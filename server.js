const { createServer } = require("node:http");
const os = require("node:os");
const { loadEnvConfig } = require("@next/env");
const next = require("next");
const { Server } = require("socket.io");
const mongoose = require("mongoose");
const { createHmac, timingSafeEqual } = require("node:crypto");

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

const rooms = new Map();
const playerStages = new Map();   // playerId → current stage (cross-socket tracking)
const socketToPlayer = new Map(); // socketId → playerId
const socketPlayerCoins = new Map(); // socketId → last client-synced balance for NPC offer sizing
const playerNpcQuest = new Map(); // playerId → bool (has active NPC quest)

// ─── NPC Cycle Timer (per-socket personal timers) ───────────────────
const CYCLE_MS = 20 * 60 * 1000;

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

// Attach dynamic data to certain NPC types before emitting
function enrichNpc(npc, availableCoins = 0) {
  const visitId = Date.now().toString(36) + Math.random().toString(36).slice(2);
  if (npc.type === "gambling") {
    const maxBet = Math.min(10000, Math.max(0, Math.floor(Number(availableCoins) || 0)));
    return { ...npc, visitId, betAmount: maxBet > 0 ? Math.floor(Math.random() * maxBet) + 1 : 0 };
  }
  if (npc.type === "shop") {
    const catalog = ["asset-ticket", "quest-scroll-normal", "quest-scroll-rare", "quest-scroll-epic", "chest-small", "chest-medium", "chest-large", "cooldown-minute", "cooldown-minute-lv2", "limit-break", "accessory-mrx", "accessory-mrx-red-eye", "accessory-mrx-glasses", "accessory-ppuk"];
    const offers = [...catalog].sort(() => Math.random() - 0.5).slice(0, 4);
    return { ...npc, visitId, offers };
  }
  return { ...npc, visitId };
}

// ─── Per-socket personal timer helpers ──────────────────────────────
// Called inside app.prepare() so `io` is in scope there; helpers are defined
// at module level but use socketPersonalTimer / socketFrozenMs which are.

function clearPersonalTimer(socketId) {
  const state = socketPersonalTimer.get(socketId);
  if (state?.timerId) clearTimeout(state.timerId);
  socketPersonalTimer.delete(socketId);
}

async function getMembersCollection() {
  if (!mongoUri) throw new Error("MONGODB_URI is not configured");
  if (mongoose.connection.readyState !== 1) {
    await mongoose.connect(mongoUri, {
      bufferCommands: false,
      dbName: mongoDbName
    });
  }
  return mongoose.connection.collection("members");
}

async function getPersistedNpcCycle(playerId) {
  const members = await getMembersCollection();
  return members.findOne(
    { discord_id: String(playerId || "") },
    { projection: { npcCycle: 1 } }
  );
}

async function setPersistedNpcCycle(playerId, npcCycle) {
  if (!playerId) return;
  const members = await getMembersCollection();
  await members.updateOne(
    { discord_id: String(playerId) },
    { $set: { npcCycle } }
  );
}

async function setPersistedPendingNpc(playerId, pendingNpc) {
  if (!playerId) return;
  const members = await getMembersCollection();
  await members.updateOne(
    { discord_id: String(playerId) },
    { $set: { "npcCycle.pendingNpc": pendingNpc || null } }
  );
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
    avatar: String(player.avatar || ""),
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
  return compactPlayer(player, Boolean(player.socketIds?.size));
}

