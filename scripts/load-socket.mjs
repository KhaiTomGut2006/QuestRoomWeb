import { io } from "socket.io-client";

const baseUrl = String(process.env.LOAD_BASE_URL || "http://localhost:3000").replace(/\/+$/, "");
const basePath = String(process.env.NEXT_PUBLIC_BASE_PATH || "").replace(/^\/+|\/+$/g, "");
const socketPath = `${basePath ? `/${basePath}` : ""}/socket.io`;
const clients = Math.max(1, Number(process.env.LOAD_SOCKET_CLIENTS) || 10);
const durationMs = Math.max(1000, Number(process.env.LOAD_DURATION_MS) || 10_000);
const joinRoom = process.env.LOAD_SOCKET_JOIN === "true";
const supportsSocketDeltaV2 = process.env.LOAD_SOCKET_DELTA_V2 === "true";
const movesPerSecond = Math.max(1, Number(process.env.LOAD_SOCKET_MOVES_PER_SECOND) || 2);
const sockets = [];
let connected = 0;
let errors = 0;
let moves = 0;

function createSocket(index) {
  const socket = io(baseUrl, {
    path: socketPath,
    transports: ["websocket"],
    reconnection: false,
    timeout: 5000
  });
  socket.on("connect", () => {
    connected += 1;
    if (!joinRoom) return;
    socket.emit("player:join", {
      id: `phase0-load-${index}`,
      name: `Load Test ${index}`,
      stage: "phase0-load-room",
      x: 50,
      y: 70,
      supportsSocketDeltaV2
    });
  });
  socket.on("connect_error", () => {
    errors += 1;
  });
  return socket;
}

for (let index = 0; index < clients; index += 1) sockets.push(createSocket(index));

const moveTimer = joinRoom
  ? setInterval(() => {
      for (const socket of sockets) {
        if (!socket.connected) continue;
        socket.emit("player:move", {
          x: 45 + Math.random() * 10,
          y: 65 + Math.random() * 10,
          action: "move"
        });
        moves += 1;
      }
    }, Math.max(50, Math.round(1000 / movesPerSecond)))
  : null;

await new Promise((resolve) => setTimeout(resolve, durationMs));
if (moveTimer) clearInterval(moveTimer);
for (const socket of sockets) socket.disconnect();

console.log(JSON.stringify({
  generatedAt: new Date().toISOString(),
  baseUrl,
  socketPath,
  clients,
  durationMs,
  joinRoom,
  supportsSocketDeltaV2,
  connected,
  errors,
  moves
}, null, 2));
if (errors) process.exitCode = 1;
