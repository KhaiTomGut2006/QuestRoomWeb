import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { requestChallenge, submitChallenge } from "@/lib/player";
import { writeErrorMessage, writeErrorStatus } from "@/lib/writeSafety";

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
    return NextResponse.json({ error: writeErrorMessage(error) }, { status: writeErrorStatus(error) });
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
    const result = await submitChallenge(discordId, body?.evidence, body?.postText);
    if (!result) return NextResponse.json({ error: "member_not_found" }, { status: 404 });
    return NextResponse.json(result);
  } catch (error) {
    const fallbackStatus = ["pending_challenge_not_found", "challenge_image_required"].includes(error.message)
      ? 400
      : 503;
    return NextResponse.json({ error: writeErrorMessage(error) }, { status: writeErrorStatus(error, fallbackStatus) });
  }
}
