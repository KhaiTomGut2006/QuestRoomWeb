import { io } from "socket.io-client";
import os from "node:os";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

const BASE_URL = String(process.env.LOAD_TEST_BASE_URL || "http://127.0.0.1:3101").replace(/\/+$/, "");
const SCENARIOS = {
  normal: { users: 300, durationMs: 120_000, rampMs: 30_000, moveMinMs: 2_000, moveJitterMs: 4_000, reactionRate: 0.25, peekRate: 0.12, questRate: 0.08, hintRate: 0.05 },
  heavy: { users: 500, durationMs: 300_000, rampMs: 60_000, moveMinMs: 1_500, moveJitterMs: 3_000, reactionRate: 0.35, peekRate: 0.18, questRate: 0.12, hintRate: 0.08 },
  spike: { users: 800, durationMs: 180_000, rampMs: 20_000, moveMinMs: 1_000, moveJitterMs: 2_000, reactionRate: 0.4, peekRate: 0.25, questRate: 0.16, hintRate: 0.1 },
  "auth-heavy": { users: 300, durationMs: 300_000, rampMs: 60_000, moveMinMs: 1_500, moveJitterMs: 3_000, reactionRate: 0.3, peekRate: 0.16, questRate: 0.08, hintRate: 0.05, auth: true, socialRate: 0.08, rankingRate: 0.04, globalRate: 0.05, profileRate: 0.03, positionRate: 0.2 },
  "reaction-heavy": { users: 300, durationMs: 180_000, rampMs: 45_000, moveMinMs: 2_000, moveJitterMs: 4_000, reactionRate: 0.2, peekRate: 0.08, questRate: 0.04, hintRate: 0.03, auth: true, socialRate: 0.05, rankingRate: 0.02, globalRate: 0.08, profileRate: 0.02, positionRate: 0.08, socialPostReactionRate: 0.18 },
  soak: { users: 300, durationMs: 7_200_000, rampMs: 120_000, moveMinMs: 4_000, moveJitterMs: 8_000, reactionRate: 0.12, peekRate: 0.06, questRate: 0.03, hintRate: 0.02 },
  "upload-abuse": { users: 60, durationMs: 120_000, rampMs: 20_000, moveMinMs: 2_000, moveJitterMs: 4_000, reactionRate: 0.2, peekRate: 0.1, questRate: 0.05, hintRate: 0.03, uploadAbuse: true }
};
const SCENARIO_NAME = String(process.env.LOAD_TEST_SCENARIO || "normal").toLowerCase();
const SCENARIO = SCENARIOS[SCENARIO_NAME] || SCENARIOS.normal;
const USERS = Math.max(1, Number(process.env.LOAD_TEST_USERS || SCENARIO.users));
const DURATION_MS = Math.max(10_000, Number(process.env.LOAD_TEST_DURATION_MS || SCENARIO.durationMs));
const RAMP_MS = Math.max(1_000, Number(process.env.LOAD_TEST_RAMP_MS || SCENARIO.rampMs));
const OUTPUT_DIR = String(process.env.LOAD_TEST_OUTPUT_DIR || "outputs/load-tests");
const QUEUE_TRANSPORT = String(process.env.LOAD_TEST_QUEUE_TRANSPORT || "sse").toLowerCase();
const UPLOAD_ABUSE_ENABLED = process.env.LOAD_TEST_UPLOAD_ABUSE === "true" || Boolean(SCENARIO.uploadAbuse);
const GAME_API_TOKEN = String(process.env.LOAD_TEST_GAME_API_TOKEN || process.env.GAME_API_TOKEN || "");
const LOAD_TEST_AUTH_TOKEN = String(process.env.LOAD_TEST_AUTH_TOKEN || "");
const STAGES = String(process.env.LOAD_TEST_STAGES || "game-demo-1,game-demo-2,game-demo-3")
  .split(",")
  .map((value) => value.trim())
  .filter(Boolean);

const apiStats = new Map();
const socketStats = { connected: 0, connectError: 0, disconnected: 0, npcVisits: 0, roomStates: 0, patches: 0 };
const sockets = new Set();
const healthSamples = [];
const uploadAbuseResults = [];
const globalPostIds = [];
const startedAt = Date.now();
let basePath = "";
let stop = false;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function percentile(values, p) {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil(sorted.length * p) - 1))];
}

function apiPath(path) {
  return `${BASE_URL}${basePath}${path}`;
}

