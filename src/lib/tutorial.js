import { connectDb } from "@/lib/db";
import { normalizeMember } from "@/lib/player";
import Member from "@/models/Member";

const ROLE_QUEST_COST = 50;
const ROLE_QUEST_REWARD = 100;
const ROLE_NPC_WAIT_MS = 2 * 60 * 1000;

const TUTORIAL_QUEST_BADGE = {
  id: "tutorial-first-quest",
  label: "First Quest",
  sublabel: "Tutorial Mode",
  kind: "silver",
  icon: "/assets/Rank/Silver.png"
};

const TUTORIAL_ROLE_BADGE = {
  id: "tutorial-challenge-role",
  label: "Challenge Role",
  sublabel: "Tutorial Mode",
  kind: "gold",
  icon: "/assets/Rank/Gold.png"
};

function currentCoins(member) {
  return Math.max(0, Number.parseInt(member.coin || "0", 10) || 0);
}

function addBadge(member, badge) {
  if (!Array.isArray(member.profileAchievements)) member.profileAchievements = [];
  if (member.profileAchievements.some((item) => item.id === badge.id)) return;
  member.profileAchievements.push({
    ...badge,
    awardedAt: new Date()
  });
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
  return Member.findOne({ discord_id: String(discordId || "") });
}

export async function advanceTutorial(discordId, action) {
  const member = await loadTutorialMember(discordId);
  if (!member) return null;

  let reward = null;
  const now = new Date();

  if (action === "complete-quest") {
    assertTutorialStep(member, "quest-intro");
    member.coin = String(currentCoins(member) + 50);
    addBadge(member, TUTORIAL_QUEST_BADGE);
    updateStep(member, "chest-intro");
    reward = { kind: "coins", coins: 50, title: "Tutorial Quest สำเร็จ" };
  } else if (action === "open-chest") {
    assertTutorialStep(member, "chest-intro");
    const coins = 20 + Math.floor(Math.random() * 81);
    member.coin = String(currentCoins(member) + coins);
    updateStep(member, "shop-intro");
    reward = { kind: "coins", coins, title: "ทดลองเปิด Chest สำเร็จ" };
  } else if (action === "buy-role-quest") {
    assertTutorialStep(member, "shop-intro");
    const coins = currentCoins(member);
    if (coins < ROLE_QUEST_COST) throw new Error("not_enough_coins");
    member.coin = String(coins - ROLE_QUEST_COST);
    updateStep(member, "role-quest-offer", { roleNpcAvailableAt: now });
  } else if (action === "defer-role-test") {
    assertTutorialStep(member, "role-quest-offer", "role-quest-waiting");
    updateStep(member, "role-quest-waiting", {
      roleNpcAvailableAt: new Date(now.getTime() + ROLE_NPC_WAIT_MS)
    });
  } else if (action === "accept-role-test") {
    assertTutorialStep(member, "role-quest-offer", "role-quest-waiting");
    const availableAt = new Date(member.tutorial.roleNpcAvailableAt || 0).getTime();
    if (availableAt > now.getTime()) throw new Error("tutorial_role_npc_not_ready");
    updateStep(member, "role-quest-active");
  } else if (action === "complete-role-test") {
    assertTutorialStep(member, "role-quest-active");
    member.coin = String(currentCoins(member) + ROLE_QUEST_REWARD);
    member.rank = "Challenge Role";
    addBadge(member, TUTORIAL_ROLE_BADGE);
    updateStep(member, "completed", { completedAt: now });
    reward = { kind: "coins", coins: ROLE_QUEST_REWARD, title: "Challenge Role สำเร็จ" };
  } else {
    throw new Error("invalid_tutorial_action");
  }

  member.markModified("tutorial");
  member.markModified("profileAchievements");
  await member.save({ validateModifiedOnly: true });

  return {
    member: normalizeMember(member),
    reward,
    roleQuestCost: ROLE_QUEST_COST,
    roleQuestReward: ROLE_QUEST_REWARD
  };
}
