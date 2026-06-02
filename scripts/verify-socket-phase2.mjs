import { io } from "socket.io-client";

const baseUrl = String(process.env.LOAD_BASE_URL || "http://localhost:3000").replace(/\/+$/, "");
const basePath = String(process.env.NEXT_PUBLIC_BASE_PATH || "").replace(/^\/+|\/+$/g, "");
const socketPath = `${basePath ? `/${basePath}` : ""}/socket.io`;
const metricsToken = String(process.env.METRICS_TOKEN || "");
const graceMs = Math.max(0, Number(process.env.SOCKET_PRESENCE_GRACE_MS) || 15_000);
const sockets = [];

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function waitForEvent(socket, event, predicate = () => true, timeoutMs = 5000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      socket.off(event, handler);
      reject(new Error(`Timed out waiting for ${event}`));
    }, timeoutMs);
    function handler(payload) {
      if (!predicate(payload)) return;
      clearTimeout(timer);
      socket.off(event, handler);
      resolve(payload);
    }
    socket.on(event, handler);
  });
}

async function connectPlayer({ id, stage, supportsSocketDeltaV2 }) {
  const socket = io(baseUrl, {
    path: socketPath,
    transports: ["websocket"],
    reconnection: false,
    timeout: 5000
  });
  sockets.push(socket);
  await waitForEvent(socket, "connect");
  const state = waitForEvent(socket, "room:state");
  socket.emit("player:join", {
    id,
    name: id,
    stage,
    x: 50,
    y: 70,
    supportsSocketDeltaV2
  });
  await state;
  return socket;
}

async function getMetrics() {
  const response = await fetch(`${baseUrl}/internal/metrics`, {
    headers: metricsToken ? { Authorization: `Bearer ${metricsToken}` } : {},
    signal: AbortSignal.timeout(5000)
  });
  assert(response.ok, `Metrics endpoint returned ${response.status}`);
  return response.json();
}

try {
  const protocolStage = "tutorial-room-phase2-protocol";
  const mover = await connectPlayer({ id: "phase2-mover", stage: protocolStage, supportsSocketDeltaV2: true });
  const deltaObserver = await connectPlayer({ id: "phase2-delta-observer", stage: protocolStage, supportsSocketDeltaV2: true });
  const legacyObserver = await connectPlayer({ id: "phase2-legacy-observer", stage: protocolStage, supportsSocketDeltaV2: false });

  const deltaEvent = waitForEvent(deltaObserver, "player:move-delta", (payload) => payload?.id === "phase2-mover");
  const legacyEvent = waitForEvent(legacyObserver, "player:upsert", (payload) => payload?.id === "phase2-mover");
  mover.emit("player:move", { x: 51, y: 70, action: "move" });
  const [deltaPayload, legacyPayload] = await Promise.all([deltaEvent, legacyEvent]);
  assert(!("achievements" in deltaPayload), "Delta payload unexpectedly contains achievements");
  assert(Array.isArray(legacyPayload.achievements), "Legacy payload lost achievements");

  for (let index = 0; index < 40; index += 1) {
    mover.emit("player:move", { x: 49 + (index % 3), y: 70, action: "move" });
  }
  await delay(200);
  const limitedMetrics = await getMetrics();
  assert((limitedMetrics.socket?.dropped?.["player:move"]?.count || 0) > 0, "Movement rate limit did not drop burst events");

  const presenceStage = "tutorial-room-phase2-presence";
  const presence = await connectPlayer({ id: "phase2-presence", stage: presenceStage, supportsSocketDeltaV2: true });
  presence.disconnect();
  await delay(Math.max(50, Math.floor(graceMs / 2)));
  const reconnect = await connectPlayer({ id: "phase2-presence", stage: presenceStage, supportsSocketDeltaV2: true });
  await delay(graceMs + 200);
  const reconnectedMetrics = await getMetrics();
  assert(reconnectedMetrics.socket.presence.onlinePlayers >= 4, "Reconnected player was removed during grace period");

  reconnect.disconnect();
  mover.disconnect();
  deltaObserver.disconnect();
  legacyObserver.disconnect();
  await delay(graceMs + 250);
  const finalMetrics = await getMetrics();
  assert(finalMetrics.socket.presence.retainedPlayers === 0, "Offline players remain after reconnect grace period");
  assert(finalMetrics.socket.presence.rooms === 0, "Empty rooms remain after reconnect grace period");

  console.log(JSON.stringify({
    ok: true,
    socketPath,
    graceMs,
    movementDeltaKeys: Object.keys(deltaPayload).sort(),
    legacyPayloadKeys: Object.keys(legacyPayload).sort(),
    droppedMovementEvents: limitedMetrics.socket.dropped["player:move"].count,
    finalPresence: finalMetrics.socket.presence
  }, null, 2));
} finally {
  for (const socket of sockets) socket.disconnect();
}
