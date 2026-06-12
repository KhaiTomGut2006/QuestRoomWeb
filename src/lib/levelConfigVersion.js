import mongoose from "mongoose";
import { connectDb } from "@/lib/db";

// Cross-process cache invalidation for the level config.
//
// Every save (PUT/PATCH /api/levels) bumps a version counter stored in Mongo.
// Cache layers compare their stored version against the current one (checked at
// most once per LEVEL_CONFIG_VERSION_CHECK_MS) instead of relying purely on TTL,
// so workers that did not handle the save still pick up changes within seconds.

const COLLECTION = "config_meta";
const DOC_ID = "levelConfig";
const CHECK_TTL_MS = Math.max(1_000, Number(process.env.LEVEL_CONFIG_VERSION_CHECK_MS || 10_000));

let lastVersion = 0;
let lastCheckedAt = 0;

export async function bumpLevelConfigVersion() {
  await connectDb();
  const result = await mongoose.connection.collection(COLLECTION).findOneAndUpdate(
    { _id: DOC_ID },
    { $inc: { version: 1 }, $set: { updatedAt: new Date() } },
    { upsert: true, returnDocument: "after" }
  );
  const doc = result?.value ?? result;
  lastVersion = Number(doc?.version || 0);
  lastCheckedAt = Date.now();
  return lastVersion;
}

export async function getLevelConfigVersion({ force = false } = {}) {
  const now = Date.now();
  if (!force && now - lastCheckedAt < CHECK_TTL_MS) return lastVersion;
  lastCheckedAt = now;
  try {
    await connectDb();
    const doc = await mongoose.connection.collection(COLLECTION).findOne(
      { _id: DOC_ID },
      { projection: { version: 1 } }
    );
    lastVersion = Number(doc?.version || 0);
  } catch (error) {
    console.error("levelConfigVersion check failed:", error.message);
  }
  return lastVersion;
}
