import { connectDb } from "@/lib/db";
import Member from "@/models/Member";
import { getWalkablePoint } from "@/lib/walkableArea";

const DEFAULT_STAGE = "game-demo-1";
const DEFAULT_COINS = 1080;

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
    achievements: (member.profileAchievements || []).map((achievement) => ({
      id: achievement.id || "",
      label: achievement.label || "Badge",
      sublabel: achievement.sublabel || "",
      kind: achievement.kind || "",
      icon: achievement.icon || ""
    })),
    stage: member.stage || DEFAULT_STAGE,
    coins: Number.isFinite(coinNumber) ? coinNumber : DEFAULT_COINS,
    quest: member.quest || {},
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

export async function advanceChallenge(discordId) {
  await connectDb();
  const member = await Member.findOne({ discord_id: String(discordId || "") });
  if (!member) return null;

  member.questChallengeRequestedAt = new Date();
  const currentCoins = Number.parseInt(member.coin || DEFAULT_COINS, 10);
  const stageNumber = Number.parseInt(String(member.stage || DEFAULT_STAGE).split("-").pop(), 10) || 1;
  const cost = Math.round(250 * Math.pow(1.35, stageNumber - 1));

  if (currentCoins < cost) {
    await member.save();
    return { ok: false, reason: "not_enough_coins", cost, member: normalizeMember(member) };
  }

  member.coin = String(currentCoins - cost);
  member.stage = `game-demo-${stageNumber + 1}`;
  member.quest = {
    current: `Clear cozy task ${stageNumber + 1}`,
    status: "active",
    completed: [...(member.quest?.completed || []), `game-demo-${stageNumber}`],
    cooldownUntil: new Date(Date.now() + 40 * 60 * 1000)
  };
  await member.save();

  return { ok: true, cost, member: normalizeMember(member) };
}
