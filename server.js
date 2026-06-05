const { createServer } = require("node:http");
const os = require("node:os");
const { loadEnvConfig } = require("@next/env");
const next = require("next");
const { Server } = require("socket.io");
const mongoose = require("mongoose");
const { createHmac, timingSafeEqual } = require("node:crypto");
const { S3Client, GetObjectCommand } = require("@aws-sdk/client-s3");

loadEnvConfig(process.cwd());

const dev = process.env.NODE_ENV !== "production";
const productionDevToolsEnabled = process.env.ENABLE_DEV_TOOLS === "true"
  && String(process.env.DEV_TOOL_DISCORD_IDS || "").split(",").some((value) => value.trim());
const hostname = process.env.HOSTNAME || "0.0.0.0";
const port = Number(process.env.PORT || 3000);
const rawBasePath = process.env.NEXT_PUBLIC_BASE_PATH || "";
const basePath = rawBasePath ? `/${rawBasePath.replace(/^\/+|\/+$/g, "")}` : "";
const app = next({ dev, hostname, port });
const handle = app.getRequestHandler();
const mongoUri = process.env.MONGODB_URI;
const mongoDbName = process.env.MONGODB_DB || undefined;
let r2ReadClient = null;

const rooms = new Map();
const playerStages = new Map();   // playerId → current stage (cross-socket tracking)
const socketToPlayer = new Map(); // socketId → playerId
const socketPlayerCoins = new Map(); // socketId → last client-synced balance for NPC offer sizing
const playerNpcQuest = new Map(); // playerId → bool (has active NPC quest)
const MAX_ROOM_PLAYERS = Math.max(50, Number(process.env.MAX_ROOM_PLAYERS || 300));
const ROOM_STATE_LIMIT = Math.max(50, Number(process.env.ROOM_STATE_LIMIT || 200));
const ROOM_PATCH_INTERVAL_MS = 100;
const SOCKET_TRANSPORTS = process.env.SOCKET_ALLOW_POLLING === "true"
  ? ["websocket", "polling"]
  : ["websocket"];
const LEVEL_CONFIG_CACHE_TTL_MS = Math.max(30_000, Number(process.env.LEVEL_CONFIG_CACHE_TTL_MS || 300_000));
const NPC_CYCLE_RESTORE_ENABLED = process.env.NPC_CYCLE_RESTORE_ENABLED !== "false";
const NPC_CYCLE_RESTORE_JITTER_MS = Math.max(0, Number(process.env.NPC_CYCLE_RESTORE_JITTER_MS || 30_000));
const NPC_CYCLE_RESTORE_CACHE_TTL_MS = Math.max(1_000, Number(process.env.NPC_CYCLE_RESTORE_CACHE_TTL_MS || 15_000));
const NPC_CYCLE_RESTORE_CACHE_MAX = Math.max(100, Number(process.env.NPC_CYCLE_RESTORE_CACHE_MAX || 1_000));
const roomPatchBuffers = new Map();
const roomPatchTimers = new Map();
const levelConfigCache = new Map();
const npcCycleRestoreCache = new Map();
const socketCycleRestoreTimers = new Map();
const activeNpcVisits = globalThis.__questRoomActiveNpcVisits || new Map();
globalThis.__questRoomActiveNpcVisits = activeNpcVisits;
const SERVER_METRICS_INTERVAL_MS = Math.max(10_000, Number(process.env.SERVER_METRICS_INTERVAL_MS || 60_000));
const SERVER_METRICS_RSS_WARN_MB = Math.max(256, Number(process.env.SERVER_METRICS_RSS_WARN_MB || 1536));
const API_METRICS_MAX_ROUTES = Math.max(20, Number(process.env.API_METRICS_MAX_ROUTES || 120));
const API_METRICS_SAMPLE_SIZE = Math.max(20, Number(process.env.API_METRICS_SAMPLE_SIZE || 80));
const API_SLOW_REQUEST_MS = Math.max(250, Number(process.env.API_SLOW_REQUEST_MS || 1_500));
const API_STUCK_REQUEST_MS = Math.max(1_000, Number(process.env.API_STUCK_REQUEST_MS || 15_000));
const NODE_MAX_OLD_SPACE_MB = Math.max(512, Number(process.env.NODE_MAX_OLD_SPACE_MB || 1536));
const HEAP_GUARD_ENABLED = process.env.HEAP_GUARD_ENABLED !== "false";
const HEAP_GUARD_WARN_MB = Math.max(256, Number(process.env.HEAP_GUARD_WARN_MB || Math.floor(NODE_MAX_OLD_SPACE_MB * 0.72)));
const HEAP_GUARD_CRIT_MB = Math.max(HEAP_GUARD_WARN_MB + 64, Number(process.env.HEAP_GUARD_CRIT_MB || Math.floor(NODE_MAX_OLD_SPACE_MB * 0.88)));
const HEAP_GUARD_LOG_INTERVAL_MS = Math.max(1_000, Number(process.env.HEAP_GUARD_LOG_INTERVAL_MS || 5_000));
let lastMetricsCheckAt = Date.now();
let lastHeapGuardLogAt = 0;
const apiRouteStats = new Map();
const activeApiRequests = new Map();
let nextApiRequestId = 1;

function normalizeApiPath(reqUrl = "") {
  let pathname = "/";
  try {
    pathname = new URL(reqUrl || "/", "http://localhost").pathname;
  } catch {
    pathname = String(reqUrl || "/").split("?")[0] || "/";
  }
  const normalizedBasePath = basePath ? `${basePath}/` : "";
  if (normalizedBasePath && pathname.startsWith(normalizedBasePath)) {
    pathname = `/${pathname.slice(normalizedBasePath.length)}`;
  }
  return pathname.replace(/\/+/g, "/");
}

function isTrackedApiPath(pathname = "") {
  return pathname === "/api/health" || pathname.startsWith("/api/");
}

function currentHeapUsedMb(memory = process.memoryUsage()) {
  return Math.round(memory.heapUsed / 1024 / 1024);
}

function heapGuardSnapshot(memory = process.memoryUsage()) {
  const heapUsedMb = currentHeapUsedMb(memory);
  return {
    enabled: HEAP_GUARD_ENABLED,
    heapUsedMb,
    warnMb: HEAP_GUARD_WARN_MB,
    criticalMb: HEAP_GUARD_CRIT_MB,
    warning: heapUsedMb >= HEAP_GUARD_WARN_MB,
    critical: heapUsedMb >= HEAP_GUARD_CRIT_MB
  };
}

function logHeapGuard(snapshot, reason, pathname = "") {
  const now = Date.now();
  if (now - lastHeapGuardLogAt < HEAP_GUARD_LOG_INTERVAL_MS) return;
  lastHeapGuardLogAt = now;
  console.warn("[heap-guard]", JSON.stringify({
    reason,
    pathname,
    ...snapshot,
    runtime: collectRuntimeStats(process.memoryUsage(), 0)
  }));
}

function shouldShedRequest(pathname) {
  if (!HEAP_GUARD_ENABLED) return false;
  const snapshot = heapGuardSnapshot();
  if (!snapshot.critical) {
    if (snapshot.warning) logHeapGuard(snapshot, "warning", pathname);
    return false;
  }
  const normalizedPath = normalizeApiPath(pathname);
  const allowed =
    normalizedPath === "/api/health"
    || normalizedPath.startsWith("/_next/static/")
    || normalizedPath.startsWith("/assets/")
    || normalizedPath === "/favicon.ico";
  if (!allowed) logHeapGuard(snapshot, "shed-http", normalizedPath);
  return !allowed;
}

function sendOverloadedResponse(req, res, pathname) {
  const normalizedPath = normalizeApiPath(pathname || req.url || "");
  const isApi = normalizedPath.startsWith("/api/");
  res.statusCode = 503;
  res.setHeader("Retry-After", "5");
  res.setHeader("Cache-Control", "no-store");
  if (isApi) {
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    res.end(JSON.stringify({
      error: "server_busy",
      reason: "heap_guard",
      retryAfterSec: 5
    }));
    return;
  }
  res.setHeader("Content-Type", "text/plain; charset=utf-8");
  res.end("Quest Room is busy. Please retry in a few seconds.");
}

function shouldShedSocketConnection() {
  if (!HEAP_GUARD_ENABLED) return false;
  const snapshot = heapGuardSnapshot();
  if (!snapshot.critical) {
    if (snapshot.warning) logHeapGuard(snapshot, "warning-socket");
    return false;
  }
  logHeapGuard(snapshot, "shed-socket");
  return true;
}

