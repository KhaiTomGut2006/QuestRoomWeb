import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { connectDb } from "@/lib/db";
import Member from "@/models/Member";
import { MEMBER_INTERACTION_SELECT, normalizeMemberInteraction } from "@/lib/player";
import { openChestReward } from "@/lib/shop";
import { hasNpcVisitAction, markNpcVisitAction, NPC_VISIT_ACTIONS } from "@/lib/npcVisit";

const MEMBER_READ_QUERY_MAX_TIME_MS = Math.max(500, Number(process.env.MEMBER_READ_QUERY_MAX_TIME_MS || 3_000));

export async function POST(request) {
  const session = await getServerSession(authOptions);
  const discordId = session?.user?.discordId;
  if (!discordId) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  try {
    await connectDb();
    const { visitId } = await request.json();
    const member = await Member.findOne({ discord_id: String(discordId) })
      .select(MEMBER_INTERACTION_SELECT)
      .maxTimeMS(MEMBER_READ_QUERY_MAX_TIME_MS);
    if (!member) return NextResponse.json({ error: "member_not_found" }, { status: 404 });
    if (hasNpcVisitAction(member, visitId, NPC_VISIT_ACTIONS.chest)) {
      return NextResponse.json({ error: "chest_already_claimed" }, { status: 409 });
    }
    markNpcVisitAction(member, visitId, NPC_VISIT_ACTIONS.chest);
    const reward = await openChestReward(member);
    const updated = await Member.findOneAndUpdate(
      {
        discord_id: String(discordId),
        $or: [
          { npcVisitId: { $ne: String(visitId || "") } },
          { npcVisitPurchases: { $nin: [NPC_VISIT_ACTIONS.chest] } }
        ]
      },
      {
        $set: {
          questCoin: member.questCoin,
          npcVisitId: member.npcVisitId,
          npcVisitPurchases: member.npcVisitPurchases,
          shopAssetTickets: member.shopAssetTickets,
          ownedAccessories: member.ownedAccessories,
          npcQuest: member.npcQuest,
          shopCooldownT1: member.shopCooldownT1,
          shopCooldownT2: member.shopCooldownT2,
          shopLimitBreak: member.shopLimitBreak
        }
      },
      { new: true, projection: MEMBER_INTERACTION_SELECT, maxTimeMS: MEMBER_READ_QUERY_MAX_TIME_MS }
    );
    if (!updated) return NextResponse.json({ error: "chest_already_claimed" }, { status: 409 });
    return NextResponse.json({ reward, member: normalizeMemberInteraction(updated) });
  } catch (error) {
    const status = error.message === "npc_visit_expired" ? 409 : 503;
    return NextResponse.json({ error: error.message }, { status });
  }
}
