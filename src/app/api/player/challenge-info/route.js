import { NextResponse } from "next/server";
import { connectDb } from "@/lib/db";
import Level from "@/models/Level";
import { unlockRewards } from "@/lib/levelUnlocks";

const LEVEL_QUERY_MAX_TIME_MS = Math.max(500, Number(process.env.LEVEL_QUERY_MAX_TIME_MS || 3_000));

function publicChallengeVideoUrl(info) {
  const url = String(info?.videoUrl || "").trim();
  const publicBase = String(process.env.R2_PUBLIC_BASE_URL || "").replace(/\/+$/, "");
  if (!publicBase) return url;

  const videoPath = String(info?.videoPath || "").trim();
  if (videoPath.startsWith("r2/")) {
    const key = videoPath.slice(3);
    return `${publicBase}/${encodeURI(key).replace(/%2F/g, "/")}`;
  }

  try {
    const parsed = new URL(url);
    if (
      parsed.hostname.endsWith(".r2.dev")
      && (
        parsed.pathname.startsWith("/challenge-videos/")
        || parsed.pathname.startsWith("/npc-quests/challenge-videos/")
      )
    ) {
      return `${publicBase}${parsed.pathname}`;
    }
  } catch {
    return url;
  }
  return url;
}

function normalizeChallengeInfo(level) {
  const info = level?.challengeInfo || {};
  return {
    title: String(info.title || level?.name || "").trim(),
    description: String(info.description || "").trim(),
    videoUrl: publicChallengeVideoUrl(info),
    videoPath: String(info.videoPath || "").trim(),
    videoContentType: String(info.videoContentType || "").trim(),
    rewards: unlockRewards(level?.unlocks || {}, { realImages: false }).slice(0, 12),
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
      { _id: 0, name: 1, challengeInfo: 1, unlocks: 1 }
    ).lean().maxTimeMS(LEVEL_QUERY_MAX_TIME_MS);

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
