import { NextResponse } from "next/server";
import { entryQueueStats, joinEntryQueue, releaseEntryQueue } from "@/lib/entryQueue";

const STREAM_INTERVAL_MS = Math.max(2_000, Number(process.env.ENTRY_QUEUE_STREAM_INTERVAL_MS || 5_000));
const STREAM_MAX_DURATION_MS = Math.max(30_000, Number(process.env.ENTRY_QUEUE_STREAM_MAX_DURATION_MS || 120_000));
const STREAM_ENABLED = process.env.ENTRY_QUEUE_STREAM_ENABLED === "true";

function sseMessage(event, data) {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}

function streamEntryQueue(request, clientId) {
  const encoder = new TextEncoder();
  const userAgent = request.headers.get("user-agent") || "";
  let closed = false;
  let intervalId = 0;

  const stream = new ReadableStream({
    start(controller) {
      const startedAt = Date.now();
      let lastPayload = "";

      const send = (event, data) => {
        if (closed) return;
        controller.enqueue(encoder.encode(sseMessage(event, data)));
      };

      const tick = () => {
        if (closed) return;
        const result = joinEntryQueue(clientId, { userAgent });
        const payload = JSON.stringify(result);
        if (payload !== lastPayload || result.status === "admitted") {
          lastPayload = payload;
          send("queue", result);
        } else {
          send("heartbeat", { ok: true, checkedAt: new Date().toISOString() });
        }
        if (result.status === "admitted" || Date.now() - startedAt >= STREAM_MAX_DURATION_MS) {
          closed = true;
          clearInterval(intervalId);
          controller.close();
        }
      };

      const abort = () => {
        closed = true;
        clearInterval(intervalId);
        try { controller.close(); } catch {}
      };

      request.signal?.addEventListener("abort", abort, { once: true });
      send("open", { ok: true, streamIntervalMs: STREAM_INTERVAL_MS });
      tick();
      intervalId = setInterval(tick, STREAM_INTERVAL_MS);
    },
    cancel() {
      closed = true;
      clearInterval(intervalId);
    }
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-store, no-transform",
      "Connection": "keep-alive",
      "X-Accel-Buffering": "no"
    }
  });
}

export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const clientId = searchParams.get("clientId") || "";
  if (!clientId) {
    return NextResponse.json({ ok: true, status: "stats", ...entryQueueStats() });
  }

  if (searchParams.get("stream") === "1" && STREAM_ENABLED) {
    return streamEntryQueue(request, clientId);
  }

  const result = joinEntryQueue(clientId, {
    userAgent: request.headers.get("user-agent") || ""
  });
  const status = result.status === "full" ? 429 : 200;
  return NextResponse.json(result, { status });
}

export async function POST(request) {
  const body = await request.json().catch(() => ({}));
  const clientId = body?.clientId || "";
  const token = body?.token || "";
  return NextResponse.json({
    ok: true,
    ...releaseEntryQueue(clientId, token)
  });
}
