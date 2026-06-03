import { connectDb } from "@/lib/db";
import Member from "@/models/Member";
import { getWalkablePoint } from "@/lib/walkableArea";
import mongoose from "mongoose";

import Level from "@/models/Level";
import CourseConfig from "@/models/CourseConfig";

const DEFAULT_STAGE = "game-demo-1";
const DEFAULT_COINS = 0;
export const MEMBER_INTERACTION_SELECT = [
  "_id",
  "discord_id",
  "nick",
  "nickname",
  "realName",
  "username",
  "discordData",
  "rank",
  "profileAchievements",
  "stage",
  "quest",
  "npcQuest",
  "questChallenge",
  "challengeFailureStage",
  "challengeFailureCount",
  "questReward",
  "roomPosition",
  "shopCooldownT1",
  "shopCooldownT2",
  "shopLimitBreak",
  "shopAssetTickets",
  "ownedAccessories",
  "equippedAccessory",
  "npcCycle",
  "npcVisitId",
  "npcVisitPurchases",
  "coin",
  "tutorial"
].join(" ");

let cachedLevels = null;
let cachedLevelsAt = 0;
let pendingLevelsLoad = null;
const LEVEL_CACHE_TTL_MS = Math.max(30_000, Number(process.env.LEVEL_CACHE_TTL_MS || 300_000));
let cachedSocialActivity = null;
let cachedSocialActivityAt = 0;
let pendingSocialActivityLoad = null;
const SOCIAL_ACTIVITY_CACHE_TTL_MS = 10_000;
const MAX_SOCIAL_ACTIVITY_ITEMS = 100;
const RANKING_CACHE_TTL_MS = Math.max(10_000, Number(process.env.RANKING_CACHE_TTL_MS || 60_000));
const cachedStageRankings = new Map();

async function ensureLevels({ force = false } = {}) {
  const cacheIsFresh =
    cachedLevels &&
    Date.now() - cachedLevelsAt < LEVEL_CACHE_TTL_MS;

  if (!force && cacheIsFresh) return cachedLevels;

  if (!pendingLevelsLoad) {
    pendingLevelsLoad = (async () => {
      await connectDb();
      const levels = await Level.find().sort({ order: 1 }).lean();
      cachedLevels = levels.map(l => ({
        stageId:  l.stageId,
        name:     l.name,
        order:    l.order,
        npcShop:  l.npcShop  || [],
        boxDrops: l.boxDrops || [],
        npcSpawns:l.npcSpawns || [],
      }));
      cachedLevelsAt = Date.now();
      return cachedLevels;
    })().catch((err) => {
      console.error("Failed to load levels in player.js", err);
      cachedLevels ||= [];
      cachedLevelsAt = Date.now();
      return cachedLevels;
    }).finally(() => {
      pendingLevelsLoad = null;
    });
  }

  return pendingLevelsLoad;
}

function firstConfiguredStage() {
  return cachedLevels?.[0]?.stageId || DEFAULT_STAGE;
}

export async function getFirstConfiguredStage() {
  await connectDb();
  await ensureLevels();
  return firstConfiguredStage();
}

function toRoman(number) {
  const values = [
    [1000, "M"], [900, "CM"], [500, "D"], [400, "CD"], [100, "C"], [90, "XC"], [50, "L"], [40, "XL"], [10, "X"], [9, "IX"], [5, "V"], [4, "IV"], [1, "I"]
  ];
  let remaining = Math.max(1, Number(number) || 1);
  let result = "";
  for (const [value, numeral] of values) {
    while (remaining >= value) {
      result += numeral;
      remaining -= value;
    }
  }
  return result;
}

function getStageNumber(stage = DEFAULT_STAGE) {
  if (cachedLevels && cachedLevels.length > 0) {
    const idx = cachedLevels.findIndex(l => l.stageId === stage);
    if (idx !== -1) return idx + 1;
  }
  return Number.parseInt(String(stage).split("-").pop(), 10) || 1;
}

function getTaskName(stage = DEFAULT_STAGE) {
  if (cachedLevels && cachedLevels.length > 0) {
    const lvl = cachedLevels.find(l => l.stageId === stage);
    if (lvl) return lvl.name;
  }
  return `Game Demo - ${toRoman(getStageNumber(stage))}`;
}

function getSublevelLabel(stage, failureCount = 0) {
  const label = getTaskName(stage);
  const count = Math.max(0, Number(failureCount) || 0);
  return count > 0 ? `${label}-${toRoman(count + 1)}` : label;
}

function getChallengeReviewBadge(member) {
  const challenge = member?.questChallenge;
  if (!challenge || challenge.approvedAt || challenge.status === "approved") return null;
  const requestedAt = new Date(challenge.requestedAt || 0).getTime();
  const matchesAttempt = (badge, fallbackAwardedAt) => {
    if (!badge) return false;
    const awardedAt = new Date(badge.awardedAt || fallbackAwardedAt || 0).getTime();
    return Boolean(awardedAt && awardedAt >= requestedAt);
  };
  if (challenge.badge) return challenge.badge;
  if (
    matchesAttempt(member.questReward?.badge, member.questReward?.awardedAt)
    && (
      member.questReward?.taskId === challenge.taskId
      || member.questReward?.taskName === challenge.taskName
      || member.questReward?.badge?.label === challenge.taskName
    )
  ) {
    return member.questReward.badge;
  }
  return (member.profileAchievements || []).find((badge) => (
    badge?.label === challenge.taskName && matchesAttempt(badge)
  )) || null;
}

function challengeFailureKey(member) {
  const challenge = member?.questChallenge;
  const badge = getChallengeReviewBadge(member);
  const status = String(challenge?.status || "").toLowerCase();
  const isExplicitFailure = ["failed", "rejected", "declined"].includes(status);
  if (!challenge || (!badge && !isExplicitFailure)) return "";
  const requestedAt = new Date(challenge.requestedAt || 0).getTime();
  const awardedAt = new Date(badge?.awardedAt || member.questReward?.awardedAt || 0).getTime();
  return [
    challenge.stage || "",
    requestedAt || "",
    challenge.submissionId || "",
    badge?.id || badge?.label || status,
    awardedAt || ""
  ].join(":");
}