function statFor(name) {
  if (!apiStats.has(name)) {
    apiStats.set(name, { count: 0, ok: 0, fail: 0, totalMs: 0, maxMs: 0, samples: [] });
  }
  return apiStats.get(name);
}

async function requestJson(name, path, options = {}) {
  const stat = statFor(name);
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), options.timeoutMs || 8_000);
  const started = Date.now();
  try {
    const response = await fetch(apiPath(path), {
      cache: "no-store",
      signal: controller.signal,
      ...options.fetchOptions
    });
    await response.text();
    const ms = Date.now() - started;
    stat.count += 1;
    stat.totalMs += ms;
    stat.maxMs = Math.max(stat.maxMs, ms);
    stat.samples.push(ms);
    if (response.ok) stat.ok += 1;
    else stat.fail += 1;
    return response.ok;
  } catch {
    const ms = Date.now() - started;
    stat.count += 1;
    stat.fail += 1;
    stat.totalMs += ms;
    stat.maxMs = Math.max(stat.maxMs, ms);
    stat.samples.push(ms);
    return false;
  } finally {
    clearTimeout(timeoutId);
  }
}

async function requestJsonData(name, path, options = {}) {
  const stat = statFor(name);
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), options.timeoutMs || 8_000);
  const started = Date.now();
  try {
    const response = await fetch(apiPath(path), {
      cache: "no-store",
      signal: controller.signal,
      ...options.fetchOptions
    });
    const data = await response.json().catch(() => ({}));
    const ms = Date.now() - started;
    stat.count += 1;
    stat.totalMs += ms;
    stat.maxMs = Math.max(stat.maxMs, ms);
    stat.samples.push(ms);
    if (response.ok) stat.ok += 1;
    else stat.fail += 1;
    return { ok: response.ok, data };
  } catch {
    const ms = Date.now() - started;
    stat.count += 1;
    stat.fail += 1;
    stat.totalMs += ms;
    stat.maxMs = Math.max(stat.maxMs, ms);
    stat.samples.push(ms);
    return { ok: false, data: {} };
  } finally {
    clearTimeout(timeoutId);
  }
}

async function requestEntryQueue(clientId) {
  if (QUEUE_TRANSPORT !== "sse") {
    const result = await requestJsonData("entry-queue", `/api/entry-queue?clientId=${encodeURIComponent(clientId)}`);
    return {
      ok: result.ok,
      clientId,
      token: result.data?.admissionToken || result.data?.token || ""
    };
  }

  const stat = statFor("entry-queue-sse");
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 20_000);
  const started = Date.now();
  let buffer = "";

  try {
    const response = await fetch(apiPath(`/api/entry-queue?stream=1&clientId=${encodeURIComponent(clientId)}`), {
      cache: "no-store",
      signal: controller.signal
    });
    if (!response.ok || !response.body) throw new Error(`sse_failed_${response.status}`);
    const reader = response.body.getReader();
    let queueData = null;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += Buffer.from(value).toString("utf8");
      const queueBlocks = buffer.split("\n\n").filter((block) => block.includes("event: queue"));
      for (const block of queueBlocks) {
        const dataLine = block
          .split("\n")
          .find((line) => line.startsWith("data:"));
        if (!dataLine) continue;
        try {
          queueData = JSON.parse(dataLine.slice(5).trim());
        } catch {
          queueData = null;
        }
      }
      if (queueData?.status === "admitted") break;
    }
    const ms = Date.now() - started;
    stat.count += 1;
    stat.ok += queueData?.status === "admitted" ? 1 : 0;
    stat.fail += queueData?.status === "admitted" ? 0 : 1;
    stat.totalMs += ms;
    stat.maxMs = Math.max(stat.maxMs, ms);
    stat.samples.push(ms);
    return {
      ok: queueData?.status === "admitted",
      clientId,
      token: queueData?.admissionToken || queueData?.token || ""
    };
  } catch {
    const ms = Date.now() - started;
    stat.count += 1;
    stat.fail += 1;
    stat.totalMs += ms;
    stat.maxMs = Math.max(stat.maxMs, ms);
    stat.samples.push(ms);
    return { ok: false, clientId, token: "" };
  } finally {
    controller.abort();
    clearTimeout(timeoutId);
  }
}

