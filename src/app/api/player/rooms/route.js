import { NextResponse } from "next/server";
import { getAvailableRoomLevels } from "@/lib/player";
import { getPlayerDiscordId, getPlayerSession } from "@/lib/loadTestAuth";

export async function GET(request) {
  const session = await getPlayerSession(request);
  if (!getPlayerDiscordId(session)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  try {
    const levels = await getAvailableRoomLevels();
    return NextResponse.json({ levels });
  } catch (error) {
    return NextResponse.json({ error: error.message }, { status: 503 });
  }
}
