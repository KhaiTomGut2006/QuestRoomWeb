const { createServer } = require("node:http");
const os = require("node:os");
const { loadEnvConfig } = require("@next/env");
const next = require("next");
const { Server } = require("socket.io");

loadEnvConfig(process.cwd());

const dev = process.env.NODE_ENV !== "production";
const hostname = process.env.HOSTNAME || "0.0.0.0";
const port = Number(process.env.PORT || 3000);
const rawBasePath = process.env.NEXT_PUBLIC_BASE_PATH || "";
const basePath = rawBasePath ? `/${rawBasePath.replace(/^\/+|\/+$/g, "")}` : "";
const app = next({ dev, hostname, port });
const handle = app.getRequestHandler();

const rooms = new Map();
const playerStages = new Map();   // playerId → current stage (cross-socket tracking)
const socketToPlayer = new Map(); // socketId → playerId
const socketPlayerCoins = new Map(); // socketId → last client-synced balance for NPC offer sizing
const playerNpcQuest = new Map(); // playerId → bool (has active NPC quest)

// ─── NPC Cycle Timer (per-socket personal timers) ───────────────────
const CYCLE_MS = 30 * 60 * 1000;

// socketId → { timerId, startedAt, durationMs }
const socketPersonalTimer = new Map();
// socketId → remainingMs when frozen
const socketFrozenMs = new Map();
// socketId → permanent reduction in ms (from cooldown purchases)
const socketPermanentReductionMs = new Map();

// Weighted NPC pool — weights sum to 100
const NPC_POOL = [
  { weight: 20, npc: { id: "chest",        type: "chest",       name: "Treasure Chest", npcId: null,    description: "สมบัติจากอีกโลก\nx20-200 Coins" } },
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
  if (npc.type === "gambling") {
    const maxBet = Math.min(10000, Math.max(0, Math.floor(Number(availableCoins) || 0)));
    return { ...npc, betAmount: maxBet > 0 ? Math.floor(Math.random() * maxBet) + 1 : 0 };
  }
  if (npc.type === "shop") {
    const catalog = ["quest-scroll-normal", "quest-scroll-rare", "quest-scroll-epic", "chest-small", "chest-medium", "chest-large", "cooldown-minute", "cooldown-minute-lv2", "limit-break"];
    const offers = [...catalog].sort(() => Math.random() - 0.5).slice(0, 4);
    return { ...npc, offers };
  }
  return npc;
}

// ─── Per-socket personal timer helpers ──────────────────────────────
// Called inside app.prepare() so `io` is in scope there; helpers are defined
// at module level but use socketPersonalTimer / socketFrozenMs which are.

function clearPersonalTimer(socketId) {
  const state = socketPersonalTimer.get(socketId);
  if (state?.timerId) clearTimeout(state.timerId);
  socketPersonalTimer.delete(socketId);
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
    stage: String(player.stage || "game-demo-1"),
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
      if (!pid || !playerNpcQuest.get(pid)) {
        socket.emit("npc:visit", enrichNpc(pickWeightedNpc(), socketPlayerCoins.get(socket.id)));
      }
      schedulePersonalCycle(socket, effectiveCycleMs(socket.id));
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
  // ────────────────────────────────────────────────────────────────

  io.on("connection", (socket) => {
    // Start personal 30-min cycle for this socket
    schedulePersonalCycle(socket, CYCLE_MS);

    let activeStage = null;
    let activePlayerId = null;

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

    socket.on("player:join", (payload = {}) => {
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
        if (payload.hasNpcQuest) {
          freezePersonalCycle(socket);
        }
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
      room.set(activePlayerId, { ...current, ...player, socketIds });
      socket.join(activeStage);

      socket.emit("room:state", Array.from(room.values()).map(publicPlayer));
      socket.to(activeStage).emit("player:upsert", publicPlayer(room.get(activePlayerId)));
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

    // ─── NPC Quest state sync ────────────────────────────────────
    socket.on("quest:active", (isActive) => {
      const pid = socketToPlayer.get(socket.id);
      if (pid) playerNpcQuest.set(pid, Boolean(isActive));
      if (isActive) {
        freezePersonalCycle(socket);
      } else {
        resumePersonalCycle(socket);
      }
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

    // ─── Dev controls ────────────────────────────────────────────
    socket.on("dev:trigger", (payload = {}) => {
      const pid = socketToPlayer.get(socket.id);
      if (pid && playerNpcQuest.get(pid)) return;
      const specific = payload.npcId
        ? NPC_POOL.find((e) => e.npc.id === payload.npcId)?.npc
        : null;
      socket.emit("npc:visit", enrichNpc(specific || pickWeightedNpc(), socketPlayerCoins.get(socket.id)));
    });

    socket.on("dev:skip", () => {
      const pid = socketToPlayer.get(socket.id);
      if (!pid || !playerNpcQuest.get(pid)) {
        socket.emit("npc:visit", enrichNpc(pickWeightedNpc(), socketPlayerCoins.get(socket.id)));
      }
      schedulePersonalCycle(socket, CYCLE_MS);
    });

    socket.on("dev:reset", () => {
      schedulePersonalCycle(socket, CYCLE_MS);
    });

    socket.on("dev:set-speed", (multiplier) => {
      cycleSpeedMultiplier = Math.max(1, Number(multiplier) || 1);
      // Restart personal cycle with new speed for this socket
      const frozen = socketFrozenMs.get(socket.id);
      if (frozen !== undefined) {
        // Update frozen remaining to use new speed (just re-emit frozen state)
        socket.emit("timer:sync", { 
          cycleStartedAt: Date.now() - (Math.floor(CYCLE_MS / cycleSpeedMultiplier) - frozen),
          cycleDurationMs: Math.floor(CYCLE_MS / cycleSpeedMultiplier),
          frozen: true, frozenRemainingMs: frozen
        });
      } else {
        const state = socketPersonalTimer.get(socket.id);
        const remaining = state ? Math.max(0, state.durationMs - (Date.now() - state.startedAt)) : CYCLE_MS;
        schedulePersonalCycle(socket, remaining);
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
        const fullCycle = Math.floor(effectiveCycleMs(socket.id) / cycleSpeedMultiplier);
        socket.emit("timer:sync", {
          cycleStartedAt: Date.now() - (fullCycle - remaining),
          cycleDurationMs: fullCycle,
          frozen: true, frozenRemainingMs: remaining
        });
      } else {
        const state = socketPersonalTimer.get(socket.id);
        if (state) {
          const remaining = Math.max(0, state.durationMs - (Date.now() - state.startedAt) - milliseconds);
          schedulePersonalCycle(socket, remaining);
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