async function requestRaw(name, path, options = {}) {
  const stat = statFor(name);
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), options.timeoutMs || 8_000);
  const started = Date.now();
  try {
    const response = await fetch(apiPath(path), {
      cache: "no-store",
      signal: controller.signal,
      ...options.fetchOptions
    });
    await response.text().catch(() => "");
    const ms = Date.now() - started;
    stat.count += 1;
    stat.totalMs += ms;
    stat.maxMs = Math.max(stat.maxMs, ms);
    stat.samples.push(ms);
    if (response.ok) stat.ok += 1;
    else stat.fail += 1;
    return { ok: response.ok, status: response.status, ms };
  } catch (error) {
    const ms = Date.now() - started;
    stat.count += 1;
    stat.fail += 1;
    stat.totalMs += ms;
    stat.maxMs = Math.max(stat.maxMs, ms);
    stat.samples.push(ms);
    return { ok: false, status: 0, ms, error: error?.message || "request_failed" };
  } finally {
    clearTimeout(timeoutId);
  }
}

async function detectBasePath() {
  for (const candidate of ["", "/questroom"]) {
    basePath = candidate;
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 3_000);
    try {
      const response = await fetch(apiPath("/api/health"), { signal: controller.signal, cache: "no-store" });
      if (response.ok) return;
    } catch {
      // Try next candidate.
    } finally {
      clearTimeout(timeoutId);
    }
  }
  basePath = "";
}

function loadtestPlayer(index) {
  const stage = STAGES[index % STAGES.length] || "game-demo-1";
  const position = randomWalkablePosition(index);
  return {
    id: `loadtest-${index}`,
    name: `Load Test ${index}`,
    username: `loadtest${index}`,
    avatar: "",
    equippedAccessory: "",
    stage,
    challengeFailureCount: 0,
    x: position.x,
    y: position.y,
    action: "idle",
    coins: 1000,
    hasNpcQuest: false,
    permanentReductionMs: 0,
    entryQueueClientId: `loadtest-client-${index}`,
    entryAdmissionToken: "loadtest-token"
  };
}

function randomWalkablePosition(seed = 1) {
  // Keep synthetic movement inside the room floor polygon to avoid validation noise.
  const x = 30 + ((seed * 17 + Math.floor(Math.random() * 100)) % 40);
  const y = 58 + ((seed * 13 + Math.floor(Math.random() * 100)) % 22);
  return { x, y };
}

function authHeaders(player) {
  if (!SCENARIO.auth || !LOAD_TEST_AUTH_TOKEN) return {};
  return {
    "x-load-test-token": LOAD_TEST_AUTH_TOKEN,
    "x-load-test-user-id": player.id
  };
}

function authOptionsFor(player, extra = {}) {
  return {
    ...extra,
    fetchOptions: {
      ...(extra.fetchOptions || {}),
      headers: {
        ...authHeaders(player),
        ...(extra.fetchOptions?.headers || {})
      }
    }
  };
}

function rememberGlobalPosts(posts = []) {
  for (const post of Array.isArray(posts) ? posts : []) {
    const id = String(post?.id || post?.postId || "");
    if (id && !globalPostIds.includes(id)) globalPostIds.push(id);
    if (globalPostIds.length > 500) globalPostIds.shift();
  }
}

function randomReactionValue() {
  const roll = Math.random();
  if (roll < 0.45) return "like";
  if (roll < 0.9) return "dislike";
  return "";
}