function apiRouteStat(pathname) {
  if (!apiRouteStats.has(pathname)) {
    if (apiRouteStats.size >= API_METRICS_MAX_ROUTES) {
      const oldestKey = [...apiRouteStats.entries()]
        .sort(([, a], [, b]) => Number(a.lastAt || 0) - Number(b.lastAt || 0))[0]?.[0];
      if (oldestKey) apiRouteStats.delete(oldestKey);
    }
    apiRouteStats.set(pathname, {
      path: pathname,
      count: 0,
      inflight: 0,
      totalMs: 0,
      maxMs: 0,
      slowCount: 0,
      totalHeapDeltaMb: 0,
      maxHeapDeltaMb: 0,
      status2xx: 0,
      status3xx: 0,
      status4xx: 0,
      status5xx: 0,
      samples: [],
      lastStatus: 0,
      lastMs: 0,
      lastAt: 0
    });
  }
  return apiRouteStats.get(pathname);
}

function recordApiRequestStart(req) {
  const pathname = normalizeApiPath(req.url);
  if (!isTrackedApiPath(pathname)) return null;
  const id = nextApiRequestId++;
  const stat = apiRouteStat(pathname);
  stat.inflight += 1;
  activeApiRequests.set(id, {
    id,
    path: pathname,
    method: String(req.method || "GET").slice(0, 12),
    startedAt: Date.now(),
    startHeapUsed: process.memoryUsage().heapUsed
  });
  return id;
}

function recordApiRequestEnd(id, res) {
  if (!id) return;
  const active = activeApiRequests.get(id);
  if (!active) return;
  activeApiRequests.delete(id);

  const stat = apiRouteStat(active.path);
  const durationMs = Math.max(0, Date.now() - active.startedAt);
  const heapDeltaMb = Math.max(0, (process.memoryUsage().heapUsed - active.startHeapUsed) / 1024 / 1024);
  const statusCode = Number(res.statusCode) || 0;

  stat.count += 1;
  stat.inflight = Math.max(0, stat.inflight - 1);
  stat.totalMs += durationMs;
  stat.maxMs = Math.max(stat.maxMs, durationMs);
  stat.slowCount += durationMs >= API_SLOW_REQUEST_MS ? 1 : 0;
  stat.totalHeapDeltaMb += heapDeltaMb;
  stat.maxHeapDeltaMb = Math.max(stat.maxHeapDeltaMb, heapDeltaMb);
  stat.lastStatus = statusCode;
  stat.lastMs = durationMs;
  stat.lastAt = Date.now();
  stat.samples.push(durationMs);
  if (stat.samples.length > API_METRICS_SAMPLE_SIZE) stat.samples.shift();

  if (statusCode >= 500) stat.status5xx += 1;
  else if (statusCode >= 400) stat.status4xx += 1;
  else if (statusCode >= 300) stat.status3xx += 1;
  else if (statusCode >= 200) stat.status2xx += 1;
}

function percentile(values = [], percentileValue = 0.95) {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil(sorted.length * percentileValue) - 1));
  return sorted[index];
}

function publicApiMetrics() {
  const now = Date.now();
  const routes = [...apiRouteStats.values()]
    .map((stat) => ({
      path: stat.path,
      count: stat.count,
      inflight: stat.inflight,
      avgMs: stat.count ? Math.round(stat.totalMs / stat.count) : 0,
      p95Ms: Math.round(percentile(stat.samples, 0.95)),
      maxMs: Math.round(stat.maxMs),
      slowCount: stat.slowCount,
      avgHeapDeltaMb: stat.count ? Math.round((stat.totalHeapDeltaMb / stat.count) * 10) / 10 : 0,
      maxHeapDeltaMb: Math.round(stat.maxHeapDeltaMb * 10) / 10,
      status2xx: stat.status2xx,
      status3xx: stat.status3xx,
      status4xx: stat.status4xx,
      status5xx: stat.status5xx,
      lastStatus: stat.lastStatus,
      lastMs: Math.round(stat.lastMs),
      lastAt: stat.lastAt ? new Date(stat.lastAt).toISOString() : null
    }))
    .sort((a, b) => (
      b.inflight - a.inflight
      || b.slowCount - a.slowCount
      || b.count - a.count
      || b.maxMs - a.maxMs
    ))
    .slice(0, 20);
  const active = [...activeApiRequests.values()]
    .map((request) => ({
      id: request.id,
      path: request.path,
      method: request.method,
      ageMs: now - request.startedAt,
      startedAt: new Date(request.startedAt).toISOString(),
      stuck: now - request.startedAt >= API_STUCK_REQUEST_MS
    }))
    .sort((a, b) => b.ageMs - a.ageMs)
    .slice(0, 20);
  return {
    slowRequestMs: API_SLOW_REQUEST_MS,
    stuckRequestMs: API_STUCK_REQUEST_MS,
    trackedRoutes: apiRouteStats.size,
    activeCount: activeApiRequests.size,
    routes,
    active
  };
}

function collectRuntimeStats(memory = process.memoryUsage(), lagMs = 0) {
  const roomPlayerCount = Array.from(rooms.values()).reduce((sum, room) => sum + room.size, 0);
  return {
    rssMb: Math.round(memory.rss / 1024 / 1024),
    heapUsedMb: Math.round(memory.heapUsed / 1024 / 1024),
    externalMb: Math.round(memory.external / 1024 / 1024),
    lagMs,
    rooms: rooms.size,
    roomPlayers: roomPlayerCount,
    socketPersonalTimers: socketPersonalTimer.size,
    socketCycleRestoreTimers: socketCycleRestoreTimers.size,
    socketFrozen: socketFrozenMs.size,
    activeNpcVisits: activeNpcVisits.size,
    socketToPlayer: socketToPlayer.size,
    playerStages: playerStages.size,
    playerNpcQuest: playerNpcQuest.size,
    roomPatchBuffers: roomPatchBuffers.size,
    roomPatchTimers: roomPatchTimers.size,
    levelConfigCache: levelConfigCache.size,
    npcCycleRestoreCache: npcCycleRestoreCache.size,
    api: publicApiMetrics(),
    heapGuard: heapGuardSnapshot(memory),
    uptimeSec: Math.round(process.uptime()),
    checkedAt: new Date().toISOString()
  };
}

function publishRuntimeStats(memory, lagMs = 0) {
  globalThis.__questRoomRuntimeStats = collectRuntimeStats(memory, lagMs);
  return globalThis.__questRoomRuntimeStats;
}

globalThis.__questRoomCollectRuntimeStats = collectRuntimeStats;

// ─── NPC Cycle Timer (per-socket personal timers) ───────────────────
const CYCLE_MS = 30 * 60 * 1000;

// socketId → { timerId, startedAt, durationMs }
const socketPersonalTimer = new Map();
// socketId → remainingMs when frozen
const socketFrozenMs = new Map();
// socketId → permanent reduction in ms (from cooldown purchases)
const socketPermanentReductionMs = new Map();
const ACCESSORY_IDS = new Set(["accessory-mrx", "accessory-mrx-red-eye", "accessory-mrx-glasses", "accessory-ppuk"]);
const PLAYER_REACTIONS = new Set(["🥰", "😂", "😭", "🤓", "🖕🏿"]);

function canUseDevCycleTools(payload = {}) {
  if (dev) return true;
  if (!productionDevToolsEnabled) return false;

  const [encodedPayload, signature] = String(payload.devToken || "").split(".");
  if (!encodedPayload || !signature) return false;
  const expected = createHmac("sha256", String(process.env.NEXTAUTH_SECRET || ""))
    .update(encodedPayload)
    .digest("base64url");
  const actualBuffer = Buffer.from(signature);
  const expectedBuffer = Buffer.from(expected);
  if (actualBuffer.length !== expectedBuffer.length || !timingSafeEqual(actualBuffer, expectedBuffer)) return false;

  try {
    const token = JSON.parse(Buffer.from(encodedPayload, "base64url").toString("utf8"));
    return Boolean(token.discordId) && Number(token.expiresAt) > Date.now();
  } catch {
    return false;
  }
}

