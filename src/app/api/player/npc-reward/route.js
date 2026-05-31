import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { connectDb } from "@/lib/db";
import Member from "@/models/Member";
import { normalizeMember } from "@/lib/player";

const MIN_CHEST_COINS = 20;
const MAX_CHEST_COINS = 200;

export async function POST() {
  const session = await getServerSession(authOptions);
  const discordId = session?.user?.discordId;
  if (!discordId) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  try {
    await connectDb();
    const coins = Math.floor(Math.random() * (MAX_CHEST_COINS - MIN_CHEST_COINS + 1)) + MIN_CHEST_COINS;
    const member = await Member.findOneAndUpdate(
      { discord_id: String(discordId) },
      [{ $set: { coin: { $toString: { $add: [{ $toInt: { $ifNull: ["$coin", "0"] } }, coins] } } } }],
      { new: true }
    );

    if (!member) return NextResponse.json({ error: "member_not_found" }, { status: 404 });
    return NextResponse.json({ coins, member: normalizeMember(member) });
  } catch (error) {
    return NextResponse.json({ error: error.message }, { status: 503 });
  }
}
