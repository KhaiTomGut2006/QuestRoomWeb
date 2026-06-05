const state = {
  samples: [],
  paused: false,
  inFlight: false,
  pollMs: 15000,
  heapLimitMb: 1536
};

const els = {
  targetUrl: document.getElementById("target-url"),
  liveStatus: document.getElementById("live-status"),
  refreshBtn: document.getElementById("refresh-btn"),
  pauseBtn: document.getElementById("pause-btn"),
  errorBanner: document.getElementById("error-banner"),
  heapUsed: document.getElementById("heap-used"),
  heapDetail: document.getElementById("heap-detail"),
  heapMeter: document.getElementById("heap-meter"),
  rssUsed: document.getElementById("rss-used"),
  rssDetail: document.getElementById("rss-detail"),
  rssMeter: document.getElementById("rss-meter"),
  dbStatus: document.getElementById("db-status"),
  dbDetail: document.getElementById("db-detail"),
  dbMeter: document.getElementById("db-meter"),
  uptime: document.getElementById("uptime"),
  checkedAt: document.getElementById("checked-at"),
  sampleCount: document.getElementById("sample-count"),
  proxyLatency: document.getElementById("proxy-latency"),
  chart: document.getElementById("memory-chart"),
  runtimeGrid: document.getElementById("runtime-grid"),
  apiSummary: document.getElementById("api-summary"),
  apiRows: document.getElementById("api-rows"),
  activeRequests: document.getElementById("active-requests"),
  sampleRows: document.getElementById("sample-rows")
};

function formatNumber(value) {
  return new Intl.NumberFormat("en-US").format(Math.round(Number(value) || 0));
}

function formatPercent(value) {
  if (!Number.isFinite(value)) return "0%";
  return `${Math.round(value * 10) / 10}%`;
}

