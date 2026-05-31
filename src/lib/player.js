import { connectDb } from "@/lib/db";
import Member from "@/models/Member";
import { getWalkablePoint } from "@/lib/walkableArea";

import Level from "@/models/Level";
import CourseConfig from "@/models/CourseConfig";

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

function normalizeNpcQuestSubmission(submission) {
  return {
    id: submission.id || "",
    title: submission.title || "NPC Quest",
    description: submission.description || "",
    difficulty: submission.difficulty || "",
    reward: submission.reward || 0,
    npcType: submission.npcType || "",
    npcName: submission.npcName || "",
    npcCharacter: submission.npcCharacter || "",
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

function normalizeNpcQuestEvidence(discordId, evidence) {
  const url = String(evidence?.url || "").trim();
  const pathname = String(evidence?.pathname || "").trim();
  const contentType = String(evidence?.contentType || "").toLowerCase();
  const size = Math.max(0, Number(evidence?.size) || 0);
  const originalName = String(evidence?.originalName || "").slice(0, 180);
  const localUploadPrefix = `/uploads/npc-quests/${String(discordId || "")}/`;

  let parsedUrl;
  try {
    parsedUrl = new URL(url);
  } catch {
    throw new Error("invalid_quest_evidence_url");
  }

  const isBlobUrl = parsedUrl.protocol === "https:"
    && parsedUrl.hostname.endsWith(".blob.vercel-storage.com");
  const isLocalUpload = process.env.NODE_ENV !== "production"
    && ["localhost", "127.0.0.1"].includes(parsedUrl.hostname)
    && parsedUrl.pathname.includes(localUploadPrefix);
  const isAllowedType = contentType.startsWith("image/") || contentType.startsWith("video/");

  if (!isBlobUrl && !isLocalUpload) throw new Error("invalid_quest_evidence_url");
  if (!isAllowedType) throw new Error("invalid_quest_evidence_type");
  if (!size || size > 100 * 1024 * 1024) throw new Error("invalid_quest_evidence_size");

  return { url, pathname, contentType, size, originalName };
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
          cancelPenalty:member.npcQuest.cancelPenalty || 0,
          npcType:      member.npcQuest.npcType || "",
          npcName:      member.npcQuest.npcName || "",
          npcCharacter: member.npcQuest.npcCharacter || null,
          acceptedAt:   member.npcQuest.acceptedAt || null,
        }
      : null,
    npcQuestSubmissions: (member.npcQuestSubmissions || []).map(normalizeNpcQuestSubmission),
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

  let member = null;
  // If it's a 24-character hex string, search by _id first
  if (/^[0-9a-fA-F]{24}$/.test(discordId)) {
    member = await Member.findById(discordId);
  }

  if (!member) {
    member = await Member.findOne({ discord_id: String(discordId || "") });
  }

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
          npcType:      questData.npcType || "",
          npcName:      questData.npcName || "",
          npcCharacter: questData.npcCharacter || null,
          acceptedAt:   new Date(),
        }
      }
    },
    { new: true }
  );
  if (member) return normalizeMember(member);

  const existingMember = await Member.exists({ discord_id: String(discordId || "") });
  if (!existingMember) return null;
  throw new Error("active_quest_exists");
}

export async function cancelNpcQuest(discordId) {
  await connectDb();
  await ensureLevels();
  const member = await Member.findOne({ discord_id: String(discordId || "") });
  if (!member) return null;

  const currentCoins = Math.max(0, Number.parseInt(member.coin || "0", 10) || 0);
  const storedPenalty = Number(member.npcQuest?.cancelPenalty) || 0;
  const fallbackPenalty = member.npcQuest?.reward
    ? Math.max(1, Math.round(Number(member.npcQuest.reward) * 0.25))
    : 0;
  const penalty = member.npcQuest
    ? Math.min(currentCoins, Math.max(0, storedPenalty || fallbackPenalty))
    : 0;
  member.coin = String(currentCoins - penalty);
  member.npcQuest = null;
  await member.save();
  return { member: normalizeMember(member), penalty };
}

export async function submitNpcQuest(discordId, evidence) {
  await connectDb();
  await ensureLevels();
  const member = await Member.findOne({ discord_id: String(discordId || "") });
  if (!member) return null;
  if (!member.npcQuest) throw new Error("active_quest_not_found");

  const normalizedEvidence = normalizeNpcQuestEvidence(discordId, evidence);

  const currentCoins = Math.max(0, Number.parseInt(member.coin || "0", 10) || 0);
  const reward = Math.max(0, Number(member.npcQuest.reward) || 0);
  const submittedAt = new Date();
  member.npcQuestSubmissions.push({
    id: `${String(discordId || "")}-${submittedAt.getTime()}`,
    title: member.npcQuest.title || "NPC Quest",
    description: member.npcQuest.description || "",
    difficulty: member.npcQuest.difficulty || "",
    reward,
    npcType: member.npcQuest.npcType || "",
    npcName: member.npcQuest.npcName || "",
    npcCharacter: member.npcQuest.npcCharacter || "",
    evidence: normalizedEvidence,
    submittedAt
  });
  member.coin = String(currentCoins + reward);
  member.npcQuest = null;
  await member.save();
  return { member: normalizeMember(member), reward, submission: normalizeNpcQuestSubmission(member.npcQuestSubmissions.at(-1)) };
}

export async function getActiveClasses() {
  await connectDb();
  const configs = await CourseConfig.find({ isActive: true }).sort({ courseName: 1 }).lean();
  return configs.map(c => ({
    sheetTitle: c.sheetTitle,
    courseName: c.courseName
  }));
}

export async function getClassFriends(classId) {
  await connectDb();
  
  const botUrl = process.env.BOT_SERVER_URL || "http://localhost:5000";
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 2000);

  let sheetStudents = [];
  try {
    const res = await fetch(`${botUrl}/api/attendance?course=${encodeURIComponent(classId)}`, {
      signal: controller.signal
    });
    clearTimeout(timeoutId);
    if (res.ok) {
      const data = await res.json();
      if (data && data.success && Array.isArray(data.students)) {
        sheetStudents = data.students;
      }
    }
  } catch (err) {
    clearTimeout(timeoutId);
    console.warn("Failed to fetch students from bot server, falling back to local DB:", err.message);
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
    // Local MongoDB Heuristic Fallback
    const lowercaseClassId = String(classId).toLowerCase();
    let query = {
      discord_id: { $exists: true, $ne: "" }
    };
    if (lowercaseClassId.includes("nsc")) {
      query.courses = { $in: [classId, "C0008", "C0009"] };
    } else if (lowercaseClassId.includes("starways")) {
      query.courses = { $in: [classId, "C0001", "C0002", "C0005", "C0038", "C0061", "C0072", "C0076", "C0077", "C0078", "C0080", "C0081", "C0082", "C0092"] };
    } else if (lowercaseClassId.includes("hero")) {
      query.courses = { $in: [classId, "C0001", "C0002", "C0008", "C0009"] };
    } else {
      query.courses = classId;
    }
    
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
