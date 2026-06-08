import { NextResponse } from "next/server";
import { connectDb } from "@/lib/db";
import { getAvailableLevels } from "@/lib/player";
import Level from "@/models/Level";
import { normalizeLevelUnlocks, unlockRewards } from "@/lib/levelUnlocks";
import { GAME_ITEM_BY_ID, GAME_NPC_BY_ID, getGameItem, getGameNpc } from "@/lib/gameCatalog";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, PUT, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
};
const LEVEL_SAVE_MAX_LEVELS = Math.max(1, Number(process.env.LEVEL_SAVE_MAX_LEVELS || process.env.LEVEL_LIST_LIMIT || 500));
const LEVEL_UNLOCK_ITEMS_MAX = Math.max(1, Number(process.env.LEVEL_UNLOCK_ITEMS_MAX || 80));
const LEVEL_UNLOCK_NPCS_MAX = Math.max(1, Number(process.env.LEVEL_UNLOCK_NPCS_MAX || 30));

function json(body, init = {}) {
  return NextResponse.json(body, {
    ...init,
    headers: {
      ...CORS,
      ...(init.headers || {})
    }
  });
}

function isAuthorized(request) {
  const expectedToken = process.env.GAME_API_TOKEN || process.env.ADMIN_API_TOKEN || "";
  if (!expectedToken) return process.env.NODE_ENV !== "production";
  return request.headers.get("authorization") === `Bearer ${expectedToken}`;
}

function normalizePoolChance(value) {
  return Math.max(0, Math.min(100, Number(value) || 0));
}

function assertChanceTotal(entries, label, levelName) {
  if (!entries.length) return;
  const total = entries.reduce((sum, entry) => sum + (Number(entry.chance) || 0), 0);
  if (Math.abs(total - 100) > 0.01) {
    throw new Error(`${label} chances must total 100% in ${levelName}. Current total: ${Math.round(total * 10) / 10}%.`);
  }
}

function hasDuplicates(values) {
  return new Set(values).size !== values.length;
}

function normalizeLevel(level, index) {
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
        chance: normalizePoolChance(item?.chance),
        price: Math.max(0, Number(item?.price ?? meta.defaultPrice) || 0),
        maxQty: Math.max(1, Number(item?.maxQty) || 1),
      };
    }).filter((item) => item.itemType) : [],
    boxDrops: Array.isArray(level?.boxDrops) ? level.boxDrops.map((drop) => {
      const itemType = String(drop?.itemType || "").trim();
      const meta = getGameItem(itemType) || {};
      return {
        itemType,
        itemName: String(drop?.itemName || meta.label || itemType),
        chance: normalizePoolChance(drop?.chance),
      };
    }).filter((drop) => drop.itemType) : [],
    npcSpawns: Array.isArray(level?.npcSpawns) ? level.npcSpawns.map((spawn) => ({
      npcId: String(spawn?.npcId || "").trim(),
      chance: normalizePoolChance(spawn?.chance),
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

function validateLevels(levels) {
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

    const availableItems = new Set([...unlockedItems.keys(), ...unlockItemIds]);
    const availableNpcs = new Set([...unlockedNpcs.keys(), ...unlockNpcIds]);
    const shopItemIds = level.npcShop.map((item) => item.itemType);
    const boxItemIds = level.boxDrops.map((item) => item.itemType);
    const spawnNpcIds = level.npcSpawns.map((spawn) => spawn.npcId);

    if (hasDuplicates(shopItemIds)) throw new Error(`Duplicate NPC shop items in ${levelName}.`);
    if (hasDuplicates(boxItemIds)) throw new Error(`Duplicate box drops in ${levelName}.`);
    if (hasDuplicates(spawnNpcIds)) throw new Error(`Duplicate NPC spawns in ${levelName}.`);
    if (availableNpcs.size > 0 && spawnNpcIds.length === 0) throw new Error(`NPC spawn chances are required in ${levelName}.`);
    if (availableItems.size > 0 && shopItemIds.length === 0) throw new Error(`NPC shop chances are required in ${levelName}.`);
    if (availableItems.size > 0 && boxItemIds.length === 0) throw new Error(`Box drop chances are required in ${levelName}.`);

    for (const itemId of shopItemIds) {
      const meta = getGameItem(itemId);
      if (!meta) throw new Error(`Unknown shop item id: ${itemId}.`);
      if (!availableItems.has(itemId)) throw new Error(`${itemId} is not unlocked yet for ${levelName}.`);
      if (!meta.canShopSell) throw new Error(`${itemId} cannot be sold by NPC shop.`);
    }
    for (const itemId of boxItemIds) {
      const meta = getGameItem(itemId);
      if (!meta) throw new Error(`Unknown box item id: ${itemId}.`);
      if (!availableItems.has(itemId)) throw new Error(`${itemId} is not unlocked yet for ${levelName}.`);
      if (!meta.canBoxDrop) throw new Error(`${itemId} cannot drop from boxes.`);
    }
    for (const npcId of spawnNpcIds) {
      if (!getGameNpc(npcId)) throw new Error(`Unknown NPC id: ${npcId}.`);
      if (!availableNpcs.has(npcId)) throw new Error(`${npcId} is not unlocked yet for ${levelName}.`);
    }

    assertChanceTotal(level.npcSpawns, "NPC spawn", levelName);
    assertChanceTotal(level.npcShop, "NPC shop", levelName);
    assertChanceTotal(level.boxDrops, "Box drop", levelName);

    for (const item of level.unlocks.items) unlockedItems.set(item.itemType, item);
    for (const npc of level.unlocks.npcs) unlockedNpcs.set(npc.npcId, npc);
  }
}

export async function OPTIONS() {
  return new Response(null, { status: 204, headers: CORS });
}

export async function GET() {
  try {
    const levels = await getAvailableLevels();
    return json({ success: true, levels });
  } catch (error) {
    return json({ success: false, error: error.message }, { status: 503 });
  }
}

export async function PUT(request) {
  if (!isAuthorized(request)) {
    return json({ success: false, error: "unauthorized" }, { status: 401 });
  }

  try {
    const body = await request.json();
    if (!Array.isArray(body?.levels)) {
      return json({ success: false, error: "Expected an array of levels." }, { status: 400 });
    }

    const levels = body.levels.map(normalizeLevel);
    validateLevels(levels);

    await connectDb();
    await Level.deleteMany({});
    if (levels.length > 0) await Level.insertMany(levels);
    await globalThis.__questRoomInvalidateLevelRuntimeConfig?.();

    const savedLevels = await getAvailableLevels({ force: true });
    return json({ success: true, levels: savedLevels });
  } catch (error) {
    const status = ["unauthorized"].includes(error.message) ? 401 : 400;
    return json({ success: false, error: error.message }, { status });
  }
}
