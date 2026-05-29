import { NextResponse } from "next/server";
import { authConfigured } from "@/lib/auth";

export async function GET() {
  return NextResponse.json({
    authConfigured,
    demoGuestsEnabled: process.env.NEXT_PUBLIC_ENABLE_DEMO_GUESTS !== "false",
    dbConfigured: Boolean(process.env.MONGODB_URI)
  });
}