async function runUser(index) {
  await sleep(Math.floor((index / USERS) * RAMP_MS));
  const player = loadtestPlayer(index);

  const admission = await requestEntryQueue(player.entryQueueClientId);
  if (admission?.clientId) player.entryQueueClientId = admission.clientId;
  if (admission?.token) player.entryAdmissionToken = admission.token;
  await requestJson("config", "/api/config");
  await requestJson("levels", "/api/levels");
  if (SCENARIO.auth) {
    await requestJson("player-me", "/api/player/me", authOptionsFor(player));
    await requestJson("rooms", "/api/player/rooms", authOptionsFor(player));
    await requestJson("room", `/api/player/room?stage=${encodeURIComponent(player.stage)}`, authOptionsFor(player));
    await requestJson("social-status", "/api/player/social-status", authOptionsFor(player));
    const globalPage = await requestJsonData("global", "/api/player/global?class=all&limit=10", authOptionsFor(player));
    if (globalPage.ok) rememberGlobalPosts(globalPage.data?.posts);
  } else {
    await requestJson("room", `/api/player/room?stage=${encodeURIComponent(player.stage)}`);
  }

  const socket = io(BASE_URL, {
    path: `${basePath}/socket.io`,
    addTrailingSlash: false,
    transports: ["websocket"],
    reconnection: false,
    timeout: 8_000
  });
  sockets.add(socket);

  socket.on("connect", () => {
    socketStats.connected += 1;
    socket.emit("player:join", player);
    socket.emit("player:balance", { coins: player.coins });
    socket.emit("quest:active", { active: false, source: "" });
  });
  socket.on("connect_error", () => {
    socketStats.connectError += 1;
  });
  socket.on("disconnect", () => {
    socketStats.disconnected += 1;
  });
  socket.on("npc:visit", () => {
    socketStats.npcVisits += 1;
  });
  socket.on("room:state", () => {
    socketStats.roomStates += 1;
  });
  socket.on("players:patch", () => {
    socketStats.patches += 1;
  });

  const loopUntil = startedAt + DURATION_MS;
  while (!stop && Date.now() < loopUntil) {
    await sleep(SCENARIO.moveMinMs + Math.floor(Math.random() * SCENARIO.moveJitterMs));
    const { x, y } = randomWalkablePosition(index);
    socket.emit("player:move", { x, y, action: "move" });
    if (Math.random() < SCENARIO.reactionRate) socket.emit("player:reaction", { reaction: "😂" });
    if (Math.random() < SCENARIO.peekRate) socket.emit("room:peek", { stage: STAGES[(index + 1) % STAGES.length] || player.stage });
    if (Math.random() < SCENARIO.questRate) void requestJson("quest-templates", "/api/quest-templates?difficulty=easy");
    if (Math.random() < SCENARIO.hintRate) void requestJson("hint-templates", "/api/hint-templates");
    if (SCENARIO.auth && Math.random() < (SCENARIO.positionRate || 0)) {
      void requestJson("position", "/api/player/position", authOptionsFor(player, {
        fetchOptions: {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ position: { x, y } })
        }
      }));
    }
    if (SCENARIO.auth && Math.random() < (SCENARIO.socialRate || 0)) {
      void requestJson("social-status", "/api/player/social-status", authOptionsFor(player));
    }
    if (SCENARIO.auth && Math.random() < (SCENARIO.rankingRate || 0)) {
      void requestJson("ranking", `/api/player/ranking?stage=${encodeURIComponent(player.stage)}`, authOptionsFor(player));
    }
    if (SCENARIO.auth && Math.random() < (SCENARIO.globalRate || 0)) {
      void requestJsonData("global", "/api/player/global?class=all&limit=10", authOptionsFor(player)).then((result) => {
        if (result.ok) rememberGlobalPosts(result.data?.posts);
      });
    }
    if (SCENARIO.auth && globalPostIds.length && Math.random() < (SCENARIO.socialPostReactionRate || 0)) {
      const postId = globalPostIds[Math.floor(Math.random() * globalPostIds.length)];
      void requestJson("global-reaction", "/api/player/global", authOptionsFor(player, {
        fetchOptions: {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ postId, reaction: randomReactionValue() })
        }
      }));
    }
    if (SCENARIO.auth && Math.random() < (SCENARIO.profileRate || 0)) {
      void requestJson("profile", `/api/player/profile?id=${encodeURIComponent(player.id)}`, authOptionsFor(player));
    }
  }

  socket.disconnect();
  sockets.delete(socket);
}

async function runUploadAbuse() {
  if (!UPLOAD_ABUSE_ENABLED) return;
  if (!GAME_API_TOKEN) {
    uploadAbuseResults.push({ skipped: true, reason: "LOAD_TEST_GAME_API_TOKEN not set" });
    return;
  }
  const attempts = Math.max(5, Math.min(50, Math.floor(USERS / 5)));
  const body = new FormData();
  body.set("stageId", "game-demo-1");
  body.set("file", new Blob([new Uint8Array(3 * 1024 * 1024)], { type: "video/mp4" }), "oversized-load-test.mp4");
  await Promise.all(Array.from({ length: attempts }, async (_, index) => {
    await sleep(index * 250);
    const result = await requestRaw("upload-abuse-challenge-video", "/api/levels/challenge-video", {
      timeoutMs: 15_000,
      fetchOptions: {
        method: "POST",
        headers: { "x-game-api-token": GAME_API_TOKEN },
        body
      }
    });
    uploadAbuseResults.push(result);
  }));
}

