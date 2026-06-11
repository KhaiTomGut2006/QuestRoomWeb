const mongoose = require("mongoose");

const { MongoClient } = mongoose.mongo;

const DEFAULT_DB = "dekhub";
const DEFAULT_BATCH_SIZE = 500;
const MAX_BATCH_SIZE = 1_000;
const MAX_WRITE_RETRIES = 5;
const CONNECTION_OPTIONS = {
  maxPoolSize: 5,
  minPoolSize: 0,
  maxIdleTimeMS: 30_000,
  serverSelectionTimeoutMS: 10_000,
  socketTimeoutMS: 300_000
};

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isRetryableWriteError(error) {
  return error?.hasErrorLabel?.("RetryableWriteError")
    || error?.errorLabelSet?.has?.("RetryableWriteError")
    || /timed out|ECONNRESET|connection closed|network/i.test(String(error?.message || ""));
}

async function bulkWriteWithRetry(collection, operations) {
  for (let attempt = 1; attempt <= MAX_WRITE_RETRIES; attempt += 1) {
    try {
      return await collection.bulkWrite(operations, { ordered: false });
    } catch (error) {
      if (!isRetryableWriteError(error) || attempt === MAX_WRITE_RETRIES) throw error;
      const delayMs = attempt * 2_000;
      console.warn(`  write timeout; retrying batch in ${delayMs / 1_000}s (${attempt}/${MAX_WRITE_RETRIES})`);
      await sleep(delayMs);
    }
  }
  throw new Error("Bulk write retry loop exited unexpectedly.");
}

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

  if (!Number.isInteger(options.batchSize) || options.batchSize < 1 || options.batchSize > MAX_BATCH_SIZE) {
    throw new Error(`--batch-size must be an integer between 1 and ${MAX_BATCH_SIZE}.`);
  }
  return options;
}

function printHelp() {
  console.log(`
Incrementally sync the complete dekhub game database to another MongoDB deployment.

Dry-run (does not change the target):
  $env:SOURCE_MONGODB_URI="<source-uri>"
  $env:TARGET_MONGODB_URI="<target-uri>"
  npm.cmd run migrate:dekhub:all

Apply changed and new data:
  npm.cmd run migrate:dekhub:all -- --confirm

Behavior:
  - Inserts source documents whose _id does not exist on the target
  - Replaces documents whose _id exists but BSON content is different
  - Leaves unchanged documents untouched
  - Never deletes target databases, collections, or documents
  - Creates missing collections and indexes

Important:
  MongoDB users/roles, local files, environment variables, and R2/S3 files are not copied.

Options:
  --source-db dekhub      Source database (default: dekhub)
  --target-db dekhub      Target database (default: dekhub)
  --batch-size 500        Documents written per batch (1-${MAX_BATCH_SIZE})
  --confirm               Apply the migration
`);
}

function sanitizeCollectionOptions(options = {}) {
  const allowed = [
    "capped",
    "size",
    "max",
    "validator",
    "validationLevel",
    "validationAction",
    "storageEngine",
    "collation",
    "timeseries",
    "expireAfterSeconds",
    "changeStreamPreAndPostImages",
    "clusteredIndex"
  ];
  return Object.fromEntries(
    allowed
      .filter((key) => options[key] !== undefined)
      .map((key) => [key, options[key]])
  );
}

function sanitizeIndexOptions(index) {
  const ignored = new Set(["key", "ns", "v"]);
  return Object.fromEntries(
    Object.entries(index)
      .filter(([key, value]) => !ignored.has(key) && value !== undefined)
  );
}

function bsonEqual(left, right) {
  return mongoose.mongo.BSON.EJSON.stringify(left, { relaxed: false })
    === mongoose.mongo.BSON.EJSON.stringify(right, { relaxed: false });
}

function getPath(document, path) {
  return path.split(".").reduce((value, segment) => value?.[segment], document);
}

function buildUniqueIdentity(document, index) {
  const fields = Object.keys(index.key || {});
  const values = fields.map((field) => getPath(document, field));
  if (values.some((value) => value === undefined || value === null)) return null;
  return `${index.name}:${mongoose.mongo.BSON.EJSON.stringify(values, { relaxed: false })}`;
}

function buildUniqueFilter(document, index) {
  const filter = {};
  for (const field of Object.keys(index.key || {})) {
    const value = getPath(document, field);
    if (value === undefined || value === null) return null;
    filter[field] = value;
  }
  return filter;
}

