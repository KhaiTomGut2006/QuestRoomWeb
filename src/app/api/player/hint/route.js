import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { connectDb } from "@/lib/db";
import Member from "@/models/Member";
import HintTemplate from "@/models/HintTemplate";
import { MEMBER_INTERACTION_SELECT, normalizeMemberInteraction } from "@/lib/player";
import { hasNpcVisitAction, markNpcVisitAction, NPC_VISIT_ACTIONS } from "@/lib/npcVisit";

// POST /api/player/hint  body: { hintId }
export async function POST(request) {
  const session = await getServerSession(authOptions);
  const discordId = session?.user?.discordId;
  if (!discordId) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  try {
    const { hintId, visitId } = await request.json();
    if (!hintId) return NextResponse.json({ error: "missing_hintId" }, { status: 400 });

    await connectDb();

    const hint = await HintTemplate.findById(hintId).lean();
    if (!hint) return NextResponse.json({ error: "hint_not_found" }, { status: 404 });

    const cost = Number(hint.cost) || 500;

    const member = await Member.findOne({ discord_id: String(discordId) }).select(MEMBER_INTERACTION_SELECT);
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

    member.questCoin = String(currentCoins - cost);
    markNpcVisitAction(member, visitId, NPC_VISIT_ACTIONS.hint);
    await member.save({ validateModifiedOnly: true });

    return NextResponse.json({
      hintTitle:   hint.title,
      hintContent: hint.content,
      cost,
      member: normalizeMemberInteraction(member),
    });
  } catch (error) {
    const status = error.message === "npc_visit_expired" ? 409 : 503;
    return NextResponse.json({ error: error.message }, { status });
  }
}