// Weighted NPC pool — weights sum to 100
const NPC_POOL = [
  { weight: 20, npc: { id: "chest",        type: "chest",       name: "Treasure Chest", npcId: null,    description: "สมบัติจากอีกโลก\nลุ้นรับ Coin หรือไอเท็มจาก Shop" } },
  { weight: 20, npc: { id: "shop",         type: "shop",        name: "Shop",           npcId: "milt",  description: "ขายสินค้า สุ่มราคา (ถูก-แพง) 3 ชิ้น" } },
  { weight: 20, npc: { id: "quest-easy",   type: "quest",       name: "Quest (Easy)",   npcId: "near",  description: "ภารกิจที่เกี่ยวข้องกับ Checkpoint ระดับง่าย\nx50-100 Coins" } },
  { weight: 15, npc: { id: "quest-medium", type: "quest",       name: "Quest (Medium)", npcId: "fact",  description: "ภารกิจที่เกี่ยวข้องกับ Checkpoint ระดับกลาง\nx100-300 Coins" } },
  { weight: 10, npc: { id: "hints",        type: "hints",       name: "Hints",          npcId: "smith", description: "เสนอเมื่อต้องการความช่วยเหลือ" } },
  { weight: 5,  npc: { id: "quest-hard",   type: "quest",       name: "Quest (Hard)",   npcId: "nite",  description: "ภารกิจที่เกี่ยวข้องกับ Checkpoint ระดับยาก\nx500-1,000 Coins" } },
  { weight: 5,  npc: { id: "stupid-quest", type: "stupid-quest",name: "Stupid Quest",   npcId: "dog",   description: "เควสที่โคตรน่าอาย\nx100-500 Coins" } },
  { weight: 5,  npc: { id: "gambling",     type: "gambling",    name: "Gambling",       npcId: "begger",description: "ลงทุน (หัว-ก้อย) ชนะได้ Coins\nx0-1,000 Coins" } },
];

function pickWeightedNpc() {
  const total = NPC_POOL.reduce((s, e) => s + e.weight, 0);
  let rand = Math.random() * total;
  for (const entry of NPC_POOL) {
    rand -= entry.weight;
    if (rand <= 0) return entry.npc;
  }
  return NPC_POOL[NPC_POOL.length - 1].npc;
}

async function getLevelConfig(stage, projection) {
  const stageKey = String(stage || "");
  const projectionKey = Object.keys(projection || {}).sort().join(",");
  const cacheKey = `${stageKey}:${projectionKey}`;
  const cached = levelConfigCache.get(cacheKey);
  if (cached && Date.now() - cached.loadedAt < LEVEL_CONFIG_CACHE_TTL_MS) {
    return cached.value;
  }

  await getMembersCollection();
  const value = await mongoose.connection.collection("levels").findOne(
    { stageId: String(stage || "") },
    { projection }
  );
  levelConfigCache.set(cacheKey, { value, loadedAt: Date.now() });
  return value;
}

async function pickWeightedNpcForStage(stage) {
  const level = await getLevelConfig(stage, { npcSpawns: 1 });
  const configuredPool = Array.isArray(level?.npcSpawns)
    ? level.npcSpawns
        .map((spawn) => ({
          weight: Math.max(0, Number(spawn.chance) || 0),
          npc: NPC_POOL.find((entry) => entry.npc.id === String(spawn.npcId || ""))?.npc
        }))
        .filter((entry) => entry.npc && entry.weight > 0)
    : [];
  if (!configuredPool.length) return pickWeightedNpc();

  const total = configuredPool.reduce((sum, entry) => sum + entry.weight, 0);
  let rand = Math.random() * total;
  for (const entry of configuredPool) {
    rand -= entry.weight;
    if (rand <= 0) return entry.npc;
  }
  return configuredPool[configuredPool.length - 1].npc;
}

// Attach dynamic data to certain NPC types before emitting
function enrichNpc(npc, availableCoins = 0, configuredShopItems = null) {
  const visitId = Date.now().toString(36) + Math.random().toString(36).slice(2);
  if (npc.type === "gambling") {
    const maxBet = Math.min(10000, Math.max(0, Math.floor(Number(availableCoins) || 0)));
    return { ...npc, visitId, betAmount: maxBet > 0 ? Math.floor(Math.random() * maxBet) + 1 : 0 };
  }
  if (npc.type === "shop") {
    const catalog = ["asset-ticket", "quest-scroll-normal", "quest-scroll-rare", "quest-scroll-epic", "chest-small", "chest-medium", "chest-large", "cooldown-minute", "cooldown-minute-lv2", "limit-break", "accessory-mrx", "accessory-mrx-red-eye", "accessory-mrx-glasses", "accessory-ppuk"];
    const configured = Array.isArray(configuredShopItems) && configuredShopItems.length
      ? configuredShopItems
      : null;
    const offers = configured
      ? pickConfiguredShopOffers(configured, 4)
      : [...catalog].sort(() => Math.random() - 0.5).slice(0, 4);
    const offerConfig = configured
      ? Object.fromEntries(configured.map((item) => [
          String(item.itemType || ""),
          {
            itemName: String(item.itemName || ""),
            chance: Math.max(0, Number(item.chance) || 0),
            cost: Math.max(0, Number(item.price) || 0),
            maxQty: Math.max(1, Number(item.maxQty) || 1)
          }
        ]))
      : {};
    return { ...npc, visitId, offers, offerConfig };
  }
  return { ...npc, visitId };
}

function pickConfiguredShopOffers(configured, maxOffers = 4) {
  const pool = configured
    .map((item) => ({
      itemType: String(item.itemType || ""),
      weight: Math.max(0, Number(item.chance) || 0)
    }))
    .filter((item) => item.itemType);
  const unique = new Map(pool.map((item) => [item.itemType, item]));
  const remaining = [...unique.values()];
  const offers = [];
  while (remaining.length && offers.length < maxOffers) {
    const total = remaining.reduce((sum, item) => sum + item.weight, 0);
    let roll = total > 0 ? Math.random() * total : Math.random() * remaining.length;
    let pickedIndex = remaining.length - 1;
    for (let index = 0; index < remaining.length; index += 1) {
      roll -= total > 0 ? remaining[index].weight : 1;
      if (roll <= 0) {
        pickedIndex = index;
        break;
      }
    }
    offers.push(remaining.splice(pickedIndex, 1)[0].itemType);
  }
  return offers;
}

function isShopNpc(npc) {
  return npc?.type === "shop" || npc?.id === "shop" || npc?.npcId === "milt";
}

function normalizeQuestActivePayload(payload) {
  if (typeof payload === "object" && payload !== null) {
    return {
      active: Boolean(payload.active),
      source: String(payload.source || "")
    };
  }
  return {
    active: Boolean(payload),
    source: ""
  };
}

// ─── Per-socket personal timer helpers ──────────────────────────────
// Called inside app.prepare() so `io` is in scope there; helpers are defined
// at module level but use socketPersonalTimer / socketFrozenMs which are.

function clearPersonalTimer(socketId) {
  const state = socketPersonalTimer.get(socketId);
  if (state?.timerId) clearTimeout(state.timerId);
  socketPersonalTimer.delete(socketId);
}

function clearCycleRestoreTimer(socketId) {
  const timerId = socketCycleRestoreTimers.get(socketId);
  if (timerId) clearTimeout(timerId);
  socketCycleRestoreTimers.delete(socketId);
}

function rememberActiveNpcVisit(playerId, npc) {
  const playerKey = String(playerId || "");
  const visitId = String(npc?.visitId || "");
  if (!playerKey || !visitId) return;
  activeNpcVisits.set(playerKey, {
    visitId,
    npc: { ...npc },
    rememberedAt: Date.now()
  });
}

function forgetActiveNpcVisit(playerId, visitId = "") {
  const playerKey = String(playerId || "");
  if (!playerKey) return;
  const current = activeNpcVisits.get(playerKey);
  if (!current) return;
  if (visitId && String(current.visitId || "") !== String(visitId)) return;
  activeNpcVisits.delete(playerKey);
}

function startServerMetricsLogger() {
  if (process.env.ENABLE_SERVER_METRICS === "false") return;
  setInterval(() => {
    const now = Date.now();
    const memory = process.memoryUsage();
    const rssMb = Math.round(memory.rss / 1024 / 1024);
    const heapUsedMb = Math.round(memory.heapUsed / 1024 / 1024);
    const lagMs = Math.max(0, now - lastMetricsCheckAt - SERVER_METRICS_INTERVAL_MS);
    lastMetricsCheckAt = now;
    const runtimeStats = publishRuntimeStats(memory, lagMs);

    if (rssMb < SERVER_METRICS_RSS_WARN_MB && heapUsedMb < HEAP_GUARD_WARN_MB && lagMs < 1000) return;
    console.warn("[server-metrics]", JSON.stringify(runtimeStats));
  }, SERVER_METRICS_INTERVAL_MS).unref?.();
}

publishRuntimeStats();
startServerMetricsLogger();

