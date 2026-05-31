import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { getAvailableLevels } from "@/lib/player";

export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session?.user?.discordId) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  try {
    const levels = await getAvailableLevels();
    return NextResponse.json({ levels });
  } catch (error) {
    return NextResponse.json({ error: error.message }, { status: 503 });
  }
}
