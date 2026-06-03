import { NextResponse } from "next/server";
import { connectDb } from "@/lib/db";
import HintTemplate from "@/models/HintTemplate";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, PUT, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};
const CACHE_TTL_MS = Math.max(30_000, Number(process.env.TEMPLATE_CACHE_TTL_MS || 300_000));
let cachedHints = null;
let cachedHintsAt = 0;

export async function OPTIONS() {
  return new Response(null, { status: 204, headers: CORS });
}

// GET /api/hint-templates   — returns all hints ordered by order field
export async function GET() {
  try {
    if (cachedHints && Date.now() - cachedHintsAt < CACHE_TTL_MS) {
      return NextResponse.json({ hints: cachedHints }, { headers: CORS });
    }

    await connectDb();
    const hints = await HintTemplate.find().sort({ order: 1, createdAt: 1 }).lean();
    cachedHints = hints;
    cachedHintsAt = Date.now();
    return NextResponse.json({ hints }, { headers: CORS });
  } catch (error) {
    return NextResponse.json({ error: error.message }, { status: 503, headers: CORS });
  }
}

// PUT /api/hint-templates   body: { hints: [{title, content, cost?, order?}] }
// Replaces ALL hint templates with the given list
export async function PUT(request) {
  try {
    const body = await request.json();
    const incoming = Array.isArray(body?.hints) ? body.hints : [];

    const valid = incoming
      .filter((h) => h.title && h.content)
      .map((h, i) => ({
        title:   String(h.title).trim(),
        content: String(h.content).trim(),
        cost:    Number(h.cost) || 500,
        order:   Number(h.order ?? i),
      }));

    await connectDb();
    await HintTemplate.deleteMany({});
    if (valid.length > 0) await HintTemplate.insertMany(valid);

    const hints = await HintTemplate.find().sort({ order: 1, createdAt: 1 }).lean();
    cachedHints = null;
    cachedHintsAt = 0;
    return NextResponse.json({ hints }, { headers: CORS });
  } catch (error) {
    return NextResponse.json({ error: error.message }, { status: 503, headers: CORS });
  }
}
