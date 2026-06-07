import { NextResponse } from "next/server";
import { getMemberByDiscordId, syncChallengeReview } from "@/lib/player";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization"
};
const REVIEW_SYNC_REFRESH_DELAYS_MS = [1_500, 4_000];

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
    const approved = typeof body?.approved === "boolean"
      ? body.approved
      : ["approve", "approved"].includes(event)
        ? true
        : ["award", "awarded", "badge", "badge_awarded"].includes(event)
          ? false
          : null;
    const createReward = body?.createReward !== false && (
      body?.createReward === true
      || approved === true
    );
    const syncOptions = {
      event,
      approved,
      createReward,
      badge: body?.badge || null,
      awardedAt: body?.awardedAt || body?.reviewedAt || null
    };
    const result = await syncChallengeReview(discordId, syncOptions);
    if (!result) {
      return NextResponse.json({ success: false, error: "member_not_found" }, { status: 404, headers: CORS });
    }

    const io = globalThis.__questRoomIo;
    const emitMemberUpdate = (nextResult) => {
      io?.to?.(`player:${discordId}`)?.emit?.("member:update", {
        member: nextResult.member,
        reason: event || "challenge_sync"
      });
    };
    emitMemberUpdate(result);
    if (io) {
      for (const delayMs of REVIEW_SYNC_REFRESH_DELAYS_MS) {
        const timer = setTimeout(async () => {
          try {
            const refreshedMember = await getMemberByDiscordId(discordId, {
              includeSubmissions: false,
              reconcile: false
            });
            if (refreshedMember) {
              emitMemberUpdate({
                member: refreshedMember
              });
            }
          } catch (error) {
            console.warn("Delayed challenge sync refresh failed:", error.message);
          }
        }, delayMs);
        timer.unref?.();
      }
    }
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
