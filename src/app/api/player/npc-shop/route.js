import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { connectDb } from "@/lib/db";
import Member from "@/models/Member";
import { normalizeMember } from "@/lib/player";

const SHOP_ITEMS = {
  "quest-scroll": { cost: 50, ticket: "quest-scroll" },
  "asset-ticket": { cost: 120, ticket: "asset-ticket" },
  "cooldown-minute": { cost: 200, cooldownReductionMs: 60 * 1000 },
  "limit-break": { cost: 500, ticket: "limit-break" },
};

export async function POST(request) {
  const session = await getServerSession(authOptions);
  const discordId = session?.user?.discordId;
  if (!discordId) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  try {
    const { itemId } = await request.json();
    const item = SHOP_ITEMS[itemId];
    if (!item) return NextResponse.json({ error: "invalid_item" }, { status: 400 });

    await connectDb();
    const member = await Member.findOne({ discord_id: String(discordId) });
    if (!member) return NextResponse.json({ error: "member_not_found" }, { status: 404 });

    const currentCoins = Number.parseInt(member.coin || "0", 10);
    if (currentCoins < item.cost) {
      return NextResponse.json(
        { error: "not_enough_coins", coins: currentCoins, cost: item.cost },
        { status: 400 }
      );
    }

    member.coin = String(currentCoins - item.cost);
    if (item.ticket) member.ticket = [...(member.ticket || []), item.ticket];
    await member.save({ validateModifiedOnly: true });

    return NextResponse.json({
      itemId,
      cost: item.cost,
      cooldownReductionMs: item.cooldownReductionMs || 0,
      member: normalizeMember(member),
    });
  } catch (error) {
    return NextResponse.json({ error: error.message }, { status: 503 });
  }
}
