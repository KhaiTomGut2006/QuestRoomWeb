const { loadEnvConfig } = require("@next/env");
const mongoose = require("mongoose");
const {
  FORBIDDEN_SYNC_FIELDS,
  QUESTROOM_FIELDS,
  syncBatch
} = require("./sync-questroom-member-data");

loadEnvConfig(process.cwd());

const { MongoClient } = mongoose.mongo;
const SOURCE_URI = process.env.QUESTROOM_SYNC_SOURCE_URI;
const TARGET_URI = process.env.QUESTROOM_SYNC_TARGET_URI;
const SOURCE_DB = process.env.QUESTROOM_SYNC_SOURCE_DB || "dekhub";
const TARGET_DB = process.env.QUESTROOM_SYNC_TARGET_DB || "dekhub";
const INTERVAL_MS = Math.max(10_000, Number(process.env.QUESTROOM_SYNC_INTERVAL_MS || 30_000));
const BATCH_SIZE = Math.min(1_000, Math.max(25, Number(process.env.QUESTROOM_SYNC_BATCH_SIZE || 200)));
const CONNECTION_OPTIONS = {
  maxPoolSize: Math.min(10, Math.max(1, Number(process.env.QUESTROOM_SYNC_POOL_SIZE || 3))),
  minPoolSize: 0,
  maxIdleTimeMS: 60_000,
  serverSelectionTimeoutMS: 10_000,
  socketTimeoutMS: 120_000,
  retryReads: true,
  retryWrites: true
};
const WORKER_VERSION = "questroom-fields-v2-no-coin";

let stopping = false;
let timer = null;
let sourceClient = null;
let targetClient = null;

function redactMongoUri(uri) {
  try {
    const parsed = new URL(uri);
    return `${parsed.protocol}//${parsed.host}/${parsed.pathname.replace(/^\/+/, "") || "(default)"}`;
  } catch {
    return "(invalid URI)";
  }
}

function emptyTotals() {
  return {
    scannedUsers: 0,
    insertedUsers: 0,
    updatedUsers: 0,
    unchangedUsers: 0,
    fieldsChanged: 0
  };
}

async function ensureConnections() {
  if (!SOURCE_URI || !TARGET_URI) {
    throw new Error("QUESTROOM_SYNC_SOURCE_URI and QUESTROOM_SYNC_TARGET_URI are required.");
  }
  if (!sourceClient) {
    sourceClient = new MongoClient(SOURCE_URI, CONNECTION_OPTIONS);
    await sourceClient.connect();
  }
  if (!targetClient) {
    targetClient = new MongoClient(TARGET_URI, CONNECTION_OPTIONS);
    await targetClient.connect();
  }
}

async function runSyncCycle() {
  await ensureConnections();
  const startedAt = Date.now();
  const totals = emptyTotals();
  const projection = {
    discord_id: 1,
    ...Object.fromEntries(QUESTROOM_FIELDS.map((field) => [field, 1]))
  };
  const sourceCollection = sourceClient.db(SOURCE_DB).collection("members");
  const targetCollection = targetClient.db(TARGET_DB).collection("members");
  const cursor = sourceCollection.find(
    { discord_id: { $exists: true, $nin: [null, ""] } },
    { projection, batchSize: BATCH_SIZE, noCursorTimeout: true }
  );
  let batch = [];

  try {
    for await (const sourceDocument of cursor) {
      if (stopping) break;
      batch.push(sourceDocument);
      if (batch.length < BATCH_SIZE) continue;
      const result = await syncBatch(targetCollection, batch, true);
      totals.scannedUsers += batch.length;
      for (const [key, value] of Object.entries(result)) totals[key] += value;
      batch = [];
    }
    if (!stopping && batch.length > 0) {
      const result = await syncBatch(targetCollection, batch, true);
      totals.scannedUsers += batch.length;
      for (const [key, value] of Object.entries(result)) totals[key] += value;
    }
  } finally {
    await cursor.close().catch(() => {});
  }

  console.log(JSON.stringify({
    event: "questroom-member-sync",
    ok: true,
    durationMs: Date.now() - startedAt,
    ...totals,
    completedAt: new Date().toISOString()
  }));
  return Date.now() - startedAt;
}

function scheduleNextCycle(delayMs = INTERVAL_MS) {
  if (stopping) return;
  timer = setTimeout(async () => {
    let durationMs = 0;
    try {
      durationMs = await runSyncCycle();
    } catch (error) {
      console.error("[questroom-sync] cycle failed:", error?.message || error);
      await Promise.allSettled([
        sourceClient?.close(),
        targetClient?.close()
      ]);
      sourceClient = null;
      targetClient = null;
    } finally {
      scheduleNextCycle(Math.max(0, INTERVAL_MS - durationMs));
    }
  }, delayMs);
}

async function shutdown(signal) {
  if (stopping) return;
  stopping = true;
  if (timer) clearTimeout(timer);
  console.log(`[questroom-sync] shutting down (${signal})`);
  await Promise.allSettled([
    sourceClient?.close(),
    targetClient?.close()
  ]);
  process.exit(0);
}

async function main() {
  console.log("[questroom-sync] worker starting", {
    version: WORKER_VERSION,
    source: redactMongoUri(SOURCE_URI),
    target: redactMongoUri(TARGET_URI),
    sourceDb: SOURCE_DB,
    targetDb: TARGET_DB,
    intervalMs: INTERVAL_MS,
    batchSize: BATCH_SIZE,
    syncsCoin: QUESTROOM_FIELDS.includes("coin"),
    forbiddenFields: [...FORBIDDEN_SYNC_FIELDS]
  });
  const durationMs = await runSyncCycle();
  scheduleNextCycle(Math.max(0, INTERVAL_MS - durationMs));
}

process.once("SIGINT", () => void shutdown("SIGINT"));
process.once("SIGTERM", () => void shutdown("SIGTERM"));

main().catch((error) => {
  console.error("[questroom-sync] fatal:", error);
  process.exit(1);
});
