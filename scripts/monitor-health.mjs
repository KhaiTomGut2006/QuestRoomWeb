#!/usr/bin/env node

const DEFAULT_PATH = "/questroom/api/health";

function readNumber(name, fallback) {
  const value = Number(process.env[name]);
  return Number.isFinite(value) && value >= 0 ? value : fallback;
}

function normalizeHealthUrl(rawUrl) {
  const value = String(rawUrl || process.env.HEALTH_URL || "").trim();
  if (value) return value;
  const origin = String(process.env.HEALTH_ORIGIN || process.env.NEXTAUTH_URL || "http://localhost:3001").replace(/\/+$/, "");
  const path = String(process.env.HEALTH_PATH || DEFAULT_PATH);
  return `${origin}${path.startsWith("/") ? path : `/${path}`}`;
}

const healthUrl = normalizeHealthUrl(process.argv[2]);
const intervalMs = Math.max(1_000, readNumber("HEALTH_MONITOR_INTERVAL_MS", 15_000));
const timeoutMs = Math.max(1_000, readNumber("HEALTH_MONITOR_TIMEOUT_MS", 5_000));
const maxSamples = Math.floor(readNumber("HEALTH_MONITOR_SAMPLES", 0));
const warnHeapMb = readNumber("HEALTH_WARN_HEAP_MB", 1_100);
const critHeapMb = readNumber("HEALTH_CRIT_HEAP_MB", 1_350);
const warnRssMb = readNumber("HEALTH_WARN_RSS_MB", 1_300);
const critRssMb = readNumber("HEALTH_CRIT_RSS_MB", 1_650);
const requireDbConnected = process.env.HEALTH_REQUIRE_DB_CONNECTED === "true";

let samples = 0;
let worstStatus = 0;

function statusForHealth(health) {
  const memory = health?.memory || {};
  const heapUsedMb = Number(memory.heapUsedMb) || 0;
  const rssMb = Number(memory.rssMb) || 0;
  const dbStatus = String(health?.db?.status || "");

  if (heapUsedMb >= critHeapMb || rssMb >= critRssMb || (requireDbConnected && dbStatus !== "connected")) {
    return "critical";
  }
  if (heapUsedMb >= warnHeapMb || rssMb >= warnRssMb || dbStatus === "connecting" || dbStatus === "disconnecting") {
    return "warning";
  }
  return "ok";
}

function statusCode(status) {
  if (status === "critical") return 2;
  if (status === "warning") return 1;
  return 0;
}

async function fetchHealth() {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(healthUrl, { signal: controller.signal });
    const health = await response.json().catch(() => ({}));
    if (!response.ok) {
      return { status: "critical", health, error: `HTTP ${response.status}` };
    }
    const status = statusForHealth(health);
    return { status, health };
  } catch (error) {
    return { status: "critical", health: null, error: error.message || "health_fetch_failed" };
  } finally {
    clearTimeout(timeoutId);
  }
}

function logSample(sample) {
  const memory = sample.health?.memory || {};
  const db = sample.health?.db || {};
  const line = {
    checkedAt: sample.health?.checkedAt || new Date().toISOString(),
    status: sample.status,
    url: healthUrl,
    rssMb: memory.rssMb ?? null,
    heapUsedMb: memory.heapUsedMb ?? null,
    heapTotalMb: memory.heapTotalMb ?? null,
    externalMb: memory.externalMb ?? null,
    uptimeSec: sample.health?.uptimeSec ?? null,
    db: db.status || "unknown",
    error: sample.error || undefined
  };
  console.log(JSON.stringify(line));
}

async function runOnce() {
  const sample = await fetchHealth();
  logSample(sample);
  worstStatus = Math.max(worstStatus, statusCode(sample.status));
  samples += 1;
}

await runOnce();

if (maxSamples === 1) {
  process.exit(worstStatus);
}

const timer = setInterval(async () => {
  await runOnce();
  if (maxSamples && samples >= maxSamples) {
    clearInterval(timer);
    process.exit(worstStatus);
  }
}, intervalMs);
