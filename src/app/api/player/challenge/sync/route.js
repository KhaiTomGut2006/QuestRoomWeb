import { NextResponse } from "next/server";
import { syncChallengeReview } from "@/lib/player";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization"
};

function isAuthorized(request) {
  const expectedToken = process.env.GAME_API_TOKEN || process.env.ADMIN_API_TOKEN || "";
  if (!expectedToken) return true;
  const header = request.headers.get("authorization") || "";
  return header === `Bearer ${expectedToken}`;
}

export async function OPTIONS() {
  return new Response(null, { status: 204, headers: CORS });
}

export async function POST(request) {
  if (!isAuthorized(request)) {
    return NextResponse.json({ success: false, error: "unauthorized" }, { status: 401, headers: CORS });
  }

  try {
    const body = await request.json().catch(() => ({}));
    const discordId = String(body?.discordId || body?.userId || "").trim();
    if (!discordId) {
      return NextResponse.json({ success: false, error: "discord_id_required" }, { status: 400, headers: CORS });
    }

    const event = String(body?.event || body?.reason || "").toLowerCase();
    const createReward = body?.createReward !== false && (
      body?.createReward === true
      || ["approve", "approved", "award", "awarded", "badge", "badge_awarded"].includes(event)
    );
    const result = await syncChallengeReview(discordId, { createReward });
    if (!result) {
      return NextResponse.json({ success: false, error: "member_not_found" }, { status: 404, headers: CORS });
    }

    const io = globalThis.__questRoomIo;
    io?.to?.(`player:${discordId}`)?.emit?.("member:update", {
      member: result.member,
      reason: event || "challenge_sync"
    });
    if (result.notification) {
      io?.emit?.("social:notification", result.notification);
    }

    return NextResponse.json({
      success: true,
      member: result.member,
      socialNotification: result.notification
    }, { headers: CORS });
  } catch (error) {
    return NextResponse.json({ success: false, error: error.message }, { status: 503, headers: CORS });
  }
}
