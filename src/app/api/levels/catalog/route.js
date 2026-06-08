import { NextResponse } from "next/server";
import { GAME_ITEM_CATALOG, GAME_NPC_CATALOG } from "@/lib/gameCatalog";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
};

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS });
}

export async function GET() {
  return NextResponse.json(
    {
      success: true,
      items: GAME_ITEM_CATALOG,
      npcs: GAME_NPC_CATALOG
    },
    {
      headers: {
        ...CORS,
        "Cache-Control": "public, max-age=300, stale-while-revalidate=3600"
      }
    }
  );
}
