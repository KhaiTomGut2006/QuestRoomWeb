import { connectDb } from "@/lib/db";
import Member from "@/models/Member";
import { getWalkablePoint } from "@/lib/walkableArea";

const DEFAULT_STAGE = "game-demo-1";
const DEFAULT_COINS = 1080;

function toRoman(number) {
  const values = [
    [1000, "M"],
    [900, "CM"],
    [500, "D"],
    [400, "CD"],
    [100, "C"],
    [90, "XC"],
    [50, "L"],
    [40, "XL"],
    [10, "X"],
    [9, "IX"],
    [5, "V"],
    [4, "IV"],
    [1, "I"]
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
  return Number.parseInt(String(stage).split("-").pop(), 10) || 1;
}

function getTaskName(stage = DEFAULT_STAGE) {
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
    position: member.roomPosition || { x: 50, y: 70 }
  };
}

export async function upsertMemberFromDiscord(profile) {
  await connectDb();

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
  const member = await Member.findOne({ discord_id: String(discordId || "") });
  return member ? normalizeMember(member) : null;
}

export async function getRoomPlayers(stage = DEFAULT_STAGE) {
  await connectDb();
  const members = await Member.find({
    stage: String(stage || DEFAULT_STAGE),
    discord_id: { $exists: true, $ne: "" }
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
  const member = await Member.findOne({ discord_id: String(discordId || "") });
  if (!member) return null;

  const currentCoins = Number.parseInt(member.coin || DEFAULT_COINS, 10);
  const stage = member.stage || DEFAULT_STAGE;
  const stageNumber = getStageNumber(stage);
  const cost = Math.round(250 * Math.pow(1.35, stageNumber - 1));

  if (currentCoins < cost) {
    return { ok: false, reason: "not_enough_coins", cost, member: normalizeMember(member) };
  }

  if (member.questChallenge?.status === "pending" && member.questChallenge.stage === stage) {
    return { ok: true, pending: true, cost, member: normalizeMember(member) };
  }

  const requestedAt = new Date();
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
    cooldownUntil: member.quest?.cooldownUntil
  };
  await member.save({ validateModifiedOnly: true });

  return { ok: true, pending: true, cost, member: normalizeMember(member) };
}

export async function acknowledgeReward(discordId, rewardId) {
  await connectDb();
  const member = await Member.findOne({ discord_id: String(discordId || "") });
  if (!member) return null;

  if (member.questReward?.id && member.questReward.id === String(rewardId || "")) {
    member.questReward.seenAt = new Date();
    await member.save();
  }

  return normalizeMember(member);
}
