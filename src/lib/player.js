import { connectDb } from "@/lib/db";
import Member from "@/models/Member";
import { getWalkablePoint } from "@/lib/walkableArea";
import mongoose from "mongoose";

import Level from "@/models/Level";
import CourseConfig from "@/models/CourseConfig";
import SocialPost from "@/models/SocialPost";
import { completionRewardForLevel, normalizeLevelUnlocks, unlockRewards } from "@/lib/levelUnlocks";

const DEFAULT_STAGE = "game-demo-1";
const DEFAULT_COINS = 0;
const ROOM_PLAYERS_CACHE_TTL_MS = Math.max(0, Number(process.env.ROOM_PLAYERS_CACHE_TTL_MS || 5_000));
const ROOM_PLAYERS_CACHE_MAX_STAGES = Math.max(10, Number(process.env.ROOM_PLAYERS_CACHE_MAX_STAGES || 200));
const ROOM_PLAYERS_LIMIT = Math.max(50, Number(process.env.ROOM_PLAYERS_LIMIT || 200));
export const MEMBER_INTERACTION_SELECT = [
  "_id",
  "discord_id",
  "nick",
  "nickname",
  "realName",
  "username",
  "discordData",
  "questroomRank",
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
  "questCoin",
  "tutorial"
].join(" ");
const ROOM_PLAYER_SELECT = [
  "discord_id",
  "nick",
  "nickname",
  "realName",
  "username",
  "discordData",
  "stage",
  "challengeFailureStage",
  "challengeFailureCount",
  "roomPosition",
  "equippedAccessory",
  "lastAuthentication",
  "npcCycle"
].join(" ");
const MEMBER_FRIEND_SELECT = [
  "discord_id",
  "nick",
  "nickname",
  "realName",
  "username",
  "discordData",
  "questroomRank",
  "lastAuthentication",
  "profileAchievements",
  "courses"
].join(" ");
const MEMBER_RANKING_SELECT = [
  "discord_id",
  "nick",
  "nickname",
  "realName",
  "username",
  "discordData",
  "profileAchievements"
].join(" ");

let cachedLevels = null;
let cachedLevelsAt = 0;
let pendingLevelsLoad = null;
const LEVEL_CACHE_TTL_MS = Math.max(30_000, Number(process.env.LEVEL_CACHE_TTL_MS || 300_000));
let cachedSocialActivity = null;
let cachedSocialActivityAt = 0;
let pendingSocialActivityLoad = null;
const SOCIAL_ACTIVITY_CACHE_TTL_MS = 10_000;
const SOCIAL_ACTIVITY_STALE_TTL_MS = Math.max(
  SOCIAL_ACTIVITY_CACHE_TTL_MS,
  Number(process.env.SOCIAL_ACTIVITY_STALE_TTL_MS || 120_000)
);
const MAX_SOCIAL_ACTIVITY_ITEMS = 100;
const GLOBAL_POSTS_CACHE_TTL_MS = Math.max(5_000, Number(process.env.GLOBAL_POSTS_CACHE_TTL_MS || 15_000));
const GLOBAL_POSTS_CACHE_MAX_KEYS = Math.max(20, Number(process.env.GLOBAL_POSTS_CACHE_MAX_KEYS || 200));
const ACTIVE_CLASSES_CACHE_TTL_MS = Math.max(30_000, Number(process.env.ACTIVE_CLASSES_CACHE_TTL_MS || 60_000));
const RANKING_CACHE_TTL_MS = Math.max(10_000, Number(process.env.RANKING_CACHE_TTL_MS || 60_000));
const RANKING_LIMIT = Math.max(10, Number(process.env.RANKING_LIMIT || 100));
const FRIENDS_CACHE_TTL_MS = Math.max(10_000, Number(process.env.FRIENDS_CACHE_TTL_MS || 60_000));
const FRIENDS_STALE_CACHE_TTL_MS = Math.max(
  FRIENDS_CACHE_TTL_MS,
  Number(process.env.FRIENDS_STALE_CACHE_TTL_MS || 900_000)
);
const FRIENDS_CACHE_MAX_KEYS = Math.max(20, Number(process.env.FRIENDS_CACHE_MAX_KEYS || 200));
const MAX_CLASS_FRIENDS = Math.max(50, Number(process.env.MAX_CLASS_FRIENDS || 500));
const MEMBER_LIST_QUERY_MAX_TIME_MS = Math.max(1_000, Number(process.env.MEMBER_LIST_QUERY_MAX_TIME_MS || 8_000));
const SOCIAL_POSTS_QUERY_MAX_TIME_MS = Math.max(1_000, Number(process.env.SOCIAL_POSTS_QUERY_MAX_TIME_MS || 3_000));
const SOCIAL_POST_AUTO_BACKFILL_ENABLED = process.env.SOCIAL_POST_AUTO_BACKFILL_ENABLED === "true";
const SOCIAL_POST_BACKFILL_MEMBER_LIMIT = Math.max(20, Number(process.env.SOCIAL_POST_BACKFILL_MEMBER_LIMIT || 100));
const SOCIAL_POST_BACKFILL_SUBMISSIONS_PER_MEMBER = Math.max(
  1,
  Math.min(20, Number(process.env.SOCIAL_POST_BACKFILL_SUBMISSIONS_PER_MEMBER || 5))
);
const SOCIAL_POST_BACKFILL_MAX_OPERATIONS = Math.max(50, Number(process.env.SOCIAL_POST_BACKFILL_MAX_OPERATIONS || 500));
const SOCIAL_POST_BACKFILL_INTERVAL_MS = Math.max(30_000, Number(process.env.SOCIAL_POST_BACKFILL_INTERVAL_MS || 300_000));
const SOCIAL_POST_FEED_LIMIT = Math.max(1, Number(process.env.SOCIAL_POST_FEED_LIMIT || 10));
const SOCIAL_POST_FEED_MAX_LIMIT = Math.max(SOCIAL_POST_FEED_LIMIT, Number(process.env.SOCIAL_POST_FEED_MAX_LIMIT || 30));
const FRIENDS_PAGE_LIMIT = Math.max(1, Number(process.env.FRIENDS_PAGE_LIMIT || 10));
const FRIENDS_PAGE_MAX_LIMIT = Math.max(FRIENDS_PAGE_LIMIT, Number(process.env.FRIENDS_PAGE_MAX_LIMIT || 50));
const MEMBER_READ_QUERY_MAX_TIME_MS = Math.max(500, Number(process.env.MEMBER_READ_QUERY_MAX_TIME_MS || 3_000));
const cachedStageRankings = new Map();
const pendingStageRankings = new Map();
const roomPlayersCache = new Map();
const pendingRoomPlayersLoad = new Map();
const roomPlayersCacheVersions = new Map();
const cachedGlobalPosts = new Map();
const pendingGlobalPosts = new Map();
const cachedClassFriends = new Map();
const pendingClassFriends = new Map();
let cachedActiveClasses = null;
let cachedActiveClassesAt = 0;
let pendingSocialPostBackfill = null;
let lastSocialPostBackfillAt = 0;

