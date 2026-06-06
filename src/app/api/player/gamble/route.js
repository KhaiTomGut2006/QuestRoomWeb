import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { connectDb } from "@/lib/db";
import Member from "@/models/Member";
import { MEMBER_INTERACTION_SELECT, normalizeMemberInteraction } from "@/lib/player";
import { assertActiveNpcVisit, NPC_VISIT_ACTIONS } from "@/lib/npcVisit";

const MIN_BET = 1;
const MAX_BET = 10000;
const MEMBER_READ_QUERY_MAX_TIME_MS = Math.max(500, Number(process.env.MEMBER_READ_QUERY_MAX_TIME_MS || 3_000));

function questCoinExpression() {
  return {
    $convert: {
      input: { $ifNull: ["$questCoin", "0"] },
      to: "int",
      onError: 0,
      onNull: 0
    }
  };
}

// POST /api/player/gamble  body: { betAmount }
export async function POST(request) {
  const session = await getServerSession(authOptions);
  const discordId = session?.user?.discordId;
  if (!discordId) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  try {
    const { betAmount, visitId } = await request.json();
    const bet = Math.round(Number(betAmount));

    if (!Number.isFinite(bet) || bet < MIN_BET || bet > MAX_BET) {
      return NextResponse.json({ error: "invalid_bet" }, { status: 400 });
    }

    await connectDb();
    const member = await Member.findOne({ discord_id: String(discordId) })
      .select(MEMBER_INTERACTION_SELECT)
      .maxTimeMS(MEMBER_READ_QUERY_MAX_TIME_MS);
    if (!member) return NextResponse.json({ error: "member_not_found" }, { status: 404 });

    const currentCoins = Number.parseInt(member.questCoin ?? member.coin ?? "0", 10);
    if (currentCoins < bet) {
      return NextResponse.json(
        { error: "not_enough_coins", coins: currentCoins },
        { status: 400 }
      );
    }

    assertActiveNpcVisit(member, visitId);

    const won = Math.random() < 0.5;
    const delta = won ? bet : -bet;
    const operator = won ? "$add" : "$subtract";
    const coinExpr = questCoinExpression();

    const updated = await Member.findOneAndUpdate(
      {
        discord_id: String(discordId),
        $expr: { $gte: [coinExpr, bet] }
      },
      [{ $set: { questCoin: { $toString: { [operator]: [coinExpr, bet] } } } }],
      { new: true, projection: MEMBER_INTERACTION_SELECT, maxTimeMS: MEMBER_READ_QUERY_MAX_TIME_MS }
    );

    if (!updated) {
      return NextResponse.json(
        { error: "not_enough_coins", coins: currentCoins },
        { status: 400 }
      );
    }

    await Member.findOneAndUpdate(
      { discord_id: String(discordId) },
      {
        $set: { npcVisitId: visitId },
        $addToSet: { npcVisitPurchases: NPC_VISIT_ACTIONS.gamble }
      },
      { maxTimeMS: MEMBER_READ_QUERY_MAX_TIME_MS }
    );

    return NextResponse.json({ won, delta, member: normalizeMemberInteraction(updated) });
  } catch (error) {
    const status = error.message === "npc_visit_expired" ? 409 : 503;
    return NextResponse.json({ error: error.message }, { status });
  }
}
