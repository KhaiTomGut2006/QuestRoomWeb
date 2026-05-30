import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { getClassFriends, getActiveClasses } from "@/lib/player";

export async function GET(request) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.discordId) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  try {
    const { searchParams } = new URL(request.url);
    const classId = searchParams.get("class");

    const [classes, friends] = await Promise.all([
      getActiveClasses(),
      classId ? getClassFriends(classId) : []
    ]);

    // If a classId wasn't passed but we have active classes, load the first one by default
    let finalFriends = friends;
    let selectedClassId = classId;
    if (!classId && classes.length > 0) {
      selectedClassId = classes[0].sheetTitle;
      finalFriends = await getClassFriends(selectedClassId);
    }

    return NextResponse.json({
      classes,
      friends: finalFriends,
      defaultClassId: selectedClassId
    });
  } catch (error) {
    return NextResponse.json({ error: error.message }, { status: 503 });
  }
}
