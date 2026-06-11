const mongoose = require("mongoose");

const { MongoClient } = mongoose.mongo;

const DEFAULT_DB = "dekhub";
const DEFAULT_BATCH_SIZE = 200;
const QUESTROOM_FIELDS = [
  "coin",
  "questCoin",
  "questroomCoin",
  "questroomcoin",
  "rank",
  "questroomRank",
  "stage",
  "state",
  "substate",
  "subState",
  "quest",
  "questChallengeRequestedAt",
  "questChallenge",
  "challengeFailureStage",
  "challengeFailureCount",
  "challengeFailureHandledKey",
  "questReward",
  "npcQuest",
  "completedNpcQuestKeys",
  "npcQuestSubmissions",
  "npcCycle",
  "tutorial",
  "roomPosition",
  "shopCooldownT1",
  "shopCooldownT2",
  "shopLimitBreak",
  "shopAssetTickets",
  "ownedAccessories",
  "equippedAccessory",
  "npcVisitId",
  "npcVisitPurchases",
  "profileAchievements",
  "inventory",
  "items",
  "questItems",
  "ownedItems",
  "equippedItems",
  "ball",
  "ticket"
];
const CONNECTION_OPTIONS = {
  maxPoolSize: 5,
  minPoolSize: 0,
  maxIdleTimeMS: 30_000,
  serverSelectionTimeoutMS: 10_000,
  socketTimeoutMS: 300_000
};

function parseArgs(argv) {
  const options = {
    confirm: false,
    sourceDb: process.env.SOURCE_MONGODB_DB || DEFAULT_DB,
    targetDb: process.env.TARGET_MONGODB_DB || DEFAULT_DB,
    batchSize: DEFAULT_BATCH_SIZE
  };

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--confirm") {
      options.confirm = true;
      continue;
    }
    if (argument === "--help" || argument === "-h") {
      options.help = true;
      continue;
    }
    const [rawName, inlineValue] = argument.split("=", 2);
    const name = rawName.replace(/^--/, "");
    const value = inlineValue ?? argv[index + 1];
    if (!argument.startsWith("--") || value === undefined) {
      throw new Error(`Invalid argument: ${argument}`);
    }
    if (inlineValue === undefined) index += 1;

    if (name === "source-db") options.sourceDb = value;
    else if (name === "target-db") options.targetDb = value;
    else if (name === "batch-size") options.batchSize = Number(value);
    else throw new Error(`Unknown argument: --${name}`);
  }

  if (!Number.isInteger(options.batchSize) || options.batchSize < 1 || options.batchSize > 1_000) {
    throw new Error("--batch-size must be an integer between 1 and 1000.");
  }
  return options;
}

function printHelp() {
  console.log(`
Sync QuestRoom member progress from source to target by discord_id.

Dry-run:
  npm.cmd run migrate:questroom:members

Apply:
  npm.cmd run migrate:questroom:members -- --confirm

This overwrites only QuestRoom-related fields for matching users.
It does not delete users or modify profile/contact/course data.
`);
}

function bsonEqual(left, right) {
  return mongoose.mongo.BSON.EJSON.stringify(left, { relaxed: false })
    === mongoose.mongo.BSON.EJSON.stringify(right, { relaxed: false });
}

function pickQuestroomFields(document) {
  const selected = {};
  for (const field of QUESTROOM_FIELDS) {
    if (Object.prototype.hasOwnProperty.call(document, field)) {
      selected[field] = document[field];
    }
  }
  return selected;
}