function questCoinValue(member) {
  return Number.parseInt(member?.questCoin ?? member?.coin ?? DEFAULT_COINS, 10) || DEFAULT_COINS;
}

function questCoinExpression() {
  return {
    $convert: {
      input: { $ifNull: ["$questCoin", { $ifNull: ["$coin", "0"] }] },
      to: "int",
      onError: 0,
      onNull: 0
    }
  };
}

function cloneRoomPlayers(players) {
  return players.map((player) => ({ ...player }));
}

function clearRoomPlayersCache(stage = "") {
  if (stage) {
    const stageKey = String(stage);
    roomPlayersCache.delete(stageKey);
    roomPlayersCacheVersions.set(stageKey, (roomPlayersCacheVersions.get(stageKey) || 0) + 1);
    return;
  }
  roomPlayersCache.clear();
  for (const stageKey of roomPlayersCacheVersions.keys()) {
    roomPlayersCacheVersions.set(stageKey, (roomPlayersCacheVersions.get(stageKey) || 0) + 1);
  }
}

function publicEvidenceUrl(evidence) {
  const url = String(evidence?.url || "");
  const publicBase = String(process.env.R2_PUBLIC_BASE_URL || "").replace(/\/+$/, "");
  if (!publicBase) return url;

  const pathname = String(evidence?.pathname || "");
  if (pathname.startsWith("r2/")) {
    const key = pathname.slice(3);
    return `${publicBase}/${encodeURI(key).replace(/%2F/g, "/")}`;
  }

  try {
    const parsed = new URL(url);
    if (parsed.hostname.endsWith(".r2.dev") && parsed.pathname.startsWith("/npc-quests/")) {
      return `${publicBase}${parsed.pathname}`;
    }
  } catch {
    return url;
  }
  return url;
}

function pruneGlobalPostsCache(now = Date.now()) {
  for (const [key, cached] of cachedGlobalPosts) {
    if (!cached || now - cached.cachedAt >= GLOBAL_POSTS_CACHE_TTL_MS) {
      cachedGlobalPosts.delete(key);
    }
  }
  if (cachedGlobalPosts.size <= GLOBAL_POSTS_CACHE_MAX_KEYS) return;
  const overflow = cachedGlobalPosts.size - GLOBAL_POSTS_CACHE_MAX_KEYS;
  const oldestKeys = [...cachedGlobalPosts.entries()]
    .sort(([, a], [, b]) => Number(a?.cachedAt || 0) - Number(b?.cachedAt || 0))
    .slice(0, overflow)
    .map(([key]) => key);
  for (const key of oldestKeys) cachedGlobalPosts.delete(key);
}

export function clearGlobalQuestPostsCache() {
  cachedGlobalPosts.clear();
  cachedSocialActivity = null;
  cachedSocialActivityAt = 0;
  pendingSocialActivityLoad = null;
}

function pruneRoomPlayersCache(now = Date.now()) {
  if (ROOM_PLAYERS_CACHE_TTL_MS <= 0) {
    roomPlayersCache.clear();
    return;
  }
  for (const [stage, cached] of roomPlayersCache) {
    if (!cached || now - cached.cachedAt >= ROOM_PLAYERS_CACHE_TTL_MS) {
      roomPlayersCache.delete(stage);
    }
  }
  if (roomPlayersCache.size <= ROOM_PLAYERS_CACHE_MAX_STAGES) return;
  const overflow = roomPlayersCache.size - ROOM_PLAYERS_CACHE_MAX_STAGES;
  const oldestStages = [...roomPlayersCache.entries()]
    .sort(([, a], [, b]) => Number(a?.cachedAt || 0) - Number(b?.cachedAt || 0))
    .slice(0, overflow)
    .map(([stage]) => stage);
  for (const stage of oldestStages) roomPlayersCache.delete(stage);
}

function roomPlayerFromMember(member) {
  const discord = member?.discordData || {};
  const stage = member?.stage || DEFAULT_STAGE;
  return {
    id: member?.discord_id || "",
    name:
      member?.nick ||
      member?.nickname ||
      member?.realName ||
      discord.globalName ||
      discord.username ||
      "Player",
    username: discord.username || member?.username || "",
    avatar: normalizeAvatarUrl(discord.avatarUrl || ""),
    equippedAccessory: String(member?.equippedAccessory || ""),
    stage,
    challengeFailureCount: member?.challengeFailureStage === stage
      ? Math.max(0, Number(member?.challengeFailureCount) || 0)
      : 0,
    x: Number(member?.roomPosition?.x || 50),
    y: Number(member?.roomPosition?.y || 70),
    action: "idle",
    online: false
  };
}

function publicMemberIdentity(member) {
  const discord = member?.discordData || {};
  return {
    id: member?.discord_id || "",
    discordId: member?.discord_id || "",
    name:
      member?.nick ||
      member?.nickname ||
      member?.realName ||
      discord.globalName ||
      discord.username ||
      member?.username ||
      "Player",
    username: discord.username || member?.username || "",
    avatar: normalizeAvatarUrl(discord.avatarUrl || "")
  };
}

function normalizeAvatarUrl(url, size = 64) {
  const value = String(url || "");
  if (!value) return "";
  try {
    const parsed = new URL(value);
    const isDiscordAvatar =
      (parsed.hostname === "cdn.discordapp.com" || parsed.hostname === "media.discordapp.net")
      && parsed.pathname.startsWith("/avatars/");
    if (!isDiscordAvatar) return value;
    parsed.searchParams.set("size", String(size));
    return parsed.toString();
  } catch {
    return value;
  }
}

