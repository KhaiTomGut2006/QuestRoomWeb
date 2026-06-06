import { NextResponse } from "next/server";
import { getRoomPlayers } from "@/lib/player";
import { getPlayerDiscordId, getPlayerSession } from "@/lib/loadTestAuth";

export async function GET(request) {
  const session = await getPlayerSession(request);
  if (!getPlayerDiscordId(session)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  try {
    const params = new URL(request.url).searchParams;
    const roomKey = params.get("roomKey") || params.get("stage");
    const players = await getRoomPlayers(roomKey);
    return NextResponse.json({ players });
  } catch (error) {
    return NextResponse.json({ error: error.message }, { status: 503 });
  }
}