async function syncBatch(targetCollection, sourceDocuments, confirm) {
  const discordIds = sourceDocuments.map((document) => document.discord_id);
  const targetDocuments = await targetCollection.find(
    { discord_id: { $in: discordIds } },
    { projection: { discord_id: 1, ...Object.fromEntries(QUESTROOM_FIELDS.map((field) => [field, 1])) } }
  ).toArray();
  const targetByDiscordId = new Map(
    targetDocuments.map((document) => [String(document.discord_id), document])
  );
  const operations = [];
  const stats = { insertedUsers: 0, updatedUsers: 0, unchangedUsers: 0, fieldsChanged: 0 };

  for (const sourceDocument of sourceDocuments) {
    const discordId = String(sourceDocument.discord_id);
    const targetDocument = targetByDiscordId.get(discordId);
    const sourceFields = pickQuestroomFields(sourceDocument);
    const setFields = Object.fromEntries(
      Object.entries(sourceFields).filter(
        ([field, value]) => !targetDocument || !bsonEqual(value, targetDocument[field])
      )
    );
    const unsetFields = targetDocument
      ? Object.fromEntries(
        QUESTROOM_FIELDS
          .filter(
            (field) => Object.prototype.hasOwnProperty.call(targetDocument, field)
              && !Object.prototype.hasOwnProperty.call(sourceFields, field)
          )
          .map((field) => [field, ""])
      )
      : {};
    const changedFieldCount = Object.keys(setFields).length + Object.keys(unsetFields).length;

    if (changedFieldCount === 0) {
      stats.unchangedUsers += 1;
      continue;
    }

    stats.fieldsChanged += changedFieldCount;
    if (targetDocument) {
      stats.updatedUsers += 1;
      const update = {};
      if (Object.keys(setFields).length > 0) update.$set = setFields;
      if (Object.keys(unsetFields).length > 0) update.$unset = unsetFields;
      operations.push({
        updateOne: {
          filter: { _id: targetDocument._id },
          update
        }
      });
    } else {
      stats.insertedUsers += 1;
      operations.push({
        updateOne: {
          filter: { discord_id: discordId },
          update: { $setOnInsert: { discord_id: discordId, ...sourceFields } },
          upsert: true
        }
      });
    }
  }

  if (confirm && operations.length > 0) {
    await targetCollection.bulkWrite(operations, { ordered: false });
  }
  return stats;
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    printHelp();
    return;
  }

  const sourceUri = process.env.SOURCE_MONGODB_URI;
  const targetUri = process.env.TARGET_MONGODB_URI;
  if (!sourceUri || !targetUri) {
    throw new Error("Set SOURCE_MONGODB_URI and TARGET_MONGODB_URI.");
  }

  const sourceClient = new MongoClient(sourceUri, CONNECTION_OPTIONS);
  const targetClient = new MongoClient(targetUri, CONNECTION_OPTIONS);
  let cursor;

  try {
    await Promise.all([sourceClient.connect(), targetClient.connect()]);
    const sourceCollection = sourceClient.db(options.sourceDb).collection("members");
    const targetCollection = targetClient.db(options.targetDb).collection("members");
    const projection = {
      discord_id: 1,
      ...Object.fromEntries(QUESTROOM_FIELDS.map((field) => [field, 1]))
    };
    const totals = {
      scannedUsers: 0,
      insertedUsers: 0,
      updatedUsers: 0,
      unchangedUsers: 0,
      fieldsChanged: 0
    };
    let batch = [];

    console.log(`Mode: ${options.confirm ? "APPLY" : "DRY RUN"}`);
    console.log(`Source: ${options.sourceDb}.members`);
    console.log(`Target: ${options.targetDb}.members`);
    console.log("Match key: discord_id");
    console.log(`QuestRoom fields: ${QUESTROOM_FIELDS.join(", ")}`);

    cursor = sourceCollection.find(
      { discord_id: { $exists: true, $nin: [null, ""] } },
      { projection, batchSize: options.batchSize, noCursorTimeout: true }
    );

    for await (const sourceDocument of cursor) {
      batch.push(sourceDocument);
      if (batch.length < options.batchSize) continue;
      const result = await syncBatch(targetCollection, batch, options.confirm);
      totals.scannedUsers += batch.length;
      for (const [key, value] of Object.entries(result)) totals[key] += value;
      batch = [];
    }
    if (batch.length > 0) {
      const result = await syncBatch(targetCollection, batch, options.confirm);
      totals.scannedUsers += batch.length;
      for (const [key, value] of Object.entries(result)) totals[key] += value;
    }

    console.table(totals);
    console.log(
      options.confirm
        ? "QuestRoom member data sync completed."
        : "[DRY RUN] No target data was changed."
    );
  } finally {
    await cursor?.close().catch(() => {});
    await Promise.allSettled([sourceClient.close(), targetClient.close()]);
  }
}

if (require.main === module) {
  main().catch((error) => {
    console.error("Fatal QuestRoom member sync error:", error);
    process.exitCode = 1;
  });
}

module.exports = {
  QUESTROOM_FIELDS,
  bsonEqual,
  parseArgs,
  pickQuestroomFields,
  syncBatch
};
