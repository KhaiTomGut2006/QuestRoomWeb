import { NextResponse } from "next/server";
import { updateMemberPosition } from "@/lib/player";
import { getPlayerDiscordId, getPlayerSession } from "@/lib/loadTestAuth";

export async function PATCH(request) {
  const session = await getPlayerSession(request);
  const discordId = getPlayerDiscordId(session);

  if (!discordId) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  try {
    const body = await request.json();
    const result = await updateMemberPosition(discordId, body?.position || body);
    if (!result) return NextResponse.json({ error: "invalid_position_or_member_not_found" }, { status: 400 });
    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json({ error: error.message }, { status: 503 });
  }
}
