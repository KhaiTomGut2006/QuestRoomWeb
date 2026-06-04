import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { getClassFriendsPage, getActiveClasses } from "@/lib/player";

export async function GET(request) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.discordId) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  try {
    const { searchParams } = new URL(request.url);
    const classId = searchParams.get("class");
    const limit = searchParams.get("limit");
    const cursor = searchParams.get("cursor");
    const search = searchParams.get("q");

    const [classes, friendsPage] = await Promise.all([
      getActiveClasses(),
      classId ? getClassFriendsPage(classId, { limit, cursor, search }) : { friends: [], nextCursor: "", hasMore: false }
    ]);

    // If a classId wasn't passed but we have active classes, load the first one by default
    let finalFriends = friendsPage.friends;
    let nextCursor = friendsPage.nextCursor;
    let hasMore = friendsPage.hasMore;
    let selectedClassId = classId;
    if (!classId && classes.length > 0) {
      selectedClassId = classes[0].sheetTitle;
      const defaultPage = await getClassFriendsPage(selectedClassId, { limit, cursor, search });
      finalFriends = defaultPage.friends;
      nextCursor = defaultPage.nextCursor;
      hasMore = defaultPage.hasMore;
    }

    return NextResponse.json({
      classes,
      friends: finalFriends,
      nextCursor,
      hasMore,
      defaultClassId: selectedClassId
    });
  } catch (error) {
    return NextResponse.json({ error: error.message }, { status: 503 });
  }
}