app.prepare().then(() => {
  const httpServer = createServer((req, res) => handle(req, res));
  const io = new Server(httpServer, {
    path: `${basePath}/socket.io`,
    addTrailingSlash: false,
    cors: { origin: true },
    transports: ["websocket", "polling"]
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
    const timerId = setTimeout(() => {
      socketPersonalTimer.delete(socket.id);
      const pid = socketToPlayer.get(socket.id);
      if (pid && playerNpcQuest.get(pid)) {
        // Quest is active — freeze at the last 1 second until quest ends
        const frozenStartedAt = Date.now() - (fullCycle - 1000);
        socketFrozenMs.set(socket.id, 1000);
        socket.emit("timer:sync", { cycleStartedAt: frozenStartedAt, cycleDurationMs: fullCycle, frozen: true, frozenRemainingMs: 1000 });
      } else {
        socket.emit("npc:visit", enrichNpc(pickWeightedNpc(), socketPlayerCoins.get(socket.id)));
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
    socketPersonalTimer.delete(socket.id);
    if (playerNpcQuest.get(playerId)) {
      await freezePersistedCycle(socket, 1000);
      return;
    }

    const npc = enrichNpc(pickWeightedNpc(), socketPlayerCoins.get(socket.id));
    socket.emit("npc:visit", npc);
    await schedulePersistedCycle(socket, undefined, npc);
  }

  async function restorePersistedCycle(socket) {
    const playerId = socketToPlayer.get(socket.id);
    if (!playerId) return;
    const persisted = await getPersistedNpcCycle(playerId);
    const storedCycle = persisted?.npcCycle || null;
    if (storedCycle?.pendingNpc && !storedCycle.pendingNpc.visitId) {
      storedCycle.pendingNpc = enrichNpc(storedCycle.pendingNpc, socketPlayerCoins.get(socket.id));
      await setPersistedNpcCycle(playerId, storedCycle);
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

      const npc = enrichNpc(pickWeightedNpc(), socketPlayerCoins.get(socket.id));
      while (deadlineMs <= Date.now()) deadlineMs += durationMs;
      const nextCycle = {
        nextResetAt: new Date(deadlineMs),
        durationMs,
        pendingNpc: npc,
        frozenRemainingMs: null
      };
      await setPersistedNpcCycle(playerId, nextCycle);
      socket.emit("npc:visit", npc);
      armPersistedCycle(socket, nextCycle);
      return;
    }

    if (storedCycle.pendingNpc) socket.emit("npc:visit", storedCycle.pendingNpc);
    armPersistedCycle(socket, storedCycle);
  }
  // ────────────────────────────────────────────────────────────────

  io.on("connection", (socket) => {
    let activeStage = null;
    let activePlayerId = null;
    let lastReactionAt = 0;

    function detachPlayer({ removeIfOffline = false } = {}) {
      if (!activeStage || !activePlayerId) return;
      const room = getRoom(activeStage);
      const current = room.get(activePlayerId);
      if (!current) return;

      current.socketIds.delete(socket.id);
      if (removeIfOffline && current.socketIds.size === 0) {
        room.delete(activePlayerId);
        playerStages.delete(activePlayerId);
        socket.to(activeStage).emit("player:leave", activePlayerId);
        return;
      }

      const player = publicPlayer(current);
      room.set(activePlayerId, current);
      socket.to(activeStage).emit("player:upsert", player);
    }

    socket.on("player:join", async (payload = {}) => {
      const player = compactPlayer(payload);
      if (!player.id) return;

      // Track socket → player mapping
      socketToPlayer.set(socket.id, player.id);
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

      socket.emit("room:state", Array.from(room.values()).map(publicPlayer));
      socket.to(activeStage).emit("player:upsert", publicPlayer(room.get(activePlayerId)));
      if (activeStage.startsWith("tutorial-room-")) {
        clearPersonalTimer(socket.id);
        socketFrozenMs.delete(socket.id);
        return;
      }
      try {
        await restorePersistedCycle(socket);
      } catch (error) {
        console.error("Failed to restore NPC cycle:", error.message);
        await schedulePersistedCycle(socket, currentPersistedCycleDurationMs(socket.id));
      }
    });

    socket.on("room:peek", (payload = {}) => {
      const stage = String(payload.stage || "").trim().slice(0, 96);
      if (!stage) return;
      const room = rooms.get(stage);
      socket.emit("room:peek-state", {
        stage,
        players: room ? Array.from(room.values()).map(publicPlayer) : []
      });
    });

    socket.on("player:move", (payload = {}) => {
      if (!activeStage || !activePlayerId) return;
      const room = getRoom(activeStage);
      const current = room.get(activePlayerId);
      if (!current) return;
      const position = getWalkablePoint(payload);
      if (!position) return;

      const nextPlayer = compactPlayer({
        ...current,
        x: position.x,
        y: position.y,
        action: payload.action || "move"
      });

      room.set(activePlayerId, { ...current, ...nextPlayer });
      socket.to(activeStage).emit("player:upsert", publicPlayer(room.get(activePlayerId)));
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
    socket.on("quest:active", (isActive) => {
      const pid = socketToPlayer.get(socket.id);
      if (pid) playerNpcQuest.set(pid, Boolean(isActive));
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
    socket.on("dev:trigger", (payload = {}) => {
      if (!canUseDevCycleTools(payload)) return;
      const pid = socketToPlayer.get(socket.id);
      if (pid && playerNpcQuest.get(pid)) return;
      const specific = payload.npcId
        ? NPC_POOL.find((e) => e.npc.id === payload.npcId)?.npc
        : null;
      const npc = enrichNpc(specific || pickWeightedNpc(), socketPlayerCoins.get(socket.id));
      const state = socketPersonalTimer.get(socket.id);
      if (state) state.pendingNpc = npc;
      socket.emit("npc:visit", npc);
      void setPersistedPendingNpc(pid, npc).catch((error) => {
        console.error("Failed to persist dev NPC:", error.message);
      });
    });

    socket.on("dev:skip", (payload = {}) => {
      if (!canUseDevCycleTools(payload)) return;
      const pid = socketToPlayer.get(socket.id);
      if (!pid || !playerNpcQuest.get(pid)) {
        const npc = enrichNpc(pickWeightedNpc(), socketPlayerCoins.get(socket.id));
        socket.emit("npc:visit", npc);
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
      clearPersonalTimer(socket.id);
      socketFrozenMs.delete(socket.id);
      socketPermanentReductionMs.delete(socket.id);
      socketToPlayer.delete(socket.id);
      socketPlayerCoins.delete(socket.id);
      detachPlayer();
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
