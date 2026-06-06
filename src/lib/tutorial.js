import { connectDb } from "@/lib/db";
import { getFirstConfiguredStage, normalizeMember } from "@/lib/player";
import Member from "@/models/Member";

const ROLE_QUEST_COST = 50;
const ROLE_QUEST_REWARD = 100;
const ROLE_QUEST_CANCEL_WAIT_MS = 2 * 60 * 1000;
const MEMBER_READ_QUERY_MAX_TIME_MS = Math.max(500, Number(process.env.MEMBER_READ_QUERY_MAX_TIME_MS || 3_000));

function currentCoins(member) {
  return Math.max(0, Number.parseInt(member.questCoin ?? member.coin ?? "0", 10) || 0);
}

function assertTutorialStep(member, ...steps) {
  if (member.tutorial?.status !== "active" || !steps.includes(member.tutorial.step)) {
    throw new Error("invalid_tutorial_step");
  }
}

function updateStep(member, step, extra = {}) {
  member.tutorial = {
    ...(member.tutorial?.toObject?.() || member.tutorial || {}),
    ...extra,
    status: step === "completed" ? "completed" : "active",
    step,
    updatedAt: new Date()
  };
}

async function loadTutorialMember(discordId) {
  await connectDb();
  return Member.findOne({ discord_id: String(discordId || "") }).maxTimeMS(MEMBER_READ_QUERY_MAX_TIME_MS);
}

export async function advanceTutorial(discordId, action) {
  const member = await loadTutorialMember(discordId);
  if (!member) return null;

  let reward = null;
  const now = new Date();
  const originalStep = String(member.tutorial?.step || "");
  const originalStatus = String(member.tutorial?.status || "");

  if (action === "continue-welcome") {
    assertTutorialStep(member, "welcome-1");
    updateStep(member, "welcome-2");
  } else if (action === "start-first-quest") {
    assertTutorialStep(member, "welcome-2");
    updateStep(member, "quest-arrival");
  } else if (action === "accept-first-quest") {
    assertTutorialStep(member, "quest-arrival");
    if (member.npcQuest) throw new Error("active_quest_exists");
    member.npcQuest = {
      difficulty: "easy",
      title: "อยากเห็นรูปเดี่ยวตัวละครเจ้า (ตอนแยกสาย) จัง",
      description: "ส่งรูปเดี่ยวตัวละครของเจ้าในตอนแยกสาย แล้วอัปโหลดมาให้ฉันดู",
      reward: 50,
      cancelPenalty: 0,
      source: "tutorial-first-quest",
      npcType: "quest-easy",
      npcName: "near",
      npcCharacter: "near",
      acceptedAt: now
    };
    updateStep(member, "quest-active");
  } else if (action === "spawn-chest") {
    assertTutorialStep(member, "after-first-quest");
    updateStep(member, "chest-arrival");
  } else if (action === "open-chest") {
    assertTutorialStep(member, "chest-arrival");
    member.questCoin = String(currentCoins(member) + 100);
    updateStep(member, "after-chest");
    reward = { kind: "coins", coins: 100, title: "Tutorial Chest" };
  } else if (action === "spawn-shop") {
    assertTutorialStep(member, "after-chest");
    updateStep(member, "shop-arrival");
  } else if (action === "buy-role-quest") {
    assertTutorialStep(member, "shop-arrival");
    const coins = currentCoins(member);
    if (coins < ROLE_QUEST_COST) throw new Error("not_enough_coins");
    member.questCoin = String(coins - ROLE_QUEST_COST);
    member.npcQuest = {
      difficulty: "role",
      title: "Quest : Challenge Role",
      description: "ให้ส่งผลงานอะไรก็ได้ที่แสดงให้เห็นถึงสิ่งที่น้องถนัดที่สุดในการทำโปรเจค",
      reward: ROLE_QUEST_REWARD,
      cancelPenalty: 0,
      source: "tutorial-role",
      npcType: "quest-role",
      npcName: "fact",
      npcCharacter: "fact",
      acceptedAt: now,
      cancelAvailableAt: new Date(now.getTime() + ROLE_QUEST_CANCEL_WAIT_MS)
    };
    updateStep(member, "role-quest-active");
  } else if (action === "open-social") {
    assertTutorialStep(member, "social-intro");
    updateStep(member, "social-opened");
  } else if (action === "finish-social") {
    assertTutorialStep(member, "social-intro", "social-opened");
    updateStep(member, "finish-chat");
  } else if (action === "finish-tutorial") {
    assertTutorialStep(member, "finish-chat");
    member.stage = await getFirstConfiguredStage();
    updateStep(member, "completed", { completedAt: now });
  } else {
    throw new Error("invalid_tutorial_action");
  }

  const commitFilter = {
    discord_id: String(discordId || ""),
    "tutorial.status": originalStatus,
    "tutorial.step": originalStep
  };
  if (action === "accept-first-quest" || action === "buy-role-quest") {
    commitFilter.$or = [{ npcQuest: null }, { npcQuest: { $exists: false } }];
  }
  if (action === "buy-role-quest") {
    commitFilter.$expr = {
      $gte: [
        {
          $convert: {
            input: { $ifNull: ["$questCoin", { $ifNull: ["$coin", "0"] }] },
            to: "int",
            onError: 0,
            onNull: 0
          }
        },
        ROLE_QUEST_COST
      ]
    };
  }

  const updated = await Member.findOneAndUpdate(
    commitFilter,
    {
      $set: {
        tutorial: member.tutorial,
        npcQuest: member.npcQuest,
        questCoin: member.questCoin,
        stage: member.stage,
        profileAchievements: member.profileAchievements,
        questroomRank: member.questroomRank
      }
    },
    { new: true, maxTimeMS: MEMBER_READ_QUERY_MAX_TIME_MS }
  );
  if (!updated) throw new Error("invalid_tutorial_step");

  return {
    member: normalizeMember(updated),
    reward,
    roleQuestCost: ROLE_QUEST_COST,
    roleQuestReward: ROLE_QUEST_REWARD
  };
}