async function reconcileChallengeSublevel(member) {
  if (!member) return member;
  const stage = member.stage || DEFAULT_STAGE;
  let changed = false;

  if (member.challengeFailureStage && member.challengeFailureStage !== stage) {
    member.challengeFailureStage = stage;
    member.challengeFailureCount = 0;
    member.challengeFailureHandledKey = "";
    changed = true;
  }

  const failureKey = challengeFailureKey(member);
  if (failureKey && member.challengeFailureHandledKey !== failureKey) {
    member.challengeFailureStage = stage;
    member.challengeFailureCount = Math.max(0, Number(member.challengeFailureCount) || 0) + 1;
    member.challengeFailureHandledKey = failureKey;
    member.questChallenge.status = "failed";
    member.quest = {
      current: member.quest?.current || getTaskName(stage),
      status: "active",
      completed: member.quest?.completed || [],
      cooldownUntil: member.quest?.cooldownUntil,
      costMultiplier: member.quest?.costMultiplier || 1
    };
    member.markModified("questChallenge");
    member.markModified("quest");
    changed = true;
  }

  if (changed) await member.save({ validateModifiedOnly: true });
  return member;
}

function normalizeBadge(badge) {
  if (!badge) return null;
  return {
    id: badge.id || "",
    label: badge.label || "Badge",
    sublabel: badge.sublabel || "",
    kind: badge.kind || "",
    icon: badge.icon || "",
    awardedAt: badge.awardedAt || null
  };
}

function normalizeNpcQuestSubmission(submission) {
  const likes = Array.isArray(submission.likes) ? submission.likes.map(String) : [];
  const dislikes = Array.isArray(submission.dislikes) ? submission.dislikes.map(String) : [];
  return {
    id: submission.id || "",
    title: submission.title || "NPC Quest",
    description: submission.description || "",
    difficulty: submission.difficulty || "",
    reward: submission.reward || 0,
    npcType: submission.npcType || "",
    npcName: submission.npcName || "",
    npcCharacter: submission.npcCharacter || "",
    source: submission.source || "npc-quest",
    postText: submission.postText || "",
    likeCount: likes.length,
    dislikeCount: dislikes.length,
    evidence: submission.evidence
      ? {
          url: submission.evidence.url || "",
          pathname: submission.evidence.pathname || "",
          contentType: submission.evidence.contentType || "",
          size: submission.evidence.size || 0,
          originalName: submission.evidence.originalName || ""
        }
      : null,
    submittedAt: submission.submittedAt || null
  };
}

function normalizeTutorial(tutorial) {
  if (!tutorial?.status) return null;
  return {
    status: tutorial.status,
    step: tutorial.step || "",
    startedAt: tutorial.startedAt || null,
    updatedAt: tutorial.updatedAt || null,
    roleNpcAvailableAt: tutorial.roleNpcAvailableAt || null,
    completedAt: tutorial.completedAt || null
  };
}

function isGlobalQuestSubmissionVisible(member, submission) {
  if (submission?.source !== "challenge") return true;

  const challenge = member?.questChallenge;
  return Boolean(
    challenge
    && challenge.submissionId === submission.id
    && (challenge.approvedAt || challenge.status === "approved")
  );
}

function normalizeSocialQuestSubmissions(member) {
  return (member.npcQuestSubmissions || [])
    .filter((submission) => isGlobalQuestSubmissionVisible(member, submission))
    .map(normalizeNpcQuestSubmission)
    .filter((submission) => submission.evidence?.url)
    .sort((a, b) => new Date(b.submittedAt || 0) - new Date(a.submittedAt || 0));
}

function socialPublishedAt(member, submission) {
  if (submission?.source === "challenge") {
    return member?.questChallenge?.submissionId === submission.id
      ? member.questChallenge.approvedAt || null
      : null;
  }
  return submission?.submittedAt || null;
}

function normalizeSocialNotification(member, submission) {
  if (!isGlobalQuestSubmissionVisible(member, submission) || !submission?.evidence?.url) return null;
  const author = normalizeMember(member);
  const publishedAt = socialPublishedAt(member, submission);
  if (!publishedAt) return null;
  return {
    id: String(submission.id || ""),
    type: submission.source === "challenge" ? "challenge" : "npc-quest",
    title: submission.title || (submission.source === "challenge" ? "Challenge" : "NPC Quest"),
    publishedAt,
    author: {
      id: author.discordId,
      name: author.name,
      username: author.username
    }
  };
}

function normalizeNpcQuestEvidence(discordId, evidence) {
  const url = String(evidence?.url || "").trim();
  const pathname = String(evidence?.pathname || "").trim();
  const contentType = String(evidence?.contentType || "").toLowerCase();
  const size = Math.max(0, Number(evidence?.size) || 0);
  const originalName = String(evidence?.originalName || "").slice(0, 180);
  const safeDiscordId = String(discordId || "").replace(/[^a-zA-Z0-9._-]+/g, "-");
  const blobPrefix = `npc-quests/${safeDiscordId}/`;

  let parsedUrl;
  try {
    parsedUrl = new URL(url);
  } catch {
    throw new Error("invalid_quest_evidence_url");
  }

  const isBlobUrl = parsedUrl.protocol === "https:"
    && parsedUrl.hostname.endsWith(".blob.vercel-storage.com")
    && pathname.startsWith(blobPrefix);

  const configuredOrigin = process.env.NEXTAUTH_URL
    ? new URL(process.env.NEXTAUTH_URL).origin
    : "";
  const gridFsId = parsedUrl.searchParams.get("file") || "";
  const isGridFsUrl = mongoose.Types.ObjectId.isValid(gridFsId)
    && pathname === `gridfs/${safeDiscordId}/${gridFsId}`
    && parsedUrl.pathname.endsWith("/api/player/npc-quest/upload")
    && (!configuredOrigin || parsedUrl.origin === configuredOrigin);

  // Cloudflare R2: pathname is "r2/npc-quests/<discordId>/..."
  const r2PublicBase = String(process.env.R2_PUBLIC_BASE_URL || "").replace(/\/+$/, "");
  const r2PathPrefix = `npc-quests/${safeDiscordId}/`;
  const isR2Url = r2PublicBase
    && url.startsWith(`${r2PublicBase}/`)
    && pathname.startsWith(`r2/${r2PathPrefix}`);

  const isAllowedType = contentType.startsWith("image/") || contentType.startsWith("video/");

  if (!isBlobUrl && !isGridFsUrl && !isR2Url) throw new Error("invalid_quest_evidence_url");
  if (!isAllowedType) throw new Error("invalid_quest_evidence_type");
  if (!size || size > 100 * 1024 * 1024) throw new Error("invalid_quest_evidence_size");

  return { url, pathname, contentType, size, originalName };
}

