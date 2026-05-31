import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { connectDb } from "@/lib/db";
import Member from "@/models/Member";
import HintTemplate from "@/models/HintTemplate";
import { normalizeMember } from "@/lib/player";

// POST /api/player/hint  body: { hintId }
export async function POST(request) {
  const session = await getServerSession(authOptions);
  const discordId = session?.user?.discordId;
  if (!discordId) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  try {
    const { hintId } = await request.json();
    if (!hintId) return NextResponse.json({ error: "missing_hintId" }, { status: 400 });

    await connectDb();

    const hint = await HintTemplate.findById(hintId).lean();
    if (!hint) return NextResponse.json({ error: "hint_not_found" }, { status: 404 });

    const cost = Number(hint.cost) || 500;

    const member = await Member.findOne({ discord_id: String(discordId) });
    if (!member) return NextResponse.json({ error: "member_not_found" }, { status: 404 });

    const currentCoins = Number.parseInt(member.coin || "0", 10);
    if (currentCoins < cost) {
      return NextResponse.json(
        { error: "not_enough_coins", coins: currentCoins, cost },
        { status: 400 }
      );
    }

    member.coin = String(currentCoins - cost);
    await member.save({ validateModifiedOnly: true });

    return NextResponse.json({
      hintTitle:   hint.title,
      hintContent: hint.content,
      cost,
      member: normalizeMember(member),
    });
  } catch (error) {
    return NextResponse.json({ error: error.message }, { status: 503 });
  }
}
