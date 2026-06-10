import { NextResponse } from "next/server";
import { normalizeMemberSummary, updateMemberPosition } from "@/lib/player";
import { getPlayerDiscordId, getPlayerSession } from "@/lib/loadTestAuth";
import { connectDb } from "@/lib/db";
import Member from "@/models/Member";

const MEMBER_READ_QUERY_MAX_TIME_MS = Math.max(500, Number(process.env.MEMBER_READ_QUERY_MAX_TIME_MS || 3_000));

const ME_MEMBER_SELECT = [
  "_id",
  "discord_id",
  "nick",
  "nickname",
  "realName",
  "username",
  "discordData",
  "questroomRank",
  "stage",
  "quest",
  "npcQuest",
  "questChallenge",
  "challengeFailureStage",
  "challengeFailureCount",
  "challengeFailureHandledKey",
  "completedNpcQuestKeys",
  "questReward",
  "roomPosition",
  "shopCooldownT1",
  "shopCooldownT2",
  "shopLimitBreak",
  "shopAssetTickets",
  "ownedAccessories",
  "equippedAccessory",
  "npcCycle",
  "npcVisitId",
  "npcVisitPurchases",
  "questCoin",
  "tutorial",
  "npcQuestSubmissions"
].join(" ");

export async function GET(request) {
  const session = await getPlayerSession(request);
  const discordId = getPlayerDiscordId(session);

  if (!discordId) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  try {
    await connectDb();
    const rawMember = await Member.findOne({ discord_id: String(discordId || "") })
      .select(ME_MEMBER_SELECT)
      .lean()
      .maxTimeMS(MEMBER_READ_QUERY_MAX_TIME_MS);
    const member = normalizeMemberSummary(rawMember);
    if (!member) return NextResponse.json({ error: "member_not_found" }, { status: 404 });
    return NextResponse.json({ member });
  } catch (error) {
    return NextResponse.json({ error: error.message }, { status: 503 });
  }
}

export async function PATCH(request) {
  const session = await getPlayerSession(request);
  const discordId = getPlayerDiscordId(session);

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
