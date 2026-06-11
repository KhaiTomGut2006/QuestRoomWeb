const mongoose = require("mongoose");

const { MongoClient } = mongoose.mongo;

const DEFAULT_BATCH_SIZE = 200;
const DEFAULT_MATCH_KEY = "discord_id";
const DEFAULT_COLLECTION = "members";
const DEFAULT_SOURCE_DB = "dekhub";
const DEFAULT_TARGET_DB = "dekhub";
const DEFAULT_MODE = "fill-missing";
const MAX_DUPLICATE_SAMPLES = 10;
const MAX_DIFFERENCE_SAMPLES = 10;
const QUERY_TIMEOUT_MS = 30_000;
const CONNECTION_OPTIONS = {
  maxPoolSize: 5,
  minPoolSize: 0,
  maxIdleTimeMS: 30_000,
  serverSelectionTimeoutMS: 10_000,
  socketTimeoutMS: 60_000
};

function parseArgs(argv) {
  const options = {
    confirm: false,
    mode: DEFAULT_MODE,
    matchKey: DEFAULT_MATCH_KEY,
    batchSize: DEFAULT_BATCH_SIZE,
    sourceDb: process.env.SOURCE_MONGODB_DB || DEFAULT_SOURCE_DB,
    targetDb: process.env.TARGET_MONGODB_DB || DEFAULT_TARGET_DB,
    sourceCollection: process.env.SOURCE_MONGODB_COLLECTION || process.env.MONGODB_COLLECTION || DEFAULT_COLLECTION,
    targetCollection: process.env.TARGET_MONGODB_COLLECTION || process.env.MONGODB_COLLECTION || DEFAULT_COLLECTION,
    excludeFields: new Set(
      String(process.env.MIGRATION_EXCLUDE_FIELDS || "_id,created_at,updated_at")
        .split(",")
        .map((value) => value.trim())
        .filter(Boolean)
    )
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
    if (inlineValue === undefined) index += 1;

    if (!argument.startsWith("--") || value === undefined) {
      throw new Error(`Invalid argument: ${argument}`);
    }

    if (name === "mode") options.mode = value;
    else if (name === "match-key") options.matchKey = value;
    else if (name === "batch-size") options.batchSize = Number(value);
    else if (name === "source-db") options.sourceDb = value;
    else if (name === "target-db") options.targetDb = value;
    else if (name === "collection") {
      options.sourceCollection = value;
      options.targetCollection = value;
    } else if (name === "source-collection") options.sourceCollection = value;
    else if (name === "target-collection") options.targetCollection = value;
    else if (name === "exclude") {
      options.excludeFields = new Set(
        String(value)
          .split(",")
          .map((field) => field.trim())
          .filter(Boolean)
      );
      options.excludeFields.add("_id");
    } else {
      throw new Error(`Unknown argument: --${name}`);
    }
  }

  if (!["fill-missing", "source-wins"].includes(options.mode)) {
    throw new Error("--mode must be fill-missing or source-wins.");
  }
  if (!Number.isInteger(options.batchSize) || options.batchSize < 1 || options.batchSize > 1_000) {
    throw new Error("--batch-size must be an integer between 1 and 1000.");
  }
  if (!options.matchKey || options.matchKey.startsWith("$")) {
    throw new Error("--match-key is invalid.");
  }

  return options;
}

function printHelp() {
  console.log(`
Migrate matching user documents between MongoDB collections.

Dry-run (default):
  $env:SOURCE_MONGODB_URI="<source-uri>"
  $env:TARGET_MONGODB_URI="<target-uri>"
  node scripts/migrate-dekhub-data.js

Apply after reviewing the dry-run:
  node scripts/migrate-dekhub-data.js --confirm

Options:
  --confirm                    Apply writes. Without this flag, no data is changed.
  --mode fill-missing          Preserve target values and fill only missing/empty fields (default).
  --mode source-wins           Overwrite target fields with source values.
  --match-key discord_id       Field used to match the same user (default: discord_id).
  --collection members         Use the same collection name on both databases.
  --source-collection <name>   Override only the source collection.
  --target-collection <name>   Override only the target collection.
  --source-db dekhub           Source database (default: dekhub).
  --target-db dekhub           Target database (default: dekhub).
  --batch-size 200             Documents per batch (1-1000).
  --exclude _id,created_at     Comma-separated top-level fields not to migrate.
                               Default: _id,created_at,updated_at
`);
}

