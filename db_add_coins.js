/**
 * db_add_coins.js
 *
 * Adds a fixed number of coins to EVERY member that has a discord_id.
 *
 * Usage:
 *   node db_add_coins.js            <- dry run (show count only)
 *   node db_add_coins.js --confirm  <- actually apply
 *
 * Change AMOUNT below to adjust how many coins to add.
 */

const mongoose = require("mongoose");

const MONGODB_URI =
  "mongodb+srv://xynox:yzoQ4mRCaXcGRMMR@dekhub.7xfopzc.mongodb.net/dekhub";

const AMOUNT = 300; // coins to add per user

const DRY_RUN = !process.argv.includes("--confirm");

async function main() {
  await mongoose.connect(MONGODB_URI);
  console.log("Connected to MongoDB.\n");

  const members = mongoose.connection.collection("members");
  const filter = { discord_id: { $exists: true, $ne: "" } };

  const totalCount = await members.countDocuments(filter);
  console.log(`Members with discord_id: ${totalCount}`);
  console.log(`Coins to add per user:   ${AMOUNT}`);

  if (DRY_RUN) {
    console.log("\n[DRY RUN] No changes were made.");
    console.log(
      "Run with --confirm to apply:  node db_add_coins.js --confirm"
    );
    await mongoose.connection.close();
    return;
  }

  // Fetch all members' current coin values and update one-by-one
  // (coin is stored as a string field, so we can't use $inc directly)
  const cursor = members.find(filter, { projection: { _id: 1, coin: 1 } });
  let modified = 0;

  const bulkOps = [];
  for await (const doc of cursor) {
    const current = Number.parseInt(doc.coin || "0", 10) || 0;
    const next = String(current + AMOUNT);
    bulkOps.push({
      updateOne: {
        filter: { _id: doc._id },
        update: { $set: { coin: next } }
      }
    });

    // Execute in batches of 500
    if (bulkOps.length >= 500) {
      const result = await members.bulkWrite(bulkOps, { ordered: false });
      modified += result.modifiedCount;
      bulkOps.length = 0;
    }
  }

  if (bulkOps.length > 0) {
    const result = await members.bulkWrite(bulkOps, { ordered: false });
    modified += result.modifiedCount;
  }

  console.log(`\nDone!`);
  console.log(`  Matched:  ${totalCount}`);
  console.log(`  Modified: ${modified}`);

  await mongoose.connection.close();
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
