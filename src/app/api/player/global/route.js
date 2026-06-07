import { NextResponse } from "next/server";
import {
  getActiveClasses,
  getGlobalQuestPosts,
  reactToGlobalQuestPost
} from "@/lib/player";
import { getPlayerDiscordId, getPlayerSession } from "@/lib/loadTestAuth";

export async function GET(request) {
  const session = await getPlayerSession(request);
  const discordId = getPlayerDiscordId(session);
  if (!discordId) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  try {
    const { searchParams } = new URL(request.url);
    const classId = searchParams.get("class") || "all";
    const [activeClasses, page] = await Promise.all([
      getActiveClasses(),
      getGlobalQuestPosts(classId, discordId, {
        limit: searchParams.get("limit"),
        cursor: searchParams.get("cursor")
      })
    ]);
    const classes = [
      { sheetTitle: "all", courseName: "All Courses" },
      ...activeClasses
    ];
    return NextResponse.json({
      classes,
      posts: page.posts,
      nextCursor: page.nextCursor,
      hasMore: page.hasMore,
      defaultClassId: classId
    });
  } catch (error) {
    return NextResponse.json({ error: error.message }, { status: 503 });
  }
}

export async function PATCH(request) {
  const session = await getPlayerSession(request);
  const discordId = getPlayerDiscordId(session);
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
