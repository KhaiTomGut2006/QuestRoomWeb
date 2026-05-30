import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { acceptNpcQuest, dismissNpcQuest } from "@/lib/player";

// POST /api/player/npc-quest   — accept an NPC quest
export async function POST(request) {
  const session = await getServerSession(authOptions);
  const discordId = session?.user?.discordId;
  if (!discordId) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  try {
    const body = await request.json();
    const { difficulty, title, description, reward, npcType, npcName, npcCharacter } = body;
    if (!difficulty || !title || !description) {
      return NextResponse.json({ error: "missing_fields" }, { status: 400 });
    }
    const member = await acceptNpcQuest(discordId, {
      difficulty,
      title,
      description,
      reward: Number(reward) || 0,
      npcType: npcType || "",
      npcName: npcName || "",
      npcCharacter: npcCharacter || null,
    });
    if (!member) return NextResponse.json({ error: "member_not_found" }, { status: 404 });
    return NextResponse.json({ member });
  } catch (error) {
    return NextResponse.json({ error: error.message }, { status: 503 });
  }
}

// DELETE /api/player/npc-quest  — complete / abandon the active NPC quest
export async function DELETE() {
  const session = await getServerSession(authOptions);
  const discordId = session?.user?.discordId;
  if (!discordId) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  try {
    const member = await dismissNpcQuest(discordId);
    if (!member) return NextResponse.json({ error: "member_not_found" }, { status: 404 });
    return NextResponse.json({ member });
  } catch (error) {
    return NextResponse.json({ error: error.message }, { status: 503 });
  }
}
