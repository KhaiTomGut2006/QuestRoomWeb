import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { connectDb } from "@/lib/db";
import Member from "@/models/Member";
import { normalizeMember } from "@/lib/player";
import { openChestReward } from "@/lib/shop";
import { hasNpcVisitAction, markNpcVisitAction, NPC_VISIT_ACTIONS } from "@/lib/npcVisit";
import { writeErrorMessage, writeErrorStatus } from "@/lib/writeSafety";
import cooldownTokens from "@/lib/cooldownToken.cjs";

const { issueCooldownToken } = cooldownTokens;

export async function POST(request) {
  const session = await getServerSession(authOptions);
  const discordId = session?.user?.discordId;
  if (!discordId) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  try {
    await connectDb();
    const { visitId } = await request.json();
    const member = await Member.findOne({ discord_id: String(discordId) });
    if (!member) return NextResponse.json({ error: "member_not_found" }, { status: 404 });
    if (hasNpcVisitAction(member, visitId, NPC_VISIT_ACTIONS.chest)) {
      return NextResponse.json({ error: "chest_already_claimed" }, { status: 409 });
    }
    markNpcVisitAction(member, visitId, NPC_VISIT_ACTIONS.chest);
    const reward = await openChestReward(member);
    await member.save({ validateModifiedOnly: true });
    return NextResponse.json({
      reward,
      cooldownToken: issueCooldownToken({ discordId, milliseconds: reward?.cooldownReductionMs }),
      member: normalizeMember(member)
    });
  } catch (error) {
    const status = writeErrorStatus(error, error.message === "npc_visit_expired" ? 409 : 503);
    return NextResponse.json({ error: writeErrorMessage(error) }, { status });
  }
}
