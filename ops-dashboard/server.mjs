import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { createServer } from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const publicDir = path.join(__dirname, "public");
const host = process.env.OPS_DASHBOARD_HOST || "127.0.0.1";
const port = Number(process.env.OPS_DASHBOARD_PORT || 3003);
const pollMs = Math.max(5000, Number(process.env.OPS_DASHBOARD_POLL_MS || 15000));
const healthUrl = process.env.QUESTROOM_HEALTH_URL || "http://127.0.0.1:3001/questroom/api/health";
const basicAuth = String(process.env.OPS_DASHBOARD_BASIC_AUTH || "");

const mimeTypes = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".ico": "image/x-icon",
  ".svg": "image/svg+xml"
};

function isAuthorized(request) {
  if (!basicAuth) return true;
  const expected = Buffer.from(basicAuth).toString("base64");
  return request.headers.authorization === `Basic ${expected}`;
}

function requireAuth(response) {
  response.statusCode = 401;
  response.setHeader("WWW-Authenticate", 'Basic realm="Quest Room Ops"');
  response.end("Authentication required");
}

function json(response, status, body) {
  response.statusCode = status;
  response.setHeader("Content-Type", "application/json; charset=utf-8");
  response.setHeader("Cache-Control", "no-store");
  response.end(JSON.stringify(body));
}

async function proxyHealth(response) {
  const startedAt = Date.now();
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 5000);
  try {
    const upstream = await fetch(healthUrl, { signal: controller.signal });
    const body = await upstream.json().catch(() => ({}));
    json(response, upstream.ok ? 200 : upstream.status, {
      ...body,
      opsProxy: {
        ok: upstream.ok,
        upstreamStatus: upstream.status,
        latencyMs: Date.now() - startedAt,
        target: healthUrl,
        checkedAt: new Date().toISOString()
      }
    });
  } catch (error) {
    json(response, 503, {
      ok: false,
      error: "health_unavailable",
      message: error.message || "upstream_unavailable",
      opsProxy: {
        ok: false,
        upstreamStatus: 0,
        latencyMs: Date.now() - startedAt,
        target: healthUrl,
        checkedAt: new Date().toISOString()
      }
    });
  } finally {
    clearTimeout(timeoutId);
  }
}

async function serveStatic(request, response) {
  const url = new URL(request.url || "/", `http://${request.headers.host || "localhost"}`);
  const pathname = url.pathname === "/" ? "/index.html" : url.pathname;
  const safePath = path.normalize(pathname).replace(/^(\.\.(\/|\\|$))+/, "");
  const filePath = path.join(publicDir, safePath);
  if (!filePath.startsWith(publicDir)) {
    response.statusCode = 403;
    response.end("Forbidden");
    return;
  }
  try {
    const info = await stat(filePath);
    if (!info.isFile()) throw new Error("not_file");
    const ext = path.extname(filePath);
    response.statusCode = 200;
    response.setHeader("Content-Type", mimeTypes[ext] || "application/octet-stream");
    response.setHeader("Cache-Control", ext === ".html" ? "no-store" : "public, max-age=300");
    createReadStream(filePath).pipe(response);
  } catch {
    response.statusCode = 404;
    response.setHeader("Content-Type", "text/plain; charset=utf-8");
    response.end("Not found");
  }
}

const server = createServer((request, response) => {
  if (!isAuthorized(request)) {
    requireAuth(response);
    return;
  }
  const url = new URL(request.url || "/", `http://${request.headers.host || "localhost"}`);
  if (url.pathname === "/api/health") {
    void proxyHealth(response);
    return;
  }
  if (url.pathname === "/api/config") {
    json(response, 200, {
      pollMs,
      healthUrl
    });
    return;
  }
  void serveStatic(request, response);
});

server.listen(port, host, () => {
  console.log(`Quest Room Ops dashboard ready on http://${host}:${port}`);
  console.log(`Reading health from ${healthUrl}`);
});
