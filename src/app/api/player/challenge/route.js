import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { requestChallenge } from "@/lib/player";

export async function POST() {
  const session = await getServerSession(authOptions);
  const discordId = session?.user?.discordId;

  if (!discordId) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  try {
    const result = await requestChallenge(discordId);
    if (!result) return NextResponse.json({ error: "member_not_found" }, { status: 404 });
    if (!result.ok) return NextResponse.json(result, { status: 200 });
    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json({ error: error.message }, { status: 503 });
  }
}
