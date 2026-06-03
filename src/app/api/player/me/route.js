import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { getMemberByDiscordId, updateMemberPosition } from "@/lib/player";

export async function GET() {
  const session = await getServerSession(authOptions);
  const discordId = session?.user?.discordId;

  if (!discordId) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  try {
    const member = await getMemberByDiscordId(discordId, { includeSubmissions: false });
    if (!member) return NextResponse.json({ error: "member_not_found" }, { status: 404 });
    return NextResponse.json({ member });
  } catch (error) {
    return NextResponse.json({ error: error.message }, { status: 503 });
  }
}

export async function PATCH(request) {
  const session = await getServerSession(authOptions);
  const discordId = session?.user?.discordId;

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
