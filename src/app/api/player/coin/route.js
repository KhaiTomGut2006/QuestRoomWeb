import { NextResponse } from "next/server";
import { connectDb } from "@/lib/db";
import Member from "@/models/Member";

const COIN_QUERY_MAX_TIME_MS = Math.max(500, Number(process.env.COIN_QUERY_MAX_TIME_MS || 2_000));

function questCoinValue(member) {
  return Number.parseInt(member?.questCoin ?? "0", 10) || 0;
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

    await connectDb();
    const member = await Member.findOne({ discord_id: discordId })
      .select("questCoin")
      .lean()
      .maxTimeMS(COIN_QUERY_MAX_TIME_MS);

    if (!member) {
      return NextResponse.json({ error: "member_not_found" }, { status: 404 });
    }

    return NextResponse.json(
      { questCoin: questCoinValue(member) },
      { headers: { "Cache-Control": "private, no-store" } }
    );
  } catch (error) {
    return NextResponse.json({ error: error.message }, { status: 503 });
  }
}
