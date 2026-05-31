import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { connectDb } from "@/lib/db";
import { getAccessory } from "@/lib/accessories";
import { normalizeMember } from "@/lib/player";
import Member from "@/models/Member";

export async function PATCH(request) {
  const session = await getServerSession(authOptions);
  const discordId = session?.user?.discordId;
  if (!discordId) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  try {
    const { accessoryId = "" } = await request.json();
    const normalizedAccessoryId = String(accessoryId || "");
    if (normalizedAccessoryId && !getAccessory(normalizedAccessoryId)) {
      return NextResponse.json({ error: "invalid_accessory" }, { status: 400 });
    }

    await connectDb();
    const member = await Member.findOne({ discord_id: String(discordId) });
    if (!member) return NextResponse.json({ error: "member_not_found" }, { status: 404 });

    if (
      normalizedAccessoryId &&
      !(member.ownedAccessories || []).map(String).includes(normalizedAccessoryId)
    ) {
      return NextResponse.json({ error: "accessory_not_owned" }, { status: 403 });
    }

    member.equippedAccessory = normalizedAccessoryId;
    await member.save({ validateModifiedOnly: true });
    return NextResponse.json({ member: normalizeMember(member) });
  } catch (error) {
    return NextResponse.json({ error: error.message }, { status: 503 });
  }
}
