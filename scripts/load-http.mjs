const baseUrl = String(process.env.LOAD_BASE_URL || "http://localhost:3000").replace(/\/+$/, "");
const paths = String(process.env.LOAD_PATHS || "/api/config,/api/levels")
  .split(",")
  .map((path) => path.trim())
  .filter(Boolean);
const concurrency = Math.max(1, Number(process.env.LOAD_CONCURRENCY) || 10);
const durationMs = Math.max(1000, Number(process.env.LOAD_DURATION_MS) || 10_000);
const timeoutMs = Math.max(100, Number(process.env.LOAD_TIMEOUT_MS) || 10_000);
const stopAt = Date.now() + durationMs;
const latencies = [];
const statuses = new Map();
let errors = 0;
let requestIndex = 0;

function percentile(values, ratio) {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * ratio))];
}

async function worker() {
  while (Date.now() < stopAt) {
    const path = paths[requestIndex++ % paths.length];
    const startedAt = performance.now();
    try {
      const response = await fetch(`${baseUrl}${path}`, {
        signal: AbortSignal.timeout(timeoutMs)
      });
      await response.arrayBuffer();
      const status = String(response.status);
      statuses.set(status, (statuses.get(status) || 0) + 1);
    } catch {
      errors += 1;
    } finally {
      latencies.push(performance.now() - startedAt);
    }
  }
}

await Promise.all(Array.from({ length: concurrency }, () => worker()));

const elapsedSeconds = durationMs / 1000;
const report = {
  generatedAt: new Date().toISOString(),
  baseUrl,
  paths,
  concurrency,
  durationMs,
  requests: latencies.length,
  requestsPerSecond: Math.round((latencies.length / elapsedSeconds) * 100) / 100,
  errors,
  statuses: Object.fromEntries([...statuses.entries()].sort()),
  latencyMs: {
    avg: Math.round((latencies.reduce((sum, value) => sum + value, 0) / Math.max(1, latencies.length)) * 100) / 100,
    p50: Math.round(percentile(latencies, 0.5) * 100) / 100,
    p95: Math.round(percentile(latencies, 0.95) * 100) / 100,
    p99: Math.round(percentile(latencies, 0.99) * 100) / 100
  }
};

console.log(JSON.stringify(report, null, 2));
if (errors) process.exitCode = 1;