function isR2ReadConfigured() {
  return Boolean(
    process.env.R2_ACCOUNT_ID &&
    process.env.R2_ACCESS_KEY_ID &&
    process.env.R2_SECRET_ACCESS_KEY &&
    process.env.R2_BUCKET
  );
}

function getR2ReadClient() {
  if (r2ReadClient) return r2ReadClient;
  r2ReadClient = new S3Client({
    region: "auto",
    endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
    credentials: {
      accessKeyId: process.env.R2_ACCESS_KEY_ID,
      secretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
    },
  });
  return r2ReadClient;
}

function mediaHeaders(extra = {}) {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, HEAD, OPTIONS",
    "Access-Control-Allow-Headers": "Range, Content-Type",
    "Cache-Control": "public, max-age=31536000, immutable",
    ...extra
  };
}

async function handleR2MediaRequest(req, res) {
  if (req.method === "OPTIONS") {
    res.writeHead(204, mediaHeaders());
    res.end();
    return;
  }
  if (req.method !== "GET" && req.method !== "HEAD") {
    res.writeHead(405, mediaHeaders({ "Content-Type": "text/plain; charset=utf-8" }));
    res.end("Method not allowed");
    return;
  }
  if (!isR2ReadConfigured()) {
    res.writeHead(503, mediaHeaders({ "Content-Type": "text/plain; charset=utf-8" }));
    res.end("R2 is not configured");
    return;
  }

  const requestUrl = new URL(req.url || "/", "http://localhost");
  const key = decodeURIComponent(requestUrl.pathname.replace(/^\/+/, ""));
  if (!key.startsWith("npc-quests/") || key.includes("..")) {
    res.writeHead(404, mediaHeaders({ "Content-Type": "text/plain; charset=utf-8" }));
    res.end("Not found");
    return;
  }

  try {
    const object = await getR2ReadClient().send(new GetObjectCommand({
      Bucket: process.env.R2_BUCKET,
      Key: key,
      Range: req.headers.range
    }));
    const headers = mediaHeaders({
      "Content-Type": object.ContentType || "application/octet-stream",
      "ETag": object.ETag || "",
      "Accept-Ranges": "bytes"
    });
    if (object.ContentLength !== undefined) headers["Content-Length"] = String(object.ContentLength);
    if (object.ContentRange) headers["Content-Range"] = object.ContentRange;
    res.writeHead(object.ContentRange ? 206 : 200, headers);
    if (req.method === "HEAD") {
      res.end();
      return;
    }
    object.Body.pipe(res);
  } catch (error) {
    const status = error?.$metadata?.httpStatusCode === 404 || error?.name === "NoSuchKey" ? 404 : 502;
    res.writeHead(status, mediaHeaders({ "Content-Type": "text/plain; charset=utf-8" }));
    res.end(status === 404 ? "Not found" : "R2 read failed");
  }
}

async function getMembersCollection() {
  if (!mongoUri) throw new Error("MONGODB_URI is not configured");
  if (mongoose.connection.readyState !== 1) {
    await mongoose.connect(mongoUri, {
      bufferCommands: false,
      dbName: mongoDbName,
      maxPoolSize: Math.max(5, Number(process.env.MONGODB_MAX_POOL_SIZE || 20)),
      minPoolSize: Math.max(0, Number(process.env.MONGODB_MIN_POOL_SIZE || 0)),
      maxIdleTimeMS: Math.max(5_000, Number(process.env.MONGODB_MAX_IDLE_MS || 30_000)),
      serverSelectionTimeoutMS: Math.max(1_000, Number(process.env.MONGODB_SERVER_SELECTION_TIMEOUT_MS || 5_000)),
      socketTimeoutMS: Math.max(10_000, Number(process.env.MONGODB_SOCKET_TIMEOUT_MS || 45_000))
    });
  }
  return mongoose.connection.collection("members");
}

const NPC_QUEST_DIFFICULTY = {
  "quest-easy":   "easy",
  "quest-medium": "medium",
  "quest-hard":   "hard",
  "stupid-quest": "stupid",
};

async function pickQuestTemplateForNpc(npcId) {
  const difficulty = NPC_QUEST_DIFFICULTY[npcId];
  if (!difficulty) return null;
  try {
    await getMembersCollection();
    const templates = await mongoose.connection.collection("quest_templates")
      .find({ difficulty }, { projection: { _id: 0, title: 1, description: 1, difficulty: 1, rewardMin: 1, rewardMax: 1, npcCharacter: 1 } })
      .toArray();
    if (!templates.length) return null;
    const picked = templates[Math.floor(Math.random() * templates.length)];
    const rewardMin = Number(picked.rewardMin) || 50;
    const rewardMax = Number(picked.rewardMax) || 100;
    const reward = Math.round(rewardMin + Math.random() * (rewardMax - rewardMin));
    return { difficulty: picked.difficulty, title: picked.title, description: picked.description, reward, npcCharacter: picked.npcCharacter || null };
  } catch {
    return null;
  }
}

async function enrichNpcForStage(npc, availableCoins = 0, stage = "") {
  if (npc.type === "shop") {
    const level = await getLevelConfig(stage, { npcShop: 1 });
    return enrichNpc(npc, availableCoins, level?.npcShop || null);
  }
  if (npc.type === "quest" || npc.type === "stupid-quest") {
    const questData = await pickQuestTemplateForNpc(npc.id);
    const enriched = enrichNpc(npc, availableCoins);
    return questData ? { ...enriched, questData } : enriched;
  }
  return enrichNpc(npc, availableCoins);
}

function cloneNpcCycle(cycle) {
  if (!cycle) return null;
  return {
    ...cycle,
    nextResetAt: cycle.nextResetAt ? new Date(cycle.nextResetAt) : cycle.nextResetAt,
    pendingNpc: cycle.pendingNpc ? { ...cycle.pendingNpc } : cycle.pendingNpc
  };
}

function pruneNpcCycleRestoreCache(now = Date.now()) {
  for (const [playerId, cached] of npcCycleRestoreCache) {
    if (!cached || now - cached.loadedAt >= NPC_CYCLE_RESTORE_CACHE_TTL_MS) {
      npcCycleRestoreCache.delete(playerId);
    }
  }
  if (npcCycleRestoreCache.size <= NPC_CYCLE_RESTORE_CACHE_MAX) return;
  const overflow = npcCycleRestoreCache.size - NPC_CYCLE_RESTORE_CACHE_MAX;
  const oldestKeys = [...npcCycleRestoreCache.entries()]
    .sort(([, a], [, b]) => Number(a?.loadedAt || 0) - Number(b?.loadedAt || 0))
    .slice(0, overflow)
    .map(([key]) => key);
  for (const key of oldestKeys) npcCycleRestoreCache.delete(key);
}

async function getPersistedNpcCycle(playerId) {
  const playerKey = String(playerId || "");
  if (!playerKey) return null;
  const now = Date.now();
  pruneNpcCycleRestoreCache(now);
  const cached = npcCycleRestoreCache.get(playerKey);
  if (cached && now - cached.loadedAt < NPC_CYCLE_RESTORE_CACHE_TTL_MS) {
    return { npcCycle: cloneNpcCycle(cached.npcCycle) };
  }

  const members = await getMembersCollection();
  const result = await members.findOne(
    { discord_id: playerKey },
    { projection: { npcCycle: 1 } }
  );
  npcCycleRestoreCache.set(playerKey, {
    loadedAt: Date.now(),
    npcCycle: cloneNpcCycle(result?.npcCycle || null)
  });
  return result;
}

async function setPersistedNpcCycle(playerId, npcCycle) {
  const playerKey = String(playerId || "");
  if (!playerKey) return;
  if (!NPC_CYCLE_RESTORE_ENABLED) return;
  const members = await getMembersCollection();
  await members.updateOne(
    { discord_id: playerKey },
    { $set: { npcCycle } }
  );
  npcCycleRestoreCache.set(playerKey, {
    loadedAt: Date.now(),
    npcCycle: cloneNpcCycle(npcCycle || null)
  });
  pruneNpcCycleRestoreCache();
}

async function setPersistedPendingNpc(playerId, pendingNpc) {
  const playerKey = String(playerId || "");
  if (!playerKey) return;
  if (!NPC_CYCLE_RESTORE_ENABLED) return;
  const members = await getMembersCollection();
  await members.updateOne(
    { discord_id: playerKey },
    [
      {
        $set: {
          npcCycle: {
            $mergeObjects: [
              { $ifNull: ["$npcCycle", {}] },
              { pendingNpc: pendingNpc || null }
            ]
          }
        }
      }
    ]
  );
  const cached = npcCycleRestoreCache.get(playerKey);
  if (cached?.npcCycle) {
    cached.loadedAt = Date.now();
    cached.npcCycle.pendingNpc = pendingNpc || null;
  }
}

