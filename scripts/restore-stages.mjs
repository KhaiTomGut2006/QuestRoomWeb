import pkg from "@next/env";
const { loadEnvConfig } = pkg;
import { MongoClient } from "mongodb";

loadEnvConfig(process.cwd());
const MONGO_URI = process.env.MONGODB_URI;
if (!MONGO_URI) { console.error("MONGODB_URI not configured"); process.exit(1); }

async function main() {
  const client = new MongoClient(MONGO_URI, { directConnection: true });
  await client.connect();
  const members = client.db("dekhub").collection("members");
  const levels = client.db("dekhub").collection("levels");

  // Get current level stageIds in order
  const currentLevels = await levels.find({}).sort({ order: 1 }).toArray();
  const stageOrder = currentLevels.map(l => l.stageId);
  console.log("Current stage order:", stageOrder);

  // For each player, find their highest completed stage and set stage to next
  const players = await members.find({
    $or: [
      { "quest.completed.0": { $exists: true } },
      { questChallenge: { $ne: null } },
    ]
  }, {
    projection: { discord_id: 1, stage: 1, "quest.completed": 1, questChallenge: 1 }
  }).toArray();

  console.log(`\nChecking ${players.length} players for stage recovery...\n`);

  let moved = 0;
  for (const p of players) {
    const completed = p.quest?.completed || [];
    
    // Find the last completed stage that exists in current levels
    let highestIndex = -1;
    for (const compId of completed) {
      const idx = stageOrder.indexOf(compId);
      if (idx > highestIndex) highestIndex = idx;
    }

    // Also check if they have a challenge on a specific stage
    const challengeStage = p.questChallenge?.stage;
    if (challengeStage) {
      const idx = stageOrder.indexOf(challengeStage);
      if (idx > highestIndex) highestIndex = idx;
    }

    // Set to next stage after highest completed, or stage-1 if none
    const nextStage = highestIndex >= 0 && highestIndex + 1 < stageOrder.length
      ? stageOrder[highestIndex + 1]
      : stageOrder[0];

    if (nextStage !== p.stage) {
      await members.updateOne(
        { _id: p._id },
        { $set: { stage: nextStage } }
      );
      moved++;
    }
  }

  console.log(`✅ Moved ${moved} players back to their correct stages`);

  // Show distribution
  const dist = await members.aggregate([
    { $group: { _id: "$stage", count: { $sum: 1 } } },
    { $sort: { count: -1 } }
  ]).toArray();
  console.log("\n📊 New stage distribution:");
  for (const d of dist) {
    console.log(`  ${d._id}: ${d.count}`);
  }

  await client.close();
}

main().catch(err => { console.error("Error:", err.message); process.exit(1); });
