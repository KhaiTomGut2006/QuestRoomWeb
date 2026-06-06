import { NextResponse } from "next/server";
import { getMemberByDiscordId } from "@/lib/player";
import { getPlayerDiscordId, getPlayerSession } from "@/lib/loadTestAuth";

const PROFILE_MEMBER_SELECT = [
  "_id",
  "discord_id",
  "nick",
  "nickname",
  "realName",
  "username",
  "discordData",
  "questroomRank",
  "profileAchievements",
  "stage",
  "questChallenge",
  "npcQuestSubmissions",
  "ownedAccessories",
  "equippedAccessory"
].join(" ");

export async function GET(request) {
  const session = await getPlayerSession(request);
  const viewerDiscordId = getPlayerDiscordId(session);
  if (!viewerDiscordId) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  try {
    const { searchParams } = new URL(request.url);
    const discordId = searchParams.get("id");
    if (!discordId) {
      return NextResponse.json({ error: "id_required" }, { status: 400 });
    }

    const member = await getMemberByDiscordId(discordId, {
      submissionLimit: 12,
      selectFields: PROFILE_MEMBER_SELECT
    });
    if (!member) {
      return NextResponse.json({ error: "player_not_found" }, { status: 404 });
    }

    // Adapt to room player format
    const playerProfile = {
      id: member.discordId,
      name: member.name,
      username: member.username,
      avatar: member.avatar,
      rank: member.rank,
      achievements: member.achievements,
      questPosts: member.socialQuestSubmissions,
      ownedAccessories: member.discordId === viewerDiscordId ? member.ownedAccessories : [],
      equippedAccessory: member.equippedAccessory,
      stage: member.stage,
      online: false // Default to offline unless they are online in sockets
    };

    return NextResponse.json({ player: playerProfile });
  } catch (error) {
    return NextResponse.json({ error: error.message }, { status: 503 });
  }
}
