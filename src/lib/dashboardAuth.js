import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";

export const dashboardCors = {
  "Access-Control-Allow-Origin": process.env.DASHBOARD_ALLOWED_ORIGIN || "*",
  "Access-Control-Allow-Methods": "GET, PUT, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Dashboard-Token"
};

function safeTokenEqual(left, right) {
  const leftBuffer = Buffer.from(String(left || ""));
  const rightBuffer = Buffer.from(String(right || ""));
  return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer);
}

export function requireDashboardWrite(request) {
  const configuredToken = String(process.env.DASHBOARD_API_TOKEN || "").trim();
  if (!configuredToken) return null;

  const authorization = String(request.headers.get("authorization") || "");
  const bearerToken = authorization.startsWith("Bearer ") ? authorization.slice(7).trim() : "";
  const suppliedToken = bearerToken || String(request.headers.get("x-dashboard-token") || "").trim();

  if (safeTokenEqual(configuredToken, suppliedToken)) return null;

  return NextResponse.json(
    { error: "unauthorized" },
    { status: 401, headers: dashboardCors }
  );
}
