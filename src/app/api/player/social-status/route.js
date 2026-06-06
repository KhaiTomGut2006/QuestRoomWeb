import { NextResponse } from "next/server";
import { getSocialQuestStatus, markSocialQuestSeen } from "@/lib/player";
import { getPlayerDiscordId, getPlayerSession } from "@/lib/loadTestAuth";

export async function GET(request) {
  const session = await getPlayerSession(request);
  const discordId = getPlayerDiscordId(session);
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

export async function POST(request) {
  const session = await getPlayerSession(request);
  const discordId = getPlayerDiscordId(session);
  if (!discordId) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  try {
    const updated = await markSocialQuestSeen(discordId);
    if (!updated) return NextResponse.json({ error: "member_not_found" }, { status: 404 });
    return NextResponse.json({ unreadCount: 0 });
  } catch (error) {
    return NextResponse.json({ error: error.message }, { status: 503 });
  }
}
