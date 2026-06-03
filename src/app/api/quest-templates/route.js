import { NextResponse } from "next/server";
import { connectDb } from "@/lib/db";
import QuestTemplate from "@/models/QuestTemplate";

// CORS headers — dashboard (different port) calls this endpoint
const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, PUT, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};
const CACHE_TTL_MS = Math.max(30_000, Number(process.env.TEMPLATE_CACHE_TTL_MS || 300_000));
let cachedQuestTemplates = new Map();

export async function OPTIONS() {
  return new Response(null, { status: 204, headers: CORS });
}

// GET /api/quest-templates?difficulty=easy   — returns quests (all or filtered)
export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const difficulty = searchParams.get("difficulty");

  try {
    const filter = difficulty ? { difficulty } : {};
    const cacheKey = difficulty || "__all__";
    const cached = cachedQuestTemplates.get(cacheKey);
    if (cached && Date.now() - cached.loadedAt < CACHE_TTL_MS) {
      return NextResponse.json({ quests: cached.quests }, { headers: CORS });
    }

    await connectDb();
    const quests = await QuestTemplate.find(filter).sort({ difficulty: 1, createdAt: 1 }).lean();
    cachedQuestTemplates.set(cacheKey, { quests, loadedAt: Date.now() });
    return NextResponse.json({ quests }, { headers: CORS });
  } catch (error) {
    return NextResponse.json({ error: error.message }, { status: 503, headers: CORS });
  }
}

// PUT /api/quest-templates   body: { quests: [{difficulty, title, description, rewardMin, rewardMax, npcCharacter?}] }
// Replaces ALL quest templates with the given list
export async function PUT(request) {
  try {
    const body = await request.json();
    const incoming = Array.isArray(body?.quests) ? body.quests : [];

    // Validate entries
    const valid = incoming.filter(
      (q) => ["easy", "medium", "hard", "stupid"].includes(q.difficulty) && q.title && q.description
    );

    await connectDb();
    // Delete all existing templates and insert fresh batch
    await QuestTemplate.deleteMany({});
    if (valid.length > 0) {
      await QuestTemplate.insertMany(
        valid.map((q) => ({
          difficulty: q.difficulty,
          title: String(q.title).trim(),
          description: String(q.description).trim(),
          rewardMin: Number(q.rewardMin) || 50,
          rewardMax: Number(q.rewardMax) || 100,
          npcCharacter: q.npcCharacter || null,
        }))
      );
    }

    const quests = await QuestTemplate.find({}).sort({ difficulty: 1, createdAt: 1 }).lean();
    cachedQuestTemplates = new Map();
    return NextResponse.json({ success: true, quests }, { headers: CORS });
  } catch (error) {
    return NextResponse.json({ error: error.message }, { status: 503, headers: CORS });
  }
}