async function inspectDatabase(db) {
  const definitions = await db.listCollections({}, { nameOnly: false }).toArray();
  const collections = definitions.filter(
    (definition) => definition.type === "collection" && !definition.name.startsWith("system.")
  );
  const summary = [];

  for (const definition of collections) {
    const collection = db.collection(definition.name);
    const [documents, indexes] = await Promise.all([
      collection.estimatedDocumentCount(),
      collection.listIndexes().toArray()
    ]);
    summary.push({
      collection: definition.name,
      documents,
      indexes: indexes.length,
      definition
    });
  }

  return {
    collections: summary,
    views: definitions.filter((definition) => definition.type === "view")
  };
}

async function ensureCollection(targetDb, collectionInfo) {
  const { collection: name, definition } = collectionInfo;
  const existing = await targetDb.listCollections({ name }, { nameOnly: true }).hasNext();
  if (!existing) {
    await targetDb.createCollection(name, sanitizeCollectionOptions(definition.options));
    return true;
  }
  return false;
}

async function syncBatch(targetCollection, sourceDocuments, confirm, uniqueIndexes = []) {
  const ids = sourceDocuments.map((document) => document._id);
  const uniqueFilters = sourceDocuments.flatMap((document) => (
    uniqueIndexes
      .map((index) => buildUniqueFilter(document, index))
      .filter(Boolean)
  ));
  const lookupFilter = uniqueFilters.length > 0
    ? { $or: [{ _id: { $in: ids } }, ...uniqueFilters] }
    : { _id: { $in: ids } };
  const targetDocuments = await targetCollection.find(
    lookupFilter,
    { batchSize: sourceDocuments.length }
  ).toArray();
  const targetById = new Map(
    targetDocuments.map((document) => [
      mongoose.mongo.BSON.EJSON.stringify(document._id, { relaxed: false }),
      document
    ])
  );
  const targetByUniqueIdentity = new Map();
  for (const targetDocument of targetDocuments) {
    for (const index of uniqueIndexes) {
      const identity = buildUniqueIdentity(targetDocument, index);
      if (identity) targetByUniqueIdentity.set(identity, targetDocument);
    }
  }
  const operations = [];
  let inserts = 0;
  let updates = 0;
  let unchanged = 0;

  for (const sourceDocument of sourceDocuments) {
    const idKey = mongoose.mongo.BSON.EJSON.stringify(sourceDocument._id, { relaxed: false });
    let targetDocument = targetById.get(idKey);
    if (!targetDocument) {
      for (const index of uniqueIndexes) {
        const identity = buildUniqueIdentity(sourceDocument, index);
        if (identity && targetByUniqueIdentity.has(identity)) {
          targetDocument = targetByUniqueIdentity.get(identity);
          break;
        }
      }
    }
    if (!targetDocument) {
      inserts += 1;
      operations.push({ insertOne: { document: sourceDocument } });
    } else {
      const replacement = targetDocument._id === sourceDocument._id
        ? sourceDocument
        : { ...sourceDocument, _id: targetDocument._id };
      if (bsonEqual(replacement, targetDocument)) {
        unchanged += 1;
        continue;
      }
      updates += 1;
      operations.push({
        replaceOne: {
          filter: { _id: targetDocument._id },
          replacement,
          upsert: false
        }
      });
    }
  }

  if (confirm && operations.length > 0) {
    await bulkWriteWithRetry(targetCollection, operations);
  }
  return { inserts, updates, unchanged };
}

async function syncIndexes(sourceCollection, targetCollection, confirm, targetExists) {
  const sourceIndexes = await sourceCollection.listIndexes().toArray();
  const targetIndexes = targetExists
    ? await targetCollection.listIndexes().toArray()
    : [];
  const targetIndexNames = new Set(targetIndexes.map((index) => index.name));
  const missingIndexes = sourceIndexes.filter(
    (index) => index.name !== "_id_" && !targetIndexNames.has(index.name)
  );

  if (confirm) {
    for (const index of missingIndexes) {
      await targetCollection.createIndex(index.key, sanitizeIndexOptions(index));
    }
  }
  return { sourceIndexes: sourceIndexes.length, missingIndexes: missingIndexes.length };
}

