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
const playerNpcQuest = new Map(); // playerId → bool (has active NPC quest)

// ─── NPC Cycle Timer ────────────────────────────────────────────────
const CYCLE_MS = 40 * 60 * 1000;

// Weighted NPC pool — weights sum to 100
const NPC_POOL = [
  { weight: 20, npc: { id: "chest",        type: "chest",       name: "Treasure Chest", npcId: null,    description: "สมบัติจากอีกโลก\nx20-200 Coins" } },
  { weight: 20, npc: { id: "shop",         type: "shop",        name: "Shop",           npcId: "milt",  description: "ขายสินค้า สุ่มราคา (ถูก-แพง) 3 ชิ้น" } },
  { weight: 20, npc: { id: "quest-easy",   type: "quest",       name: "Quest (Easy)",   npcId: "witch", description: "ภารกิจที่เกี่ยวข้องกับ Checkpoint ระดับง่าย\nx50-100 Coins" } },
  { weight: 15, npc: { id: "quest-medium", type: "quest",       name: "Quest (Medium)", npcId: "witch", description: "ภารกิจที่เกี่ยวข้องกับ Checkpoint ระดับกลาง\nx100-300 Coins" } },
  { weight: 10, npc: { id: "hints",        type: "hints",       name: "Hints",          npcId: "smith", description: "เสนอเมื่อต้องการความช่วยเหลือ" } },
  { weight: 5,  npc: { id: "quest-hard",   type: "quest",       name: "Quest (Hard)",   npcId: "witch", description: "ภารกิจที่เกี่ยวข้องกับ Checkpoint ระดับยาก\nx500-1,000 Coins" } },
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
function enrichNpc(npc) {
  if (npc.type === "gambling") {
    return { ...npc, betAmount: Math.floor(Math.random() * 9901) + 100 };
  }
  return npc;
}

let cycleStartedAt = Date.now();
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

  // ─── NPC Cycle Scheduler ────────────────────────────────────────
  function effectiveDuration() {
    return Math.max(1000, Math.floor(CYCLE_MS / cycleSpeedMultiplier));
  }

  function scheduleCycle() {
    if (cycleTimer) clearTimeout(cycleTimer);
    const dur = effectiveDuration();
    const elapsed = Date.now() - cycleStartedAt;
    const remaining = Math.max(500, dur - (elapsed % dur));

    cycleTimer = setTimeout(() => {
      // Each connected socket gets its own random NPC (skip players with active quest)
      for (const [, s] of io.sockets.sockets) {
        const pid = socketToPlayer.get(s.id);
        if (pid && playerNpcQuest.get(pid)) continue;
        s.emit("npc:visit", enrichNpc(pickWeightedNpc()));
      }
      cycleStartedAt = Date.now();
      io.emit("timer:sync", { cycleStartedAt, cycleDurationMs: effectiveDuration() });
      scheduleCycle();
    }, remaining);
  }
  scheduleCycle();
  // ────────────────────────────────────────────────────────────────

  io.on("connection", (socket) => {
    // Send current cycle state immediately on connect
    socket.emit("timer:sync", { cycleStartedAt, cycleDurationMs: CYCLE_MS });

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
      room.set(activePlayerId, { ...current, ...player, socketIds });
      socket.join(activeStage);

      socket.emit("room:state", Array.from(room.values()).map(publicPlayer));
      socket.to(activeStage).emit("player:upsert", publicPlayer(room.get(activePlayerId)));
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
    });
    // ─────────────────────────────────────────────────────────────

    // ─── Dev controls ────────────────────────────────────────────
    socket.on("dev:trigger", (payload = {}) => {
      const specific = payload.npcId
        ? NPC_POOL.find((e) => e.npc.id === payload.npcId)?.npc
        : null;
      socket.emit("npc:visit", enrichNpc(specific || pickWeightedNpc()));
    });

    socket.on("dev:skip", () => {
      for (const [, s] of io.sockets.sockets) {
        const pid = socketToPlayer.get(s.id);
        if (pid && playerNpcQuest.get(pid)) continue;
        s.emit("npc:visit", enrichNpc(pickWeightedNpc()));
      }
      cycleStartedAt = Date.now();
      io.emit("timer:sync", { cycleStartedAt, cycleDurationMs: effectiveDuration() });
      scheduleCycle();
    });

    socket.on("dev:reset", () => {
      cycleStartedAt = Date.now();
      io.emit("timer:sync", { cycleStartedAt, cycleDurationMs: effectiveDuration() });
      scheduleCycle();
    });

    socket.on("dev:set-speed", (multiplier) => {
      cycleSpeedMultiplier = Math.max(1, Number(multiplier) || 1);
      io.emit("timer:sync", { cycleStartedAt, cycleDurationMs: effectiveDuration() });
      scheduleCycle();
    });
    // ─────────────────────────────────────────────────────────────

    socket.on("disconnect", () => {
      socketToPlayer.delete(socket.id);
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
