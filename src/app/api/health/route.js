import mongoose from "mongoose";
import { NextResponse } from "next/server";

const readyStateLabels = {
  0: "disconnected",
  1: "connected",
  2: "connecting",
  3: "disconnecting"
};

async function pingDb(timeoutMs = 750) {
  if (mongoose.connection.readyState !== 1 || !mongoose.connection.db) {
    return { ok: false, latencyMs: null, skipped: true };
  }
  const startedAt = Date.now();
  let timeoutId;
  try {
    const timeout = new Promise((_, reject) => {
      timeoutId = setTimeout(() => reject(new Error("db_ping_timeout")), timeoutMs);
    });
    await Promise.race([
      mongoose.connection.db.admin().ping(),
      timeout
    ]);
    return { ok: true, latencyMs: Date.now() - startedAt, skipped: false };
  } catch (error) {
    return {
      ok: false,
      latencyMs: Date.now() - startedAt,
      skipped: false,
      error: error?.message || "db_ping_failed"
    };
  } finally {
    clearTimeout(timeoutId);
  }
}

export async function GET() {
  const memory = process.memoryUsage();
  const dbPing = await pingDb();
  const runtime = typeof globalThis.__questRoomCollectRuntimeStats === "function"
    ? globalThis.__questRoomCollectRuntimeStats(memory)
    : globalThis.__questRoomRuntimeStats || null;
  return NextResponse.json({
    ok: true,
    uptimeSec: Math.round(process.uptime()),
    memory: {
      rssMb: Math.round(memory.rss / 1024 / 1024),
      heapUsedMb: Math.round(memory.heapUsed / 1024 / 1024),
      heapTotalMb: Math.round(memory.heapTotal / 1024 / 1024),
      externalMb: Math.round(memory.external / 1024 / 1024)
    },
    db: {
      readyState: mongoose.connection.readyState,
      status: readyStateLabels[mongoose.connection.readyState] || "unknown",
      ping: dbPing
    },
    runtime,
    checkedAt: new Date().toISOString()
  });
}
