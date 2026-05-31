import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import {
  getActiveClasses,
  getGlobalQuestPosts,
  reactToGlobalQuestPost
} from "@/lib/player";

export async function GET(request) {
  const session = await getServerSession(authOptions);
  const discordId = session?.user?.discordId;
  if (!discordId) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  try {
    const { searchParams } = new URL(request.url);
    const classes = await getActiveClasses();
    const classId = searchParams.get("class") || classes[0]?.sheetTitle || "";
    const posts = classId ? await getGlobalQuestPosts(classId, discordId) : [];
    return NextResponse.json({ classes, posts, defaultClassId: classId });
  } catch (error) {
    return NextResponse.json({ error: error.message }, { status: 503 });
  }
}

export async function PATCH(request) {
  const session = await getServerSession(authOptions);
  const discordId = session?.user?.discordId;
  if (!discordId) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  try {
    const body = await request.json();
    const result = await reactToGlobalQuestPost(discordId, body?.postId, body?.reaction);
    if (!result) return NextResponse.json({ error: "post_not_found" }, { status: 404 });
    return NextResponse.json(result);
  } catch (error) {
    const status = error.message === "invalid_reaction" ? 400 : 503;
    return NextResponse.json({ error: error.message }, { status });
  }
}
