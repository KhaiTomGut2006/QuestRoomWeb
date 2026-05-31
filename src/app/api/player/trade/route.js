import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { transferCoins } from "@/lib/player";

export async function POST(request) {
  const session = await getServerSession(authOptions);
  const discordId = session?.user?.discordId;
  if (!discordId) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  try {
    const body = await request.json();
    const result = await transferCoins(discordId, body?.recipientId, body?.amount);
    return NextResponse.json(result);
  } catch (error) {
    const status = {
      invalid_trade_amount: 400,
      cannot_trade_self: 409,
      player_not_found: 404,
      recipient_not_found: 404,
      not_enough_coins: 422
    }[error.message] || 503;
    return NextResponse.json({ error: error.message }, { status });
  }
}
