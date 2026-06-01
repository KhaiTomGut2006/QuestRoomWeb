import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { advanceTutorial } from "@/lib/tutorial";

export async function POST(request) {
  const session = await getServerSession(authOptions);
  const discordId = session?.user?.discordId;
  if (!discordId) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  try {
    const body = await request.json();
    const result = await advanceTutorial(discordId, body?.action);
    if (!result) return NextResponse.json({ error: "member_not_found" }, { status: 404 });
    return NextResponse.json(result);
  } catch (error) {
    const status = ["invalid_tutorial_action", "invalid_tutorial_step", "tutorial_role_npc_not_ready"].includes(error.message)
      ? 400
      : error.message === "not_enough_coins"
        ? 409
        : 503;
    return NextResponse.json({ error: error.message }, { status });
  }
}
