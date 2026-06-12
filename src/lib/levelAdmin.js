import { normalizeLevelUnlocks, unlockRewards } from "@/lib/levelUnlocks";
import { GAME_ITEM_BY_ID, GAME_NPC_BY_ID, getGameItem, getGameNpc } from "@/lib/gameCatalog";

// Shared admin-save logic for /api/levels (PUT) and /api/levels/[stageId] (PATCH).
//
// Pool chances are proportional WEIGHTS, not percentages — the runtime rolls
// weighted picks, so totals are intentionally not required to equal 100.

export const LEVEL_SAVE_MAX_LEVELS = Math.max(1, Number(process.env.LEVEL_SAVE_MAX_LEVELS || process.env.LEVEL_LIST_LIMIT || 500));
export const LEVEL_UNLOCK_ITEMS_MAX = Math.max(1, Number(process.env.LEVEL_UNLOCK_ITEMS_MAX || 80));
export const LEVEL_UNLOCK_NPCS_MAX = Math.max(1, Number(process.env.LEVEL_UNLOCK_NPCS_MAX || 30));

export function getAuthStatus(request) {
  const expectedToken = process.env.GAME_API_TOKEN || process.env.ADMIN_API_TOKEN || "";
  if (!expectedToken) {
    return {
      ok: process.env.NODE_ENV !== "production",
      error: "server_game_api_token_not_configured",
    };
  }
  const bearer = request.headers.get("authorization") || "";
  const headerToken = request.headers.get("x-game-api-token") || "";
  const hasSubmittedToken = Boolean(bearer || headerToken);
  return {
    ok: bearer === `Bearer ${expectedToken}` || headerToken === expectedToken,
    error: hasSubmittedToken ? "invalid_game_api_token" : "missing_game_api_token",
  };
}

export function isAuthorized(request) {
  return getAuthStatus(request).ok;
}

function normalizePoolWeight(value) {
  return Math.max(0, Math.min(100000, Number(value) || 0));
}

function hasDuplicates(values) {
  return new Set(values).size !== values.length;
}

export function normalizeLevel(level, index) {
  const unlocks = normalizeLevelUnlocks(level?.unlocks || {});
  const configuredRewards = unlockRewards(unlocks, { realImages: false }).slice(0, 12);
  return {
    stageId: String(level?.stageId || "").trim(),
    name: String(level?.name || "").trim(),
    order: index,
    npcShop: Array.isArray(level?.npcShop) ? level.npcShop.map((item) => {
      const itemType = String(item?.itemType || "").trim();
      const meta = getGameItem(itemType) || {};
      return {
        itemType,
        itemName: String(item?.itemName || meta.label || itemType),
        chance: normalizePoolWeight(item?.chance),
        price: Math.max(0, Number(item?.price ?? meta.defaultPrice) || 0),
        maxQty: Math.max(1, Number(item?.maxQty) || 1),
      };
    }).filter((item) => item.itemType) : [],
    boxDrops: Array.isArray(level?.boxDrops) ? level.boxDrops.map((drop) => {
      const itemType = String(drop?.itemType || "").trim();
      if (itemType === "coins") {
        return {
          itemType: "coins",
          itemName: "Coins",
          chance: normalizePoolWeight(drop?.chance),
          coinMin: Math.max(1, Math.min(100000, Number(drop?.coinMin) || 20)),
          coinMax: Math.max(1, Math.min(100000, Number(drop?.coinMax) || 200)),
        };
      }
      const meta = getGameItem(itemType) || {};
      return {
        itemType,
        itemName: String(drop?.itemName || meta.label || itemType),
        chance: normalizePoolWeight(drop?.chance),
      };
    }).filter((drop) => drop.itemType) : [],
    npcSpawns: Array.isArray(level?.npcSpawns) ? level.npcSpawns.map((spawn) => ({
      npcId: String(spawn?.npcId || "").trim(),
      chance: normalizePoolWeight(spawn?.chance),
    })).filter((spawn) => spawn.npcId) : [],
    challengeInfo: {
      title: String(level?.challengeInfo?.title || "").trim(),
      description: String(level?.challengeInfo?.description || "").trim().slice(0, 2000),
      videoUrl: String(level?.challengeInfo?.videoUrl || "").trim(),
      videoPath: String(level?.challengeInfo?.videoPath || "").trim(),
      videoContentType: String(level?.challengeInfo?.videoContentType || "").trim(),
      rewards: configuredRewards,
    },
    unlocks,
  };
}