export function getDiscordAvatar(discordId, avatarHash) {
  if (!discordId || !avatarHash) return "";
  return `https://cdn.discordapp.com/avatars/${discordId}/${avatarHash}.png?size=128`;
}

export function normalizeMember(member, options = {}) {
  const includeSubmissions = options.includeSubmissions !== false;
  const submissionLimit = Math.max(0, Number(options.submissionLimit) || 0);
  const npcQuestSubmissions = submissionLimit
    ? (member.npcQuestSubmissions || []).slice(-submissionLimit)
    : (member.npcQuestSubmissions || []);
  const memberObject = member.toObject?.() || member;
  const discord = member.discordData || {};
  const coinNumber = Number.parseInt(member.coin || DEFAULT_COINS, 10);
  
  const stage = member.stage || DEFAULT_STAGE;
  const stageNumber = getStageNumber(stage);
  const challengeFailureCount = member.challengeFailureStage === stage
    ? Math.max(0, Number(member.challengeFailureCount) || 0)
    : 0;
  const costMultiplier = member.quest?.costMultiplier || 1;
  const currentChallengeCost = Math.round(250 * Math.pow(1.35, Math.max(0, stageNumber - 1))) * costMultiplier;

  return {
    id: String(member._id),
    discordId: member.discord_id || "",
    name:
      member.nick ||
      member.nickname ||
      member.realName ||
      discord.globalName ||
      discord.username ||
      "Player",
    username: discord.username || member.username || "",
    avatar: discord.avatarUrl || "",
    rank: member.rank || "Game Tester",
    achievements: (member.profileAchievements || []).map(normalizeBadge),
    stage: member.stage || DEFAULT_STAGE,
    stageLabel: getSublevelLabel(member.stage, challengeFailureCount),
    challengeFailureCount,
    coins: Number.isFinite(coinNumber) ? coinNumber : DEFAULT_COINS,
    quest: member.quest || {},
    npcQuest: member.npcQuest
      ? {
          difficulty:   member.npcQuest.difficulty || "",
          title:        member.npcQuest.title || "",
          description:  member.npcQuest.description || "",
          reward:       member.npcQuest.reward || 0,
          cancelPenalty:member.npcQuest.cancelPenalty || 0,
          source:
            member.npcQuest.source ||
            (member.npcQuest.npcType === "quest" ? "shop" : "visitor"),
          npcType:      member.npcQuest.npcType || "",
          npcName:      member.npcQuest.npcName || "",
          npcCharacter: member.npcQuest.npcCharacter || null,
          acceptedAt:   member.npcQuest.acceptedAt || null,
          cancelAvailableAt: member.npcQuest.cancelAvailableAt || null,
        }
      : null,
    npcQuestSubmissions: includeSubmissions
      ? npcQuestSubmissions.map(normalizeNpcQuestSubmission)
      : [],
    socialQuestSubmissions: includeSubmissions
      ? normalizeSocialQuestSubmissions({ ...memberObject, npcQuestSubmissions })
      : [],
    tutorial: normalizeTutorial(member.tutorial),
    challenge: member.questChallenge || null,
    reward: member.questReward
      ? {
          id: member.questReward.id || "",
          taskId: member.questReward.taskId || "",
          taskName: member.questReward.taskName || "",
          badge: normalizeBadge(member.questReward.badge),
          awardedAt: member.questReward.awardedAt || null,
          seenAt: member.questReward.seenAt || null
        }
      : null,
    position: member.roomPosition || { x: 50, y: 70 },
    currentChallengeCost,
    costMultiplier,
    shopCooldownT1: member.shopCooldownT1 || 0,
    shopCooldownT2: member.shopCooldownT2 || 0,
    shopLimitBreak: Boolean(member.shopLimitBreak),
    shopAssetTickets: member.shopAssetTickets || 0,
    ownedAccessories: Array.isArray(member.ownedAccessories) ? member.ownedAccessories.map(String) : [],
    equippedAccessory: String(member.equippedAccessory || ""),
    npcVisitId: String(member.npcVisitId || ""),
    npcVisitPurchases: Array.isArray(member.npcVisitPurchases) ? member.npcVisitPurchases.map(String) : [],
  };
}

export function normalizeMemberInteraction(member) {
  return normalizeMember(member, { includeSubmissions: false });
}

export async function upsertMemberFromDiscord(profile) {
  await connectDb();
  await ensureLevels();

  const discordId = String(profile?.id || "");
  if (!discordId) throw new Error("Discord profile is missing id");

  const avatarUrl = getDiscordAvatar(discordId, profile.avatar) || profile.image_url || "";
  const username = String(profile.username || "").trim();
  const globalName = String(profile.global_name || profile.globalName || "").trim();
  const initialPosition = {
    x: 48 + Math.round(Math.random() * 10),
    y: 68 + Math.round(Math.random() * 12),
    updatedAt: new Date()
  };
  const initialStage = firstConfiguredStage();

  await Member.findOneAndUpdate(
    { discord_id: discordId },
    {
      $set: {
        email: profile.email || undefined,
        lastAuthentication: new Date(),
        "discordData.id": discordId,
        "discordData.username": username,
        "discordData.globalName": globalName,
        "discordData.avatar": profile.avatar || "",
        "discordData.avatarUrl": avatarUrl
      },
      $setOnInsert: {
        discord_id: discordId,
        fullname: globalName || username || `Discord ${discordId.slice(-4)}`,
        nick: globalName || username || "Player",
        coin: String(DEFAULT_COINS),
        stage: initialStage,
        quest: {
          current: "อยากเห็นรูปเดี่ยวตัวละครเจ้า (ตอนแยกสาย) จัง",
          status: "active",
          completed: []
        },
        tutorial: {
          status: "active",
          step: "welcome-1",
          startedAt: new Date(),
          updatedAt: new Date()
        },
        roomPosition: initialPosition
      }
    },
    { new: true, upsert: true }
  );

  await Promise.all([
    Member.updateOne(
      { discord_id: discordId, stage: { $exists: false } },
      { $set: { stage: initialStage } }
    ),
    Member.updateOne(
      { discord_id: discordId, quest: { $exists: false } },
      {
        $set: {
          quest: {
            current: "อยากเห็นรูปเดี่ยวตัวละครเจ้า (ตอนแยกสย) จัง",
            status: "active",
            completed: []
          }
        }
      }
    ),
    Member.updateOne(
      { discord_id: discordId, roomPosition: { $exists: false } },
      { $set: { roomPosition: initialPosition } }
    )
  ]);

  const member = await Member.findOne({ discord_id: discordId });
  return normalizeMember(member);
}

