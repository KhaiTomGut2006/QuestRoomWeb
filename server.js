const { createServer } = require("node:http");
const os = require("node:os");
const next = require("next");
const { Server } = require("socket.io");

const dev = process.env.NODE_ENV !== "production";
const hostname = process.env.HOSTNAME || "0.0.0.0";
const port = Number(process.env.PORT || 3000);
const app = next({ dev, hostname, port });
const handle = app.getRequestHandler();

const rooms = new Map();
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

function compactPlayer(player) {
  const position = getWalkablePoint(player) || { x: 50, y: 70 };
  return {
    id: String(player.id || ""),
    name: String(player.name || "Player").slice(0, 32),
    avatar: String(player.avatar || ""),
    stage: String(player.stage || "game-demo-1"),
    x: position.x,
    y: position.y,
    action: String(player.action || "idle").slice(0, 24),
    updatedAt: Date.now()
  };
}

app.prepare().then(() => {
  const httpServer = createServer((req, res) => handle(req, res));
  const io = new Server(httpServer, {
    cors: { origin: true },
    transports: ["websocket", "polling"]
  });

  io.on("connection", (socket) => {
    let activeStage = null;
    let activePlayerId = null;

    socket.on("player:join", (payload = {}) => {
      const player = compactPlayer(payload);
      if (!player.id) return;

      if (activeStage) socket.leave(activeStage);
      activeStage = player.stage;
      activePlayerId = player.id;

      const room = getRoom(activeStage);
      room.set(activePlayerId, { ...player, socketId: socket.id });
      socket.join(activeStage);

      socket.emit("room:state", Array.from(room.values()).map(compactPlayer));
      socket.to(activeStage).emit("player:upsert", compactPlayer(player));
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

      room.set(activePlayerId, { ...nextPlayer, socketId: socket.id });
      socket.to(activeStage).emit("player:upsert", nextPlayer);
    });

    socket.on("disconnect", () => {
      if (!activeStage || !activePlayerId) return;
      const room = getRoom(activeStage);
      room.delete(activePlayerId);
      socket.to(activeStage).emit("player:leave", activePlayerId);
      if (room.size === 0) rooms.delete(activeStage);
    });
  });

  httpServer.listen(port, hostname, () => {
    console.log(`QuestRoomWeb ready on http://${hostname}:${port}`);
    console.log("Open on this computer: http://localhost:" + port);
    for (const url of getLanUrls()) {
      console.log("Open on your phone:    " + url);
    }
  });
});
