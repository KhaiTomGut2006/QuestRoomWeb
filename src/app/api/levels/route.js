import { NextResponse } from "next/server";
import { connectDb } from "@/lib/db";
import { getAvailableLevels } from "@/lib/player";
import Level from "@/models/Level";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, PUT, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

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

    const levels = body.levels.map((level, index) => ({
      stageId:  String(level?.stageId || "").trim(),
      name:     String(level?.name || "").trim(),
      order:    index,
      npcShop:  Array.isArray(level?.npcShop)  ? level.npcShop.map(item => ({
        itemType: String(item.itemType || ""),
        itemName: String(item.itemName || ""),
        price:    Number(item.price)  || 0,
        maxQty:   Number(item.maxQty) || 1,
      })) : [],
      boxDrops: Array.isArray(level?.boxDrops) ? level.boxDrops.map(drop => ({
        itemType: String(drop.itemType || ""),
        itemName: String(drop.itemName || ""),
        chance:   Number(drop.chance)  || 0,
      })) : [],
    }));
    const stageIds = new Set(levels.map((level) => level.stageId));

    if (levels.some((level) => !level.stageId || !level.name)) {
      return NextResponse.json({ success: false, error: "Every level needs a stage id and name." }, { status: 400, headers: CORS });
    }
    if (stageIds.size !== levels.length) {
      return NextResponse.json({ success: false, error: "Stage ids must be unique." }, { status: 400, headers: CORS });
    }

    await connectDb();
    await Level.deleteMany({});
    if (levels.length > 0) await Level.insertMany(levels);

    const savedLevels = await getAvailableLevels();
    return NextResponse.json({ success: true, levels: savedLevels }, { headers: CORS });
  } catch (error) {
    return NextResponse.json({ success: false, error: error.message }, { status: 503, headers: CORS });
  }
}
