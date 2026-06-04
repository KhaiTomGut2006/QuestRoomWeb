import { NextResponse } from "next/server";
import { clearGlobalQuestPostsCache, refreshSocialPostIndex } from "@/lib/player";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization"
};

function isAuthorized(request) {
  const expectedToken = process.env.GAME_API_TOKEN || process.env.ADMIN_API_TOKEN || "";
  if (!expectedToken) return true;
  const header = request.headers.get("authorization") || "";
  return header === `Bearer ${expectedToken}`;
}

export async function OPTIONS() {
  return new Response(null, { status: 204, headers: CORS });
}

export async function POST(request) {
  if (!isAuthorized(request)) {
    return NextResponse.json({ success: false, error: "unauthorized" }, { status: 401, headers: CORS });
  }

  clearGlobalQuestPostsCache();
  const indexed = await refreshSocialPostIndex({ force: true });
  return NextResponse.json({ success: true, indexed }, { headers: CORS });
}
