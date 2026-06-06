import mongoose from "mongoose";
import nextEnv from "@next/env";

const { loadEnvConfig } = nextEnv;
loadEnvConfig(process.cwd());

const mongoUri = process.env.MONGODB_URI;
const dbName = process.env.MONGODB_DB || undefined;
const apply = process.env.APPLY_SOCIAL_REACTION_CLEANUP === "true";
const batchSize = Math.max(10, Number(process.env.SOCIAL_REACTION_CLEANUP_BATCH_SIZE || 100));

if (!mongoUri) {
  console.error("MONGODB_URI is required");
  process.exit(1);
}

await mongoose.connect(mongoUri, dbName ? { dbName } : undefined);
const posts = mongoose.connection.collection("socialposts");

const query = {
  $or: [
    { likes: { $exists: true, $ne: [] } },
    { dislikes: { $exists: true, $ne: [] } }
  ],
  likeCount: { $exists: true },
  dislikeCount: { $exists: true }
};

const total = await posts.countDocuments(query);
let cleaned = 0;

if (apply) {
  const cursor = posts.find(query, { projection: { _id: 1 } }).batchSize(batchSize);
  for await (const post of cursor) {
    await posts.updateOne({ _id: post._id }, { $set: { likes: [], dislikes: [] } });
    cleaned += 1;
  }
}

await mongoose.disconnect();
console.log(JSON.stringify({ ok: true, dryRun: !apply, matched: total, cleaned }));
