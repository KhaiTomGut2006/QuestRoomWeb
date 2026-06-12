import { NextResponse } from "next/server";
import { connectDb } from "@/lib/db";
import { getAvailableLevels } from "@/lib/player";
import Level from "@/models/Level";
import { getAuthStatus, normalizeLevel, validateLevel } from "@/lib/levelAdmin";
import { bumpLevelConfigVersion } from "@/lib/levelConfigVersion";

// PATCH /api/levels/[stageId] — update a single stage in place.
//
// Much cheaper than the full PUT (which wipes and re-inserts the whole
// collection); the dashboard uses this when only some stages changed and the
// stage list/order is untouched. Renames and reorders still go through PUT.

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "PATCH, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Game-Api-Token",
};

function json(body, init = {}) {
  return NextResponse.json(body, {
    ...init,
    headers: {
      ...CORS,
      ...(init.headers || {})
    }
  });
}

export async function OPTIONS() {
  return new Response(null, { status: 204, headers: CORS });
}

export async function PATCH(request, context) {
  const auth = getAuthStatus(request);
  if (!auth.ok) {
    return json({ success: false, error: auth.error }, { status: 401 });
  }

  try {
    const { stageId: rawStageId } = await context.params;
    const stageId = String(rawStageId || "").trim();
    if (!stageId) {
      return json({ success: false, error: "stage_id_required" }, { status: 400 });
    }

    const body = await request.json();
    if (!body?.level || typeof body.level !== "object") {
      return json({ success: false, error: "Expected a level object." }, { status: 400 });
    }

    await connectDb();
    const existing = await Level.findOne({ stageId }).select("order").lean();
    if (!existing) {
      return json({ success: false, error: "stage_not_found" }, { status: 404 });
    }

    // Keep stageId/order stable — PATCH cannot rename or reorder stages.
    const normalized = normalizeLevel({ ...body.level, stageId }, Number(existing.order) || 0);
    if (!normalized.name) {
      return json({ success: false, error: "Every level needs a stage id and name." }, { status: 400 });
    }

    // Cross-stage duplicate-unlock check against all other stages.
    const others = await Level.find({ stageId: { $ne: stageId } })
      .select("stageId unlocks")
      .lean();
    const unlockedItems = new Map();
    const unlockedNpcs = new Map();
    for (const other of others) {
      for (const item of other.unlocks?.items || []) unlockedItems.set(item.itemType, item);
      for (const npc of other.unlocks?.npcs || []) unlockedNpcs.set(npc.npcId, npc);
    }
    validateLevel(normalized, { unlockedItems, unlockedNpcs });

    await Level.updateOne({ stageId }, {
      $set: {
        name: normalized.name,
        npcShop: normalized.npcShop,
        boxDrops: normalized.boxDrops,
        npcSpawns: normalized.npcSpawns,
        unlocks: normalized.unlocks,
        challengeInfo: normalized.challengeInfo,
      },
    });
    await bumpLevelConfigVersion();
    await globalThis.__questRoomInvalidateLevelRuntimeConfig?.();
    await getAvailableLevels({ force: true });

    return json({ success: true, level: normalized });
  } catch (error) {
    return json({ success: false, error: error.message }, { status: 400 });
  }
}