// Validates a single normalized level (catalog ids, duplicates, flags).
// `previouslyUnlocked` lets cross-level duplicate checks work for both full PUT
// and single-stage PATCH.
export function validateLevel(level, { unlockedItems = new Map(), unlockedNpcs = new Map() } = {}) {
  const levelName = level.name || level.stageId;

  if (level.unlocks.items.length > LEVEL_UNLOCK_ITEMS_MAX) {
    throw new Error(`Too many item unlocks in ${levelName}. Maximum is ${LEVEL_UNLOCK_ITEMS_MAX}.`);
  }
  if (level.unlocks.npcs.length > LEVEL_UNLOCK_NPCS_MAX) {
    throw new Error(`Too many NPC unlocks in ${levelName}. Maximum is ${LEVEL_UNLOCK_NPCS_MAX}.`);
  }

  const unlockItemIds = level.unlocks.items.map((item) => item.itemType);
  const unlockNpcIds = level.unlocks.npcs.map((npc) => npc.npcId);
  if (hasDuplicates(unlockItemIds)) throw new Error(`Duplicate item unlocks in ${levelName}.`);
  if (hasDuplicates(unlockNpcIds)) throw new Error(`Duplicate NPC unlocks in ${levelName}.`);

  for (const itemId of unlockItemIds) {
    if (!GAME_ITEM_BY_ID.has(itemId)) throw new Error(`Unknown item id: ${itemId}.`);
    if (unlockedItems.has(itemId)) throw new Error(`${itemId} is already unlocked before ${levelName}.`);
  }
  for (const npcId of unlockNpcIds) {
    if (!GAME_NPC_BY_ID.has(npcId)) throw new Error(`Unknown NPC id: ${npcId}.`);
    if (unlockedNpcs.has(npcId)) throw new Error(`${npcId} is already unlocked before ${levelName}.`);
  }

  const shopItemIds = level.npcShop.map((item) => item.itemType);
  const boxItemIds = level.boxDrops.map((item) => item.itemType);
  const spawnNpcIds = level.npcSpawns.map((spawn) => spawn.npcId);

  if (hasDuplicates(shopItemIds)) throw new Error(`Duplicate NPC shop items in ${levelName}.`);
  if (hasDuplicates(boxItemIds)) throw new Error(`Duplicate box drops in ${levelName}.`);
  if (hasDuplicates(spawnNpcIds)) throw new Error(`Duplicate NPC spawns in ${levelName}.`);

  for (const itemId of shopItemIds) {
    const meta = getGameItem(itemId);
    if (!meta) throw new Error(`Unknown shop item id: ${itemId}.`);
    if (meta.canShopSell === false) throw new Error(`${itemId} cannot be sold by NPC shop.`);
  }
  for (const itemId of boxItemIds) {
    if (itemId === "coins") continue;
    const meta = getGameItem(itemId);
    if (!meta) throw new Error(`Unknown box item id: ${itemId}.`);
    if (meta.canBoxDrop === false) throw new Error(`${itemId} cannot drop from boxes.`);
  }
  for (const npcId of spawnNpcIds) {
    if (!getGameNpc(npcId)) throw new Error(`Unknown NPC id: ${npcId}.`);
  }
}

export function validateLevels(levels) {
  if (levels.length > LEVEL_SAVE_MAX_LEVELS) {
    throw new Error(`Too many levels. Maximum is ${LEVEL_SAVE_MAX_LEVELS}.`);
  }
  if (levels.some((level) => !level.stageId || !level.name)) {
    throw new Error("Every level needs a stage id and name.");
  }
  if (hasDuplicates(levels.map((level) => level.stageId))) {
    throw new Error("Stage ids must be unique.");
  }

  const unlockedItems = new Map();
  const unlockedNpcs = new Map();
  for (const level of levels) {
    validateLevel(level, { unlockedItems, unlockedNpcs });
    for (const item of level.unlocks.items) unlockedItems.set(item.itemType, item);
    for (const npc of level.unlocks.npcs) unlockedNpcs.set(npc.npcId, npc);
  }
}
