import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { getMemberByDiscordId } from "@/lib/player";

export async function GET(request) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.discordId) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  try {
    const { searchParams } = new URL(request.url);
    const discordId = searchParams.get("id");
    if (!discordId) {
      return NextResponse.json({ error: "id_required" }, { status: 400 });
    }

    const member = await getMemberByDiscordId(discordId);
    if (!member) {
      return NextResponse.json({ error: "player_not_found" }, { status: 404 });
    }

    // Adapt to room player format
    const playerProfile = {
      id: member.discordId,
      name: member.name,
      username: member.username,
      avatar: member.avatar,
      rank: member.rank,
      achievements: member.achievements,
      stage: member.stage,
      online: false // Default to offline unless they are online in sockets
    };

    return NextResponse.json({ player: playerProfile });
  } catch (error) {
    return NextResponse.json({ error: error.message }, { status: 503 });
  }
}