let cycleStartedAt = Date.now(); // kept for legacy compat, not used for per-socket logic
let cycleSpeedMultiplier = 1;   // dev: 1=normal, 10=10× faster, etc.
let cycleTimer = null;
// ────────────────────────────────────────────────────────────────────

const walkableFloorPolygon = [
  { x: 23, y: 59 },
  { x: 50, y: 38 },
  { x: 77, y: 59 },
  { x: 84, y: 69 },
  { x: 50, y: 91 },
  { x: 16, y: 69 }
];

function isPointInPolygon(point, polygon = walkableFloorPolygon) {
  let inside = false;

  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const xi = polygon[i].x;
    const yi = polygon[i].y;
    const xj = polygon[j].x;
    const yj = polygon[j].y;
    const intersects =
      yi > point.y !== yj > point.y &&
      point.x < ((xj - xi) * (point.y - yi)) / (yj - yi) + xi;

    if (intersects) inside = !inside;
  }

  return inside;
}

function getWalkablePoint(point) {
  const next = {
    x: Number(point?.x),
    y: Number(point?.y)
  };

  if (!Number.isFinite(next.x) || !Number.isFinite(next.y)) return null;
  return isPointInPolygon(next) ? next : null;
}

function getLanUrls() {
  return Object.values(os.networkInterfaces())
    .flat()
    .filter((net) => net && net.family === "IPv4" && !net.internal)
    .map((net) => `http://${net.address}:${port}`);
}

function getRoom(stage) {
  const key = String(stage || "game-demo-1");
  if (!rooms.has(key)) rooms.set(key, new Map());
  return rooms.get(key);
}

function displayAvatarUrl(url, size = 64) {
  const value = String(url || "");
  if (!value) return "";
  try {
    const parsed = new URL(value);
    const isDiscordAvatar =
      (parsed.hostname === "cdn.discordapp.com" || parsed.hostname === "media.discordapp.net")
      && parsed.pathname.startsWith("/avatars/");
    if (!isDiscordAvatar) return value;
    parsed.searchParams.set("size", String(size));
    return parsed.toString();
  } catch {
    return value;
  }
}

function pruneRoom(stage) {
  const key = String(stage || "");
  const room = rooms.get(key);
  if (!room) return;

  for (const [playerId, player] of room) {
    if (!player.socketIds?.size) {
      room.delete(playerId);
      playerStages.delete(playerId);
      playerNpcQuest.delete(playerId);
    }
  }

  if (room.size > MAX_ROOM_PLAYERS) {
    const playersByAge = Array.from(room.entries())
      .sort(([, a], [, b]) => Number(a.updatedAt || 0) - Number(b.updatedAt || 0));
    for (const [playerId, player] of playersByAge.slice(0, room.size - MAX_ROOM_PLAYERS)) {
      if (player.socketIds?.size) continue;
      room.delete(playerId);
      playerStages.delete(playerId);
      playerNpcQuest.delete(playerId);
    }
  }

  if (room.size === 0) rooms.delete(key);
}

function selectPublicRoomPlayers(room, focusId = "") {
  if (!room?.size) return [];
  let players = Array.from(room.values())
    .map(publicPlayerPresence)
    .filter((player) => player?.id);
  if (players.length <= ROOM_STATE_LIMIT && !focusId) return players;

  const focusIndex = players.findIndex((player) => player.id === focusId);
  if (focusIndex > 0) {
    const focusPlayer = players[focusIndex];
    players = [
      focusPlayer,
      ...players.slice(0, focusIndex),
      ...players.slice(focusIndex + 1)
    ];
  }
  return players.slice(0, ROOM_STATE_LIMIT);
}

function queueRoomPatch(io, stage, player, { volatile = true } = {}) {
  const key = String(stage || "");
  if (!key || !player?.id) return;

  let buffer = roomPatchBuffers.get(key);
  if (!buffer) {
    buffer = { players: new Map(), reliable: false };
    roomPatchBuffers.set(key, buffer);
  }
  buffer.players.set(player.id, player);
  buffer.reliable ||= !volatile;

  if (roomPatchTimers.has(key)) return;
  const timer = setTimeout(() => {
    roomPatchTimers.delete(key);
    const nextBuffer = roomPatchBuffers.get(key);
    roomPatchBuffers.delete(key);
    if (!nextBuffer?.players?.size) return;
    const patch = Array.from(nextBuffer.players.values()).filter((patchedPlayer) => patchedPlayer?.id);
    if (!patch.length) return;
    const target = io.to(key);
    if (nextBuffer.reliable) {
      target.emit("players:patch", patch);
    } else {
      target.volatile.emit("players:patch", patch);
    }
  }, ROOM_PATCH_INTERVAL_MS);
  roomPatchTimers.set(key, timer);
}

// Returns a non-overlapping spawn position for a joining player.
// Checks only against players who currently have an active socket (online).
function resolveSpawnPosition(proposed, room, excludeId) {
  const MIN_DIST = 4; // minimum distance between players (% units)

  function overlaps(pos) {
    for (const [id, p] of room) {
      if (id === excludeId) continue;
      if (!p.socketIds?.size) continue; // only avoid online players
      const dx = (p.x || 50) - pos.x;
      const dy = (p.y || 70) - pos.y;
      if (Math.sqrt(dx * dx + dy * dy) < MIN_DIST) return true;
    }
    return false;
  }

  if (!overlaps(proposed)) return proposed;

  // Try random offsets radiating outward from the proposed position
  for (let i = 0; i < 20; i++) {
    const angle = Math.random() * 2 * Math.PI;
    const dist = MIN_DIST + Math.random() * 12;
    const candidate = {
      x: proposed.x + Math.cos(angle) * dist,
      y: proposed.y + Math.sin(angle) * dist
    };
    if (isPointInPolygon(candidate) && !overlaps(candidate)) return candidate;
  }

  // Fallback: random walkable position anywhere on the floor
  for (let i = 0; i < 30; i++) {
    const candidate = { x: 26 + Math.random() * 48, y: 44 + Math.random() * 44 };
    if (isPointInPolygon(candidate) && !overlaps(candidate)) return candidate;
  }

  return proposed; // give up — keep original position
}

function compactPlayer(player, online = Boolean(player?.online)) {
  const position = getWalkablePoint(player) || { x: 50, y: 70 };
  const achievements = Array.isArray(player.achievements)
    ? player.achievements.slice(0, 12).map((achievement) => ({
        id: String(achievement?.id || "").slice(0, 64),
        label: String(achievement?.label || "Badge").slice(0, 64),
        sublabel: String(achievement?.sublabel || "").slice(0, 96),
        kind: String(achievement?.kind || "").slice(0, 32),
        icon: String(achievement?.icon || "").slice(0, 512)
      }))
    : [];
  return {
    id: String(player.id || ""),
    name: String(player.name || "Player").slice(0, 32),
    username: String(player.username || "").slice(0, 32),
    avatar: displayAvatarUrl(player.avatar),
    rank: String(player.rank || "Game Tester").slice(0, 48),
    achievements,
    equippedAccessory: ACCESSORY_IDS.has(String(player.equippedAccessory || "")) ? String(player.equippedAccessory) : "",
    stage: String(player.stage || "game-demo-1"),
    challengeFailureCount: Math.max(0, Number(player.challengeFailureCount) || 0),
    x: position.x,
    y: position.y,
    action: String(player.action || "idle").slice(0, 24),
    online,
    updatedAt: Date.now()
  };
}

function publicPlayer(player) {
  const compact = compactPlayer(player, Boolean(player.socketIds?.size));
  return {
    id: compact.id,
    name: compact.name,
    username: compact.username,
    avatar: compact.avatar,
    equippedAccessory: compact.equippedAccessory,
    stage: compact.stage,
    challengeFailureCount: compact.challengeFailureCount,
    x: compact.x,
    y: compact.y,
    action: compact.action,
    online: compact.online,
    updatedAt: compact.updatedAt
  };
}

function publicPlayerMovement(player) {
  const position = getWalkablePoint(player) || { x: 50, y: 70 };
  return {
    id: String(player?.id || ""),
    x: position.x,
    y: position.y,
    action: String(player?.action || "move").slice(0, 24),
    updatedAt: Date.now()
  };
}

