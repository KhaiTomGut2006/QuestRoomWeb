import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { getStageRanking, getAvailableLevels } from "@/lib/player";

export async function GET(request) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.discordId) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  try {
    const { searchParams } = new URL(request.url);
    const stageId = searchParams.get("stage");

    const [levels, ranking] = await Promise.all([
      getAvailableLevels(),
      getStageRanking(stageId)
    ]);

    return NextResponse.json({ levels, ranking });
  } catch (error) {
    return NextResponse.json({ error: error.message }, { status: 503 });
  }
}
