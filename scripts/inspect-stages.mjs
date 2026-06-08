import pkg from "@next/env";
const { loadEnvConfig } = pkg;
import mongoose from "mongoose";

loadEnvConfig(process.cwd());
const MONGO_URI = process.env.MONGODB_URI;
if (!MONGO_URI) { console.error("MONGODB_URI not configured"); process.exit(1); }

async function main() {
  await mongoose.connect(MONGO_URI, { bufferCommands: false, serverSelectionTimeoutMS: 5000 });
  const members = mongoose.connection.collection("members");

  // Look for any data that might tell us original stage IDs
  const withCompleted = await members.find(
    { "quest.completed.0": { $exists: true } },
    { projection: { "quest.completed": 1, _id: 0 } }
  ).limit(5).toArray();
  console.log("Players with completed quests:", withCompleted.length);

  const withChallenge = await members.find(
    { questChallenge: { $exists: true, $ne: null } },
    { projection: { "questChallenge.stage": 1, "questChallenge.status": 1, _id: 0 } }
  ).limit(5).toArray();
  console.log("Players with challenge:", withChallenge.length);

  const withReward = await members.find(
    { questReward: { $exists: true, $ne: null } },
    { projection: { "questReward.taskId": 1, "questReward.taskName": 1, _id: 0 } }
  ).limit(5).toArray();
  console.log("Players with reward:", withReward.length);

  // Check if we have any other clues
  const allFields = await members.aggregate([
    { $limit: 100 },
    { $project: { 
      questCurrent: "$quest.current",
      questCompleted: "$quest.completed",
      challengeStage: "$questChallenge.stage",
      rewardTaskId: "$questReward.taskId",
    }}
  ]).toArray();

  const seenStages = new Set();
  for (const doc of allFields) {
    if (doc.questCurrent) seenStages.add("current:" + doc.questCurrent);
    if (doc.questCompleted?.length) doc.questCompleted.forEach(c => seenStages.add("completed:" + c));
    if (doc.challengeStage) seenStages.add("challenge:" + doc.challengeStage);
    if (doc.rewardTaskId) seenStages.add("reward:" + doc.rewardTaskId);
  }

  console.log("\n🔍 Stage IDs found in member data:");
  for (const s of [...seenStages].sort()) {
    console.log("  ", s);
  }

  await mongoose.disconnect();
}

main().catch(err => { console.error("Error:", err.message); process.exit(1); });