function isPlainObject(value) {
  return value !== null
    && typeof value === "object"
    && !Array.isArray(value)
    && !(value instanceof Date)
    && value?._bsontype === undefined;
}

function isMissingValue(value) {
  return value === undefined
    || value === null
    || value === ""
    || (Array.isArray(value) && value.length === 0);
}

function getPath(document, path) {
  return path.split(".").reduce((current, segment) => current?.[segment], document);
}

function flattenDocument(document, prefix = "", output = {}) {
  for (const [key, value] of Object.entries(document || {})) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (isPlainObject(value) && Object.keys(value).length > 0) {
      flattenDocument(value, path, output);
    } else {
      output[path] = value;
    }
  }
  return output;
}

function collectMissingFields(source, target, prefix = "", output = {}) {
  for (const [key, sourceValue] of Object.entries(source || {})) {
    const path = prefix ? `${prefix}.${key}` : key;
    const targetValue = target?.[key];

    if (isMissingValue(targetValue)) {
      if (!isMissingValue(sourceValue)) output[path] = sourceValue;
      continue;
    }
    if (isPlainObject(sourceValue) && isPlainObject(targetValue)) {
      collectMissingFields(sourceValue, targetValue, path, output);
    }
  }
  return output;
}

function buildSetFields(source, target, options) {
  const sourceWithoutExcludedFields = {};
  for (const [key, value] of Object.entries(source)) {
    if (!options.excludeFields.has(key) && key !== options.matchKey && value !== undefined) {
      sourceWithoutExcludedFields[key] = value;
    }
  }

  if (options.mode === "source-wins") return sourceWithoutExcludedFields;
  return collectMissingFields(sourceWithoutExcludedFields, target);
}

function valuesEqual(left, right) {
  return mongoose.mongo.BSON.EJSON.stringify(left, { relaxed: false })
    === mongoose.mongo.BSON.EJSON.stringify(right, { relaxed: false });
}

async function findDuplicateKeys(collection, matchKey) {
  return collection.aggregate(
    [
      { $match: { [matchKey]: { $exists: true, $nin: [null, ""] } } },
      { $group: { _id: `$${matchKey}`, count: { $sum: 1 } } },
      { $match: { count: { $gt: 1 } } },
      { $limit: MAX_DUPLICATE_SAMPLES }
    ],
    { allowDiskUse: true, maxTimeMS: QUERY_TIMEOUT_MS }
  ).toArray();
}

