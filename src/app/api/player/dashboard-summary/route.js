import { NextResponse } from "next/server";
import { connectDb } from "@/lib/db";
import { normalizeMemberSummary } from "@/lib/player";
import Member from "@/models/Member";

const QUERY_MAX_TIME_MS = Math.max(500, Number(process.env.MEMBER_READ_QUERY_MAX_TIME_MS || 3_000));
const MAX_IDS = Math.max(1, Number(process.env.DASHBOARD_SUMMARY_MAX_IDS || 500));
const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization"
};

const MEMBER_SELECT = [
  "_id",
  "discord_id",
  "nick",
  "nickname",
  "realName",
  "username",
  "discordData",
  "questroomRank",
  "stage",
  "quest",
  "npcQuest",
  "questChallenge",
  "challengeFailureStage",
  "challengeFailureCount",
  "challengeFailureHandledKey",
  "completedNpcQuestKeys",
  "questReward",
  "roomPosition",
  "shopCooldownT1",
  "shopCooldownT2",
  "shopLimitBreak",
  "shopAssetTickets",
  "ownedAccessories",
  "equippedAccessory",
  "npcVisitId",
  "npcVisitPurchases",
  "questCoin"
].join(" ");

function json(body, init = {}) {
  return NextResponse.json(body, {
    ...init,
    headers: {
      ...CORS,
      ...(init.headers || {})
    }
  });
}

function isAuthorized(request) {
  const expectedToken = process.env.GAME_API_TOKEN || process.env.ADMIN_API_TOKEN || "";
  if (!expectedToken) return true;
  return request.headers.get("authorization") === `Bearer ${expectedToken}`;
}

function normalizeDiscordIds(value) {
  const input = Array.isArray(value) ? value : String(value || "").split(",");
  return [...new Set(input.map((id) => String(id || "").trim()).filter(Boolean))].slice(0, MAX_IDS);
}

export async function OPTIONS() {
  return new Response(null, { status: 204, headers: CORS });
}

export async function POST(request) {
  if (!isAuthorized(request)) {
    return json({ success: false, error: "unauthorized" }, { status: 401 });
  }

  try {
    const body = await request.json().catch(() => ({}));
    const discordIds = normalizeDiscordIds(body?.discordIds || body?.ids);
    if (!discordIds.length) {
      return json({ success: true, players: [] }, { headers: { "Cache-Control": "private, no-store" } });
    }

    await connectDb();
    const members = await Member.find({ discord_id: { $in: discordIds } })
      .select(MEMBER_SELECT)
      .lean()
      .maxTimeMS(QUERY_MAX_TIME_MS);

    const players = members.map((member) => {
      const normalized = normalizeMemberSummary(member);
      const discord = member.discordData || {};
      return {
        discordId: normalized.discordId,
        discordName: discord.globalName || discord.username || normalized.username || normalized.name,
        discordUsername: discord.username || normalized.username || "",
        avatarUrl: normalized.avatar,
        roomKey: normalized.roomKey,
        roomLabel: normalized.roomLabel,
        stageLabel: normalized.stageLabel,
        coins: normalized.coins
      };
    });

    return json(
      { success: true, players },
      { headers: { "Cache-Control": "private, no-store" } }
    );
  } catch (error) {
    return json({ success: false, error: error.message }, { status: 503 });
  }
}