export async function getMemberByDiscordId(discordId, options = {}) {
  await connectDb();
  await ensureLevels();
  const includeSubmissions = options.includeSubmissions !== false;
  const selectFields = includeSubmissions
    ? null
    : MEMBER_INTERACTION_SELECT;
  const submissionLimit = Math.max(0, Number(options.submissionLimit) || 0);

  let member = null;
  // If it's a 24-character hex string, search by _id first
  if (/^[0-9a-fA-F]{24}$/.test(discordId)) {
    const query = Member.findById(discordId);
    if (selectFields) query.select(selectFields);
    if (submissionLimit) query.slice("npcQuestSubmissions", -submissionLimit);
    member = await query;
  }

  if (!member) {
    const query = Member.findOne({ discord_id: String(discordId || "") });
    if (selectFields) query.select(selectFields);
    if (submissionLimit) query.slice("npcQuestSubmissions", -submissionLimit);
    member = await query;
  }

  if (
    member
    && member.tutorial?.status !== "active"
    && cachedLevels?.length
    && !cachedLevels.some((level) => level.stageId === member.stage)
  ) {
    member.stage = firstConfiguredStage();
    await member.save({ validateModifiedOnly: true });
  }

  if (!member) return null;
  const reconciled = await reconcileChallengeSublevel(member);
  return includeSubmissions
    ? normalizeMember(reconciled, { submissionLimit })
    : normalizeMemberInteraction(reconciled);
}

export async function getRoomPlayers(stage = DEFAULT_STAGE) {
  await connectDb();
  await ensureLevels();
  const members = await Member.find({
    stage: String(stage || DEFAULT_STAGE),
    discord_id: { $exists: true, $ne: "" },
    lastAuthentication: { $exists: true, $ne: null },
    npcCycle: { $exists: true, $ne: null }
  })
    .select(MEMBER_INTERACTION_SELECT)
    .sort({ lastAuthentication: -1 });

  await Promise.all(members.map(reconcileChallengeSublevel));
  return members.map((member) => {
    const normalized = normalizeMemberInteraction(member);
    return {
      id: normalized.discordId,
      name: normalized.name,
      username: normalized.username,
      avatar: normalized.avatar,
      rank: normalized.rank,
      achievements: normalized.achievements,
      equippedAccessory: normalized.equippedAccessory,
      stage: normalized.stage,
      challengeFailureCount: normalized.challengeFailureCount,
      x: Number(normalized.position?.x || 50),
      y: Number(normalized.position?.y || 70),
      action: "idle",
      online: false
    };
  });
}

export async function updateMemberPosition(discordId, position) {
  await connectDb();
  const nextPosition = getWalkablePoint(position);
  if (!nextPosition) return null;

  const result = await Member.updateOne(
    { discord_id: String(discordId || "") },
    {
      $set: {
        roomPosition: {
          x: nextPosition.x,
          y: nextPosition.y,
          updatedAt: new Date()
        }
      }
    }
  );

  return result.matchedCount ? { ok: true, position: nextPosition } : null;
}

export async function transferCoins(senderDiscordId, recipientDiscordId, amount) {
  await connectDb();
  await ensureLevels();

  const senderId = String(senderDiscordId || "");
  const recipientId = String(recipientDiscordId || "");
  const coinAmount = Number(amount);
  if (!Number.isInteger(coinAmount) || coinAmount < 1 || coinAmount > 1_000_000) {
    throw new Error("invalid_trade_amount");
  }
  if (!senderId || !recipientId) throw new Error("player_not_found");
  if (senderId === recipientId) throw new Error("cannot_trade_self");

  const recipientExists = await Member.exists({ discord_id: recipientId });
  if (!recipientExists) throw new Error("recipient_not_found");

  const coinValue = {
    $convert: {
      input: { $ifNull: ["$coin", "0"] },
      to: "int",
      onError: 0,
      onNull: 0
    }
  };

  const sender = await Member.findOneAndUpdate(
    {
      discord_id: senderId,
      $expr: { $gte: [coinValue, coinAmount] }
    },
    [{ $set: { coin: { $toString: { $subtract: [coinValue, coinAmount] } } } }],
    { new: true }
  );

  if (!sender) {
    const senderExists = await Member.exists({ discord_id: senderId });
    if (!senderExists) throw new Error("player_not_found");
    throw new Error("not_enough_coins");
  }

  try {
    const recipient = await Member.findOneAndUpdate(
      { discord_id: recipientId },
      [{ $set: { coin: { $toString: { $add: [coinValue, coinAmount] } } } }],
      { new: true }
    );
    if (!recipient) throw new Error("recipient_not_found");

    return {
      amount: coinAmount,
      member: normalizeMember(sender),
      recipient: {
        id: recipient.discord_id || "",
        name: normalizeMember(recipient).name
      }
    };
  } catch (error) {
    await Member.updateOne(
      { discord_id: senderId },
      [{ $set: { coin: { $toString: { $add: [coinValue, coinAmount] } } } }]
    );
    throw error;
  }
}

export async function requestChallenge(discordId) {
  await connectDb();
  await ensureLevels();
  const member = await Member.findOne({ discord_id: String(discordId || "") }).select(MEMBER_INTERACTION_SELECT);
  if (!member) return null;

  const currentCoins = Number.parseInt(member.coin || DEFAULT_COINS, 10);
  const stage = member.stage || DEFAULT_STAGE;
  const stageNumber = getStageNumber(stage);
  const costMultiplier = member.quest?.costMultiplier || 1;
  const cost = 100 * costMultiplier;

  if (currentCoins < cost) {
    return { ok: false, reason: "not_enough_coins", cost, member: normalizeMemberInteraction(member) };
  }

  if (member.questChallenge?.status === "pending" && member.questChallenge.stage === stage) {
    return { ok: true, pending: true, cost, member: normalizeMemberInteraction(member) };
  }

  const requestedAt = new Date();
  member.coin = String(currentCoins - cost);
  member.questChallengeRequestedAt = requestedAt;
  member.questChallenge = {
    status: "pending",
    taskId: stage,
    taskName: getTaskName(stage),
    stage,
    cost,
    requestedAt
  };
  member.quest = {
    current: member.quest?.current || getTaskName(stage),
    status: "pending",
    completed: member.quest?.completed || [],
    cooldownUntil: member.quest?.cooldownUntil,
    costMultiplier: costMultiplier
  };
  await member.save({ validateModifiedOnly: true });

  return { ok: true, pending: true, cost, member: normalizeMemberInteraction(member) };
}

