import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { getRoomPlayers } from "@/lib/player";

export async function GET(request) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.discordId) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  try {
    const stage = new URL(request.url).searchParams.get("stage");
    const players = await getRoomPlayers(stage);
    return NextResponse.json({ players });
  } catch (error) {
    return NextResponse.json({ error: error.message }, { status: 503 });
  }
}
