import { NextResponse } from "next/server";
import { connectDb } from "@/lib/db";
import QuestTemplate from "@/models/QuestTemplate";

// CORS headers — dashboard (different port) calls this endpoint
const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, PUT, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

export async function OPTIONS() {
  return new Response(null, { status: 204, headers: CORS });
}

// GET /api/quest-templates?difficulty=easy   — returns quests (all or filtered)
export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const difficulty = searchParams.get("difficulty");

  try {
    await connectDb();
    const filter = difficulty ? { difficulty } : {};
    const quests = await QuestTemplate.find(filter).sort({ difficulty: 1, createdAt: 1 }).lean();
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
      (q) => ["easy", "medium", "hard"].includes(q.difficulty) && q.title && q.description
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
    return NextResponse.json({ success: true, quests }, { headers: CORS });
  } catch (error) {
    return NextResponse.json({ error: error.message }, { status: 503, headers: CORS });
  }
}