export async function submitChallenge(discordId, evidence, postText = "") {
  await connectDb();
  await ensureLevels();
  const member = await Member.findOne({ discord_id: String(discordId || "") })
    .select(`${MEMBER_INTERACTION_SELECT} npcQuestSubmissions`);
  if (!member) return null;
  if (member.questChallenge?.status !== "pending") throw new Error("pending_challenge_not_found");

  const normalizedEvidence = normalizeNpcQuestEvidence(discordId, evidence);
  if (!String(normalizedEvidence.contentType || "").startsWith("image/")) {
    throw new Error("challenge_image_required");
  }

  const submittedAt = new Date();
  const submissionId = member.questChallenge.submissionId
    || `${String(discordId || "")}-challenge-${submittedAt.getTime()}`;
  const normalizedPostText = String(postText || "").trim().slice(0, 500);
  const submission = {
    id: submissionId,
    title: member.questChallenge.taskName || getTaskName(member.questChallenge.stage),
    description: "Challenge submission",
    difficulty: "challenge",
    reward: 0,
    npcType: "challenge",
    npcName: "",
    npcCharacter: "",
    source: "challenge",
    evidence: normalizedEvidence,
    postText: normalizedPostText,
    likes: [],
    dislikes: [],
    submittedAt
  };

  if (!Array.isArray(member.npcQuestSubmissions)) member.npcQuestSubmissions = [];
  const existingIndex = member.npcQuestSubmissions.findIndex((item) => item.id === submissionId);
  if (existingIndex >= 0) {
    submission.likes = member.npcQuestSubmissions[existingIndex].likes || [];
    submission.dislikes = member.npcQuestSubmissions[existingIndex].dislikes || [];
    member.npcQuestSubmissions[existingIndex] = submission;
  } else {
    member.npcQuestSubmissions.push(submission);
  }

  member.questChallenge.submissionId = submissionId;
  member.questChallenge.evidence = normalizedEvidence;
  member.questChallenge.postText = normalizedPostText;
  member.questChallenge.submittedAt = submittedAt;
  member.markModified("questChallenge");
  member.markModified("npcQuestSubmissions");
  await member.save({ validateModifiedOnly: true });

  return {
    member: normalizeMemberInteraction(member),
    submission: normalizeNpcQuestSubmission(submission)
  };
}

export async function acknowledgeReward(discordId, rewardId) {
  await connectDb();
  await ensureLevels();
  const member = await Member.findOne({ discord_id: String(discordId || "") });
  if (!member) return null;

  if (member.questReward?.id && member.questReward.id === String(rewardId || "")) {
    member.questReward.seenAt = new Date();
    await member.save({ validateModifiedOnly: true });
  }

  return normalizeMember(member);
}

export async function getAvailableLevels() {
  await connectDb();
  await ensureLevels();
  return cachedLevels || [];
}

export async function getStageRanking(stageId) {
  await connectDb();
  await ensureLevels();
  
  const level = cachedLevels.find(l => l.stageId === stageId) || cachedLevels[0];
  if (!level) return [];
  const cacheKey = String(level.stageId || level.name || stageId || "");
  const cached = cachedStageRankings.get(cacheKey);
  if (cached && Date.now() - cached.loadedAt < RANKING_CACHE_TTL_MS) {
    return cached.ranking;
  }

  const members = await Member.find({
    discord_id: { $exists: true, $ne: "" },
    "profileAchievements.label": level.name
  }).lean();

  const gradeValues = {
    master: 6,
    diamond: 5,
    platinum: 4,
    gold: 3,
    silver: 2,
    bronze: 1
  };

  const rankedPlayers = members.map(m => {
    const badge = m.profileAchievements.find(a => a.label === level.name);
    const normalized = normalizeMember(m);
    return {
      id: normalized.id,
      name: normalized.name,
      username: normalized.username,
      avatar: normalized.avatar,
      badge: {
        id: badge?.id || "",
        label: badge?.label || "",
        kind: badge?.kind || "bronze",
        icon: badge?.icon || "",
        awardedAt: badge?.awardedAt || null
      },
      gradeValue: gradeValues[badge?.kind] || 0
    };
  });

  // Sort by gradeValue descending, then by awardedAt ascending (earliest first)
  rankedPlayers.sort((a, b) => {
    if (b.gradeValue !== a.gradeValue) {
      return b.gradeValue - a.gradeValue;
    }
    const timeA = a.badge.awardedAt ? new Date(a.badge.awardedAt).getTime() : Infinity;
    const timeB = b.badge.awardedAt ? new Date(b.badge.awardedAt).getTime() : Infinity;
    return timeA - timeB;
  });

  const ranking = rankedPlayers.map((p, idx) => ({
    rank: idx + 1,
    id: p.id,
    name: p.name,
    username: p.username,
    avatar: p.avatar,
    badge: p.badge
  }));
  cachedStageRankings.set(cacheKey, { ranking, loadedAt: Date.now() });
  return ranking;
}

export async function acceptNpcQuest(discordId, questData) {
  await connectDb();
  await ensureLevels();
  const reward = Math.max(0, Number(questData.reward) || 0);
  const cancelPenalty = reward > 0 ? Math.max(1, Math.round(reward * 0.25)) : 0;
  const member = await Member.findOneAndUpdate(
    {
      discord_id: String(discordId || ""),
      $or: [{ npcQuest: null }, { npcQuest: { $exists: false } }]
    },
    {
      $set: {
        npcQuest: {
          difficulty:   questData.difficulty,
          title:        questData.title,
          description:  questData.description,
          reward,
          cancelPenalty,
          source:       questData.source || "visitor",
          npcType:      questData.npcType || "",
          npcName:      questData.npcName || "",
          npcCharacter: questData.npcCharacter || null,
          acceptedAt:   new Date(),
        }
      }
    },
    { new: true, projection: MEMBER_INTERACTION_SELECT }
  );
  if (member) return normalizeMemberInteraction(member);

  const existingMember = await Member.exists({ discord_id: String(discordId || "") });
  if (!existingMember) return null;
  throw new Error("active_quest_exists");
}

