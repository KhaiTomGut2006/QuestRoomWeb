import { NextResponse } from "next/server";
import { entryQueueStats, joinEntryQueue, releaseEntryQueue } from "@/lib/entryQueue";

export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const clientId = searchParams.get("clientId") || "";
  if (!clientId) {
    return NextResponse.json({ ok: true, status: "stats", ...entryQueueStats() });
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