function getBestBadge(profileAchievements = []) {
  const gradeValues = {
    master: 6,
    diamond: 5,
    platinum: 4,
    gold: 3,
    silver: 2,
    bronze: 1
  };
  let bestBadge = null;
  let maxGrade = 0;
  for (const badge of profileAchievements || []) {
    const val = gradeValues[badge?.kind] || 0;
    if (val > maxGrade) {
      maxGrade = val;
      bestBadge = badge;
    }
  }
  return bestBadge;
}

function publicBadge(badge) {
  return badge ? {
    id: badge.id || "",
    label: badge.label || "",
    kind: badge.kind || "bronze",
    icon: badge.icon || "",
    awardedAt: badge.awardedAt || null
  } : null;
}

function cloneFriends(friends) {
  return friends.map((friend) => ({
    ...friend,
    bestBadge: friend.bestBadge ? { ...friend.bestBadge } : null
  }));
}

function pruneClassFriendsCache(now = Date.now()) {
  for (const [key, cached] of cachedClassFriends) {
    if (!cached || now - cached.cachedAt >= FRIENDS_STALE_CACHE_TTL_MS) {
      cachedClassFriends.delete(key);
    }
  }
  if (cachedClassFriends.size <= FRIENDS_CACHE_MAX_KEYS) return;
  const overflow = cachedClassFriends.size - FRIENDS_CACHE_MAX_KEYS;
  const oldestKeys = [...cachedClassFriends.entries()]
    .sort(([, a], [, b]) => Number(a?.cachedAt || 0) - Number(b?.cachedAt || 0))
    .slice(0, overflow)
    .map(([key]) => key);
  for (const key of oldestKeys) cachedClassFriends.delete(key);
}

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
        unlocks: normalizeLevelUnlocks(l.unlocks || {}),
        challengeInfo: {
          title: l.challengeInfo?.title || "",
          description: l.challengeInfo?.description || "",
          videoUrl: l.challengeInfo?.videoUrl || "",
          videoPath: l.challengeInfo?.videoPath || "",
          videoContentType: l.challengeInfo?.videoContentType || "",
          rewards: Array.isArray(l.challengeInfo?.rewards) ? l.challengeInfo.rewards.map((reward) => ({
            id: String(reward?.id || ""),
            label: String(reward?.label || ""),
            image: String(reward?.image || ""),
            quantity: Math.max(0, Number(reward?.quantity) || 0),
            kind: String(reward?.kind || "item"),
          })) : unlockRewards(l.unlocks || {}, { realImages: false }),
        },
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
    badge: normalizeBadge(submission.badge),
    likeCount: likes.length,
    dislikeCount: dislikes.length,
    evidence: submission.evidence
      ? {
          url: publicEvidenceUrl(submission.evidence),
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
    && isChallengePassedToNextRoom(member, challenge)
    && (challenge.approvedAt || ["approved", "awarded"].includes(challenge.status))
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
      && isChallengePassedToNextRoom(member, member.questChallenge)
      ? member.questChallenge.approvedAt || submission.submittedAt || null
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

function socialPostDocumentFromMemberSubmission(member, submission) {
  if (!submission?.id || !submission?.evidence?.url) return null;
  const publishedAt = socialPublishedAt(member, submission);
  const visible = Boolean(publishedAt && isGlobalQuestSubmissionVisible(member, submission));
  const identity = publicMemberIdentity(member);
  const likes = Array.isArray(submission.likes) ? submission.likes.map(String) : [];
  const dislikes = Array.isArray(submission.dislikes) ? submission.dislikes.map(String) : [];

  return {
    postId: String(submission.id),
    authorId: identity.discordId,
    author: {
      id: identity.discordId,
      name: identity.name,
      username: identity.username,
      avatar: identity.avatar
    },
    title: submission.title || (submission.source === "challenge" ? "Challenge" : "NPC Quest"),
    description: submission.description || "",
    difficulty: submission.difficulty || "",
    reward: Math.max(0, Number(submission.reward) || 0),
    npcType: submission.npcType || "",
    npcName: submission.npcName || "",
    npcCharacter: submission.npcCharacter || "",
    source: submission.source || "npc-quest",
    postText: String(submission.postText || "").slice(0, 500),
    badge: normalizeBadge(submission.source === "challenge"
      ? submission.badge || member?.questChallenge?.badge
      : submission.badge),
    evidence: {
      url: publicEvidenceUrl(submission.evidence),
      pathname: submission.evidence.pathname || "",
      contentType: submission.evidence.contentType || "",
      size: Math.max(0, Number(submission.evidence.size) || 0),
      originalName: submission.evidence.originalName || ""
    },
    likes,
    dislikes,
    submittedAt: submission.submittedAt || publishedAt || null,
    publishedAt: publishedAt || null,
    visible
  };
}

function serializeSocialPost(post, viewerId = "") {
  const raw = post?.toObject?.() || post || {};
  const likes = Array.isArray(raw.likes) ? raw.likes.map(String) : [];
  const dislikes = Array.isArray(raw.dislikes) ? raw.dislikes.map(String) : [];
  const viewer = String(viewerId || "");
  return {
    id: raw.postId || raw.id || "",
    title: raw.title || (raw.source === "challenge" ? "Challenge" : "NPC Quest"),
    description: raw.description || "",
    difficulty: raw.difficulty || "",
    reward: Math.max(0, Number(raw.reward) || 0),
    npcType: raw.npcType || "",
    npcName: raw.npcName || "",
    npcCharacter: raw.npcCharacter || "",
    source: raw.source || "npc-quest",
    postText: raw.postText || "",
    badge: normalizeBadge(raw.badge),
    evidence: raw.evidence
      ? {
          url: publicEvidenceUrl(raw.evidence),
          pathname: raw.evidence.pathname || "",
          contentType: raw.evidence.contentType || "",
          size: Math.max(0, Number(raw.evidence.size) || 0),
          originalName: raw.evidence.originalName || ""
        }
      : null,
    likeCount: likes.length,
    dislikeCount: dislikes.length,
    submittedAt: raw.publishedAt || raw.submittedAt || null,
    author: raw.author
      ? {
          id: raw.author.id || raw.authorId || "",
          name: raw.author.name || "Player",
          username: raw.author.username || "",
          avatar: raw.author.avatar || ""
        }
      : {
          id: raw.authorId || "",
          name: "Player",
          username: "",
          avatar: ""
        },
    viewerReaction: viewer && likes.includes(viewer)
      ? "like"
      : viewer && dislikes.includes(viewer)
        ? "dislike"
        : ""
  };
}

async function upsertSocialPostForSubmission(member, submission) {
  const doc = socialPostDocumentFromMemberSubmission(member, submission);
  if (!doc?.postId || !doc.authorId) return null;
  await SocialPost.findOneAndUpdate(
    { postId: doc.postId },
    { $set: doc },
    { upsert: true, new: true, setDefaultsOnInsert: true }
  );
  clearGlobalQuestPostsCache();
  return doc;
}

function newestBadge(badges = []) {
  return [...(badges || [])]
    .filter(Boolean)
    .sort((a, b) => new Date(b.awardedAt || 0) - new Date(a.awardedAt || 0))[0] || null;
}

function rewardIdForBadge(badge) {
  if (!badge) return "";
  const awardedAt = badge.awardedAt ? new Date(badge.awardedAt).getTime() : "";
  return `badge:${badge.id || badge.label || "badge"}:${awardedAt}`;
}

function configuredStageOrder(stage) {
  const stageId = String(stage || "");
  if (!stageId || !cachedLevels?.length) return 0;
  const index = cachedLevels.findIndex((level) => level.stageId === stageId);
  return index >= 0 ? index + 1 : 0;
}

function isChallengePassedToNextRoom(member, challenge = member?.questChallenge) {
  if (!challenge?.stage || !member?.stage) return false;
  const challengeOrder = configuredStageOrder(challenge.stage);
  const currentOrder = configuredStageOrder(member.stage);
  if (challengeOrder && currentOrder) return currentOrder > challengeOrder;
  return false;
}

export async function syncChallengeReview(discordId, { createReward = false } = {}) {
  await connectDb();
  await ensureLevels();
  const member = await Member.findOne({ discord_id: String(discordId || "") })
    .select(`${MEMBER_INTERACTION_SELECT} npcQuestSubmissions`);
  if (!member) return null;

  let saved = false;
  const challenge = member.questChallenge || null;
  const challengeSubmission = challenge?.submissionId
    ? (member.npcQuestSubmissions || []).find((submission) => submission.id === challenge.submissionId)
    : null;
  const challengeBadge = normalizeBadge(challenge?.badge) || normalizeBadge(challengeSubmission?.badge);
  const fallbackBadge = challengeBadge || normalizeBadge(newestBadge(member.profileAchievements));
  const passedToNextRoom = isChallengePassedToNextRoom(member, challenge);
  const approvedAt = challenge?.approvedAt || fallbackBadge?.awardedAt || new Date();

  if (createReward && fallbackBadge && passedToNextRoom) {
    const nextRewardId = rewardIdForBadge(fallbackBadge);
    const completedLevel = cachedLevels.find((level) => level.stageId === challenge?.stage) || null;
    const completionReward = completionRewardForLevel(completedLevel);
    const shouldGrantCoins = completionReward.coins > 0 && member.questReward?.id !== nextRewardId;
    if (shouldGrantCoins) {
      member.questCoin = String(questCoinValue(member) + completionReward.coins);
      saved = true;
    }
    if (!member.questReward?.id || member.questReward.id !== nextRewardId) {
      member.questReward = {
        id: nextRewardId,
        taskId: challenge?.taskId || member.stage || DEFAULT_STAGE,
        taskName: challenge?.taskName || fallbackBadge.label || getTaskName(member.stage),
        badge: fallbackBadge,
        coins: shouldGrantCoins ? completionReward.coins : 0,
        rewards: completionReward.rewards,
        unlocks: completionReward.unlocks,
        awardedAt: fallbackBadge.awardedAt || new Date(),
        seenAt: null
      };
      member.markModified("questReward");
      saved = true;
    } else if (
      completionReward.rewards.length
      && (!Array.isArray(member.questReward.rewards) || member.questReward.rewards.length === 0)
    ) {
      member.questReward.rewards = completionReward.rewards;
      member.questReward.unlocks = completionReward.unlocks;
      member.markModified("questReward");
      saved = true;
    }
  }

  if (challenge && challengeSubmission && passedToNextRoom) {
    if (!challenge.approvedAt) {
      member.questChallenge.approvedAt = approvedAt;
      saved = true;
    }
    if (!["approved", "awarded"].includes(String(challenge.status || "").toLowerCase())) {
      member.questChallenge.status = "approved";
      saved = true;
    }
    if (fallbackBadge && !challenge.badge?.id && !challenge.badge?.label) {
      member.questChallenge.badge = fallbackBadge;
      saved = true;
    }
    if (fallbackBadge && (!challengeSubmission.badge?.id && !challengeSubmission.badge?.label)) {
      challengeSubmission.badge = fallbackBadge;
      member.markModified("npcQuestSubmissions");
      saved = true;
    }
    member.markModified("questChallenge");
  }

  if (saved) {
    await member.save({ validateModifiedOnly: true });
  }

  if (challengeSubmission) {
    await upsertSocialPostForSubmission(member, challengeSubmission);
  }

  return {
    member: normalizeMemberInteraction(member),
    notification: challengeSubmission ? normalizeSocialNotification(member, challengeSubmission) : null
  };
}

async function backfillSocialPostsFromMembers({ force = false } = {}) {
  const now = Date.now();
  if (pendingSocialPostBackfill) {
    return pendingSocialPostBackfill;
  }
  if (
    !force
    && lastSocialPostBackfillAt
    && now - lastSocialPostBackfillAt < SOCIAL_POST_BACKFILL_INTERVAL_MS
  ) {
    return null;
  }

  pendingSocialPostBackfill = (async () => {
    const members = await Member.find({
      discord_id: { $exists: true, $ne: "" },
      "npcQuestSubmissions.0": { $exists: true }
    })
      .select([
        "discord_id",
        "nick",
        "nickname",
        "realName",
        "username",
        "discordData",
        "questChallenge",
        "npcQuestSubmissions"
      ].join(" "))
      .slice("npcQuestSubmissions", -SOCIAL_POST_BACKFILL_SUBMISSIONS_PER_MEMBER)
      .sort({ "npcQuestSubmissions.submittedAt": -1 })
      .limit(SOCIAL_POST_BACKFILL_MEMBER_LIMIT)
      .lean()
      .maxTimeMS(MEMBER_LIST_QUERY_MAX_TIME_MS);

    const operations = [];
    for (const member of members) {
      for (const submission of member.npcQuestSubmissions || []) {
        if (operations.length >= SOCIAL_POST_BACKFILL_MAX_OPERATIONS) break;
        const doc = socialPostDocumentFromMemberSubmission(member, submission);
        if (!doc?.postId || !doc.authorId) continue;
        operations.push({
          updateOne: {
            filter: { postId: doc.postId },
            update: { $set: doc },
            upsert: true
          }
        });
      }
      if (operations.length >= SOCIAL_POST_BACKFILL_MAX_OPERATIONS) break;
    }

    if (operations.length > 0) {
      await SocialPost.bulkWrite(operations, { ordered: false });
      clearGlobalQuestPostsCache();
    }
    lastSocialPostBackfillAt = Date.now();
    return operations.length;
  })()
    .catch((error) => {
      console.error("Failed to backfill social posts:", error.message);
      lastSocialPostBackfillAt = Date.now();
      return 0;
    })
    .finally(() => {
      pendingSocialPostBackfill = null;
    });

  return pendingSocialPostBackfill;
}

export async function refreshSocialPostIndex({ force = true } = {}) {
  await connectDb();
  return backfillSocialPostsFromMembers({ force });
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
  const extension = String(avatarHash).startsWith("a_") ? "gif" : "png";
  return `https://cdn.discordapp.com/avatars/${discordId}/${avatarHash}.${extension}?size=64`;
}

export function normalizeMember(member, options = {}) {
  const includeSubmissions = options.includeSubmissions !== false;
  const submissionLimit = Math.max(0, Number(options.submissionLimit) || 0);
  const npcQuestSubmissions = submissionLimit
    ? (member.npcQuestSubmissions || []).slice(-submissionLimit)
    : (member.npcQuestSubmissions || []);
  const memberObject = member.toObject?.() || member;
  const discord = member.discordData || {};
  const coinNumber = questCoinValue(member);
  
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
    avatar: normalizeAvatarUrl(discord.avatarUrl || ""),
    rank: member.questroomRank || "Game Tester",
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
        coins: Math.max(0, Number(member.questReward.coins) || 0),
        rewards: Array.isArray(member.questReward.rewards) ? member.questReward.rewards : [],
        unlocks: member.questReward.unlocks || null,
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
        questCoin: String(DEFAULT_COINS),
        questroomRank: "Game Tester",
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

  return true;
}

export async function getMemberByDiscordId(discordId, options = {}) {
  await connectDb();
  await ensureLevels();
  const includeSubmissions = options.includeSubmissions !== false;
  const lean = Boolean(options.lean);
  const reconcile = options.reconcile !== false && !lean;
  const selectFields = options.selectFields || (includeSubmissions
    ? null
    : MEMBER_INTERACTION_SELECT);
  const submissionLimit = Math.max(0, Number(options.submissionLimit) || 0);

  let member = null;
  // If it's a 24-character hex string, search by _id first
  if (/^[0-9a-fA-F]{24}$/.test(discordId)) {
    const query = Member.findById(discordId).maxTimeMS(MEMBER_READ_QUERY_MAX_TIME_MS);
    if (selectFields) query.select(selectFields);
    if (submissionLimit) query.slice("npcQuestSubmissions", -submissionLimit);
    if (lean) query.lean();
    member = await query;
  }

  if (!member) {
    const query = Member.findOne({ discord_id: String(discordId || "") }).maxTimeMS(MEMBER_READ_QUERY_MAX_TIME_MS);
    if (selectFields) query.select(selectFields);
    if (submissionLimit) query.slice("npcQuestSubmissions", -submissionLimit);
    if (lean) query.lean();
    member = await query;
  }

  if (!member) return null;
  const reconciled = reconcile ? await reconcileChallengeSublevel(member) : member;
  return includeSubmissions
    ? normalizeMember(reconciled, { submissionLimit })
    : normalizeMemberInteraction(reconciled);
}

export async function getRoomPlayers(stage = DEFAULT_STAGE) {
  await connectDb();
  await ensureLevels();
  const stageKey = String(stage || DEFAULT_STAGE);
  pruneRoomPlayersCache();
  const cached = roomPlayersCache.get(stageKey);
  if (cached && Date.now() - cached.cachedAt < ROOM_PLAYERS_CACHE_TTL_MS) {
    return cloneRoomPlayers(cached.players);
  }

  let pendingLoad = pendingRoomPlayersLoad.get(stageKey);
  if (!pendingLoad) {
    const cacheVersion = roomPlayersCacheVersions.get(stageKey) || 0;
    pendingLoad = (async () => {
      const members = await Member.find({
        stage: stageKey,
        discord_id: { $exists: true, $ne: "" },
        lastAuthentication: { $exists: true, $ne: null }
      })
        .select(ROOM_PLAYER_SELECT)
        .sort({ lastAuthentication: -1 })
        .limit(ROOM_PLAYERS_LIMIT)
        .lean()
        .maxTimeMS(MEMBER_LIST_QUERY_MAX_TIME_MS);

      const players = members.map(roomPlayerFromMember).filter((player) => player.id);
      if (
        ROOM_PLAYERS_CACHE_TTL_MS > 0
        && (roomPlayersCacheVersions.get(stageKey) || 0) === cacheVersion
      ) {
        roomPlayersCache.set(stageKey, {
          cachedAt: Date.now(),
          players: cloneRoomPlayers(players)
        });
      }
      return players;
    })().finally(() => {
      pendingRoomPlayersLoad.delete(stageKey);
    });
    pendingRoomPlayersLoad.set(stageKey, pendingLoad);
  }

  return cloneRoomPlayers(await pendingLoad);
}

export async function updateMemberPosition(discordId, position) {
  await connectDb();
  const nextPosition = getWalkablePoint(position);
  if (!nextPosition) return null;

  const member = await Member.findOneAndUpdate(
    { discord_id: String(discordId || "") },
    {
      $set: {
        roomPosition: {
          x: nextPosition.x,
          y: nextPosition.y,
          updatedAt: new Date()
        }
      }
    },
    { projection: { stage: 1 } }
  );

  if (member) clearRoomPlayersCache(member.stage || "");
  return member ? { ok: true, position: nextPosition } : null;
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

  const coinValue = questCoinExpression();

  const sender = await Member.findOneAndUpdate(
    {
      discord_id: senderId,
      $expr: { $gte: [coinValue, coinAmount] }
    },
    [{ $set: { questCoin: { $toString: { $subtract: [coinValue, coinAmount] } } } }],
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
      [{ $set: { questCoin: { $toString: { $add: [coinValue, coinAmount] } } } }],
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
      [{ $set: { questCoin: { $toString: { $add: [coinValue, coinAmount] } } } }]
    );
    throw error;
  }
}

