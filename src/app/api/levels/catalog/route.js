import { NextResponse } from "next/server";
import { GAME_ITEM_CATALOG, GAME_NPC_CATALOG } from "@/lib/gameCatalog";

export async function GET() {
  return NextResponse.json(
    {
      success: true,
      items: GAME_ITEM_CATALOG,
      npcs: GAME_NPC_CATALOG
    },
    {
      headers: {
        "Cache-Control": "public, max-age=300, stale-while-revalidate=3600"
      }
    }
  );
}
