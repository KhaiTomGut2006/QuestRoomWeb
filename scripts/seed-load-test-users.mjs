import mongoose from "mongoose";
import nextEnv from "@next/env";

const { loadEnvConfig } = nextEnv;
loadEnvConfig(process.cwd());

const USERS = Math.max(1, Number(process.env.LOAD_TEST_USERS || 300));
const STAGES = String(process.env.LOAD_TEST_STAGES || "game-demo-1,game-demo-2,game-demo-3")
  .split(",")
  .map((value) => value.trim())
  .filter(Boolean);
const mongoUri = process.env.MONGODB_URI;
const dbName = process.env.MONGODB_DB || undefined;

if (!mongoUri) {
  console.error("MONGODB_URI is required");
  process.exit(1);
}

function memberDocument(index) {
  const discordId = `loadtest-${index}`;
  const stage = STAGES[index % STAGES.length] || "game-demo-1";
  return {
    discord_id: discordId,
    fullname: `Load Test ${index}`,
    nick: `Load Test ${index}`,
    nickname: `Load Test ${index}`,
    realName: `Load Test ${index}`,
    username: `loadtest-${index}`,
    questCoin: "1000",
    coin: "1000",
    questroomRank: "Load Tester",
    stage,
    lastAuthentication: new Date(),
    socialLastSeenAt: new Date(0),
    discordData: {
      id: discordId,
      username: `loadtest-${index}`,
      globalName: `Load Test ${index}`,
      avatar: "",
      avatarUrl: ""
    },
    roomPosition: {
      x: 10 + (index % 80),
      y: 20 + (index % 60),
      updatedAt: new Date()
    },
    quest: {
      current: "Load test quest",
      status: "active",
      completed: []
    },
    npcQuest: null,
    npcQuestSubmissions: [],
    profileAchievements: [],
    ownedAccessories: [],
    npcVisitPurchases: [],
    tutorial: {
      status: "completed",
      step: "done",
      startedAt: new Date(),
      updatedAt: new Date(),
      completedAt: new Date()
    }
  };
}

await mongoose.connect(mongoUri, dbName ? { dbName } : undefined);
const members = mongoose.connection.collection("members");

let upserted = 0;
for (let index = 1; index <= USERS; index += 1) {
  const doc = memberDocument(index);
  const updateFields = {
    lastAuthentication: doc.lastAuthentication,
    stage: doc.stage,
    roomPosition: doc.roomPosition,
    socialLastSeenAt: doc.socialLastSeenAt,
    questCoin: doc.questCoin,
    coin: doc.coin,
    discordData: doc.discordData,
    tutorial: doc.tutorial
  };
  const insertFields = { ...doc };
  for (const key of Object.keys(updateFields)) delete insertFields[key];
  const result = await members.updateOne(
    { discord_id: doc.discord_id },
    {
      $set: updateFields,
      $setOnInsert: insertFields
    },
    { upsert: true }
  );
  if (result.upsertedCount || result.modifiedCount) upserted += 1;
}

await mongoose.disconnect();
console.log(JSON.stringify({ ok: true, users: USERS, touched: upserted, stages: STAGES }));
