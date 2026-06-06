import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { connectDb } from "@/lib/db";
import Member from "@/models/Member";
import HintTemplate from "@/models/HintTemplate";
import { MEMBER_INTERACTION_SELECT, normalizeMemberInteraction } from "@/lib/player";
import { assertActiveNpcVisit, hasNpcVisitAction, NPC_VISIT_ACTIONS } from "@/lib/npcVisit";

const MEMBER_READ_QUERY_MAX_TIME_MS = Math.max(500, Number(process.env.MEMBER_READ_QUERY_MAX_TIME_MS || 3_000));
const HINT_QUERY_MAX_TIME_MS = Math.max(500, Number(process.env.HINT_QUERY_MAX_TIME_MS || 3_000));

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

// POST /api/player/hint  body: { hintId }
export async function POST(request) {
  const session = await getServerSession(authOptions);
  const discordId = session?.user?.discordId;
  if (!discordId) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  try {
    const { hintId, visitId } = await request.json();
    if (!hintId) return NextResponse.json({ error: "missing_hintId" }, { status: 400 });

    await connectDb();

    const hint = await HintTemplate.findById(hintId)
      .lean()
      .maxTimeMS(HINT_QUERY_MAX_TIME_MS);
    if (!hint) return NextResponse.json({ error: "hint_not_found" }, { status: 404 });

    const cost = Number(hint.cost) || 500;

    const member = await Member.findOne({ discord_id: String(discordId) })
      .select(MEMBER_INTERACTION_SELECT)
      .maxTimeMS(MEMBER_READ_QUERY_MAX_TIME_MS);
    if (!member) return NextResponse.json({ error: "member_not_found" }, { status: 404 });
    if (hasNpcVisitAction(member, visitId, NPC_VISIT_ACTIONS.hint)) {
      return NextResponse.json({ error: "hint_already_bought" }, { status: 409 });
    }

    const currentCoins = Number.parseInt(member.questCoin ?? member.coin ?? "0", 10);
    if (currentCoins < cost) {
      return NextResponse.json(
        { error: "not_enough_coins", coins: currentCoins, cost },
        { status: 400 }
      );
    }

    assertActiveNpcVisit(member, visitId);

    const coinExpr = questCoinExpression();
    const updated = await Member.findOneAndUpdate(
      {
        discord_id: String(discordId),
        $expr: { $gte: [coinExpr, cost] }
      },
      [{ $set: { questCoin: { $toString: { $subtract: [coinExpr, cost] } } } }],
      { new: true, projection: MEMBER_INTERACTION_SELECT, maxTimeMS: MEMBER_READ_QUERY_MAX_TIME_MS }
    );

    if (!updated) {
      return NextResponse.json(
        { error: "not_enough_coins", coins: currentCoins, cost },
        { status: 400 }
      );
    }

    await Member.findOneAndUpdate(
      { discord_id: String(discordId) },
      {
        $set: { npcVisitId: visitId },
        $addToSet: { npcVisitPurchases: NPC_VISIT_ACTIONS.hint }
      },
      { maxTimeMS: MEMBER_READ_QUERY_MAX_TIME_MS }
    );

    return NextResponse.json({
      hintTitle: hint.title,
      hintContent: hint.content,
      cost,
      member: normalizeMemberInteraction(updated),
    });
  } catch (error) {
    const status = error.message === "npc_visit_expired" ? 409 : 503;
    return NextResponse.json({ error: error.message }, { status });
  }
}
