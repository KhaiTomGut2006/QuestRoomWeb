import mongoose from "mongoose";

const uri = process.env.MONGODB_URI;

let cached = globalThis.__questRoomMongoose;

if (!cached) {
  cached = globalThis.__questRoomMongoose = { conn: null, promise: null };
}

export async function connectDb() {
  if (!uri) {
    throw new Error("MONGODB_URI is not configured");
  }

  if (cached.conn) return cached.conn;

  if (!cached.promise) {
    cached.promise = mongoose.connect(uri, {
      bufferCommands: false,
      dbName: process.env.MONGODB_DB || undefined,
      maxPoolSize: Math.max(5, Number(process.env.MONGODB_MAX_POOL_SIZE || 20)),
      minPoolSize: Math.max(0, Number(process.env.MONGODB_MIN_POOL_SIZE || 0)),
      maxIdleTimeMS: Math.max(5_000, Number(process.env.MONGODB_MAX_IDLE_MS || 30_000)),
      serverSelectionTimeoutMS: Math.max(1_000, Number(process.env.MONGODB_SERVER_SELECTION_TIMEOUT_MS || 5_000)),
      socketTimeoutMS: Math.max(10_000, Number(process.env.MONGODB_SOCKET_TIMEOUT_MS || 45_000))
    });
  }

  cached.conn = await cached.promise;
  return cached.conn;
}
