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
      dbName: process.env.MONGODB_DB || undefined
    });
  }

  cached.conn = await cached.promise;
  return cached.conn;
}
