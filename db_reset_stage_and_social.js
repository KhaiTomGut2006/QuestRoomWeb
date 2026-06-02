/**
 * db_reset_stage_and_social.js
 *
 * Resets Stage progress and Social (NPC quest submissions / social status)
 * for EVERY member that has a discord_id.
 *
 * Stage fields reset:
 *   stage, quest, questChallenge, questChallengeRequestedAt,
 *   challengeFailureStage, challengeFailureCount, challengeFailureHandledKey,
 *   questReward, npcQuest, npcCycle
 *
 * Social fields reset:
 *   npcQuestSubmissions, socialLastSeenAt
 *
 * Usage:
 *   node db_reset_stage_and_social.js            <- dry run (count only)
 *   node db_reset_stage_and_social.js --confirm  <- actually apply changes
 */

const mongoose = require("mongoose");

// ── Update this URI if your connection string changes ──────────────────────────
const MONGODB_URI =
  "mongodb+srv://xynox:yzoQ4mRCaXcGRMMR@dekhub.7xfopzc.mongodb.net/dekhub";
// ──────────────────────────────────────────────────────────────────────────────

const DRY_RUN = !process.argv.includes("--confirm");

async function main() {
  await mongoose.connect(MONGODB_URI);
  console.log("Connected to MongoDB.\n");

  // ── Shared schema options (strict: false lets us query any collection) ──────
  const looseSchemaMember = new mongoose.Schema(
    {},
    { strict: false, collection: "members" }
  );
  const Member =
    mongoose.models.Member ||
    mongoose.model("Member", looseSchemaMember);

  const looseSchemLevel = new mongoose.Schema(
    {},
    { strict: false, collection: "levels" }
  );
  const Level =
    mongoose.models.Level ||
    mongoose.model("Level", looseSchemLevel);

  // ── Determine the first configured stage ───────────────────────────────────
  const firstLevel = await Level.findOne({}).sort({ order: 1 }).lean();
  const firstStage = firstLevel?.stageId || "game-demo-1";
  console.log(`First configured stage: "${firstStage}"`);

  // ── Count affected users ───────────────────────────────────────────────────
  const filter = { discord_id: { $exists: true, $ne: "" } };
  const totalCount = await Member.countDocuments(filter);
  console.log(`Members with discord_id: ${totalCount}`);

  if (DRY_RUN) {
    console.log("\n[DRY RUN] No changes were made.");
    console.log(
      'Run with --confirm to apply the reset:  node db_reset_stage_and_social.js --confirm'
    );
    await mongoose.connection.close();
    return;
  }

  // ── Build the update payload ───────────────────────────────────────────────
  const now = new Date();

  const updateOp = {
    $set: {
      // Stage
      stage: firstStage,
      quest: {
        current: "อยากเห็นรูปเดี่ยวตัวละครเจ้า (ตอนแยกสาย) จัง",
        status: "active",
        completed: [],
      },
      npcQuest: null,
      npcCycle: null,
      challengeFailureStage: firstStage,
      challengeFailureCount: 0,

      // Tutorial — send everyone back to the beginning
      tutorial: {
        status: "active",
        step: "welcome-1",
        startedAt: now,
        updatedAt: now,
      },

      // Social
      npcQuestSubmissions: [],
    },
    $unset: {
      // Stage
      questChallenge: "",
      questChallengeRequestedAt: "",
      challengeFailureHandledKey: "",
      questReward: "",

      // Social
      socialLastSeenAt: "",
    },
  };

  console.log("\nApplying reset…");
  const result = await Member.updateMany(filter, updateOp);

  console.log(`\nDone!`);
  console.log(`  Matched:  ${result.matchedCount}`);
  console.log(`  Modified: ${result.modifiedCount}`);

  await mongoose.connection.close();
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
