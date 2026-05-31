import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { acceptNpcQuest, cancelNpcQuest, submitNpcQuest } from "@/lib/player";

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
    const status = error.message === "active_quest_exists" ? 409 : 503;
    return NextResponse.json({ error: error.message }, { status });
  }
}

// DELETE /api/player/npc-quest  — abandon the active NPC quest with a penalty
export async function DELETE() {
  const session = await getServerSession(authOptions);
  const discordId = session?.user?.discordId;
  if (!discordId) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  try {
    const result = await cancelNpcQuest(discordId);
    if (!result) return NextResponse.json({ error: "member_not_found" }, { status: 404 });
    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json({ error: error.message }, { status: 503 });
  }
}

// PATCH /api/player/npc-quest  — submit the active NPC quest and receive its reward
export async function PATCH() {
  const session = await getServerSession(authOptions);
  const discordId = session?.user?.discordId;
  if (!discordId) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  try {
    const result = await submitNpcQuest(discordId);
    if (!result) return NextResponse.json({ error: "member_not_found" }, { status: 404 });
    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json({ error: error.message }, { status: 503 });
  }
}