export async function cancelNpcQuest(discordId) {
  await connectDb();
  await ensureLevels();
  const member = await Member.findOne({ discord_id: String(discordId || "") }).select(MEMBER_INTERACTION_SELECT);
  if (!member) return null;

  const questSource = member.npcQuest?.source || "";
  if (questSource === "tutorial-first-quest") throw new Error("tutorial_quest_cannot_cancel");
  if (
    questSource === "tutorial-role"
    && new Date(member.npcQuest?.cancelAvailableAt || 0).getTime() > Date.now()
  ) {
    throw new Error("tutorial_role_cancel_locked");
  }

  const currentCoins = Math.max(0, Number.parseInt(member.coin || "0", 10) || 0);
  const storedPenalty = Number(member.npcQuest?.cancelPenalty) || 0;
  const fallbackPenalty = member.npcQuest?.reward
    ? Math.max(1, Math.round(Number(member.npcQuest.reward) * 0.25))
    : 0;
  const penalty = member.npcQuest && questSource !== "tutorial-role"
    ? Math.min(currentCoins, Math.max(0, storedPenalty || fallbackPenalty))
    : 0;
  member.coin = String(currentCoins - penalty);
  member.npcQuest = null;
  if (questSource === "tutorial-role") {
    member.tutorial = {
      ...(member.tutorial?.toObject?.() || member.tutorial || {}),
      status: "active",
      step: "social-intro",
      updatedAt: new Date()
    };
    member.markModified("tutorial");
  }
  await member.save();
  return { member: normalizeMemberInteraction(member), penalty };
}

export async function submitNpcQuest(discordId, evidence, postText = "") {
  await connectDb();
  await ensureLevels();
  const member = await Member.findOne({ discord_id: String(discordId || "") })
    .select(`${MEMBER_INTERACTION_SELECT} npcQuestSubmissions`);
  if (!member) return null;
  if (!member.npcQuest) throw new Error("active_quest_not_found");

  const normalizedEvidence = normalizeNpcQuestEvidence(discordId, evidence);
  const questSource = member.npcQuest.source || "";

  const currentCoins = Math.max(0, Number.parseInt(member.coin || "0", 10) || 0);
  const reward = Math.max(0, Number(member.npcQuest.reward) || 0);
  const submittedAt = new Date();
  if (!Array.isArray(member.npcQuestSubmissions)) member.npcQuestSubmissions = [];
  member.npcQuestSubmissions.push({
    id: `${String(discordId || "")}-${submittedAt.getTime()}`,
    title: member.npcQuest.title || "NPC Quest",
    description: member.npcQuest.description || "",
    difficulty: member.npcQuest.difficulty || "",
    reward,
    npcType: member.npcQuest.npcType || "",
    npcName: member.npcQuest.npcName || "",
    npcCharacter: member.npcQuest.npcCharacter || "",
    source: "npc-quest",
    evidence: normalizedEvidence,
    postText: String(postText || "").trim().slice(0, 500),
    likes: [],
    dislikes: [],
    submittedAt
  });
  member.coin = String(currentCoins + reward);
  member.npcQuest = null;
  if (!Array.isArray(member.profileAchievements)) member.profileAchievements = [];
  if (questSource === "tutorial-first-quest") {
    if (!member.profileAchievements.some((badge) => badge.id === "tutorial-time-to-begin")) {
      member.profileAchievements.push({
        id: "tutorial-time-to-begin",
        label: "Time To Begin",
        sublabel: "Tutorial Mode",
        kind: "silver",
        icon: "/assets/Rank/Silver.png",
        awardedAt: submittedAt
      });
    }
    member.tutorial = {
      ...(member.tutorial?.toObject?.() || member.tutorial || {}),
      status: "active",
      step: "after-first-quest",
      updatedAt: submittedAt
    };
  }
  if (questSource === "tutorial-role") {
    if (!member.profileAchievements.some((badge) => badge.id === "tutorial-challenge-role")) {
      member.profileAchievements.push({
        id: "tutorial-challenge-role",
        label: "Challenge Role",
        sublabel: "Tutorial Mode",
        kind: "gold",
        icon: "/assets/Rank/Gold.png",
        awardedAt: submittedAt
      });
    }
    member.rank = "Challenge Role";
    member.tutorial = {
      ...(member.tutorial?.toObject?.() || member.tutorial || {}),
      status: "active",
      step: "social-intro",
      updatedAt: submittedAt
    };
  }
  member.markModified("tutorial");
  member.markModified("profileAchievements");
  await member.save();
  return { member: normalizeMemberInteraction(member), reward, submission: normalizeNpcQuestSubmission(member.npcQuestSubmissions.at(-1)) };
}

export async function getActiveClasses() {
  await connectDb();
  const configs = await CourseConfig.find({ isActive: true }).sort({ courseName: 1 }).lean();
  return configs.map(c => ({
    sheetTitle: c.sheetTitle,
    courseName: c.courseName
  }));
}

