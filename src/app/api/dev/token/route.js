import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { canUseDevTools } from "@/lib/devTools";
import { createDevSocketToken } from "@/lib/devToken";

export async function GET() {
  const session = await getServerSession(authOptions);
  const discordId = session?.user?.discordId;
  if (!discordId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!canUseDevTools(discordId)) {
    return NextResponse.json({ error: "Dev tools are disabled or you are not allowed to use them." }, { status: 403 });
  }
  return NextResponse.json({ token: createDevSocketToken(discordId) });
}