async function processBatch({
  sourceDocuments,
  targetCollection,
  options,
  stats,
  differenceSamples
}) {
  const keys = sourceDocuments.map((document) => document[options.matchKey]);
  const targetDocuments = await targetCollection.find(
    { [options.matchKey]: { $in: keys } },
    { maxTimeMS: QUERY_TIMEOUT_MS }
  ).toArray();
  const targetByKey = new Map(
    targetDocuments.map((document) => [String(document[options.matchKey]), document])
  );
  const operations = [];

  for (const source of sourceDocuments) {
    const key = source[options.matchKey];
    const target = targetByKey.get(String(key));

    if (!target) {
      const documentToInsert = {};
      for (const [field, value] of Object.entries(source)) {
        if (!options.excludeFields.has(field)) documentToInsert[field] = value;
      }
      operations.push({
        updateOne: {
          filter: { [options.matchKey]: key },
          update: { $setOnInsert: documentToInsert },
          upsert: true
        }
      });
      stats.wouldInsert += 1;
      continue;
    }

    stats.matched += 1;
    const setFields = buildSetFields(source, target, options);
    const changedFields = Object.entries(setFields)
      .filter(([path, value]) => !valuesEqual(getPath(target, path), value));

    if (changedFields.length === 0) {
      stats.unchanged += 1;
      continue;
    }

    const update = Object.fromEntries(changedFields);
    operations.push({
      updateOne: {
        filter: { _id: target._id },
        update: { $set: update }
      }
    });
    stats.wouldUpdate += 1;
    stats.fieldsChanged += changedFields.length;

    if (differenceSamples.length < MAX_DIFFERENCE_SAMPLES) {
      differenceSamples.push({
        key,
        fields: changedFields.slice(0, 20).map(([path]) => path)
      });
    }
  }

  if (options.confirm && operations.length > 0) {
    const result = await targetCollection.bulkWrite(operations, { ordered: false });
    stats.inserted += result.upsertedCount;
    stats.updated += result.modifiedCount;
  }
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
    throw new Error("Set SOURCE_MONGODB_URI and TARGET_MONGODB_URI before running this script.");
  }

  const sourceClient = new MongoClient(sourceUri, CONNECTION_OPTIONS);
  const targetClient = new MongoClient(targetUri, CONNECTION_OPTIONS);
  let sourceCursor;

  try {
    await Promise.all([sourceClient.connect(), targetClient.connect()]);

    const sourceDb = options.sourceDb ? sourceClient.db(options.sourceDb) : sourceClient.db();
    const targetDb = targetClient.db(options.targetDb);
    const sourceCollection = sourceDb.collection(options.sourceCollection);
    const targetCollection = targetDb.collection(options.targetCollection);

    console.log(`Mode: ${options.confirm ? "APPLY" : "DRY RUN"} / ${options.mode}`);
    console.log(`Source: ${sourceDb.databaseName}.${sourceCollection.collectionName}`);
    console.log(`Target: ${targetDb.databaseName}.${targetCollection.collectionName}`);
    console.log(`Match key: ${options.matchKey}`);
    console.log(`Excluded top-level fields: ${[...options.excludeFields].join(", ")}`);

    const [sourceDuplicates, targetDuplicates] = await Promise.all([
      findDuplicateKeys(sourceCollection, options.matchKey),
      findDuplicateKeys(targetCollection, options.matchKey)
    ]);
    if (sourceDuplicates.length > 0 || targetDuplicates.length > 0) {
      console.error("Duplicate match keys found. Migration stopped to prevent ambiguous updates.");
      if (sourceDuplicates.length > 0) console.error("Source duplicates:", sourceDuplicates);
      if (targetDuplicates.length > 0) console.error("Target duplicates:", targetDuplicates);
      process.exitCode = 2;
      return;
    }

    const filter = { [options.matchKey]: { $exists: true, $nin: [null, ""] } };
    const stats = {
      scanned: 0,
      matched: 0,
      unchanged: 0,
      wouldInsert: 0,
      wouldUpdate: 0,
      fieldsChanged: 0,
      inserted: 0,
      updated: 0
    };
    const differenceSamples = [];
    let batch = [];

    sourceCursor = sourceCollection.find(filter, {
      batchSize: options.batchSize,
      noCursorTimeout: true,
      maxTimeMS: QUERY_TIMEOUT_MS
    });

    for await (const sourceDocument of sourceCursor) {
      batch.push(sourceDocument);
      stats.scanned += 1;
      if (batch.length < options.batchSize) continue;

      await processBatch({
        sourceDocuments: batch,
        targetCollection,
        options,
        stats,
        differenceSamples
      });
      batch = [];
      if (stats.scanned % 1_000 === 0) console.log(`Scanned ${stats.scanned} source documents...`);
    }

    if (batch.length > 0) {
      await processBatch({
        sourceDocuments: batch,
        targetCollection,
        options,
        stats,
        differenceSamples
      });
    }

    console.log("\nSummary");
    console.table(stats);
    if (differenceSamples.length > 0) {
      console.log("Sample changed fields:");
      console.dir(differenceSamples, { depth: null });
    }
    if (!options.confirm) {
      console.log("\n[DRY RUN] No data was changed. Add --confirm after reviewing this summary.");
    }
  } finally {
    await sourceCursor?.close().catch(() => {});
    await Promise.allSettled([sourceClient.close(), targetClient.close()]);
  }
}

if (require.main === module) {
  main().catch((error) => {
    console.error("Fatal migration error:", error);
    process.exitCode = 1;
  });
}

module.exports = {
  buildSetFields,
  flattenDocument,
  getPath,
  isMissingValue,
  parseArgs
};