export async function requestChallenge(discordId) {
  await connectDb();
  await ensureLevels();
  const member = await Member.findOne({ discord_id: String(discordId || "") }).select(MEMBER_INTERACTION_SELECT);
  if (!member) return null;

  const currentCoins = questCoinValue(member);
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
  member.questCoin = String(currentCoins - cost);
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
  await upsertSocialPostForSubmission(member, submission);

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

export async function getAvailableLevels({ force = false } = {}) {
  await connectDb();
  await ensureLevels({ force });
  return cachedLevels || [];
}

export async function getStageRanking(stageId) {
  await connectDb();
  await ensureLevels();
  
  const level = cachedLevels.find(l => l.stageId === stageId) || cachedLevels[0];
  if (!level) return [];
  const cacheKey = String(level.stageId || level.name || stageId || "");
  const now = Date.now();
  const cached = cachedStageRankings.get(cacheKey);
  if (cached && now - cached.loadedAt < RANKING_CACHE_TTL_MS) {
    return cached.ranking.map((player) => ({
      ...player,
      badge: player.badge ? { ...player.badge } : null
    }));
  }

  if (pendingStageRankings.has(cacheKey)) {
    const ranking = await pendingStageRankings.get(cacheKey);
    return ranking.map((player) => ({
      ...player,
      badge: player.badge ? { ...player.badge } : null
    }));
  }

  const rankingLoad = (async () => {
    const members = await Member.find({
      discord_id: { $exists: true, $ne: "" },
      "profileAchievements.label": level.name
    })
      .select(MEMBER_RANKING_SELECT)
      .lean()
      .maxTimeMS(MEMBER_LIST_QUERY_MAX_TIME_MS);

    const gradeValues = {
      master: 6,
      diamond: 5,
      platinum: 4,
      gold: 3,
      silver: 2,
      bronze: 1
    };

    const rankedPlayers = members.map(m => {
      const badge = (m.profileAchievements || []).find(a => a?.label === level.name);
      const identity = publicMemberIdentity(m);
      return {
        id: identity.id,
        name: identity.name,
        username: identity.username,
        avatar: identity.avatar,
        badge: publicBadge(badge) || {
          id: "",
          label: "",
          kind: "bronze",
          icon: "",
          awardedAt: null
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

    const ranking = rankedPlayers.slice(0, RANKING_LIMIT).map((p, idx) => ({
      rank: idx + 1,
      id: p.id,
      name: p.name,
      username: p.username,
      avatar: p.avatar,
      badge: p.badge
    }));
    cachedStageRankings.set(cacheKey, { ranking, loadedAt: Date.now() });
    return ranking;
  })().finally(() => {
    pendingStageRankings.delete(cacheKey);
  });

  pendingStageRankings.set(cacheKey, rankingLoad);
  const ranking = await rankingLoad;
  return ranking.map((player) => ({
    ...player,
    badge: player.badge ? { ...player.badge } : null
  }));
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

  const currentCoins = Math.max(0, questCoinValue(member));
  const storedPenalty = Number(member.npcQuest?.cancelPenalty) || 0;
  const fallbackPenalty = member.npcQuest?.reward
    ? Math.max(1, Math.round(Number(member.npcQuest.reward) * 0.25))
    : 0;
  const penalty = member.npcQuest && questSource !== "tutorial-role"
    ? Math.min(currentCoins, Math.max(0, storedPenalty || fallbackPenalty))
    : 0;
  member.questCoin = String(currentCoins - penalty);
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

  const currentCoins = Math.max(0, questCoinValue(member));
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
  member.questCoin = String(currentCoins + reward);
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
    member.questroomRank = "Challenge Role";
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
  const submission = member.npcQuestSubmissions.at(-1);
  await upsertSocialPostForSubmission(member, submission);
  return { member: normalizeMemberInteraction(member), reward, submission: normalizeNpcQuestSubmission(submission) };
}

export async function getActiveClasses() {
  await connectDb();
  if (cachedActiveClasses && Date.now() - cachedActiveClassesAt < ACTIVE_CLASSES_CACHE_TTL_MS) {
    return cachedActiveClasses.map((item) => ({ ...item }));
  }
  const configs = await CourseConfig.find({ isActive: true }).sort({ courseName: 1 }).lean();
  cachedActiveClasses = configs.map(c => ({
    sheetTitle: c.sheetTitle,
    courseName: c.courseName
  }));
  cachedActiveClassesAt = Date.now();
  return cachedActiveClasses.map((item) => ({ ...item }));
}

export async function getGlobalQuestPosts(classId, viewerDiscordId, options = {}) {
  await connectDb();
  const isAllCourses = String(classId || "") === "all";
  const viewerId = String(viewerDiscordId || "");
  const limit = clampPageLimit(options.limit, SOCIAL_POST_FEED_LIMIT, SOCIAL_POST_FEED_MAX_LIMIT);
  const cursor = parseSocialPostCursor(options.cursor);
  const cacheKey = `${String(classId || "all")}:${limit}:${cursor ? socialPostCursor({ publishedAt: cursor.publishedAt, postId: cursor.postId }) : "first"}`;
  pruneGlobalPostsCache();
  const cached = cachedGlobalPosts.get(cacheKey);
  if (cached && Date.now() - cached.cachedAt < GLOBAL_POSTS_CACHE_TTL_MS) {
    return {
      posts: cached.posts.map((post) => serializeSocialPost(post, viewerId)),
      nextCursor: cached.nextCursor,
      hasMore: cached.hasMore
    };
  }
  const pending = pendingGlobalPosts.get(cacheKey);
  if (pending) {
    const page = await pending;
    return {
      posts: page.posts.map((post) => serializeSocialPost(post, viewerId)),
      nextCursor: page.nextCursor,
      hasMore: page.hasMore
    };
  }

  const nextLoad = (async () => {
    if (SOCIAL_POST_AUTO_BACKFILL_ENABLED) {
      void backfillSocialPostsFromMembers().catch(() => {});
    }

    const query = {
      visible: true,
      "evidence.url": { $exists: true, $ne: "" },
      publishedAt: { $exists: true, $ne: null }
    };

    if (!isAllCourses) {
      const friends = await getClassFriends(classId);
      const discordIds = friends.map((friend) => friend.id).filter(Boolean);
      if (discordIds.length === 0) return { posts: [], nextCursor: "", hasMore: false };
      query.authorId = { $in: discordIds };
    }

    if (cursor) {
      query.$or = [
        { publishedAt: { $lt: cursor.publishedAt } },
        { publishedAt: cursor.publishedAt, postId: { $lt: cursor.postId } }
      ];
    }

    let posts = await SocialPost.find(query)
      .select("-_id postId title description difficulty reward npcType npcName npcCharacter source postText badge evidence likes dislikes publishedAt submittedAt author authorId")
      .sort({ publishedAt: -1, postId: -1 })
      .limit(limit + 1)
      .lean()
      .maxTimeMS(SOCIAL_POSTS_QUERY_MAX_TIME_MS);

    if (posts.length === 0 && SOCIAL_POST_AUTO_BACKFILL_ENABLED) {
      await backfillSocialPostsFromMembers({ force: true });
      posts = await SocialPost.find(query)
        .select("-_id postId title description difficulty reward npcType npcName npcCharacter source postText badge evidence likes dislikes publishedAt submittedAt author authorId")
        .sort({ publishedAt: -1, postId: -1 })
        .limit(limit + 1)
        .lean()
        .maxTimeMS(SOCIAL_POSTS_QUERY_MAX_TIME_MS);
    }

    const hasMore = posts.length > limit;
    const pagePosts = hasMore ? posts.slice(0, limit) : posts;
    const nextCursor = hasMore ? socialPostCursor(pagePosts.at(-1)) : "";

    cachedGlobalPosts.set(cacheKey, {
      cachedAt: Date.now(),
      posts: pagePosts,
      nextCursor,
      hasMore
    });
    return { posts: pagePosts, nextCursor, hasMore };
  })().finally(() => {
    pendingGlobalPosts.delete(cacheKey);
  });
  pendingGlobalPosts.set(cacheKey, nextLoad);

  const page = await nextLoad;
  return {
    posts: page.posts.map((post) => serializeSocialPost(post, viewerId)),
    nextCursor: page.nextCursor,
    hasMore: page.hasMore
  };
}

function clampPageLimit(value, fallback, max) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return Math.min(Math.max(1, Math.floor(parsed)), max);
}

function socialPostCursor(post) {
  const timestamp = new Date(post?.publishedAt || post?.submittedAt || 0).getTime();
  const postId = String(post?.postId || post?.id || "");
  return timestamp && postId ? `${timestamp}:${encodeURIComponent(postId)}` : "";
}

function parseSocialPostCursor(cursor) {
  const [timestampText, encodedPostId = ""] = String(cursor || "").split(":");
  const timestamp = Number(timestampText);
  if (!Number.isFinite(timestamp) || timestamp <= 0 || !encodedPostId) return null;
  return {
    publishedAt: new Date(timestamp),
    postId: decodeURIComponent(encodedPostId)
  };
}

async function loadSocialActivity({ allowStale = false } = {}) {
  const cacheIsFresh =
    cachedSocialActivity &&
    Date.now() - cachedSocialActivityAt < SOCIAL_ACTIVITY_CACHE_TTL_MS;
  if (cacheIsFresh) return cachedSocialActivity;

  const cacheIsStaleUsable =
    allowStale &&
    cachedSocialActivity &&
    Date.now() - cachedSocialActivityAt < SOCIAL_ACTIVITY_STALE_TTL_MS;
  if (cacheIsStaleUsable) {
    if (!pendingSocialActivityLoad) {
      void loadSocialActivity().catch(() => {});
    }
    return cachedSocialActivity;
  }

  if (!pendingSocialActivityLoad) {
    pendingSocialActivityLoad = SocialPost.find({
      visible: true,
      "evidence.url": { $exists: true, $ne: "" },
      publishedAt: { $exists: true, $ne: null }
    })
      .select("-_id postId authorId source title publishedAt author")
      .sort({ publishedAt: -1 })
      .limit(MAX_SOCIAL_ACTIVITY_ITEMS)
      .lean()
      .maxTimeMS(SOCIAL_POSTS_QUERY_MAX_TIME_MS)
      .then((items) => {
        cachedSocialActivity = (items || []).map((item) => ({
          id: item.postId,
          authorId: item.authorId,
          type: item.source === "challenge" ? "challenge" : "npc-quest",
          title: item.title || (item.source === "challenge" ? "Challenge" : "NPC Quest"),
          author: {
            id: item.author?.id || item.authorId || "",
            name: item.author?.name || "Player",
            username: item.author?.username || ""
          },
          publishedAt: item.publishedAt ? new Date(item.publishedAt) : null
        }));
        cachedSocialActivityAt = Date.now();
        if (cachedSocialActivity.length === 0 && SOCIAL_POST_AUTO_BACKFILL_ENABLED) {
          void backfillSocialPostsFromMembers().catch(() => {});
        }
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
    loadSocialActivity({ allowStale: true })
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

  const normalizedPostId = String(postId || "");
  const viewerId = String(discordId || "");
  const post = await SocialPost.findOne({ postId: normalizedPostId, visible: true })
    .select("postId likes dislikes visible")
    .lean()
    .maxTimeMS(SOCIAL_POSTS_QUERY_MAX_TIME_MS);

  if (post) {
    const likes = (post.likes || []).map(String).filter((id) => id !== viewerId);
    const dislikes = (post.dislikes || []).map(String).filter((id) => id !== viewerId);
    if (normalizedReaction === "like") likes.push(viewerId);
    if (normalizedReaction === "dislike") dislikes.push(viewerId);
    await SocialPost.updateOne(
      { postId: normalizedPostId },
      { $set: { likes, dislikes } }
    );

    void Member.findOne({ "npcQuestSubmissions.id": normalizedPostId })
      .select("npcQuestSubmissions")
      .then(async (member) => {
        const submission = member?.npcQuestSubmissions?.find((item) => item.id === normalizedPostId);
        if (!submission) return;
        submission.likes = likes;
        submission.dislikes = dislikes;
        member.markModified("npcQuestSubmissions");
        await member.save({ validateModifiedOnly: true });
      })
      .catch((error) => {
        console.warn("Failed to mirror social reaction to legacy member submission:", error.message);
      });

    clearGlobalQuestPostsCache();
    return {
      postId: normalizedPostId,
      viewerReaction: normalizedReaction,
      likeCount: likes.length,
      dislikeCount: dislikes.length
    };
  }

  const member = await Member.findOne({ "npcQuestSubmissions.id": normalizedPostId });
  if (!member) return null;

  const submission = member.npcQuestSubmissions.find((item) => item.id === normalizedPostId);
  if (!submission || !isGlobalQuestSubmissionVisible(member, submission)) return null;

  submission.likes = (submission.likes || []).map(String).filter((id) => id !== viewerId);
  submission.dislikes = (submission.dislikes || []).map(String).filter((id) => id !== viewerId);
  if (normalizedReaction === "like") submission.likes.push(viewerId);
  if (normalizedReaction === "dislike") submission.dislikes.push(viewerId);

  member.markModified("npcQuestSubmissions");
  await member.save({ validateModifiedOnly: true });
  await upsertSocialPostForSubmission(member, submission);
  return {
    postId: submission.id,
    viewerReaction: normalizedReaction,
    likeCount: submission.likes.length,
    dislikeCount: submission.dislikes.length
  };
}

export async function getClassFriends(classId) {
  await connectDb();
  const normalizedClassId = String(classId || "").trim();
  if (!normalizedClassId) return [];

  const now = Date.now();
  pruneClassFriendsCache(now);
  const cached = cachedClassFriends.get(normalizedClassId);
  const cachedAge = cached ? now - cached.cachedAt : Infinity;
  if (cached && cachedAge < FRIENDS_CACHE_TTL_MS) {
    return cloneFriends(cached.friends);
  }
  if (pendingClassFriends.has(normalizedClassId)) {
    if (cached && cachedAge < FRIENDS_STALE_CACHE_TTL_MS) {
      return cloneFriends(cached.friends);
    }
    return cloneFriends(await pendingClassFriends.get(normalizedClassId));
  }

  const friendsLoad = (async () => {
    const botUrl = (process.env.BOT_SERVER_URL || "https://api.hamsterquest.com/attendance").replace(/\/$/, "");
    const botTimeoutMs = Math.max(2000, Number(process.env.BOT_SERVER_TIMEOUT_MS) || 20000);
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), botTimeoutMs);
  
    let sheetStudents = [];
    try {
      const res = await fetch(`${botUrl}/api/attendance?course=${encodeURIComponent(normalizedClassId)}`, {
        signal: controller.signal
      });
      if (res.ok) {
        const data = await res.json();
        if (data && data.success && Array.isArray(data.students)) {
          sheetStudents = data.students.slice(0, MAX_CLASS_FRIENDS);
        }
      }
    } catch (err) {
      console.warn("Failed to fetch students from bot server, falling back to local DB:", err.message);
    } finally {
      clearTimeout(timeoutId);
    }

    let members = [];

    if (sheetStudents.length > 0) {
      const discordIds = sheetStudents.map(s => String(s.discordId || "")).filter(Boolean);
      if (discordIds.length > 0) {
        members = await Member.find({
          discord_id: { $in: discordIds }
        })
          .select(MEMBER_FRIEND_SELECT)
          .lean()
          .maxTimeMS(MEMBER_LIST_QUERY_MAX_TIME_MS);
      }

      const memberMap = new Map(members.map(m => [m.discord_id, m]));
      return sheetStudents.map(student => {
        const m = memberMap.get(String(student.discordId || ""));
        if (m) {
          const identity = publicMemberIdentity(m);
          const bestBadge = getBestBadge(m.profileAchievements);
          return {
            id: identity.discordId,
            name: identity.name,
            username: identity.username,
            avatar: identity.avatar,
            rank: m.questroomRank || "Game Tester",
            lastAuthentication: m.lastAuthentication ? m.lastAuthentication.toISOString() : null,
            isOnline: student.isOnline || false,
            bestBadge: publicBadge(bestBadge)
          };
        }
        return {
          id: student.discordId || `sheet-${student.sheetRowIndex}`,
          name: student.name || "Player",
          username: student.discordUsername || "",
          avatar: normalizeAvatarUrl(student.avatarUrl || ""),
          rank: "Game Tester",
          lastAuthentication: null,
          isOnline: student.isOnline || false,
          bestBadge: null
        };
      });
    }

    // Return only exact local matches if the Google Sheet service is unavailable.
    const query = {
      discord_id: { $exists: true, $ne: "" },
      courses: normalizedClassId
    };

    members = await Member.find(query)
      .select(MEMBER_FRIEND_SELECT)
      .limit(MAX_CLASS_FRIENDS)
      .lean()
      .maxTimeMS(MEMBER_LIST_QUERY_MAX_TIME_MS);

    return members.map(m => {
      const identity = publicMemberIdentity(m);
      const bestBadge = getBestBadge(m.profileAchievements);
      return {
        id: identity.discordId,
        name: identity.name,
        username: identity.username,
        avatar: identity.avatar,
        rank: m.questroomRank || "Game Tester",
        lastAuthentication: m.lastAuthentication ? m.lastAuthentication.toISOString() : null,
        isOnline: false,
        bestBadge: publicBadge(bestBadge)
      };
    });
  })().then((friends) => {
    cachedClassFriends.set(normalizedClassId, {
      friends: cloneFriends(friends),
      cachedAt: Date.now()
    });
    pruneClassFriendsCache();
    return friends;
  }).finally(() => {
    pendingClassFriends.delete(normalizedClassId);
  });

  pendingClassFriends.set(normalizedClassId, friendsLoad);
  if (cached && cachedAge < FRIENDS_STALE_CACHE_TTL_MS) {
    return cloneFriends(cached.friends);
  }
  return cloneFriends(await friendsLoad);
}

export async function getClassFriendsPage(classId, options = {}) {
  const limit = clampPageLimit(options.limit, FRIENDS_PAGE_LIMIT, FRIENDS_PAGE_MAX_LIMIT);
  const cursor = String(options.cursor || "");
  const search = String(options.search || "").trim().toLowerCase();
  const allFriends = await getClassFriends(classId);
  const friends = search
    ? allFriends.filter((friend) => (
      String(friend.name || "").toLowerCase().includes(search)
      || String(friend.username || "").toLowerCase().includes(search)
    ))
    : allFriends;
  const startIndex = cursor
    ? Math.max(0, friends.findIndex((friend) => String(friend.id || "") === cursor) + 1)
    : 0;
  const pageFriends = friends.slice(startIndex, startIndex + limit);
  const hasMore = startIndex + limit < friends.length;
  return {
    friends: pageFriends,
    nextCursor: hasMore ? String(pageFriends.at(-1)?.id || "") : "",
    hasMore
  };
}
