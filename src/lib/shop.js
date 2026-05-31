import QuestTemplate from "@/models/QuestTemplate";

export const ASSET_TICKET_ITEM_ID = "asset-ticket";

export const SHOP_ITEMS = {
  [ASSET_TICKET_ITEM_ID]: {
    cost: 500,
    assetTicket: true,
    name: "Select 1 Asset on HamStore"
  },
  "quest-scroll-normal": {
    cost: 50,
    questDifficulty: "easy",
    name: "Quest (Normal)"
  },
  "quest-scroll-rare": {
    cost: 100,
    questDifficulty: "medium",
    name: "Quest (Rare)"
  },
  "quest-scroll-epic": {
    cost: 400,
    questDifficulty: "hard",
    name: "Quest (Epic)"
  },
  "chest-small": {
    cost: 50,
    chestMin: 10,
    chestMax: 100,
    name: "Chests (x10-100 Coins)"
  },
  "chest-medium": {
    cost: 100,
    chestMin: 50,
    chestMax: 200,
    name: "Chests (x50-200 Coins)"
  },
  "chest-large": {
    cost: 350,
    chestMin: 200,
    chestMax: 500,
    name: "Chests (x200-500 Coins)"
  },
  "cooldown-minute": {
    cost: 200,
    cooldownReductionMs: 60_000,
    cooldownTier: 1,
    maxCount: 10,
    name: "Max Cooldown -1 min"
  },
  "cooldown-minute-lv2": {
    cost: 400,
    cooldownReductionMs: 60_000,
    cooldownTier: 2,
    maxCount: 10,
    requiresLimitBreak: true,
    name: "Max Cooldown Lv2 -1 min"
  },
  "limit-break": {
    cost: 2000,
    limitBreak: true,
    name: "Limit Break"
  }
};

const CHEST_COIN_WEIGHT = 120;

function randomInt(min, max) {
  return Math.floor(min + Math.random() * (max - min + 1));
}

function pickWeighted(items) {
  const totalWeight = items.reduce((total, item) => total + item.weight, 0);
  let roll = Math.random() * totalWeight;
  for (const item of items) {
    roll -= item.weight;
    if (roll < 0) return item;
  }
  return items.at(-1);
}

function getChestDropWeight(item) {
  return Math.max(1, Math.round(10_000 / Math.max(1, item.cost)));
}

function canReceiveChestDrop(member, itemId, item) {
  if (item.limitBreak || item.chestMin !== undefined) return false;
  if (item.questDifficulty && member.npcQuest) return false;
  if (item.cooldownTier === 1) return (member.shopCooldownT1 || 0) < item.maxCount;
  if (item.cooldownTier === 2) {
    return Boolean(member.shopLimitBreak) && (member.shopCooldownT2 || 0) < item.maxCount;
  }
  return itemId === ASSET_TICKET_ITEM_ID || Boolean(item.questDifficulty);
}

async function pickQuest(difficulty) {
  const pool = await QuestTemplate.find({ difficulty }).lean();
  if (!pool.length) throw new Error("no_quest_templates");
  const picked = pool[Math.floor(Math.random() * pool.length)];
  const reward = Math.round(
    (picked.rewardMin || 50) + Math.random() * ((picked.rewardMax || 100) - (picked.rewardMin || 50))
  );
  return { ...picked, reward };
}

export async function grantShopItem(member, itemId) {
  const item = SHOP_ITEMS[itemId];
  if (!item) throw new Error("invalid_item");

  let assignedQuest = null;
  if (item.assetTicket) {
    member.shopAssetTickets = (member.shopAssetTickets || 0) + 1;
  }
  if (item.questDifficulty) {
    const quest = await pickQuest(item.questDifficulty);
    const reward = quest.reward;
    assignedQuest = {
      difficulty: quest.difficulty,
      title: quest.title,
      description: quest.description,
      reward,
      cancelPenalty: reward > 0 ? Math.max(1, Math.round(reward * 0.25)) : 0,
      source: "shop",
      npcType: "quest",
      npcName: quest.npcCharacter || "witch",
      npcCharacter: quest.npcCharacter || null,
      acceptedAt: new Date()
    };
    member.npcQuest = assignedQuest;
  }
  if (item.cooldownTier === 1) member.shopCooldownT1 = (member.shopCooldownT1 || 0) + 1;
  if (item.cooldownTier === 2) member.shopCooldownT2 = (member.shopCooldownT2 || 0) + 1;
  if (item.limitBreak) member.shopLimitBreak = true;

  return {
    itemId,
    itemName: item.name,
    assignedQuest,
    cooldownReductionMs: item.cooldownReductionMs || 0,
    assetTickets: member.shopAssetTickets || 0
  };
}

export async function openChestReward(member, { coinMin = 20, coinMax = 200 } = {}) {
  const pool = [
    { kind: "coins", weight: CHEST_COIN_WEIGHT }
  ];

  for (const [itemId, item] of Object.entries(SHOP_ITEMS)) {
    if (!canReceiveChestDrop(member, itemId, item)) continue;
    pool.push({
      kind: "item",
      itemId,
      itemName: item.name,
      weight: getChestDropWeight(item)
    });
  }

  const picked = pickWeighted(pool);
  if (picked.kind === "coins") {
    const coins = randomInt(coinMin, coinMax);
    member.coin = String((Number.parseInt(member.coin || "0", 10) || 0) + coins);
    return { kind: "coins", coins };
  }

  let granted = null;
  try {
    granted = await grantShopItem(member, picked.itemId);
  } catch (error) {
    if (error.message !== "no_quest_templates") throw error;
    const coins = randomInt(coinMin, coinMax);
    member.coin = String((Number.parseInt(member.coin || "0", 10) || 0) + coins);
    return { kind: "coins", coins };
  }
  return {
    kind: "item",
    ...granted
  };
}
