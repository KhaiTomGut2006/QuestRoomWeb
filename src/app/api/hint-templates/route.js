import { NextResponse } from "next/server";
import { connectDb } from "@/lib/db";
import { dashboardCors, requireDashboardWrite } from "@/lib/dashboardAuth";
import { replaceCollectionDocuments } from "@/lib/replaceCollection";
import HintTemplate from "@/models/HintTemplate";

const CORS = dashboardCors;

export async function OPTIONS() {
  return new Response(null, { status: 204, headers: CORS });
}

// GET /api/hint-templates   — returns all hints ordered by order field
export async function GET() {
  try {
    await connectDb();
    const hints = await HintTemplate.find().sort({ order: 1, createdAt: 1 }).lean();
    return NextResponse.json({ hints }, { headers: CORS });
  } catch (error) {
    return NextResponse.json({ error: error.message }, { status: 503, headers: CORS });
  }
}

// PUT /api/hint-templates   body: { hints: [{title, content, cost?, order?}] }
// Replaces ALL hint templates with the given list
export async function PUT(request) {
  const unauthorized = requireDashboardWrite(request);
  if (unauthorized) return unauthorized;

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
    await replaceCollectionDocuments(HintTemplate, valid);

    const hints = await HintTemplate.find().sort({ order: 1, createdAt: 1 }).lean();
    return NextResponse.json({ hints }, { headers: CORS });
  } catch (error) {
    return NextResponse.json({ error: error.message }, { status: 503, headers: CORS });
  }
}
