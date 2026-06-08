import QuestTemplate from "@/models/QuestTemplate";
import Level from "@/models/Level";
import { ACCESSORY_LIST } from "@/lib/accessories";

const SHOP_QUERY_MAX_TIME_MS = Math.max(500, Number(process.env.SHOP_QUERY_MAX_TIME_MS || 3_000));

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
    maxCount: 5,
    name: "Max Cooldown -1 min"
  },
  "cooldown-minute-lv2": {
    cost: 400,
    cooldownReductionMs: 60_000,
    cooldownTier: 2,
    maxCount: 5,
    requiresLimitBreak: true,
    name: "Max Cooldown Lv2 -1 min"
  },
  "limit-break": {
    cost: 2000,
    limitBreak: true,
    name: "Limit Break"
  },
  ...Object.fromEntries(
    ACCESSORY_LIST.map((accessory) => [
      accessory.id,
      {
        cost: accessory.cost,
        accessoryId: accessory.id,
        name: accessory.name
      }
    ])
  )
};

const CHEST_COIN_WEIGHT = 120;

function randomInt(min, max) {
  return Math.floor(min + Math.random() * (max - min + 1));
}

function currentQuestCoins(member) {
  return Number.parseInt(member?.questCoin ?? member?.coin ?? "0", 10) || 0;
}

function addQuestCoins(member, coins) {
  member.questCoin = String(currentQuestCoins(member) + Math.max(0, Number(coins) || 0));
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

function canReceiveConfiguredChestDrop(member, itemId, item) {
  if (item.chestMin !== undefined) return true;
  if (item.questDifficulty && member.npcQuest) return false;
  if (item.cooldownTier === 1) return (member.shopCooldownT1 || 0) < item.maxCount;
  if (item.cooldownTier === 2) {
    return Boolean(member.shopLimitBreak) && (member.shopCooldownT2 || 0) < item.maxCount;
  }
  if (item.limitBreak) return !member.shopLimitBreak;
  if (item.accessoryId) return !(member.ownedAccessories || []).map(String).includes(item.accessoryId);
  return true;
}

function normalizeConfiguredShopItem(entry) {
  const itemId = String(entry?.itemType || "");
  const baseItem = SHOP_ITEMS[itemId];
  if (!baseItem) return null;
  const configuredPrice = Number(entry?.price);
  return {
    itemId,
    ...baseItem,
    name: String(entry?.itemName || baseItem.name),
    cost: Number.isFinite(configuredPrice) ? Math.max(0, configuredPrice) : baseItem.cost,
    maxQty: Math.max(1, Number(entry?.maxQty) || 1)
  };
}

async function getLevelItemConfig(stage) {
  if (!stage) return null;
  return Level.findOne({ stageId: String(stage) }, { npcShop: 1, boxDrops: 1 })
    .lean()
    .maxTimeMS(SHOP_QUERY_MAX_TIME_MS);
}

export async function getNpcShopItems(stage) {
  const level = await getLevelItemConfig(stage);
  if (!level?.npcShop?.length) return null;
  return level.npcShop.map(normalizeConfiguredShopItem).filter(Boolean);
}

export async function getNpcShopItem(stage, itemId) {
  const configuredItems = await getNpcShopItems(stage);
  if (!configuredItems) {
    return SHOP_ITEMS[itemId] ? { itemId, ...SHOP_ITEMS[itemId], maxQty: 1 } : null;
  }
  return configuredItems.find((item) => item.itemId === itemId) || null;
}

async function pickQuest(difficulty) {
  const [picked] = await QuestTemplate.aggregate([
    { $match: { difficulty } },
    {
      $project: {
        _id: 0,
        difficulty: 1,
        title: 1,
        description: 1,
        rewardMin: 1,
        rewardMax: 1,
        npcCharacter: 1
      }
    },
    { $sample: { size: 1 } }
  ]).option({ maxTimeMS: SHOP_QUERY_MAX_TIME_MS });
  if (!picked) throw new Error("no_quest_templates");
  const reward = Math.round(
    (picked.rewardMin || 50) + Math.random() * ((picked.rewardMax || 100) - (picked.rewardMin || 50))
  );
  return { ...picked, reward };
}

export async function grantShopItem(member, itemId, itemOverride = null) {
  const item = itemOverride ? { ...SHOP_ITEMS[itemId], ...itemOverride } : SHOP_ITEMS[itemId];
  if (!item) throw new Error("invalid_item");

  let assignedQuest = null;
  if (item.assetTicket) {
    member.shopAssetTickets = (member.shopAssetTickets || 0) + 1;
  }
  if (item.accessoryId) {
    const ownedAccessories = new Set((member.ownedAccessories || []).map(String));
    ownedAccessories.add(item.accessoryId);
    member.ownedAccessories = Array.from(ownedAccessories);
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
  const level = await getLevelItemConfig(member.stage);
  const configuredDrops = level?.boxDrops || [];
  const pool = [];

  if (configuredDrops.length) {
    for (const drop of configuredDrops) {
      const itemId = String(drop?.itemType || "");
      const weight = Number(drop?.chance);
      if (!Number.isFinite(weight) || weight <= 0) continue;
      if (itemId === "coins") {
        pool.push({
          kind: "coins",
          weight,
          coinMin: Math.max(1, Number(drop.coinMin) || 20),
          coinMax: Math.max(1, Number(drop.coinMax) || 200)
        });
        continue;
      }
      const item = SHOP_ITEMS[itemId];
      if (!item) continue;
      if (!canReceiveConfiguredChestDrop(member, itemId, item)) continue;
      pool.push({ kind: "item", itemId, itemName: drop.itemName || item.name, weight });
    }
  } else {
    pool.push({ kind: "coins", weight: CHEST_COIN_WEIGHT, coinMin, coinMax });
    for (const [itemId, item] of Object.entries(SHOP_ITEMS)) {
      if (!canReceiveChestDrop(member, itemId, item)) continue;
      pool.push({
        kind: "item",
        itemId,
        itemName: item.name,
        weight: getChestDropWeight(item)
      });
    }
  }

  if (!pool.length) pool.push({ kind: "coins", weight: 1, coinMin, coinMax });
  const picked = pickWeighted(pool);
  if (picked.kind === "coins") {
    const min = Number(picked.coinMin) || coinMin;
    const max = Number(picked.coinMax) || coinMax;
    const coins = randomInt(min, max);
    addQuestCoins(member, coins);
    return { kind: "coins", coins };
  }

  const pickedItem = SHOP_ITEMS[picked.itemId];
  if (pickedItem.chestMin !== undefined) {
    const coins = randomInt(pickedItem.chestMin, pickedItem.chestMax);
    addQuestCoins(member, coins);
    return { kind: "coins", coins, sourceItemId: picked.itemId, sourceItemName: picked.itemName };
  }

  let granted = null;
  try {
    granted = await grantShopItem(member, picked.itemId);
  } catch (error) {
    if (error.message !== "no_quest_templates") throw error;
    const coins = randomInt(coinMin, coinMax);
    addQuestCoins(member, coins);
    return { kind: "coins", coins };
  }
  return {
    kind: "item",
    ...granted
  };
}
