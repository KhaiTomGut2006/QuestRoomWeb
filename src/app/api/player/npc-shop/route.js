import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { connectDb } from "@/lib/db";
import Member from "@/models/Member";
import QuestTemplate from "@/models/QuestTemplate";
import { normalizeMember } from "@/lib/player";

const SHOP_ITEMS = {
  "quest-scroll-normal": { cost: 50,   questDifficulty: "easy" },
  "quest-scroll-rare":   { cost: 100,  questDifficulty: "medium" },
  "quest-scroll-epic":   { cost: 400,  questDifficulty: "hard" },
  "chest-small":         { cost: 50,   chestMin: 10,  chestMax: 100 },
  "chest-medium":        { cost: 100,  chestMin: 50,  chestMax: 200 },
  "chest-large":         { cost: 350,  chestMin: 200, chestMax: 500 },
  "cooldown-minute":     { cost: 200,  cooldownReductionMs: 60_000, cooldownTier: 1, maxCount: 10 },
  "cooldown-minute-lv2": { cost: 400,  cooldownReductionMs: 60_000, cooldownTier: 2, maxCount: 10, requiresLimitBreak: true },
  "limit-break":         { cost: 2000, limitBreak: true },
};

// Pick a random quest template for a given difficulty and compute reward
async function pickQuest(difficulty) {
  const pool = await QuestTemplate.find({ difficulty }).lean();
  if (!pool.length) throw new Error("no_quest_templates");
  const picked = pool[Math.floor(Math.random() * pool.length)];
  const reward = Math.round(
    (picked.rewardMin || 50) + Math.random() * ((picked.rewardMax || 100) - (picked.rewardMin || 50))
  );
  return { ...picked, reward };
}

export async function POST(request) {
  const session = await getServerSession(authOptions);
  const discordId = session?.user?.discordId;
  if (!discordId) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  try {
    const { itemId } = await request.json();
    const item = SHOP_ITEMS[itemId];
    if (!item) return NextResponse.json({ error: "invalid_item" }, { status: 400 });

    await connectDb();
    const member = await Member.findOne({ discord_id: String(discordId) });
    if (!member) return NextResponse.json({ error: "member_not_found" }, { status: 404 });

    // Quest scroll: cannot buy while a quest is active
    if (item.questDifficulty) {
      if (member.npcQuest) {
        return NextResponse.json({ error: "active_quest_exists" }, { status: 409 });
      }
    }

    // Chest: no stock limit, handled below

    // Tier-specific stock validation
    if (item.cooldownTier === 1) {
      if ((member.shopCooldownT1 || 0) >= item.maxCount) {
        return NextResponse.json({ error: "cooldown_maxed", tier: 1 }, { status: 400 });
      }
    }
    if (item.cooldownTier === 2) {
      if (!member.shopLimitBreak) {
        return NextResponse.json({ error: "requires_limit_break" }, { status: 400 });
      }
      if ((member.shopCooldownT2 || 0) >= item.maxCount) {
        return NextResponse.json({ error: "cooldown_maxed", tier: 2 }, { status: 400 });
      }
    }
    if (item.limitBreak && member.shopLimitBreak) {
      return NextResponse.json({ error: "already_owned" }, { status: 400 });
    }

    const currentCoins = Number.parseInt(member.coin || "0", 10);
    if (currentCoins < item.cost) {
      return NextResponse.json(
        { error: "not_enough_coins", coins: currentCoins, cost: item.cost },
        { status: 400 }
      );
    }

    member.coin = String(currentCoins - item.cost);

    // Quest scroll: assign quest immediately
    let assignedQuest = null;
    if (item.questDifficulty) {
      const quest = await pickQuest(item.questDifficulty);
      const reward = quest.reward;
      const cancelPenalty = reward > 0 ? Math.max(1, Math.round(reward * 0.25)) : 0;
      assignedQuest = {
        difficulty:   quest.difficulty,
        title:        quest.title,
        description:  quest.description,
        reward,
        cancelPenalty,
        npcType:      "quest",
        npcName:      quest.npcCharacter || "witch",
        npcCharacter: quest.npcCharacter || null,
        acceptedAt:   new Date(),
      };
      member.npcQuest = assignedQuest;
    }

    // Chest: award coins immediately
    let chestCoins = 0;
    if (item.chestMin !== undefined) {
      chestCoins = Math.floor(item.chestMin + Math.random() * (item.chestMax - item.chestMin + 1));
      const currentCoinsAfterPurchase = Number.parseInt(member.coin, 10);
      member.coin = String(currentCoinsAfterPurchase + chestCoins);
    }

    if (item.cooldownTier === 1) member.shopCooldownT1 = (member.shopCooldownT1 || 0) + 1;
    if (item.cooldownTier === 2) member.shopCooldownT2 = (member.shopCooldownT2 || 0) + 1;
    if (item.limitBreak)         member.shopLimitBreak = true;
    await member.save({ validateModifiedOnly: true });

    return NextResponse.json({
      itemId,
      cost: item.cost,
      cooldownReductionMs: item.cooldownReductionMs || 0,
      assignedQuest,
      chestCoins: chestCoins || 0,
      member: normalizeMember(member),
    });
  } catch (error) {
    return NextResponse.json({ error: error.message }, { status: 503 });
  }
}