async function syncCollection(sourceDb, targetDb, collectionInfo, batchSize, confirm) {
  const { collection: name } = collectionInfo;
  const targetExisted = await targetDb.listCollections({ name }, { nameOnly: true }).hasNext();
  const collectionCreated = confirm && !targetExisted
    ? await ensureCollection(targetDb, collectionInfo)
    : !targetExisted;
  const sourceCollection = sourceDb.collection(name);
  const targetCollection = targetDb.collection(name);
  const sourceIndexes = await sourceCollection.listIndexes().toArray();
  const uniqueIndexes = sourceIndexes.filter(
    (index) => index.name !== "_id_" && index.unique === true
  );
  const cursor = sourceCollection.find({}, {
    batchSize,
    noCursorTimeout: true
  });
  const stats = {
    scanned: 0,
    inserts: 0,
    updates: 0,
    unchanged: 0,
    collectionCreated,
    missingIndexes: 0
  };
  let batch = [];

  try {
    for await (const document of cursor) {
      batch.push(document);
      if (batch.length < batchSize) continue;
      const result = await syncBatch(targetCollection, batch, confirm, uniqueIndexes);
      stats.scanned += batch.length;
      stats.inserts += result.inserts;
      stats.updates += result.updates;
      stats.unchanged += result.unchanged;
      batch = [];
      if (stats.scanned % 5_000 === 0) console.log(`  ${name}: compared ${stats.scanned} documents`);
    }
    if (batch.length > 0) {
      const result = await syncBatch(targetCollection, batch, confirm, uniqueIndexes);
      stats.scanned += batch.length;
      stats.inserts += result.inserts;
      stats.updates += result.updates;
      stats.unchanged += result.unchanged;
    }
  } finally {
    await cursor.close().catch(() => {});
  }

  const indexResult = await syncIndexes(
    sourceCollection,
    targetCollection,
    confirm,
    targetExisted || (confirm && collectionCreated)
  );
  stats.missingIndexes = indexResult.missingIndexes;
  return stats;
}

async function createMissingViews(targetDb, views, confirm) {
  let missing = 0;
  for (const view of views) {
    const exists = await targetDb.listCollections({ name: view.name }, { nameOnly: true }).hasNext();
    if (exists) continue;
    missing += 1;
    if (confirm) {
      await targetDb.createCollection(view.name, {
        viewOn: view.options.viewOn,
        pipeline: view.options.pipeline || [],
        ...(view.options.collation ? { collation: view.options.collation } : {})
      });
    }
  }
  return missing;
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

  try {
    await Promise.all([sourceClient.connect(), targetClient.connect()]);
    const sourceDb = sourceClient.db(options.sourceDb);
    const targetDb = targetClient.db(options.targetDb);
    const sourceSummary = await inspectDatabase(sourceDb);
    const totalDocuments = sourceSummary.collections.reduce((sum, item) => sum + item.documents, 0);

    console.log(`Mode: ${options.confirm ? "INCREMENTAL SYNC" : "DRY RUN"}`);
    console.log(`Source: ${sourceClient.options.hosts?.join(",") || "MongoDB"}/${sourceDb.databaseName}`);
    console.log(`Target database: ${targetDb.databaseName}`);
    console.table(
      sourceSummary.collections.map(({ collection, documents, indexes }) => ({
        collection,
        documents,
        indexes
      }))
    );
    console.log(`Collections: ${sourceSummary.collections.length}`);
    console.log(`Views: ${sourceSummary.views.length}`);
    console.log(`Total documents: ${totalDocuments}`);

    if (!options.confirm) {
      console.log("\n[DRY RUN] Comparing source and target. Target will not be changed.");
    }

    const results = [];
    for (const collectionInfo of sourceSummary.collections) {
      console.log(`Syncing ${collectionInfo.collection}...`);
      const result = await syncCollection(
        sourceDb,
        targetDb,
        collectionInfo,
        options.batchSize,
        options.confirm
      );
      results.push({ collection: collectionInfo.collection, ...result });
    }
    const missingViews = await createMissingViews(targetDb, sourceSummary.views, options.confirm);

    console.log("\nSync summary");
    console.table(results);
    console.log(`Missing views ${options.confirm ? "created" : "detected"}: ${missingViews}`);
    console.log(
      options.confirm
        ? "Incremental database sync completed. No target-only data was deleted."
        : "[DRY RUN] No target data was changed. Add --confirm to apply these inserts and updates."
    );
  } finally {
    await Promise.allSettled([sourceClient.close(), targetClient.close()]);
  }
}

if (require.main === module) {
  main().catch((error) => {
    console.error("Fatal database migration error:", error);
    process.exitCode = 1;
  });
}

module.exports = {
  parseArgs,
  bsonEqual,
  buildUniqueFilter,
  buildUniqueIdentity,
  bulkWriteWithRetry,
  isRetryableWriteError,
  sanitizeCollectionOptions,
  sanitizeIndexOptions,
  syncBatch
};
