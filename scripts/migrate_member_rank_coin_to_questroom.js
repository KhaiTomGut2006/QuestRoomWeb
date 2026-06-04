const mongoose = require("mongoose");
const { loadEnvConfig } = require("@next/env");

loadEnvConfig(process.cwd());

const DRY_RUN = !process.argv.includes("--confirm");
const mongoUri = process.env.MONGODB_URI;
const mongoDbName = process.env.MONGODB_DB || undefined;

async function main() {
  if (!mongoUri) throw new Error("MONGODB_URI is not configured.");
  await mongoose.connect(mongoUri, mongoDbName ? { dbName: mongoDbName } : undefined);

  const Member = mongoose.models.Member || mongoose.model(
    "Member",
    new mongoose.Schema({}, { strict: false, collection: "members" })
  );

  const filter = { discord_id: { $exists: true, $ne: "" } };
  const total = await Member.countDocuments(filter);
  const missingQuestCoin = await Member.countDocuments({
    ...filter,
    questCoin: { $exists: false }
  });
  const rankNotNovice = await Member.countDocuments({
    ...filter,
    rank: { $ne: "Novice" }
  });
  const nonZeroCoin = await Member.countDocuments({
    ...filter,
    coin: { $ne: "0" }
  });
  const sample = await Member.find(filter)
    .select("discord_id coin questCoin rank questroomRank")
    .limit(5)
    .lean();

  console.log(`Members with discord_id: ${total}`);
  console.log(`Missing questCoin: ${missingQuestCoin}`);
  console.log(`rank not Novice: ${rankNotNovice}`);
  console.log(`coin not zero: ${nonZeroCoin}`);
  console.log("Sample before:");
  console.log(JSON.stringify(sample, null, 2));

  if (DRY_RUN) {
    console.log("\n[DRY RUN] No changes were made.");
    console.log("Run with --confirm to apply: node scripts/migrate_member_rank_coin_to_questroom.js --confirm");
    await mongoose.connection.close();
    return;
  }

  const result = await Member.updateMany(
    filter,
    [
      {
        $set: {
          questCoin: {
            $toString: {
              $convert: {
                input: { $ifNull: ["$coin", { $ifNull: ["$questCoin", "0"] }] },
                to: "int",
                onError: 0,
                onNull: 0
              }
            }
          },
          questroomRank: { $ifNull: ["$questroomRank", "Game Tester"] },
          coin: "0",
          rank: "Novice"
        }
      }
    ]
  );

  console.log("\nMigration applied.");
  console.log(`Matched: ${result.matchedCount}`);
  console.log(`Modified: ${result.modifiedCount}`);

  const sampleAfter = await Member.find(filter)
    .select("discord_id coin questCoin rank questroomRank")
    .limit(5)
    .lean();
  console.log("Sample after:");
  console.log(JSON.stringify(sampleAfter, null, 2));

  await mongoose.connection.close();
}

main().catch((error) => {
  console.error("Fatal migration error:", error);
  process.exit(1);
});
