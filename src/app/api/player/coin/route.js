import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { connectDb } from "@/lib/db";
import Member from "@/models/Member";

const COIN_QUERY_MAX_TIME_MS = Math.max(500, Number(process.env.COIN_QUERY_MAX_TIME_MS || 2_000));

function coinValue(member) {
  return Number.parseInt(member?.questCoin ?? member?.coin ?? "0", 10) || 0;
}

async function isAuthorized(request, discordId) {
  const expectedToken = process.env.GAME_API_TOKEN || process.env.ADMIN_API_TOKEN || "";
  const header = request.headers.get("authorization") || "";

  if (expectedToken && header === `Bearer ${expectedToken}`) return true;

  const session = await getServerSession(authOptions);
  return String(session?.user?.discordId || "") === discordId;
}

export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url);
    const discordId = String(
      searchParams.get("id") || searchParams.get("discordId") || searchParams.get("userId") || ""
    ).trim();

    if (!discordId) {
      return NextResponse.json({ error: "discord_id_required" }, { status: 400 });
    }

    if (discordId.length > 128) {
      return NextResponse.json({ error: "invalid_discord_id" }, { status: 400 });
    }

    if (!(await isAuthorized(request, discordId))) {
      return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    }

    await connectDb();
    const member = await Member.findOne({ discord_id: discordId })
      .select("questCoin coin")
      .lean()
      .maxTimeMS(COIN_QUERY_MAX_TIME_MS);

    if (!member) {
      return NextResponse.json({ error: "member_not_found" }, { status: 404 });
    }

    return NextResponse.json(
      { coins: coinValue(member) },
      { headers: { "Cache-Control": "private, no-store" } }
    );
  } catch (error) {
    return NextResponse.json({ error: error.message }, { status: 503 });
  }
}
