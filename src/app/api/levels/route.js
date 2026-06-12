import { NextResponse } from "next/server";
import { connectDb } from "@/lib/db";
import { getAvailableLevels } from "@/lib/player";
import Level from "@/models/Level";
import { getAuthStatus, normalizeLevel, validateLevels } from "@/lib/levelAdmin";
import { bumpLevelConfigVersion } from "@/lib/levelConfigVersion";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, PUT, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Game-Api-Token",
};

function json(body, init = {}) {
  return NextResponse.json(body, {
    ...init,
    headers: {
      ...CORS,
      ...(init.headers || {}),
    },
  });
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
  const auth = getAuthStatus(request);
  if (!auth.ok) {
    return json({ success: false, error: auth.error }, { status: 401 });
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
    await bumpLevelConfigVersion();
    await globalThis.__questRoomInvalidateLevelRuntimeConfig?.();

    const savedLevels = await getAvailableLevels({ force: true });
    return json({ success: true, levels: savedLevels });
  } catch (error) {
    return json({ success: false, error: error.message }, { status: 400 });
  }
}