function formatDuration(seconds) {
  const total = Math.max(0, Math.round(Number(seconds) || 0));
  const days = Math.floor(total / 86400);
  const hours = Math.floor((total % 86400) / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const secs = total % 60;
  if (days) return `${days}d ${hours}h ${minutes}m`;
  if (hours) return `${hours}h ${minutes}m ${secs}s`;
  if (minutes) return `${minutes}m ${secs}s`;
  return `${secs}s`;
}

function timeLabel(value) {
  const date = new Date(value || Date.now());
  return date.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

function clampPercent(value) {
  return Math.min(100, Math.max(0, value));
}

function statusForHealth(health) {
  if (!health?.ok) return "critical";
  const guard = health.runtime?.heapGuard;
  if (guard?.critical) return "critical";
  if (guard?.warning) return "warning";
  const heap = Number(health.memory?.heapUsedMb) || 0;
  const rss = Number(health.memory?.rssMb) || 0;
  if (heap >= 1350 || rss >= 1650) return "critical";
  if (heap >= 1100 || rss >= 1300) return "warning";
  return "ok";
}

function statusLabel(status) {
  if (status === "critical") return "CRIT";
  if (status === "warning") return "WARN";
  return "OK";
}

function statusForApiRoute(route, api = {}) {
  const stuckMs = Number(api.stuckRequestMs) || 15000;
  const slowMs = Number(api.slowRequestMs) || 1500;
  const isHealth = route?.path === "/api/health";
  if (!isHealth && route?.inflight > 0 && route?.maxMs >= stuckMs) return "critical";
  if (route?.status5xx > 0 || route?.p95Ms >= stuckMs || route?.maxHeapDeltaMb >= 80) return "critical";
  if ((!isHealth && route?.inflight > 0) || route?.slowCount > 0 || route?.p95Ms >= slowMs || route?.status4xx > 0 || route?.maxHeapDeltaMb >= 20) return "warning";
  return "ok";
}

function renderMeter(element, percent, status = "ok") {
  element.style.width = `${clampPercent(percent)}%`;
  element.style.background = status === "critical" ? "var(--crit)" : status === "warning" ? "var(--warn)" : "var(--ok)";
}

function renderChart(samples) {
  const chartSamples = samples.slice(-30);
  const width = 760;
  const height = 280;
  const pad = { left: 48, right: 20, top: 18, bottom: 34 };
  const maxValue = Math.max(
    state.heapLimitMb,
    ...chartSamples.flatMap((sample) => [
      sample.memory?.heapUsedMb || 0,
      sample.memory?.rssMb || 0,
      sample.memory?.heapTotalMb || 0,
      sample.memory?.externalMb || 0
    ])
  );
  const yMax = Math.ceil(maxValue / 300) * 300 || 1800;
  const pointsFor = (key) => chartSamples.map((sample, index) => {
    const x = pad.left + (chartSamples.length <= 1 ? 0 : index * ((width - pad.left - pad.right) / (chartSamples.length - 1)));
    const y = pad.top + (1 - ((Number(sample.memory?.[key]) || 0) / yMax)) * (height - pad.top - pad.bottom);
    return `${x},${y}`;
  }).join(" ");
  const grid = [0, 0.25, 0.5, 0.75, 1].map((step) => {
    const y = pad.top + step * (height - pad.top - pad.bottom);
    const label = Math.round(yMax * (1 - step));
    return `<g><line class="chart-grid" x1="${pad.left}" x2="${width - pad.right}" y1="${y}" y2="${y}"></line><text class="chart-label" x="10" y="${y + 4}">${formatNumber(label)}</text></g>`;
  }).join("");
  els.chart.innerHTML = `
    ${grid}
    <polyline class="chart-line" stroke="var(--gold)" points="${pointsFor("rssMb")}"></polyline>
    <polyline class="chart-line" stroke="var(--blue)" points="${pointsFor("heapTotalMb")}"></polyline>
    <polyline class="chart-line" stroke="var(--coral)" points="${pointsFor("heapUsedMb")}"></polyline>
    <polyline class="chart-line" stroke="var(--teal)" points="${pointsFor("externalMb")}"></polyline>
  `;
}

function renderRuntime(runtime = {}) {
  const items = [
    ["Room Players", runtime.roomPlayers],
    ["Rooms", runtime.rooms],
    ["Socket Map", runtime.socketToPlayer],
    ["NPC Visits", runtime.activeNpcVisits],
    ["Patch Buffers", runtime.roomPatchBuffers],
    ["Cycle Timers", runtime.socketPersonalTimers],
    ["Heap Guard", runtime.heapGuard?.critical ? "CRIT" : runtime.heapGuard?.warning ? "WARN" : "OK"],
    ["Lag", `${formatNumber(runtime.lagMs)}ms`]
  ];
  els.runtimeGrid.innerHTML = items.map(([label, value]) => `
    <div class="runtime-item">
      <span>${label}</span>
      <strong>${value ?? "-"}</strong>
    </div>
  `).join("");
}

function renderApi(api = {}) {
  const routes = Array.isArray(api.routes) ? api.routes : [];
  const active = Array.isArray(api.active) ? api.active.filter((request) => request.path !== "/api/health" || request.stuck) : [];
  els.apiSummary.textContent = `${formatNumber(api.trackedRoutes || routes.length)} routes, ${formatNumber(api.activeCount || active.length)} active`;
  els.apiRows.innerHTML = routes.length ? routes.map((route) => {
    const status = statusForApiRoute(route, api);
    return `
      <tr>
        <td><code>${route.path}</code></td>
        <td><span class="pill ${status}">${statusLabel(status)}</span></td>
        <td>${formatNumber(route.count)}</td>
        <td>${formatNumber(route.inflight)}</td>
        <td>${formatNumber(route.avgMs)}ms</td>
        <td>${formatNumber(route.p95Ms)}ms</td>
        <td>${formatNumber(route.maxMs)}ms</td>
        <td>${formatNumber(route.slowCount)}</td>
        <td>${formatNumber(route.status5xx)}</td>
        <td>${formatNumber(route.maxHeapDeltaMb)} MB</td>
        <td>${route.lastAt ? timeLabel(route.lastAt) : "-"}</td>
      </tr>
    `;
  }).join("") : `<tr><td colspan="11">No API requests observed yet</td></tr>`;

  els.activeRequests.innerHTML = active.length ? active.map((request) => {
    const status = request.stuck ? "critical" : Number(request.ageMs) >= 5000 ? "warning" : "ok";
    return `
      <div class="active-item ${status}">
        <span>${request.method}</span>
        <code>${request.path}</code>
        <strong>${formatNumber(request.ageMs)}ms</strong>
      </div>
    `;
  }).join("") : `<p class="empty-note">No active API requests right now</p>`;
}

function renderSamples(samples) {
  els.sampleRows.innerHTML = samples.slice(-8).reverse().map((sample) => {
    const status = statusForHealth(sample);
    return `
      <tr>
        <td>${timeLabel(sample.checkedAt)}</td>
        <td><span class="pill ${status}">${statusLabel(status)}</span></td>
        <td>${formatNumber(sample.memory?.heapUsedMb)} MB</td>
        <td>${formatNumber(sample.memory?.rssMb)} MB</td>
        <td>${sample.db?.status || "unknown"}</td>
        <td>${formatDuration(sample.uptimeSec)}</td>
      </tr>
    `;
  }).join("");
}

function render(health) {
  const status = statusForHealth(health);
  const memory = health.memory || {};
  const guard = health.runtime?.heapGuard || {};
  state.heapLimitMb = Number(guard.criticalMb ? Math.round(guard.criticalMb / 0.88) : state.heapLimitMb) || state.heapLimitMb;
  const heapPercent = ((memory.heapUsedMb || 0) / state.heapLimitMb) * 100;
  const rssPercent = ((memory.rssMb || 0) / state.heapLimitMb) * 100;

  els.liveStatus.className = `live ${status}`;
  els.liveStatus.textContent = health.ok ? (state.paused ? "Paused" : "Live") : "Offline";
  els.heapUsed.textContent = `${formatNumber(memory.heapUsedMb)} MB`;
  els.heapDetail.textContent = `${formatPercent(heapPercent)} of ${formatNumber(state.heapLimitMb)} MB`;
  renderMeter(els.heapMeter, heapPercent, guard.critical ? "critical" : guard.warning ? "warning" : "ok");
  els.rssUsed.textContent = `${formatNumber(memory.rssMb)} MB`;
  els.rssDetail.textContent = `${formatPercent(rssPercent)} of ${formatNumber(state.heapLimitMb)} MB`;
  renderMeter(els.rssMeter, rssPercent, memory.rssMb >= 1650 ? "critical" : memory.rssMb >= 1300 ? "warning" : "ok");
  els.dbStatus.textContent = health.db?.status || "unknown";
  els.dbDetail.textContent = `readyState: ${health.db?.readyState ?? "-"}`;
  renderMeter(els.dbMeter, health.db?.status === "connected" ? 100 : 18, health.db?.status === "connected" ? "ok" : "warning");
  els.uptime.textContent = formatDuration(health.uptimeSec);
  els.checkedAt.textContent = `Checked ${timeLabel(health.checkedAt)}`;
  els.proxyLatency.textContent = `Proxy ${formatNumber(health.opsProxy?.latencyMs)}ms`;
  els.sampleCount.textContent = `Last ${state.samples.length} samples, auto refresh every ${Math.round(state.pollMs / 1000)}s`;

  renderChart(state.samples);
  renderRuntime(health.runtime);
  renderApi(health.runtime?.api);
  renderSamples(state.samples);
}

async function loadConfig() {
  const config = await fetch("/api/config", { cache: "no-store" }).then((response) => response.json());
  state.pollMs = Number(config.pollMs) || state.pollMs;
  els.targetUrl.textContent = config.healthUrl || "unknown";
}

async function loadHealth() {
  if (state.inFlight || document.visibilityState === "hidden") return;
  state.inFlight = true;
  try {
    const health = await fetch("/api/health", { cache: "no-store" }).then((response) => response.json());
    state.samples = [...state.samples.slice(-119), health];
    els.errorBanner.hidden = health.ok;
    els.errorBanner.textContent = health.ok ? "" : `Game health unavailable: ${health.message || health.error || "unknown"}`;
    render(health);
  } catch (error) {
    els.liveStatus.className = "live critical";
    els.liveStatus.textContent = "Offline";
    els.errorBanner.hidden = false;
    els.errorBanner.textContent = `Dashboard proxy unavailable: ${error.message}`;
  } finally {
    state.inFlight = false;
  }
}

async function boot() {
  await loadConfig().catch(() => {
    els.targetUrl.textContent = "config unavailable";
  });
  await loadHealth();
  setInterval(() => {
    if (!state.paused) void loadHealth();
  }, state.pollMs);
}

els.refreshBtn.addEventListener("click", () => loadHealth());
els.pauseBtn.addEventListener("click", () => {
  state.paused = !state.paused;
  els.pauseBtn.textContent = state.paused ? "Resume" : "Pause";
  if (!state.paused) void loadHealth();
});
document.addEventListener("visibilitychange", () => {
  if (!state.paused) void loadHealth();
});

void boot();
