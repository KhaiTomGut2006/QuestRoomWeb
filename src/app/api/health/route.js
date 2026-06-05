import mongoose from "mongoose";
import { NextResponse } from "next/server";

const readyStateLabels = {
  0: "disconnected",
  1: "connected",
  2: "connecting",
  3: "disconnecting"
};

export async function GET() {
  const memory = process.memoryUsage();
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
      status: readyStateLabels[mongoose.connection.readyState] || "unknown"
    },
    runtime,
    checkedAt: new Date().toISOString()
  });
}
