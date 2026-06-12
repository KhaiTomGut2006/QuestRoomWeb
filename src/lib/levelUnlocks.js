import { getGameItem, getGameNpc } from "@/lib/gameCatalog";

// Proportional weight, not a percentage — totals are not required to be 100.
function cleanWeight(value) {
  return Math.max(0, Math.min(100000, Number(value) || 0));
}

export function normalizeUnlockItem(item) {
  const itemType = String(item?.itemType || item?.id || "").trim();
  if (!itemType) return null;
  const meta = getGameItem(itemType) || {};
  const shopChance = cleanWeight(item?.shopChance ?? item?.shopWeight ?? item?.shopPercent);
  const boxChance = cleanWeight(item?.boxChance ?? item?.boxWeight ?? item?.boxPercent);
  return {
    itemType,
    itemName: String(item?.itemName || item?.label || meta.label || itemType),
    shopChance,
    boxChance,
    price: Math.max(0, Number(item?.price ?? meta.defaultPrice) || 0),
    maxQty: Math.max(1, Number(item?.maxQty) || 1),
    shadowImage: String(item?.shadowImage || meta.shadowImage || ""),
    image: String(item?.image || meta.image || item?.shadowImage || meta.shadowImage || "")
  };
}

export function normalizeUnlockNpc(npc) {
  const npcId = String(npc?.npcId || npc?.id || "").trim();
  if (!npcId) return null;
  const meta = getGameNpc(npcId) || {};
  return {
    npcId,
    name: String(npc?.name || npc?.label || meta.label || npcId),
    spawnChance: cleanWeight(npc?.spawnChance),
    shadowImage: String(npc?.shadowImage || meta.shadowImage || ""),
    image: String(npc?.image || meta.image || npc?.shadowImage || meta.shadowImage || "")
  };
}

export function normalizeLevelUnlocks(unlocks = {}) {
  return {
    coinReward: Math.max(0, Number(unlocks?.coinReward ?? unlocks?.coins ?? 0) || 0),
    items: Array.isArray(unlocks?.items) ? unlocks.items.map(normalizeUnlockItem).filter(Boolean) : [],
    npcs: Array.isArray(unlocks?.npcs) ? unlocks.npcs.map(normalizeUnlockNpc).filter(Boolean) : []
  };
}

export function validateUnlockWeights(unlocks, levelName = "level") {
  for (const item of unlocks.items || []) {
    const total = Math.round((Number(item.shopChance) + Number(item.boxChance)) * 100) / 100;
    if (Math.abs(total - 100) > 0.01) {
      throw new Error(`Unlock chance for ${item.itemName || item.itemType} in ${levelName} must total 100%.`);
    }
  }
}

export function unlockRewards(unlocks = {}, { realImages = false } = {}) {
  const normalized = normalizeLevelUnlocks(unlocks);
  const rewards = [
    ...normalized.items.map((item) => ({
      id: item.itemType,
      label: item.itemName,
      image: realImages ? item.image : item.shadowImage,
      quantity: 1,
      kind: "item"
    })),
    ...normalized.npcs.map((npc) => ({
      id: npc.npcId,
      label: npc.name,
      image: realImages ? npc.image : npc.shadowImage,
      quantity: 1,
      kind: "npc"
    }))
  ];
  if (normalized.coinReward > 0) {
    rewards.push({
      id: "coins",
      label: "Coins",
      image: "/assets/Coin.png",
      quantity: normalized.coinReward,
      kind: "coins"
    });
  }
  return rewards;
}

export function cumulativeUnlockedItems(levels = [], stageId = "") {
  const ordered = [...levels].sort((a, b) => Number(a.order || 0) - Number(b.order || 0));
  const current = ordered.find((level) => level.stageId === stageId);
  if (!current) return [];
  const seen = new Map();
  for (const level of ordered) {
    if (Number(level.order || 0) >= Number(current.order || 0)) break;
    const unlocks = normalizeLevelUnlocks(level.unlocks);
    for (const item of unlocks.items) seen.set(item.itemType, item);
  }
  return [...seen.values()];
}

export function completionRewardForLevel(level) {
  const unlocks = normalizeLevelUnlocks(level?.unlocks);
  return {
    coins: unlocks.coinReward,
    unlocks,
    rewards: unlockRewards(unlocks, { realImages: true })
  };
}
