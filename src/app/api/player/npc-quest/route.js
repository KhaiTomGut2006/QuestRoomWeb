import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { connectDb } from "@/lib/db";
import { acceptNpcQuest, cancelNpcQuest, submitNpcQuest } from "@/lib/player";
import { assertActiveNpcVisit } from "@/lib/npcVisit";
import { writeErrorMessage, writeErrorStatus } from "@/lib/writeSafety";
import Member from "@/models/Member";
import QuestTemplate from "@/models/QuestTemplate";

const VISITOR_QUEST_DIFFICULTIES = {
  "quest-easy": "easy",
  "quest-medium": "medium",
  "quest-hard": "hard",
  "stupid-quest": "stupid"
};

// POST /api/player/npc-quest   — accept an NPC quest
export async function POST(request) {
  const session = await getServerSession(authOptions);
  const discordId = session?.user?.discordId;
  if (!discordId) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  try {
    const body = await request.json();
    const { difficulty, title, description, reward, npcType, npcName, visitId } = body;
    if (!difficulty || !title || !description) {
      return NextResponse.json({ error: "missing_fields" }, { status: 400 });
    }

    const expectedDifficulty = VISITOR_QUEST_DIFFICULTIES[String(npcType || "")];
    if (!expectedDifficulty || expectedDifficulty !== difficulty) {
      return NextResponse.json({ error: "invalid_quest_offer" }, { status: 400 });
    }

    await connectDb();
    const [memberWithVisit, template] = await Promise.all([
      Member.findOne({ discord_id: String(discordId) }, { npcCycle: 1 }).lean(),
      QuestTemplate.findOne({
        difficulty: expectedDifficulty,
        title: String(title),
        description: String(description)
      }).lean()
    ]);
    if (!memberWithVisit) return NextResponse.json({ error: "member_not_found" }, { status: 404 });
    assertActiveNpcVisit(memberWithVisit, visitId);
    if (!template) return NextResponse.json({ error: "invalid_quest_offer" }, { status: 400 });

    const rewardMin = Math.max(0, Number(template.rewardMin) || 0);
    const rewardMax = Math.max(rewardMin, Number(template.rewardMax) || rewardMin);
    const normalizedReward = Math.min(rewardMax, Math.max(rewardMin, Math.round(Number(reward) || rewardMin)));

    const member = await acceptNpcQuest(discordId, {
      difficulty: template.difficulty,
      title: template.title,
      description: template.description,
      reward: normalizedReward,
      npcType: npcType || "",
      npcName: npcName || "",
      npcCharacter: template.npcCharacter || null,
    });
    if (!member) return NextResponse.json({ error: "member_not_found" }, { status: 404 });
    return NextResponse.json({ member });
  } catch (error) {
    const status = writeErrorStatus(
      error,
      ["active_quest_exists", "npc_visit_expired"].includes(error.message) ? 409 : 503
    );
    return NextResponse.json({ error: writeErrorMessage(error) }, { status });
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
    return NextResponse.json({ error: writeErrorMessage(error) }, { status: writeErrorStatus(error) });
  }
}

// PATCH /api/player/npc-quest  — submit the active NPC quest and receive its reward
export async function PATCH(request) {
  const session = await getServerSession(authOptions);
  const discordId = session?.user?.discordId;
  if (!discordId) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  try {
    const body = await request.json();
    const result = await submitNpcQuest(discordId, body?.evidence, body?.postText);
    if (!result) return NextResponse.json({ error: "member_not_found" }, { status: 404 });
    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json({ error: writeErrorMessage(error) }, { status: writeErrorStatus(error) });
  }
}