export async function getGlobalQuestPosts(classId, viewerDiscordId) {
  await connectDb();
  const isAllCourses = String(classId || "") === "all";
  const viewerId = String(viewerDiscordId || "");
  let discordIdMatch = { $exists: true, $ne: "" };

  if (!isAllCourses) {
    const friends = await getClassFriends(classId);
    const discordIds = friends.map((friend) => friend.id).filter(Boolean);
    if (discordIds.length === 0) return [];
    discordIdMatch = { $in: discordIds };
  }

  const posts = await Member.aggregate([
    {
      $match: {
        discord_id: discordIdMatch,
        "npcQuestSubmissions.0": { $exists: true }
      }
    },
    { $unwind: "$npcQuestSubmissions" },
    {
      $addFields: {
        socialSubmission: "$npcQuestSubmissions",
        isChallengeSubmission: { $eq: ["$npcQuestSubmissions.source", "challenge"] },
        authorName: {
          $ifNull: [
            "$nick",
            {
              $ifNull: [
                "$nickname",
                {
                  $ifNull: [
                    "$realName",
                    {
                      $ifNull: [
                        "$discordData.globalName",
                        { $ifNull: ["$discordData.username", "Player"] }
                      ]
                    }
                  ]
                }
              ]
            }
          ]
        },
        authorUsername: { $ifNull: ["$username", { $ifNull: ["$discordData.username", ""] }] },
        authorAvatar: { $ifNull: ["$discordData.avatarUrl", ""] }
      }
    },
    {
      $addFields: {
        challengeIsVisible: {
          $and: [
            "$isChallengeSubmission",
            { $eq: ["$questChallenge.submissionId", "$socialSubmission.id"] },
            {
              $or: [
                { $ne: ["$questChallenge.approvedAt", null] },
                { $eq: ["$questChallenge.status", "approved"] }
              ]
            }
          ]
        },
        publishedAt: {
          $cond: [
            "$isChallengeSubmission",
            "$questChallenge.approvedAt",
            "$socialSubmission.submittedAt"
          ]
        },
        likes: { $ifNull: ["$socialSubmission.likes", []] },
        dislikes: { $ifNull: ["$socialSubmission.dislikes", []] }
      }
    },
    {
      $match: {
        $expr: {
          $and: [
            {
              $or: [
                { $ne: ["$isChallengeSubmission", true] },
                "$challengeIsVisible"
              ]
            },
            { $ne: ["$socialSubmission.evidence.url", null] },
            { $ne: ["$socialSubmission.evidence.url", ""] },
            { $ne: ["$publishedAt", null] }
          ]
        }
      }
    },
    { $sort: { publishedAt: -1 } },
    { $limit: 50 },
    {
      $project: {
        _id: 0,
        id: { $toString: "$socialSubmission.id" },
        title: { $ifNull: ["$socialSubmission.title", "NPC Quest"] },
        description: { $ifNull: ["$socialSubmission.description", ""] },
        difficulty: { $ifNull: ["$socialSubmission.difficulty", ""] },
        reward: { $ifNull: ["$socialSubmission.reward", 0] },
        npcType: { $ifNull: ["$socialSubmission.npcType", ""] },
        npcName: { $ifNull: ["$socialSubmission.npcName", ""] },
        npcCharacter: { $ifNull: ["$socialSubmission.npcCharacter", ""] },
        source: { $ifNull: ["$socialSubmission.source", "npc-quest"] },
        postText: { $ifNull: ["$socialSubmission.postText", ""] },
        evidence: {
          url: { $ifNull: ["$socialSubmission.evidence.url", ""] },
          pathname: { $ifNull: ["$socialSubmission.evidence.pathname", ""] },
          contentType: { $ifNull: ["$socialSubmission.evidence.contentType", ""] },
          size: { $ifNull: ["$socialSubmission.evidence.size", 0] },
          originalName: { $ifNull: ["$socialSubmission.evidence.originalName", ""] }
        },
        likeCount: { $size: "$likes" },
        dislikeCount: { $size: "$dislikes" },
        submittedAt: "$publishedAt",
        author: {
          id: "$discord_id",
          name: "$authorName",
          username: "$authorUsername",
          avatar: "$authorAvatar"
        },
        viewerReaction: {
          $cond: [
            { $in: [viewerId, "$likes"] },
            "like",
            {
              $cond: [
                { $in: [viewerId, "$dislikes"] },
                "dislike",
                ""
              ]
            }
          ]
        }
      }
    }
  ]).option({ allowDiskUse: true });

  return posts;
}

async function loadSocialActivity() {
  const cacheIsFresh =
    cachedSocialActivity &&
    Date.now() - cachedSocialActivityAt < SOCIAL_ACTIVITY_CACHE_TTL_MS;
  if (cacheIsFresh) return cachedSocialActivity;

  if (!pendingSocialActivityLoad) {
    pendingSocialActivityLoad = Member.aggregate([
      {
        $match: {
          discord_id: { $exists: true, $ne: "" },
          "npcQuestSubmissions.0": { $exists: true }
        }
      },
      { $unwind: "$npcQuestSubmissions" },
      {
        $addFields: {
          socialSubmission: "$npcQuestSubmissions",
          isChallengeSubmission: { $eq: ["$npcQuestSubmissions.source", "challenge"] },
          authorName: {
            $ifNull: [
              "$nick",
              {
                $ifNull: [
                  "$nickname",
                  {
                    $ifNull: [
                      "$realName",
                      {
                        $ifNull: [
                          "$discordData.globalName",
                          { $ifNull: ["$discordData.username", "Player"] }
                        ]
                      }
                    ]
                  }
                ]
              }
            ]
          },
          authorUsername: {
            $ifNull: [
              "$username",
              { $ifNull: ["$discordData.username", ""] }
            ]
          }
        }
      },
      {
        $addFields: {
          challengeIsVisible: {
            $and: [
              "$isChallengeSubmission",
              { $eq: ["$questChallenge.submissionId", "$socialSubmission.id"] },
              {
                $or: [
                  { $ne: ["$questChallenge.approvedAt", null] },
                  { $eq: ["$questChallenge.status", "approved"] }
                ]
              }
            ]
          },
          publishedAt: {
            $cond: [
              "$isChallengeSubmission",
              "$questChallenge.approvedAt",
              "$socialSubmission.submittedAt"
            ]
          }
        }
      },
      {
        $match: {
          $expr: {
            $and: [
              {
                $or: [
                  { $ne: ["$isChallengeSubmission", true] },
                  "$challengeIsVisible"
                ]
              },
              { $ne: ["$socialSubmission.evidence.url", null] },
              { $ne: ["$socialSubmission.evidence.url", ""] },
              { $ne: ["$publishedAt", null] }
            ]
          }
        }
      },
      {
        $project: {
          _id: 0,
          id: { $toString: "$socialSubmission.id" },
          authorId: "$discord_id",
          type: {
            $cond: [
              "$isChallengeSubmission",
              "challenge",
              "npc-quest"
            ]
          },
          title: {
            $ifNull: [
              "$socialSubmission.title",
              {
                $cond: [
                  "$isChallengeSubmission",
                  "Challenge",
                  "NPC Quest"
                ]
              }
            ]
          },
          publishedAt: 1,
          author: {
            id: "$discord_id",
            name: "$authorName",
            username: "$authorUsername"
          }
        }
      },
      { $sort: { publishedAt: -1 } },
      { $limit: MAX_SOCIAL_ACTIVITY_ITEMS }
    ])
      .option({ allowDiskUse: true })
      .then((items) => {
        cachedSocialActivity = (items || []).map((item) => ({
          ...item,
          publishedAt: item.publishedAt ? new Date(item.publishedAt) : null
        }));
        cachedSocialActivityAt = Date.now();
        return cachedSocialActivity;
      })
      .catch((error) => {
        console.error("Failed to load social activity cache:", error.message);
        cachedSocialActivity ||= [];
        cachedSocialActivityAt = Date.now();
        return cachedSocialActivity;
      })
      .finally(() => {
        pendingSocialActivityLoad = null;
      });
  }

  return pendingSocialActivityLoad;
}

