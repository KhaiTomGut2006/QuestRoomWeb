import { NextResponse } from "next/server";
import { authConfigured } from "@/lib/auth";
import { isDevToolsEnabled } from "@/lib/devTools";

export async function GET() {
  return NextResponse.json({
    authConfigured,
    demoGuestsEnabled: process.env.NEXT_PUBLIC_ENABLE_DEMO_GUESTS !== "false",
    dbConfigured: Boolean(process.env.MONGODB_URI),
    devToolsEnabled: isDevToolsEnabled(),
    devToolsRequireAuth: process.env.NODE_ENV === "production",
    devCycleToolsEnabled: isDevToolsEnabled()
  });
}
