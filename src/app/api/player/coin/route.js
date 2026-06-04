import { NextResponse } from "next/server";
import { connectDb } from "@/lib/db";
import Member from "@/models/Member";

const COIN_QUERY_MAX_TIME_MS = Math.max(500, Number(process.env.COIN_QUERY_MAX_TIME_MS || 2_000));
const COIN_UPDATE_MAX_AMOUNT = Math.max(1, Number(process.env.COIN_UPDATE_MAX_AMOUNT || 1_000_000));
const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization"
};

function questCoinValue(member) {
  return Number.parseInt(member?.questCoin ?? "0", 10) || 0;
}

function questCoinExpression() {
  return {
    $convert: {
      input: { $ifNull: ["$questCoin", "0"] },
      to: "int",
      onError: 0,
      onNull: 0
    }
  };
}

function json(body, init = {}) {
  return NextResponse.json(body, {
    ...init,
    headers: {
      ...CORS,
      ...(init.headers || {})
    }
  });
}

function isAuthorized(request) {
  const expectedToken = process.env.GAME_API_TOKEN || process.env.ADMIN_API_TOKEN || "";
  const header = request.headers.get("authorization") || "";
  return Boolean(expectedToken && header === `Bearer ${expectedToken}`);
}

function parseDiscordId(source) {
  return String(source?.id || source?.discordId || source?.userId || "").trim();
}

function parseCoinAction(body) {
  const rawAction = String(body?.action || body?.operation || "").trim().toLowerCase();
  const delta = Number(body?.delta);
  const amount = Number(body?.amount ?? (Number.isFinite(delta) ? Math.abs(delta) : undefined));

  if (!Number.isSafeInteger(amount) || amount < 1 || amount > COIN_UPDATE_MAX_AMOUNT) {
    return { error: "invalid_amount" };
  }

  if (["add", "increase", "grant", "plus", "+"].includes(rawAction)) {
    return { action: "add", amount };
  }

  if (["subtract", "reduce", "decrease", "deduct", "minus", "-"].includes(rawAction)) {
    return { action: "subtract", amount };
  }

  if (!rawAction && Number.isFinite(delta) && delta !== 0) {
    return { action: delta > 0 ? "add" : "subtract", amount };
  }

  return { error: "invalid_action" };
}

export async function OPTIONS() {
  return new Response(null, { status: 204, headers: CORS });
}

export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url);
    const discordId = String(
      searchParams.get("id") || searchParams.get("discordId") || searchParams.get("userId") || ""
    ).trim();

    if (!discordId) {
      return json({ error: "discord_id_required" }, { status: 400 });
    }

    if (discordId.length > 128) {
      return json({ error: "invalid_discord_id" }, { status: 400 });
    }

    await connectDb();
    const member = await Member.findOne({ discord_id: discordId })
      .select("questCoin")
      .lean()
      .maxTimeMS(COIN_QUERY_MAX_TIME_MS);

    if (!member) {
      return json({ error: "member_not_found" }, { status: 404 });
    }

    return json(
      { questCoin: questCoinValue(member) },
      { headers: { "Cache-Control": "private, no-store" } }
    );
  } catch (error) {
    return json({ error: error.message }, { status: 503 });
  }
}

export async function POST(request) {
  if (!isAuthorized(request)) {
    return json({ error: "unauthorized" }, { status: 401 });
  }

  try {
    const body = await request.json().catch(() => ({}));
    const discordId = parseDiscordId(body);

    if (!discordId) {
      return json({ error: "discord_id_required" }, { status: 400 });
    }

    if (discordId.length > 128) {
      return json({ error: "invalid_discord_id" }, { status: 400 });
    }

    const parsed = parseCoinAction(body);
    if (parsed.error) {
      return json({ error: parsed.error }, { status: 400 });
    }

    await connectDb();
    const coinValue = questCoinExpression();
    const filter = parsed.action === "subtract"
      ? { discord_id: discordId, $expr: { $gte: [coinValue, parsed.amount] } }
      : { discord_id: discordId };
    const operator = parsed.action === "subtract" ? "$subtract" : "$add";

    const member = await Member.findOneAndUpdate(
      filter,
      [{ $set: { questCoin: { $toString: { [operator]: [coinValue, parsed.amount] } } } }],
      { new: true, projection: { questCoin: 1 }, lean: true }
    ).maxTimeMS(COIN_QUERY_MAX_TIME_MS);

    if (!member) {
      const exists = await Member.exists({ discord_id: discordId }).maxTimeMS(COIN_QUERY_MAX_TIME_MS);
      if (!exists) {
        return json({ error: "member_not_found" }, { status: 404 });
      }
      return json({ error: "not_enough_quest_coin" }, { status: 422 });
    }

    return json(
      { questCoin: questCoinValue(member) },
      { headers: { "Cache-Control": "private, no-store" } }
    );
  } catch (error) {
    return json({ error: error.message }, { status: 503 });
  }
}
