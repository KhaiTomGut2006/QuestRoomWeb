import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { connectDb } from "@/lib/db";
import Member from "@/models/Member";
import { normalizeMember } from "@/lib/player";

const MIN_BET = 1;
const MAX_BET = 10000;

// POST /api/player/gamble  body: { betAmount }
export async function POST(request) {
  const session = await getServerSession(authOptions);
  const discordId = session?.user?.discordId;
  if (!discordId) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  try {
    const { betAmount } = await request.json();
    const bet = Math.round(Number(betAmount));

    if (!Number.isFinite(bet) || bet < MIN_BET || bet > MAX_BET) {
      return NextResponse.json({ error: "invalid_bet" }, { status: 400 });
    }

    await connectDb();
    const member = await Member.findOne({ discord_id: String(discordId) });
    if (!member) return NextResponse.json({ error: "member_not_found" }, { status: 404 });

    const currentCoins = Number.parseInt(member.coin || "0", 10);
    if (currentCoins < bet) {
      return NextResponse.json(
        { error: "not_enough_coins", coins: currentCoins },
        { status: 400 }
      );
    }

    const won = Math.random() < 0.5;
    const delta = won ? bet : -bet;
    member.coin = String(Math.max(0, currentCoins + delta));
    await member.save({ validateModifiedOnly: true });

    return NextResponse.json({ won, delta, member: normalizeMember(member) });
  } catch (error) {
    return NextResponse.json({ error: error.message }, { status: 503 });
  }
}
