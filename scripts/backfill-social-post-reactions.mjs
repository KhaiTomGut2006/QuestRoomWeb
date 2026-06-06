import mongoose from "mongoose";
import nextEnv from "@next/env";

const { loadEnvConfig } = nextEnv;
loadEnvConfig(process.cwd());

const mongoUri = process.env.MONGODB_URI;
const dbName = process.env.MONGODB_DB || undefined;
const batchSize = Math.max(10, Number(process.env.SOCIAL_REACTION_BACKFILL_BATCH_SIZE || 100));

if (!mongoUri) {
  console.error("MONGODB_URI is required");
  process.exit(1);
}

function uniqueStrings(values = []) {
  return [...new Set((Array.isArray(values) ? values : []).map(String).filter(Boolean))];
}

await mongoose.connect(mongoUri, dbName ? { dbName } : undefined);
const posts = mongoose.connection.collection("socialposts");
const reactions = mongoose.connection.collection("social_post_reactions");

await reactions.createIndex({ postId: 1, userId: 1 }, { unique: true });
await reactions.createIndex({ postId: 1, reaction: 1 });
await reactions.createIndex({ userId: 1, updatedAt: -1 });

let scanned = 0;
let updatedPosts = 0;
let upsertedReactions = 0;

const cursor = posts.find(
  {
    $or: [
      { likes: { $exists: true, $ne: [] } },
      { dislikes: { $exists: true, $ne: [] } },
      { likeCount: { $exists: false } },
      { dislikeCount: { $exists: false } }
    ]
  },
  { projection: { postId: 1, likes: 1, dislikes: 1, likeCount: 1, dislikeCount: 1 } }
).batchSize(batchSize);

for await (const post of cursor) {
  scanned += 1;
  const postId = String(post.postId || "");
  if (!postId) continue;
  const likes = uniqueStrings(post.likes);
  const dislikes = uniqueStrings(post.dislikes).filter((userId) => !likes.includes(userId));

  const operations = [
    ...likes.map((userId) => ({
      updateOne: {
        filter: { postId, userId },
        update: { $set: { postId, userId, reaction: "like", reactedAt: new Date(), updatedAt: new Date() }, $setOnInsert: { createdAt: new Date() } },
        upsert: true
      }
    })),
    ...dislikes.map((userId) => ({
      updateOne: {
        filter: { postId, userId },
        update: { $set: { postId, userId, reaction: "dislike", reactedAt: new Date(), updatedAt: new Date() }, $setOnInsert: { createdAt: new Date() } },
        upsert: true
      }
    }))
  ];

  if (operations.length) {
    const result = await reactions.bulkWrite(operations, { ordered: false });
    upsertedReactions += result.upsertedCount + result.modifiedCount;
  }

  await posts.updateOne(
    { _id: post._id },
    { $set: { likeCount: likes.length, dislikeCount: dislikes.length } }
  );
  updatedPosts += 1;
}

await mongoose.disconnect();
console.log(JSON.stringify({ ok: true, scanned, updatedPosts, upsertedReactions }));