async function sampleHealth() {
  while (!stop) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 3_000);
    try {
      const response = await fetch(apiPath("/api/health"), { signal: controller.signal, cache: "no-store" });
      const data = await response.json();
    healthSamples.push({
        at: Date.now() - startedAt,
        rssMb: data?.memory?.rssMb || 0,
        heapUsedMb: data?.memory?.heapUsedMb || 0,
        externalMb: data?.memory?.externalMb || 0,
        lagMs: data?.runtime?.lagMs || 0,
        sockets: data?.runtime?.socketToPlayer || 0,
        rooms: data?.runtime?.rooms || 0,
        roomPlayers: data?.runtime?.roomPlayers || 0,
        dbStatus: data?.db?.status || "unknown",
        dbPingMs: data?.db?.ping?.latencyMs ?? null,
        cpuLoad1: os.loadavg()[0],
        apiActiveCount: data?.runtime?.api?.activeCount || 0,
        entryQueueWaiting: data?.runtime?.entryQueue?.waiting || 0,
        entryQueueActive: data?.runtime?.entryQueue?.active || 0,
        pendingNpcPoolLoads: data?.runtime?.pendingNpcPoolLoads || 0,
        activeNpcVisits: data?.runtime?.activeNpcVisits || 0
      });
    } catch {
      healthSamples.push({ at: Date.now() - startedAt, error: "health_failed", cpuLoad1: os.loadavg()[0] });
    } finally {
      clearTimeout(timeoutId);
    }
    await sleep(5_000);
  }
}

function summarize() {
  const validHealth = healthSamples.filter((sample) => !sample.error);
  const max = (key) => Math.max(0, ...validHealth.map((sample) => Number(sample[key]) || 0));
  const last = validHealth.at(-1) || null;
  return {
    config: { scenario: SCENARIO_NAME, baseUrl: BASE_URL, basePath, users: USERS, durationMs: DURATION_MS, rampMs: RAMP_MS, stages: STAGES, uploadAbuse: UPLOAD_ABUSE_ENABLED, queueTransport: QUEUE_TRANSPORT, auth: Boolean(SCENARIO.auth) },
    health: {
      samples: healthSamples.length,
      failures: healthSamples.filter((sample) => sample.error).length,
      maxRssMb: max("rssMb"),
      maxHeapUsedMb: max("heapUsedMb"),
      maxExternalMb: max("externalMb"),
      maxLagMs: max("lagMs"),
      maxSockets: max("sockets"),
      maxRoomPlayers: max("roomPlayers"),
      maxCpuLoad1: max("cpuLoad1"),
      maxApiActiveCount: max("apiActiveCount"),
      maxPendingNpcPoolLoads: max("pendingNpcPoolLoads"),
      maxActiveNpcVisits: max("activeNpcVisits"),
      last
    },
    socket: socketStats,
    uploadAbuse: {
      attempts: uploadAbuseResults.length,
      rejected: uploadAbuseResults.filter((result) => result.status === 413).length,
      unauthorized: uploadAbuseResults.filter((result) => result.status === 401).length,
      skipped: uploadAbuseResults.some((result) => result.skipped),
      results: uploadAbuseResults.slice(0, 10)
    },
    api: Object.fromEntries([...apiStats.entries()].map(([name, stat]) => [name, {
      count: stat.count,
      ok: stat.ok,
      fail: stat.fail,
      avgMs: stat.count ? Math.round(stat.totalMs / stat.count) : 0,
      p95Ms: Math.round(percentile(stat.samples, 0.95)),
      maxMs: Math.round(stat.maxMs)
    }]))
  };
}

async function writeResults(summary) {
  await mkdir(OUTPUT_DIR, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const baseName = `${stamp}-${SCENARIO_NAME}-${USERS}u`;
  const summaryPath = path.join(OUTPUT_DIR, `${baseName}-summary.json`);
  const samplesPath = path.join(OUTPUT_DIR, `${baseName}-samples.json`);
  await writeFile(summaryPath, `${JSON.stringify({ event: "load_test_summary", ...summary }, null, 2)}\n`);
  await writeFile(samplesPath, `${JSON.stringify({ event: "load_test_samples", samples: healthSamples }, null, 2)}\n`);
  return { summaryPath, samplesPath };
}

await detectBasePath();
console.log(JSON.stringify({ event: "load_test_start", scenario: SCENARIO_NAME, baseUrl: BASE_URL, basePath, users: USERS, durationMs: DURATION_MS, rampMs: RAMP_MS }));

const healthTask = sampleHealth();
const users = Array.from({ length: USERS }, (_, index) => runUser(index + 1));
const uploadTask = runUploadAbuse();
await Promise.allSettled(users);
await uploadTask;
stop = true;
for (const socket of sockets) socket.disconnect();
await healthTask;
const summary = summarize();
const output = await writeResults(summary);
console.log(JSON.stringify({ event: "load_test_summary", ...summary, output }, null, 2));
