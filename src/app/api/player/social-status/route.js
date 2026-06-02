import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { getSocialQuestStatus, markSocialQuestSeen } from "@/lib/player";

export async function GET(request) {
  const session = await getServerSession(authOptions);
  const discordId = session?.user?.discordId;
  if (!discordId) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  try {
    const { searchParams } = new URL(request.url);
    const status = await getSocialQuestStatus(discordId, searchParams.get("since"));
    if (!status) return NextResponse.json({ error: "member_not_found" }, { status: 404 });
    return NextResponse.json(status);
  } catch (error) {
    return NextResponse.json({ error: error.message }, { status: 503 });
  }
}

export async function POST() {
  const session = await getServerSession(authOptions);
  const discordId = session?.user?.discordId;
  if (!discordId) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  try {
    const updated = await markSocialQuestSeen(discordId);
    if (!updated) return NextResponse.json({ error: "member_not_found" }, { status: 404 });
    return NextResponse.json({ unreadCount: 0 });
  } catch (error) {
    return NextResponse.json({ error: error.message }, { status: 503 });
  }
}
