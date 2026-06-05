import { NextResponse } from "next/server";
import { connectDb } from "@/lib/db";
import { getAvailableLevels } from "@/lib/player";
import Level from "@/models/Level";
import { normalizeLevelUnlocks, unlockRewards, validateUnlockWeights } from "@/lib/levelUnlocks";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, PUT, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
};
const VALID_NPC_IDS = new Set([
  "chest", "shop", "quest-easy", "quest-medium",
  "hints", "quest-hard", "stupid-quest", "gambling"
]);

export async function OPTIONS() {
  return new Response(null, { status: 204, headers: CORS });
}

export async function GET() {
  try {
    const levels = await getAvailableLevels();
    return NextResponse.json({ success: true, levels }, { headers: CORS });
  } catch (error) {
    return NextResponse.json({ success: false, error: error.message }, { status: 503, headers: CORS });
  }
}

export async function PUT(request) {
  try {
    const body = await request.json();
    if (!Array.isArray(body?.levels)) {
      return NextResponse.json({ success: false, error: "Expected an array of levels." }, { status: 400, headers: CORS });
    }

    const levels = body.levels.map((level, index) => {
      const unlocks = normalizeLevelUnlocks(level?.unlocks || {});
      const unlockShopItems = unlocks.items
        .filter((item) => item.shopChance > 0)
        .map((item) => ({
          itemType: item.itemType,
          itemName: item.itemName,
          chance: item.shopChance,
          price: item.price,
          maxQty: item.maxQty,
        }));
      const unlockBoxDrops = unlocks.items
        .filter((item) => item.boxChance > 0)
        .map((item) => ({
          itemType: item.itemType,
          itemName: item.itemName,
          chance: item.boxChance,
        }));
      const configuredRewards = Array.isArray(level?.challengeInfo?.rewards)
        ? level.challengeInfo.rewards.slice(0, 8).map((reward) => ({
          id: String(reward?.id || ""),
          label: String(reward?.label || ""),
          image: String(reward?.image || ""),
          quantity: Math.max(0, Number(reward?.quantity) || 0),
          kind: String(reward?.kind || "item"),
        }))
        : [];

      return {
        stageId: String(level?.stageId || "").trim(),
        name: String(level?.name || "").trim(),
        order: index,
        npcShop: unlockShopItems.length ? unlockShopItems : Array.isArray(level?.npcShop) ? level.npcShop.map(item => ({
          itemType: String(item.itemType || ""),
          itemName: String(item.itemName || ""),
          chance: Number(item.chance) || 0,
          price: Number(item.price) || 0,
          maxQty: Number(item.maxQty) || 1,
        })) : [],
        boxDrops: unlockBoxDrops.length ? unlockBoxDrops : Array.isArray(level?.boxDrops) ? level.boxDrops.map(drop => ({
          itemType: String(drop.itemType || ""),
          itemName: String(drop.itemName || ""),
          chance: Number(drop.chance) || 0,
        })) : [],
        npcSpawns: Array.isArray(level?.npcSpawns) ? level.npcSpawns.map(spawn => ({
          npcId: String(spawn.npcId || ""),
          chance: Number(spawn.chance) || 0,
        })) : [],
        challengeInfo: {
          title: String(level?.challengeInfo?.title || "").trim(),
          description: String(level?.challengeInfo?.description || "").trim().slice(0, 2000),
          videoUrl: String(level?.challengeInfo?.videoUrl || "").trim(),
          videoPath: String(level?.challengeInfo?.videoPath || "").trim(),
          videoContentType: String(level?.challengeInfo?.videoContentType || "").trim(),
          rewards: configuredRewards.length ? configuredRewards : unlockRewards(unlocks, { realImages: false }).slice(0, 12),
        },
        unlocks,
      };
    });
    const stageIds = new Set(levels.map((level) => level.stageId));

    if (levels.some((level) => !level.stageId || !level.name)) {
      return NextResponse.json({ success: false, error: "Every level needs a stage id and name." }, { status: 400, headers: CORS });
    }
    if (stageIds.size !== levels.length) {
      return NextResponse.json({ success: false, error: "Stage ids must be unique." }, { status: 400, headers: CORS });
    }
    for (const level of levels) validateUnlockWeights(level.unlocks, level.name);
    if (levels.some((level) => level.unlocks.items.length || level.unlocks.npcs.length || level.unlocks.coinReward > 0)) {
      const unlockedItems = new Map();
      const unlockedNpcs = new Map();
      for (const level of levels) {
        level.npcShop = [...unlockedItems.values()]
          .filter((item) => item.shopChance > 0)
          .map((item) => ({
            itemType: item.itemType,
            itemName: item.itemName,
            chance: item.shopChance,
            price: item.price,
            maxQty: item.maxQty,
          }));
        level.boxDrops = [...unlockedItems.values()]
          .filter((item) => item.boxChance > 0)
          .map((item) => ({
            itemType: item.itemType,
            itemName: item.itemName,
            chance: item.boxChance,
          }));
        if (levels.some((candidate) => candidate.unlocks.npcs.length)) {
          const npcs = [...unlockedNpcs.values()];
          const chance = npcs.length ? 100 / npcs.length : 0;
          level.npcSpawns = npcs.map((npc) => ({
            npcId: npc.npcId,
            chance,
          }));
        }
        for (const item of level.unlocks.items) unlockedItems.set(item.itemType, item);
        for (const npc of level.unlocks.npcs) unlockedNpcs.set(npc.npcId, npc);
      }
    }
    const invalidNpcSpawnLevel = levels.find((level) => (
      level.npcSpawns.length > 0
      && Math.abs(level.npcSpawns.reduce((sum, spawn) => sum + spawn.chance, 0) - 100) > 0.01
    ));
    if (invalidNpcSpawnLevel) {
      return NextResponse.json({ success: false, error: `NPC spawn chances must total 100% in ${invalidNpcSpawnLevel.name}.` }, { status: 400, headers: CORS });
    }
    const invalidNpcSpawn = levels.flatMap((level) => level.npcSpawns).find((spawn) => !VALID_NPC_IDS.has(spawn.npcId));
    if (invalidNpcSpawn) {
      return NextResponse.json({ success: false, error: `Unknown NPC id: ${invalidNpcSpawn.npcId}.` }, { status: 400, headers: CORS });
    }

    await connectDb();
    await Level.deleteMany({});
    if (levels.length > 0) await Level.insertMany(levels);

    const savedLevels = await getAvailableLevels({ force: true });
    return NextResponse.json({ success: true, levels: savedLevels }, { headers: CORS });
  } catch (error) {
    return NextResponse.json({ success: false, error: error.message }, { status: 503, headers: CORS });
  }
}
