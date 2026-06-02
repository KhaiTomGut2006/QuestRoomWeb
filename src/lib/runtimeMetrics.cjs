const { monitorEventLoopDelay } = require("node:perf_hooks");

const MAX_LATENCY_SAMPLES = 1000;
const eventLoopDelay = monitorEventLoopDelay({ resolution: 20 });
eventLoopDelay.enable();

const startedAt = new Date();
const httpRoutes = new Map();
const socketIncoming = new Map();
const socketOutgoing = new Map();
const socketBroadcasts = new Map();
const socketDropped = new Map();
let activeSockets = 0;
let totalSocketConnections = 0;

function createStats() {
  return {
    count: 0,
    errors: 0,
    bytes: 0,
    latencySamples: []
  };
}

function getStats(map, key) {
  if (!map.has(key)) map.set(key, createStats());
  return map.get(key);
}

function percentile(values, ratio) {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * ratio))];
}

function round(value) {
  return Math.round((Number(value) || 0) * 100) / 100;
}

function summarize(stats) {
  const totalLatency = stats.latencySamples.reduce((sum, value) => sum + value, 0);
  return {
    count: stats.count,
    errors: stats.errors,
    bytes: stats.bytes,
    avgMs: round(stats.latencySamples.length ? totalLatency / stats.latencySamples.length : 0),
    p50Ms: round(percentile(stats.latencySamples, 0.5)),
    p95Ms: round(percentile(stats.latencySamples, 0.95)),
    p99Ms: round(percentile(stats.latencySamples, 0.99))
  };
}

function mapSummary(map) {
  return Object.fromEntries(
    [...map.entries()]
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, stats]) => [key, summarize(stats)])
  );
}

function normalizeHttpPath(url = "") {
  const pathname = String(url).split("?")[0] || "/";
  return pathname
    .replace(/\/api\/player\/npc-quest\/upload\/[^/]+$/, "/api/player/npc-quest/upload/:id")
    .slice(0, 180);
}

function estimateBytes(value) {
  if (value === undefined || value === null) return 0;
  if (Buffer.isBuffer(value)) return value.length;
  if (typeof value === "string") return Buffer.byteLength(value);
  try {
    return Buffer.byteLength(JSON.stringify(value));
  } catch {
    return 0;
  }
}

function recordLatency(stats, durationMs) {
  stats.latencySamples.push(durationMs);
  if (stats.latencySamples.length > MAX_LATENCY_SAMPLES) stats.latencySamples.shift();
}

function instrumentHttp(req, res) {
  const started = performance.now();
  const route = `${String(req.method || "GET").toUpperCase()} ${normalizeHttpPath(req.url)}`;
  const stats = getStats(httpRoutes, route);
  let responseBytes = 0;
  const originalWrite = res.write;
  const originalEnd = res.end;

  res.write = function metricsWrite(chunk, ...args) {
    responseBytes += estimateBytes(chunk);
    return originalWrite.call(this, chunk, ...args);
  };
  res.end = function metricsEnd(chunk, ...args) {
    responseBytes += estimateBytes(chunk);
    return originalEnd.call(this, chunk, ...args);
  };

  res.once("finish", () => {
    stats.count += 1;
    stats.bytes += responseBytes;
    if (Number(res.statusCode) >= 500) stats.errors += 1;
    recordLatency(stats, performance.now() - started);
  });
}

function recordSocketEvent(map, event, args) {
  const stats = getStats(map, String(event || "unknown").slice(0, 120));
  stats.count += 1;
  stats.bytes += estimateBytes(args);
}

function instrumentSocket(socket) {
  activeSockets += 1;
  totalSocketConnections += 1;
  socket.onAny((event, ...args) => recordSocketEvent(socketIncoming, event, args));
  socket.onAnyOutgoing((event, ...args) => recordSocketEvent(socketOutgoing, event, args));
  socket.once("disconnect", () => {
    activeSockets = Math.max(0, activeSockets - 1);
  });
}

function recordSocketDrop(event) {
  const stats = getStats(socketDropped, String(event || "unknown").slice(0, 120));
  stats.count += 1;
}

function recordSocketBroadcast(event, payload, recipients = 0) {
  const recipientCount = Math.max(0, Number(recipients) || 0);
  if (!recipientCount) return;
  const stats = getStats(socketBroadcasts, String(event || "unknown").slice(0, 120));
  stats.count += 1;
  stats.bytes += estimateBytes(payload) * recipientCount;
}

function roomSummary(rooms) {
  let retainedPlayers = 0;
  let onlinePlayers = 0;
  for (const room of rooms.values()) {
    retainedPlayers += room.size;
    for (const player of room.values()) {
      if (player.socketIds?.size) onlinePlayers += 1;
    }
  }
  return {
    rooms: rooms.size,
    retainedPlayers,
    onlinePlayers,
    offlineRetainedPlayers: Math.max(0, retainedPlayers - onlinePlayers)
  };
}

function snapshot({ rooms }) {
  const memory = process.memoryUsage();
  const delayToMs = (value) => Number.isFinite(value) ? round(value / 1e6) : 0;
  return {
    generatedAt: new Date().toISOString(),
    startedAt: startedAt.toISOString(),
    uptimeSeconds: round(process.uptime()),
    process: {
      pid: process.pid,
      node: process.version,
      memoryMb: {
        rss: round(memory.rss / 1024 / 1024),
        heapUsed: round(memory.heapUsed / 1024 / 1024),
        heapTotal: round(memory.heapTotal / 1024 / 1024),
        external: round(memory.external / 1024 / 1024)
      },
      eventLoopDelayMs: {
        min: delayToMs(eventLoopDelay.min),
        mean: delayToMs(eventLoopDelay.mean),
        max: delayToMs(eventLoopDelay.max),
        p95: delayToMs(eventLoopDelay.percentile(95)),
        p99: delayToMs(eventLoopDelay.percentile(99))
      }
    },
    mongo: mapSummary(globalThis.__questRoomMongoMetrics || new Map()),
    http: mapSummary(httpRoutes),
    socket: {
      activeConnections: activeSockets,
      totalConnections: totalSocketConnections,
      presence: roomSummary(rooms),
      incoming: mapSummary(socketIncoming),
      outgoing: mapSummary(socketOutgoing),
      broadcasts: mapSummary(socketBroadcasts),
      dropped: mapSummary(socketDropped)
    }
  };
}

module.exports = {
  instrumentHttp,
  instrumentSocket,
  recordSocketBroadcast,
  recordSocketDrop,
  snapshot
};
