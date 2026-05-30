import { connectDb } from "@/lib/db";
import Member from "@/models/Member";
import { getWalkablePoint } from "@/lib/walkableArea";

import Level from "@/models/Level";

const DEFAULT_STAGE = "game-demo-1";
const DEFAULT_COINS = 1080;

let cachedLevels = null;

async function ensureLevels() {
  if (!cachedLevels) {
    try {
      await connectDb();
      const levels = await Level.find().sort({ order: 1 });
      cachedLevels = levels.map(l => ({ stageId: l.stageId, name: l.name, order: l.order }));
    } catch (err) {
      console.error("Failed to load levels in player.js", err);
      cachedLevels = [];
    }
  }
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

export function getDiscordAvatar(discordId, avatarHash) {
  if (!discordId || !avatarHash) return "";
  const ext = String(avatarHash).startsWith("a_") ? "gif" : "png";
  return `https://cdn.discordapp.com/avatars/${discordId}/${avatarHash}.${ext}?size=128`;
}

export function normalizeMember(member) {
  const discord = member.discordData || {};
  const coinNumber = Number.parseInt(member.coin || DEFAULT_COINS, 10);
  
  const stage = member.stage || DEFAULT_STAGE;
  const stageNumber = getStageNumber(stage);
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
    stageLabel: getTaskName(member.stage),
    coins: Number.isFinite(coinNumber) ? coinNumber : DEFAULT_COINS,
    quest: member.quest || {},
    npcQuest: member.npcQuest
      ? {
          difficulty:   member.npcQuest.difficulty || "",
          title:        member.npcQuest.title || "",
          description:  member.npcQuest.description || "",
          reward:       member.npcQuest.reward || 0,
          npcType:      member.npcQuest.npcType || "",
          npcName:      member.npcQuest.npcName || "",
          npcCharacter: member.npcQuest.npcCharacter || null,
          acceptedAt:   member.npcQuest.acceptedAt || null,
        }
      : null,
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
    costMultiplier
  };
}

export async function upsertMemberFromDiscord(profile) {
  await connectDb();
  await ensureLevels();

  const discordId = String(profile?.id || "");
  if (!discordId) throw new Error("Discord profile is missing id");

  const avatarUrl = profile.image_url || getDiscordAvatar(discordId, profile.avatar);
  const username = String(profile.username || "").trim();
  const globalName = String(profile.global_name || profile.globalName || "").trim();
  const initialPosition = {
    x: 48 + Math.round(Math.random() * 10),
    y: 68 + Math.round(Math.random() * 12),
    updatedAt: new Date()
  };

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
        stage: DEFAULT_STAGE,
        quest: {
          current: "Find the quiet corner",
          status: "active",
          completed: []
        },
        roomPosition: initialPosition
      }
    },
    { new: true, upsert: true }
  );

  await Promise.all([
    Member.updateOne(
      { discord_id: discordId, stage: { $exists: false } },
      { $set: { stage: DEFAULT_STAGE } }
    ),
    Member.updateOne(
      { discord_id: discordId, quest: { $exists: false } },
      {
        $set: {
          quest: {
            current: "Find the quiet corner",
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

export async function getMemberByDiscordId(discordId) {
  await connectDb();
  await ensureLevels();
  const member = await Member.findOne({ discord_id: String(discordId || "") });
  return member ? normalizeMember(member) : null;
}

export async function getRoomPlayers(stage = DEFAULT_STAGE) {
  await connectDb();
  await ensureLevels();
  const members = await Member.find({
    stage: String(stage || DEFAULT_STAGE),
    discord_id: { $exists: true, $ne: "" },
    lastAuthentication: { $exists: true, $ne: null }
  });

  return members.map((member) => {
    const normalized = normalizeMember(member);
    return {
      id: normalized.discordId,
      name: normalized.name,
      username: normalized.username,
      avatar: normalized.avatar,
      rank: normalized.rank,
      achievements: normalized.achievements,
      stage: normalized.stage,
      x: Number(normalized.position?.x || 50),
      y: Number(normalized.position?.y || 70),
      action: "idle",
      online: false
    };
  });
}

export async function updateMemberPosition(discordId, position) {
  await connectDb();
  await ensureLevels();
  const nextPosition = getWalkablePoint(position);
  if (!nextPosition) {
    const existing = await getMemberByDiscordId(discordId);
    return existing;
  }

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
    { new: true }
  );

  return member ? normalizeMember(member) : null;
}

export async function requestChallenge(discordId) {
  await connectDb();
  await ensureLevels();
  const member = await Member.findOne({ discord_id: String(discordId || "") });
  if (!member) return null;

  const currentCoins = Number.parseInt(member.coin || DEFAULT_COINS, 10);
  const stage = member.stage || DEFAULT_STAGE;
  const stageNumber = getStageNumber(stage);
  const costMultiplier = member.quest?.costMultiplier || 1;
  const cost = Math.round(250 * Math.pow(1.35, Math.max(0, stageNumber - 1))) * costMultiplier;

  if (currentCoins < cost) {
    return { ok: false, reason: "not_enough_coins", cost, member: normalizeMember(member) };
  }

  if (member.questChallenge?.status === "pending" && member.questChallenge.stage === stage) {
    return { ok: true, pending: true, cost, member: normalizeMember(member) };
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

  return { ok: true, pending: true, cost, member: normalizeMember(member) };
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

  return rankedPlayers.map((p, idx) => ({
    rank: idx + 1,
    id: p.id,
    name: p.name,
    username: p.username,
    avatar: p.avatar,
    badge: p.badge
  }));
}

export async function acceptNpcQuest(discordId, questData) {
  await connectDb();
  await ensureLevels();
  const member = await Member.findOneAndUpdate(
    { discord_id: String(discordId || "") },
    {
      $set: {
        npcQuest: {
          difficulty:   questData.difficulty,
          title:        questData.title,
          description:  questData.description,
          reward:       Number(questData.reward) || 0,
          npcType:      questData.npcType || "",
          npcName:      questData.npcName || "",
          npcCharacter: questData.npcCharacter || null,
          acceptedAt:   new Date(),
        }
      }
    },
    { new: true }
  );
  return member ? normalizeMember(member) : null;
}

export async function dismissNpcQuest(discordId) {
  await connectDb();
  await ensureLevels();
  const member = await Member.findOneAndUpdate(
    { discord_id: String(discordId || "") },
    { $set: { npcQuest: null } },
    { new: true }
  );
  return member ? normalizeMember(member) : null;
}
