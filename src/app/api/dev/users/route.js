import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { connectDb } from "@/lib/db";
import { canUseDevTools } from "@/lib/devTools";
import { getFirstConfiguredStage, normalizeMember } from "@/lib/player";
import Member from "@/models/Member";

const MAX_GRANT_AMOUNT = 1_000_000_000;

function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function summarizeMember(member) {
  const normalized = normalizeMember(member);
  return {
    discordId: normalized.discordId,
    name: normalized.name,
    username: normalized.username,
    coins: normalized.coins,
    stage: normalized.stage,
    tutorial: normalized.tutorial
  };
}

async function requireDevUser() {
  const session = await getServerSession(authOptions);
  const discordId = session?.user?.discordId;
  if (!discordId) return { error: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) };
  if (!canUseDevTools(discordId)) {
    return { error: NextResponse.json({ error: "Dev tools are disabled or you are not allowed to use them." }, { status: 403 }) };
  }
  return { discordId };
}

export async function GET(request) {
  const auth = await requireDevUser();
  if (auth.error) return auth.error;

  const query = new URL(request.url).searchParams.get("q")?.trim() || "";
  if (!query) return NextResponse.json({ users: [] });

  await connectDb();
  const matcher = new RegExp(escapeRegex(query), "i");
  const users = await Member.find({
    discord_id: { $exists: true, $ne: "" },
    $or: [
      { discord_id: matcher },
      { nick: matcher },
      { nickname: matcher },
      { fullname: matcher },
      { realName: matcher },
      { username: matcher },
      { "discordData.username": matcher },
      { "discordData.globalName": matcher }
    ]
  })
    .limit(20)
    .lean();

  return NextResponse.json({ users: users.map(summarizeMember) });
}

export async function PATCH(request) {
  const auth = await requireDevUser();
  if (auth.error) return auth.error;

  const body = await request.json().catch(() => null);
  const action = body?.action;
  const targetDiscordId = String(body?.discordId || "").trim();
  if (!targetDiscordId) {
    return NextResponse.json({ error: "Missing target user id." }, { status: 400 });
  }

  await connectDb();
  const member = await Member.findOne({ discord_id: targetDiscordId });
  if (!member) return NextResponse.json({ error: "User not found." }, { status: 404 });

  if (action === "grant-coins") {
    const amount = Number(body?.amount);
    if (!Number.isSafeInteger(amount) || amount < 1 || amount > MAX_GRANT_AMOUNT) {
      return NextResponse.json({ error: `Coins must be an integer between 1 and ${MAX_GRANT_AMOUNT}.` }, { status: 400 });
    }

    const currentCoins = Number.parseInt(member.coin, 10) || 0;
    member.coin = String(Math.min(MAX_GRANT_AMOUNT, currentCoins + amount));
    await member.save();
    return NextResponse.json({ user: normalizeMember(member) });
  }

  if (action === "reset-user") {
    const now = new Date();
    const firstStage = await getFirstConfiguredStage();
    const user = await Member.findOneAndUpdate(
      { discord_id: targetDiscordId },
      {
        $set: {
          coin: "0",
          stage: firstStage,
          quest: { current: "Find the quiet corner", status: "active", completed: [] },
          npcQuest: null,
          npcQuestSubmissions: [],
          challengeFailureStage: firstStage,
          challengeFailureCount: 0,
          npcCycle: null,
          roomPosition: { x: 50, y: 70, updatedAt: now },
          shopCooldownT1: 0,
          shopCooldownT2: 0,
          shopLimitBreak: false,
          shopAssetTickets: 0,
          ownedAccessories: [],
          equippedAccessory: "",
          tutorial: { status: "active", step: "welcome-1", startedAt: now, updatedAt: now },
          profileAchievements: []
        },
        $unset: {
          questChallengeRequestedAt: "",
          questChallenge: "",
          challengeFailureHandledKey: "",
          questReward: ""
        }
      },
      { new: true }
    );
    return NextResponse.json({ user: normalizeMember(user) });
  }

  return NextResponse.json({ error: "Unsupported dev action." }, { status: 400 });
}