function publicPlayerPresence(player) {
  const compact = compactPlayer(player, Boolean(player.socketIds?.size));
  return {
    id: compact.id,
    equippedAccessory: compact.equippedAccessory,
    stage: compact.stage,
    challengeFailureCount: compact.challengeFailureCount,
    x: compact.x,
    y: compact.y,
    action: compact.action,
    online: compact.online,
    updatedAt: compact.updatedAt
  };
}

app.prepare().then(() => {
  const httpServer = createServer((req, res) => {
    const pathname = new URL(req.url || "/", "http://localhost").pathname;
    if (shouldShedRequest(pathname)) {
      sendOverloadedResponse(req, res, pathname);
      return;
    }
    const apiRequestId = recordApiRequestStart(req);
    if (apiRequestId) {
      res.once("finish", () => recordApiRequestEnd(apiRequestId, res));
      res.once("close", () => recordApiRequestEnd(apiRequestId, res));
    }
    if (pathname.startsWith("/npc-quests/")) {
      void handleR2MediaRequest(req, res);
      return;
    }
    handle(req, res);
  });
  const io = new Server(httpServer, {
    path: `${basePath}/socket.io`,
    addTrailingSlash: false,
    cors: { origin: true },
    transports: SOCKET_TRANSPORTS
  });
  globalThis.__questRoomIo = io;
  io.use((socket, next) => {
    if (shouldShedSocketConnection()) {
      next(new Error("server_busy"));
      return;
    }
    next();
  });

  // ─── Per-socket personal NPC cycle ────────────────────────────
  // Returns the effective full-cycle duration for a socket (with permanent reductions)
  function effectiveCycleMs(socketId) {
    const reduction = socketPermanentReductionMs.get(socketId) || 0;
    return Math.max(60_000, CYCLE_MS - reduction); // minimum 1 minute
  }

  function schedulePersonalCycle(socket, remainingMs) {
    const fullCycle = Math.floor(effectiveCycleMs(socket.id) / cycleSpeedMultiplier);
    const dur = Math.max(1000, remainingMs !== undefined ? Math.floor(remainingMs / cycleSpeedMultiplier) : fullCycle);
    clearPersonalTimer(socket.id);
    const startedAt = Date.now() - (fullCycle - dur);
    const timerId = setTimeout(async () => {
      socketPersonalTimer.delete(socket.id);
      const pid = socketToPlayer.get(socket.id);
      if (pid && playerNpcQuest.get(pid)) {
        // Quest is active — freeze at the last 1 second until quest ends
        const frozenStartedAt = Date.now() - (fullCycle - 1000);
        socketFrozenMs.set(socket.id, 1000);
        socket.emit("timer:sync", { cycleStartedAt: frozenStartedAt, cycleDurationMs: fullCycle, frozen: true, frozenRemainingMs: 1000 });
      } else {
        emitNpcVisit(socket, pid, await enrichNpcForStage(await pickWeightedNpcForStage(playerStages.get(pid)), socketPlayerCoins.get(socket.id), playerStages.get(pid)));
        schedulePersonalCycle(socket, effectiveCycleMs(socket.id));
      }
    }, dur);
    socketPersonalTimer.set(socket.id, { timerId, startedAt, durationMs: fullCycle });
    socket.emit("timer:sync", { cycleStartedAt: startedAt, cycleDurationMs: fullCycle, frozen: false });
  }

  function freezePersonalCycle(socket) {
    const state = socketPersonalTimer.get(socket.id);
    if (!state) return;
    clearTimeout(state.timerId);
    socketPersonalTimer.delete(socket.id);
    const remainingMs = Math.max(0, state.durationMs - (Date.now() - state.startedAt));
    socketFrozenMs.set(socket.id, remainingMs);
    socket.emit("timer:sync", { cycleStartedAt: state.startedAt, cycleDurationMs: state.durationMs, frozen: true, frozenRemainingMs: remainingMs });
  }

  function resumePersonalCycle(socket) {
    const remaining = socketFrozenMs.get(socket.id);
    socketFrozenMs.delete(socket.id);
    schedulePersonalCycle(socket, remaining !== undefined ? remaining : effectiveCycleMs(socket.id));
  }

  function currentPersistedCycleDurationMs(socketId) {
    return Math.max(1000, Math.floor(effectiveCycleMs(socketId) / cycleSpeedMultiplier));
  }

  function emitNpcVisit(socket, playerId, npc) {
    rememberActiveNpcVisit(playerId, npc);
    socket.emit("npc:visit", npc);
  }

  function emitPersistedRunningTimer(socket, deadlineMs, durationMs) {
    const remainingMs = Math.max(0, deadlineMs - Date.now());
    socket.emit("timer:sync", {
      cycleStartedAt: Date.now() - Math.max(0, durationMs - remainingMs),
      cycleDurationMs: durationMs,
      frozen: false
    });
  }

  function emitPersistedFrozenTimer(socket, durationMs, frozenRemainingMs) {
    const remainingMs = Math.max(0, Number(frozenRemainingMs) || 0);
    socket.emit("timer:sync", {
      cycleStartedAt: Date.now() - Math.max(0, durationMs - remainingMs),
      cycleDurationMs: durationMs,
      frozen: true,
      frozenRemainingMs: remainingMs
    });
  }

  function armPersistedCycle(socket, npcCycle) {
    clearPersonalTimer(socket.id);
    const durationMs = Math.max(1000, Number(npcCycle?.durationMs) || currentPersistedCycleDurationMs(socket.id));
    const deadlineMs = new Date(npcCycle?.nextResetAt || Date.now() + durationMs).getTime();
    const remainingMs = Math.max(1000, deadlineMs - Date.now());
    const timerId = setTimeout(() => {
      void handlePersistedCycleElapsed(socket).catch((error) => {
        console.error("Failed to advance NPC cycle:", error.message);
      });
    }, remainingMs);
    socketPersonalTimer.set(socket.id, {
      timerId,
      deadlineMs,
      durationMs,
      pendingNpc: npcCycle?.pendingNpc || null
    });
    emitPersistedRunningTimer(socket, deadlineMs, durationMs);
  }

  async function schedulePersistedCycle(socket, remainingMs, pendingNpc = null) {
    const playerId = socketToPlayer.get(socket.id);
    if (!playerId) return;
    const durationMs = currentPersistedCycleDurationMs(socket.id);
    const waitMs = Math.max(1000, Number.isFinite(Number(remainingMs)) ? Number(remainingMs) : durationMs);
    const npcCycle = {
      nextResetAt: new Date(Date.now() + waitMs),
      durationMs,
      pendingNpc: pendingNpc || null,
      frozenRemainingMs: null
    };
    await setPersistedNpcCycle(playerId, npcCycle);
    armPersistedCycle(socket, npcCycle);
  }

  async function freezePersistedCycle(socket, remainingMs = 1000) {
    const playerId = socketToPlayer.get(socket.id);
    if (!playerId) return;
    const state = socketPersonalTimer.get(socket.id);
    clearPersonalTimer(socket.id);
    const durationMs = state?.durationMs || currentPersistedCycleDurationMs(socket.id);
    const frozenRemainingMs = Math.max(0, Number(remainingMs) || 0);
    socketFrozenMs.set(socket.id, frozenRemainingMs);
    await setPersistedNpcCycle(playerId, {
      nextResetAt: null,
      durationMs,
      pendingNpc: state?.pendingNpc || null,
      frozenRemainingMs
    });
    emitPersistedFrozenTimer(socket, durationMs, frozenRemainingMs);
  }

  async function resumePersistedCycle(socket) {
    const remainingMs = socketFrozenMs.get(socket.id);
    socketFrozenMs.delete(socket.id);
    await schedulePersistedCycle(
      socket,
      remainingMs !== undefined ? remainingMs : currentPersistedCycleDurationMs(socket.id)
    );
  }

  async function handlePersistedCycleElapsed(socket) {
    const playerId = socketToPlayer.get(socket.id);
    if (!playerId) return;
    if (playerNpcQuest.get(playerId)) {
      await freezePersistedCycle(socket, 1000);
      return;
    }
    socketPersonalTimer.delete(socket.id);

    const npc = await enrichNpcForStage(await pickWeightedNpcForStage(playerStages.get(playerId)), socketPlayerCoins.get(socket.id), playerStages.get(playerId));
    emitNpcVisit(socket, playerId, npc);
    await schedulePersistedCycle(socket, undefined, npc);
  }

  async function restorePersistedCycle(socket) {
    const playerId = socketToPlayer.get(socket.id);
    if (!playerId) return;
    const persisted = await getPersistedNpcCycle(playerId);
    const storedCycle = persisted?.npcCycle || null;
    if (storedCycle?.pendingNpc && !storedCycle.pendingNpc.visitId) {
      storedCycle.pendingNpc = await enrichNpcForStage(storedCycle.pendingNpc, socketPlayerCoins.get(socket.id), playerStages.get(playerId));
      void setPersistedNpcCycle(playerId, storedCycle).catch((error) => {
        console.error("Failed to persist enriched NPC cycle:", error.message);
      });
    }
    const durationMs = Math.max(1000, Number(storedCycle?.durationMs) || currentPersistedCycleDurationMs(socket.id));
    const frozenRemainingMs = storedCycle?.frozenRemainingMs;

    if (frozenRemainingMs !== null && frozenRemainingMs !== undefined) {
      if (playerNpcQuest.get(playerId)) {
        socketFrozenMs.set(socket.id, Number(frozenRemainingMs) || 0);
        emitPersistedFrozenTimer(socket, durationMs, frozenRemainingMs);
        return;
      }
      socketFrozenMs.set(socket.id, Number(frozenRemainingMs) || 0);
      await resumePersistedCycle(socket);
      return;
    }

    if (!storedCycle?.nextResetAt) {
      const randomRemainingMs = Math.max(1000, Math.floor(Math.random() * currentPersistedCycleDurationMs(socket.id)));
      await schedulePersistedCycle(socket, randomRemainingMs);
      return;
    }

    let deadlineMs = new Date(storedCycle.nextResetAt).getTime();
    if (deadlineMs <= Date.now()) {
      if (playerNpcQuest.get(playerId)) {
        socketPersonalTimer.set(socket.id, {
          durationMs,
          pendingNpc: storedCycle.pendingNpc || null
        });
        await freezePersistedCycle(socket, 1000);
        return;
      }

      const npc = await enrichNpcForStage(await pickWeightedNpcForStage(playerStages.get(playerId)), socketPlayerCoins.get(socket.id), playerStages.get(playerId));
      while (deadlineMs <= Date.now()) deadlineMs += durationMs;
      const nextCycle = {
        nextResetAt: new Date(deadlineMs),
        durationMs,
        pendingNpc: npc,
        frozenRemainingMs: null
      };
      await setPersistedNpcCycle(playerId, nextCycle);
      emitNpcVisit(socket, playerId, npc);
      armPersistedCycle(socket, nextCycle);
      return;
    }

    if (storedCycle.pendingNpc && (!playerNpcQuest.get(playerId) || isShopNpc(storedCycle.pendingNpc))) {
      emitNpcVisit(socket, playerId, storedCycle.pendingNpc);
    }
    armPersistedCycle(socket, storedCycle);
  }

  function scheduleNpcCycleRestore(socket) {
    clearCycleRestoreTimer(socket.id);
    const delayMs = Math.floor(Math.random() * (NPC_CYCLE_RESTORE_JITTER_MS + 1));
    const timerId = setTimeout(async () => {
      socketCycleRestoreTimers.delete(socket.id);
      if (!socket.connected || !socketToPlayer.has(socket.id)) return;
      try {
        await restorePersistedCycle(socket);
      } catch (error) {
        console.error("Failed to restore NPC cycle:", error.message);
        if (socket.connected && socketToPlayer.has(socket.id)) {
          await schedulePersistedCycle(socket, currentPersistedCycleDurationMs(socket.id)).catch((fallbackError) => {
            console.error("Failed to schedule fallback NPC cycle:", fallbackError.message);
          });
        }
      }
    }, delayMs);
    timerId.unref?.();
    socketCycleRestoreTimers.set(socket.id, timerId);
  }
  // ────────────────────────────────────────────────────────────────

  io.on("connection", (socket) => {
    let activeStage = null;
    let activePlayerId = null;
    let lastReactionAt = 0;
    let lastMoveAt = 0;

    function detachPlayer({ removeIfOffline = false } = {}) {
      if (!activeStage || !activePlayerId) return;
      const room = getRoom(activeStage);
      const current = room.get(activePlayerId);
      if (!current) return;

      current.socketIds.delete(socket.id);
      if (removeIfOffline && current.socketIds.size === 0) {
        socket.to(activeStage).emit("player:upsert", publicPlayer({ ...current, socketIds: new Set() }));
        room.delete(activePlayerId);
        playerStages.delete(activePlayerId);
        playerNpcQuest.delete(activePlayerId);
        pruneRoom(activeStage);
        return;
      }

      const player = publicPlayer(current);
      room.set(activePlayerId, current);
      socket.to(activeStage).emit("player:upsert", player);
    }

    socket.on("player:join", async (payload = {}) => {
      const player = compactPlayer(payload);
      if (!player.id) return;
      clearCycleRestoreTimer(socket.id);

      // Track socket → player mapping
      socketToPlayer.set(socket.id, player.id);
      socket.join(`player:${player.id}`);
      socketPlayerCoins.set(socket.id, Math.max(0, Number(payload.coins) || 0));
      // Restore permanent cooldown reduction from previous purchases
      const permReduction = Math.max(0, Number(payload.permanentReductionMs) || 0);
      socketPermanentReductionMs.set(socket.id, permReduction);
      // Restore active quest state if client reports it
      if (payload.hasNpcQuest !== undefined) {
        playerNpcQuest.set(player.id, Boolean(payload.hasNpcQuest));
      }

      // Remove player from old stage if they switched stage across socket reconnections
      const trackedStage = playerStages.get(player.id);
      if (trackedStage && trackedStage !== player.stage) {
        const oldRoom = getRoom(trackedStage);
        if (oldRoom.has(player.id)) {
          oldRoom.delete(player.id);
          io.to(trackedStage).emit("player:leave", player.id);
        }
      }
      playerStages.set(player.id, player.stage);

      if (activeStage && (activeStage !== player.stage || activePlayerId !== player.id)) {
        detachPlayer({ removeIfOffline: true });
        socket.leave(activeStage);
      }
      activeStage = player.stage;
      activePlayerId = player.id;

      pruneRoom(activeStage);
      const room = getRoom(activeStage);
      const current = room.get(activePlayerId);
      const socketIds = current?.socketIds || new Set();
      socketIds.add(socket.id);

      // Jitter spawn position to avoid stacking on top of other online players
      const spawnPos = resolveSpawnPosition(
        { x: player.x, y: player.y },
        room,
        activePlayerId
      );
      const spawnedPlayer = { ...player, x: spawnPos.x, y: spawnPos.y };

      room.set(activePlayerId, { ...current, ...spawnedPlayer, socketIds });
      socket.join(activeStage);

      const nextPublicPlayer = publicPlayer(room.get(activePlayerId));
      socket.emit("room:state", selectPublicRoomPlayers(room, activePlayerId));
      queueRoomPatch(io, activeStage, nextPublicPlayer, { volatile: false });
      if (activeStage.startsWith("tutorial-room-")) {
        clearPersonalTimer(socket.id);
        socketFrozenMs.delete(socket.id);
        return;
      }
      if (NPC_CYCLE_RESTORE_ENABLED) {
        scheduleNpcCycleRestore(socket);
      } else {
        schedulePersonalCycle(socket, effectiveCycleMs(socket.id));
      }
    });

    socket.on("room:peek", (payload = {}) => {
      const stage = String(payload.stage || "").trim().slice(0, 96);
      if (!stage) return;
      const room = rooms.get(stage);
      socket.emit("room:peek-state", {
        stage,
        players: selectPublicRoomPlayers(room)
      });
    });

    socket.on("player:move", (payload = {}) => {
      if (!activeStage || !activePlayerId) return;
      const now = Date.now();
      if (now - lastMoveAt < 90) return;
      const room = getRoom(activeStage);
      const current = room.get(activePlayerId);
      if (!current) return;
      const position = getWalkablePoint(payload);
      if (!position) return;
      if (Math.hypot((current.x || 0) - position.x, (current.y || 0) - position.y) < 0.15) return;
      lastMoveAt = now;

      const nextPlayer = compactPlayer({
        ...current,
        x: position.x,
        y: position.y,
        action: payload.action || "move"
      });

      room.set(activePlayerId, { ...current, ...nextPlayer });
      queueRoomPatch(io, activeStage, publicPlayerMovement(room.get(activePlayerId)));
    });

    socket.on("player:accessory", (payload = {}) => {
      if (!activeStage || !activePlayerId) return;
      const room = getRoom(activeStage);
      const current = room.get(activePlayerId);
      if (!current) return;
      const accessoryId = String(payload.accessoryId || "");
      if (accessoryId && !ACCESSORY_IDS.has(accessoryId)) return;

      room.set(activePlayerId, { ...current, equippedAccessory: accessoryId });
      io.to(activeStage).emit("player:upsert", publicPlayer(room.get(activePlayerId)));
    });

    socket.on("player:sync", (payload = {}) => {
      if (!activeStage || !activePlayerId) return;
      const room = getRoom(activeStage);
      const current = room.get(activePlayerId);
      if (!current) return;
      const nextPlayer = compactPlayer({
        ...current,
        id: activePlayerId,
        stage: activeStage,
        challengeFailureCount: payload.challengeFailureCount
      });
      room.set(activePlayerId, { ...current, ...nextPlayer });
      io.to(activeStage).emit("player:upsert", publicPlayer(room.get(activePlayerId)));
    });

    socket.on("player:reaction", (payload = {}) => {
      if (!activeStage || !activePlayerId) return;
      const emoji = String(payload.emoji || "");
      if (!PLAYER_REACTIONS.has(emoji)) return;
      const now = Date.now();
      if (now - lastReactionAt < 300) return;
      lastReactionAt = now;
      socket.to(activeStage).emit("player:reaction", {
        playerId: activePlayerId,
        emoji
      });
    });

    // ─── NPC Quest state sync ────────────────────────────────────
    socket.on("quest:active", (payload) => {
      const { active: isActive, source } = normalizeQuestActivePayload(payload);
      const pid = socketToPlayer.get(socket.id);
      if (pid) playerNpcQuest.set(pid, Boolean(isActive));
      if (pid && isActive && source !== "shop") {
        const state = socketPersonalTimer.get(socket.id);
        if (state) state.pendingNpc = null;
        forgetActiveNpcVisit(pid);
        void setPersistedPendingNpc(pid, null).catch((error) => {
          console.error("Failed to clear pending NPC after quest activation:", error.message);
        });
      }
      // Timer is not frozen on quest accept — it keeps counting.
      // Only resume if the timer was frozen at the last 1 second.
      if (!isActive && socketFrozenMs.has(socket.id)) {
        void resumePersistedCycle(socket).catch((error) => {
          console.error("Failed to resume NPC cycle:", error.message);
        });
      }
    });

    socket.on("npc:dismiss", () => {
      const pid = socketToPlayer.get(socket.id);
      const state = socketPersonalTimer.get(socket.id);
      if (state) state.pendingNpc = null;
      forgetActiveNpcVisit(pid);
      void setPersistedPendingNpc(pid, null).catch((error) => {
        console.error("Failed to dismiss persisted NPC:", error.message);
      });
    });

    socket.on("player:balance", (payload = {}) => {
      socketPlayerCoins.set(socket.id, Math.max(0, Number(payload.coins) || 0));
    });
    // ─── Challenge broadcast ──────────────────────────────────────────
    socket.on("challenge:announce", (payload = {}) => {
      if (!activeStage || !activePlayerId) return;
      const room = getRoom(activeStage);
      const player = room.get(activePlayerId);
      if (!player) return;
      io.to(activeStage).emit("challenge:announce", {
        playerName: player.name || "Player",
        stageName: String(payload.stageName || activeStage).slice(0, 64),
      });
    });    // ─────────────────────────────────────────────────────────────

    socket.on("social:publish", (payload = {}) => {
      if (!activePlayerId) return;
      const postId = String(payload.id || "").slice(0, 160);
      if (!postId) return;
      socket.broadcast.emit("social:notification", {
        id: postId,
        type: payload.type === "challenge" ? "challenge" : "npc-quest",
        title: String(payload.title || "NPC Quest").slice(0, 96),
        publishedAt: new Date().toISOString(),
        author: {
          id: activePlayerId,
          name: String(payload.authorName || "Player").slice(0, 48),
          username: String(payload.username || "").slice(0, 48)
        }
      });
    });

    // ─── Dev controls ────────────────────────────────────────────
    socket.on("dev:trigger", async (payload = {}) => {
      if (!canUseDevCycleTools(payload)) return;
      const pid = socketToPlayer.get(socket.id);
      if (pid && playerNpcQuest.get(pid)) return;
      const specific = payload.npcId
        ? NPC_POOL.find((e) => e.npc.id === payload.npcId)?.npc
        : null;
      const npc = await enrichNpcForStage(specific || await pickWeightedNpcForStage(playerStages.get(pid)), socketPlayerCoins.get(socket.id), playerStages.get(pid));
      const state = socketPersonalTimer.get(socket.id);
      if (state) state.pendingNpc = npc;
      emitNpcVisit(socket, pid, npc);
      void setPersistedPendingNpc(pid, npc).catch((error) => {
        console.error("Failed to persist dev NPC:", error.message);
      });
    });

    socket.on("dev:skip", async (payload = {}) => {
      if (!canUseDevCycleTools(payload)) return;
      const pid = socketToPlayer.get(socket.id);
      if (!pid || !playerNpcQuest.get(pid)) {
        const npc = await enrichNpcForStage(await pickWeightedNpcForStage(playerStages.get(pid)), socketPlayerCoins.get(socket.id), playerStages.get(pid));
        emitNpcVisit(socket, pid, npc);
        void schedulePersistedCycle(socket, undefined, npc).catch((error) => {
          console.error("Failed to skip NPC cycle:", error.message);
        });
        return;
      }
      void schedulePersistedCycle(socket).catch((error) => {
        console.error("Failed to skip NPC cycle:", error.message);
      });
    });

    socket.on("dev:reset", (payload = {}) => {
      if (!canUseDevCycleTools(payload)) return;
      const pendingNpc = socketPersonalTimer.get(socket.id)?.pendingNpc || null;
      void schedulePersistedCycle(socket, undefined, pendingNpc).catch((error) => {
        console.error("Failed to reset NPC cycle:", error.message);
      });
    });

    socket.on("dev:set-speed", (payload = {}) => {
      if (!canUseDevCycleTools(payload)) return;
      cycleSpeedMultiplier = Math.max(1, Number(payload.multiplier) || 1);
      // Restart personal cycle with new speed for this socket
      const frozen = socketFrozenMs.get(socket.id);
      if (frozen !== undefined) {
        void freezePersistedCycle(socket, frozen).catch((error) => {
          console.error("Failed to update frozen NPC cycle:", error.message);
        });
      } else {
        const state = socketPersonalTimer.get(socket.id);
        const remaining = state ? Math.max(0, state.deadlineMs - Date.now()) : undefined;
        void schedulePersistedCycle(socket, remaining, state?.pendingNpc || null).catch((error) => {
          console.error("Failed to update NPC cycle speed:", error.message);
        });
      }
    });

    socket.on("shop:reduce-cooldown", (payload = {}) => {
      const milliseconds = Math.min(10 * 60 * 1000, Math.max(0, Number(payload.milliseconds) || 0));
      if (!milliseconds) return;
      // Add to permanent reduction for this socket
      const current = socketPermanentReductionMs.get(socket.id) || 0;
      socketPermanentReductionMs.set(socket.id, current + milliseconds);
      // Also reduce the current running/frozen timer immediately
      if (socketFrozenMs.has(socket.id)) {
        const remaining = Math.max(0, socketFrozenMs.get(socket.id) - milliseconds);
        socketFrozenMs.set(socket.id, remaining);
        void freezePersistedCycle(socket, remaining).catch((error) => {
          console.error("Failed to reduce frozen NPC cycle:", error.message);
        });
      } else {
        const state = socketPersonalTimer.get(socket.id);
        if (state) {
          const remaining = Math.max(0, state.deadlineMs - Date.now() - milliseconds);
          void schedulePersistedCycle(socket, remaining, state.pendingNpc).catch((error) => {
            console.error("Failed to reduce NPC cycle:", error.message);
          });
        }
      }
    });
    // ─────────────────────────────────────────────────────────────

    socket.on("disconnect", () => {
      clearCycleRestoreTimer(socket.id);
      clearPersonalTimer(socket.id);
      socketFrozenMs.delete(socket.id);
      socketPermanentReductionMs.delete(socket.id);
      socketToPlayer.delete(socket.id);
      socketPlayerCoins.delete(socket.id);
      forgetActiveNpcVisit(activePlayerId);
      detachPlayer({ removeIfOffline: true });
    });
  });

  httpServer.listen(port, hostname, () => {
    console.log(`QuestRoomWeb ready on http://${hostname}:${port}`);
    console.log("Open on this computer: http://localhost:" + port + basePath);
    for (const url of getLanUrls()) {
      console.log("Open on your phone:    " + url + basePath);
    }
  });
});