export async function getSocialQuestStatus(discordId, since) {
  await connectDb();
  const viewerId = String(discordId || "");
  const [viewer, socialActivity] = await Promise.all([
    Member.findOne(
      { discord_id: viewerId },
      { socialLastSeenAt: 1 }
    ).lean(),
    loadSocialActivity()
  ]);
  if (!viewer) return null;

  const sinceAt = new Date(since || 0);
  const validSinceAt = Number.isFinite(sinceAt.getTime()) ? sinceAt : new Date(0);
  const lastSeenAt = new Date(viewer.socialLastSeenAt || 0);
  const visibleActivity = socialActivity.filter((item) => item.authorId !== viewerId);

  return {
    unreadCount: visibleActivity.filter((item) => item.publishedAt > lastSeenAt).length,
    notifications: visibleActivity
      .filter((item) => item.publishedAt > validSinceAt)
      .slice(0, 8)
      .map(({ authorId, ...item }) => item),
    checkedAt: new Date()
  };
}

export async function markSocialQuestSeen(discordId) {
  await connectDb();
  const member = await Member.findOneAndUpdate(
    { discord_id: String(discordId || "") },
    { $set: { socialLastSeenAt: new Date() } },
    { new: true }
  );
  return Boolean(member);
}

export async function reactToGlobalQuestPost(discordId, postId, reaction) {
  await connectDb();
  const normalizedReaction = String(reaction || "");
  if (!["", "like", "dislike"].includes(normalizedReaction)) {
    throw new Error("invalid_reaction");
  }

  const member = await Member.findOne({ "npcQuestSubmissions.id": String(postId || "") });
  if (!member) return null;

  const submission = member.npcQuestSubmissions.find((item) => item.id === String(postId || ""));
  if (!submission || !isGlobalQuestSubmissionVisible(member, submission)) return null;

  const viewerId = String(discordId || "");
  submission.likes = (submission.likes || []).map(String).filter((id) => id !== viewerId);
  submission.dislikes = (submission.dislikes || []).map(String).filter((id) => id !== viewerId);
  if (normalizedReaction === "like") submission.likes.push(viewerId);
  if (normalizedReaction === "dislike") submission.dislikes.push(viewerId);

  member.markModified("npcQuestSubmissions");
  await member.save({ validateModifiedOnly: true });
  return {
    postId: submission.id,
    viewerReaction: normalizedReaction,
    likeCount: submission.likes.length,
    dislikeCount: submission.dislikes.length
  };
}

export async function getClassFriends(classId) {
  await connectDb();
  
  const botUrl = (process.env.BOT_SERVER_URL || "https://api.hamsterquest.com/attendance").replace(/\/$/, "");
  const botTimeoutMs = Math.max(2000, Number(process.env.BOT_SERVER_TIMEOUT_MS) || 20000);
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), botTimeoutMs);

  let sheetStudents = [];
  try {
    const res = await fetch(`${botUrl}/api/attendance?course=${encodeURIComponent(classId)}`, {
      signal: controller.signal
    });
    if (res.ok) {
      const data = await res.json();
      if (data && data.success && Array.isArray(data.students)) {
        sheetStudents = data.students;
      }
    }
  } catch (err) {
    console.warn("Failed to fetch students from bot server, falling back to local DB:", err.message);
  } finally {
    clearTimeout(timeoutId);
  }

  let members = [];
  const gradeValues = {
    master: 6,
    diamond: 5,
    platinum: 4,
    gold: 3,
    silver: 2,
    bronze: 1
  };

  if (sheetStudents.length > 0) {
    const discordIds = sheetStudents.map(s => s.discordId).filter(Boolean);
    if (discordIds.length > 0) {
      members = await Member.find({
        discord_id: { $in: discordIds }
      }).lean();
    }

    const memberMap = new Map(members.map(m => [m.discord_id, m]));
    return sheetStudents.map(student => {
      const m = memberMap.get(student.discordId);
      if (m) {
        const normalized = normalizeMember(m);
        let bestBadge = null;
        let maxGrade = 0;
        (m.profileAchievements || []).forEach(badge => {
          const val = gradeValues[badge.kind] || 0;
          if (val > maxGrade) {
            maxGrade = val;
            bestBadge = badge;
          }
        });
        return {
          id: normalized.discordId,
          name: normalized.name,
          username: normalized.username,
          avatar: normalized.avatar,
          rank: normalized.rank,
          lastAuthentication: m.lastAuthentication ? m.lastAuthentication.toISOString() : null,
          isOnline: student.isOnline || false,
          bestBadge: bestBadge ? {
            id: bestBadge.id || "",
            label: bestBadge.label || "",
            kind: bestBadge.kind || "bronze",
            icon: bestBadge.icon || ""
          } : null
        };
      } else {
        return {
          id: student.discordId || `sheet-${student.sheetRowIndex}`,
          name: student.name || "Player",
          username: student.discordUsername || "",
          avatar: student.avatarUrl || "",
          rank: "Game Tester",
          lastAuthentication: null,
          isOnline: student.isOnline || false,
          bestBadge: null
        };
      }
    });
  } else {
    // Return only exact local matches if the Google Sheet service is unavailable.
    const query = {
      discord_id: { $exists: true, $ne: "" },
      courses: String(classId)
    };

    members = await Member.find(query).lean();
    return members.map(m => {
      const normalized = normalizeMember(m);
      let bestBadge = null;
      let maxGrade = 0;
      (m.profileAchievements || []).forEach(badge => {
        const val = gradeValues[badge.kind] || 0;
        if (val > maxGrade) {
          maxGrade = val;
          bestBadge = badge;
        }
      });
      return {
        id: normalized.discordId,
        name: normalized.name,
        username: normalized.username,
        avatar: normalized.avatar,
        rank: normalized.rank,
        lastAuthentication: m.lastAuthentication ? m.lastAuthentication.toISOString() : null,
        isOnline: false,
        bestBadge: bestBadge ? {
          id: bestBadge.id || "",
          label: bestBadge.label || "",
          kind: bestBadge.kind || "bronze",
          icon: bestBadge.icon || ""
        } : null
      };
    });
  }
}
