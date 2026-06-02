import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

const baseUrl = String(process.env.SNAPSHOT_BASE_URL || "http://localhost:3000").replace(/\/+$/, "");
const cookie = String(process.env.SNAPSHOT_COOKIE || "");
const outputArg = process.argv.find((arg) => arg.startsWith("--write="));
const outputPath = outputArg ? resolve(outputArg.slice("--write=".length)) : "";

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function request(path, expectedStatus) {
  const response = await fetch(`${baseUrl}${path}`, {
    headers: cookie ? { Cookie: cookie } : {},
    signal: AbortSignal.timeout(10_000)
  });
  const text = await response.text();
  let body = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = { nonJsonBody: text.slice(0, 200) };
  }
  assert(response.status === expectedStatus, `${path}: expected ${expectedStatus}, received ${response.status}`);
  return { path, status: response.status, body };
}

const protectedStatus = cookie ? 200 : 401;
const checks = [];
checks.push(await request("/api/config", 200));
checks.push(await request("/api/levels", 200));
checks.push(await request("/api/player/me", protectedStatus));
checks.push(await request("/api/player/rooms", protectedStatus));
checks.push(await request("/api/player/social-status", protectedStatus));
checks.push(await request("/api/player/global", protectedStatus));

assert(typeof checks[0].body?.authConfigured === "boolean", "/api/config: missing authConfigured");
assert(typeof checks[0].body?.dbConfigured === "boolean", "/api/config: missing dbConfigured");
assert(typeof checks[0].body?.featureFlags === "object", "/api/config: missing featureFlags");
assert(Array.isArray(checks[1].body?.levels), "/api/levels: missing levels array");

const snapshot = {
  generatedAt: new Date().toISOString(),
  baseUrl,
  authenticated: Boolean(cookie),
  checks: checks.map(({ path, status, body }) => ({
    path,
    status,
    shape: body && typeof body === "object" ? Object.keys(body).sort() : []
  }))
};

if (outputPath) {
  await mkdir(dirname(outputPath), { recursive: true });
  await writeFile(outputPath, `${JSON.stringify(snapshot, null, 2)}\n`);
}

console.log(JSON.stringify(snapshot, null, 2));
