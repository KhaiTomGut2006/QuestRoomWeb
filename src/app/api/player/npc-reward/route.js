import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { connectDb } from "@/lib/db";
import Member from "@/models/Member";
import { normalizeMember } from "@/lib/player";
import { openChestReward } from "@/lib/shop";

export async function POST() {
  const session = await getServerSession(authOptions);
  const discordId = session?.user?.discordId;
  if (!discordId) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  try {
    await connectDb();
    const member = await Member.findOne({ discord_id: String(discordId) });
    if (!member) return NextResponse.json({ error: "member_not_found" }, { status: 404 });
    const reward = await openChestReward(member);
    await member.save({ validateModifiedOnly: true });
    return NextResponse.json({ reward, member: normalizeMember(member) });
  } catch (error) {
    return NextResponse.json({ error: error.message }, { status: 503 });
  }
}
