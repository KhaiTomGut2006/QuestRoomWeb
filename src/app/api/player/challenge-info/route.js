import { NextResponse } from "next/server";
import { connectDb } from "@/lib/db";
import Level from "@/models/Level";

function normalizeReward(reward, index) {
  return {
    id: String(reward?.id || `reward-${index}`),
    label: String(reward?.label || ""),
    image: String(reward?.image || ""),
    quantity: Math.max(0, Number(reward?.quantity) || 0),
    kind: String(reward?.kind || "item"),
  };
}

function normalizeChallengeInfo(level) {
  const info = level?.challengeInfo || {};
  return {
    title: String(info.title || level?.name || "").trim(),
    description: String(info.description || "").trim(),
    videoUrl: String(info.videoUrl || "").trim(),
    rewards: Array.isArray(info.rewards) ? info.rewards.slice(0, 8).map(normalizeReward) : [],
  };
}

export async function GET(request) {
  const stage = String(request.nextUrl.searchParams.get("stage") || "").trim();
  if (!stage) {
    return NextResponse.json({ error: "stage_required" }, { status: 400 });
  }

  try {
    await connectDb();
    const level = await Level.findOne(
      { stageId: stage },
      { _id: 0, name: 1, challengeInfo: 1 }
    ).lean();

    if (!level) {
      return NextResponse.json({ error: "level_not_found" }, { status: 404 });
    }

    return NextResponse.json(
      { challengeInfo: normalizeChallengeInfo(level) },
      { headers: { "Cache-Control": "private, no-store" } }
    );
  } catch (error) {
    return NextResponse.json({ error: error.message }, { status: 503 });
  }
}
