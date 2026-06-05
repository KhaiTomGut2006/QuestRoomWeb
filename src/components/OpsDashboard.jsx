"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Activity,
  AlertTriangle,
  CirclePause,
  CirclePlay,
  Clock3,
  Copy,
  Database,
  HardDrive,
  MemoryStick,
  RefreshCw,
  Server,
  Wifi
} from "lucide-react";
import { withBasePath } from "@/lib/basePath";

const REFRESH_MS = 15_000;
const MAX_SAMPLES = 120;
const HEAP_LIMIT_MB = Number(process.env.NEXT_PUBLIC_NODE_MAX_OLD_SPACE_MB || 1536);
const THRESHOLDS = {
  heapWarnMb: Number(process.env.NEXT_PUBLIC_HEALTH_WARN_HEAP_MB || 1100),
  heapCritMb: Number(process.env.NEXT_PUBLIC_HEALTH_CRIT_HEAP_MB || 1350),
  rssWarnMb: Number(process.env.NEXT_PUBLIC_HEALTH_WARN_RSS_MB || 1300),
  rssCritMb: Number(process.env.NEXT_PUBLIC_HEALTH_CRIT_RSS_MB || 1650),
  uptimeCritSec: 60
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

function statusForHealth(health) {
  const memory = health?.memory || {};
  const heap = Number(memory.heapUsedMb) || 0;
  const rss = Number(memory.rssMb) || 0;
  if (!health?.ok || heap >= THRESHOLDS.heapCritMb || rss >= THRESHOLDS.rssCritMb) return "critical";
  if (heap >= THRESHOLDS.heapWarnMb || rss >= THRESHOLDS.rssWarnMb) return "warning";
  return "ok";
}

function statusLabel(status) {
  if (status === "critical") return "CRIT";
  if (status === "warning") return "WARN";
  return "OK";
}

function clampPercent(value) {
  return Math.min(100, Math.max(0, value));
}

function MetricCard({ icon: Icon, title, value, detail, status = "ok", percent = 0, accent = "teal" }) {
  return (
    <section className={`ops-card ops-metric ops-status-${status} ops-accent-${accent}`}>
      <div className="ops-metric-icon" aria-hidden="true">
        <Icon size={30} />
      </div>
      <div className="ops-metric-body">
        <div className="ops-card-title-row">
          <h2>{title}</h2>
          <span className="ops-status-chip">{statusLabel(status)}</span>
        </div>
        <strong>{value}</strong>
        <p>{detail}</p>
        <div className="ops-meter" aria-hidden="true">
          <span style={{ width: `${clampPercent(percent)}%` }} />
        </div>
      </div>
    </section>
  );
}

function MemoryChart({ samples }) {
  const chartSamples = samples.slice(-30);
  const width = 720;
  const height = 280;
  const pad = { left: 48, right: 20, top: 18, bottom: 34 };
  const maxValue = Math.max(
    HEAP_LIMIT_MB,
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
    return { y, label };
  });

  return (
    <section className="ops-card ops-chart-card">
      <div className="ops-section-heading">
        <div>
          <h2>Memory Trend</h2>
          <p>Last {chartSamples.length} samples, auto refresh every 15s</p>
        </div>
        <span>Heap limit {formatNumber(HEAP_LIMIT_MB)} MB</span>
      </div>
      <svg className="ops-chart" viewBox={`0 0 ${width} ${height}`} role="img" aria-label="Memory trend chart">
        {grid.map((line) => (
          <g key={line.y}>
            <line x1={pad.left} x2={width - pad.right} y1={line.y} y2={line.y} />
            <text x={10} y={line.y + 4}>{formatNumber(line.label)}</text>
          </g>
        ))}
        <polyline className="ops-line ops-line-rss" points={pointsFor("rssMb")} />
        <polyline className="ops-line ops-line-heap-total" points={pointsFor("heapTotalMb")} />
        <polyline className="ops-line ops-line-heap" points={pointsFor("heapUsedMb")} />
        <polyline className="ops-line ops-line-external" points={pointsFor("externalMb")} />
        {chartSamples.map((sample, index) => {
          const x = pad.left + (chartSamples.length <= 1 ? 0 : index * ((width - pad.left - pad.right) / (chartSamples.length - 1)));
          return index % Math.max(1, Math.ceil(chartSamples.length / 6)) === 0 ? (
            <text className="ops-chart-time" key={sample.checkedAt || index} x={x} y={height - 8}>
              {timeLabel(sample.checkedAt)}
            </text>
          ) : null;
        })}
      </svg>
      <div className="ops-legend">
        <span className="ops-dot heap" /> Heap Used
        <span className="ops-dot rss" /> RSS
        <span className="ops-dot total" /> Heap Total
        <span className="ops-dot external" /> External
      </div>
    </section>
  );
}

function RuntimePanel({ runtime }) {
  const items = [
    ["Room Players", runtime?.roomPlayers],
    ["Rooms", runtime?.rooms],
    ["Socket Map", runtime?.socketToPlayer],
    ["NPC Visits", runtime?.activeNpcVisits],
    ["Room Patch Buffers", runtime?.roomPatchBuffers],
    ["Cycle Timers", runtime?.socketPersonalTimers]
  ];

  return (
    <section className="ops-card ops-runtime">
      <div className="ops-section-heading">
        <div>
          <h2>Runtime</h2>
          <p>Socket and room state from the current process</p>
        </div>
        <Wifi size={22} />
      </div>
      <div className="ops-runtime-grid">
        {items.map(([label, value]) => (
          <div key={label} className="ops-runtime-item">
            <span>{label}</span>
            <strong>{value ?? "-"}</strong>
          </div>
        ))}
      </div>
    </section>
  );
}

function ThresholdPanel() {
  return (
    <section className="ops-card ops-thresholds">
      <div className="ops-section-heading">
        <div>
          <h2>Alert Thresholds</h2>
          <p>Aligned with the health monitor script</p>
        </div>
        <AlertTriangle size={22} />
      </div>
      <dl>
        <div><dt>Heap warn</dt><dd>{formatNumber(THRESHOLDS.heapWarnMb)} MB</dd></div>
        <div><dt>Heap critical</dt><dd>{formatNumber(THRESHOLDS.heapCritMb)} MB</dd></div>
        <div><dt>RSS warn</dt><dd>{formatNumber(THRESHOLDS.rssWarnMb)} MB</dd></div>
        <div><dt>RSS critical</dt><dd>{formatNumber(THRESHOLDS.rssCritMb)} MB</dd></div>
        <div><dt>Fresh restart</dt><dd>&lt; {THRESHOLDS.uptimeCritSec}s</dd></div>
      </dl>
    </section>
  );
}

function RecentSamples({ samples }) {
  const rows = samples.slice(-8).reverse();
  return (
    <section className="ops-card ops-table-card">
      <div className="ops-section-heading">
        <div>
          <h2>Recent Samples</h2>
          <p>Stored only in this browser tab</p>
        </div>
        <Activity size={22} />
      </div>
      <div className="ops-table-wrap">
        <table>
          <thead>
            <tr>
              <th>Time</th>
              <th>Status</th>
              <th>Heap</th>
              <th>RSS</th>
              <th>Heap Total</th>
              <th>External</th>
              <th>Uptime</th>
              <th>DB</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((sample, index) => {
              const status = statusForHealth(sample);
              const heapPercent = ((sample.memory?.heapUsedMb || 0) / HEAP_LIMIT_MB) * 100;
              const rssPercent = ((sample.memory?.rssMb || 0) / HEAP_LIMIT_MB) * 100;
              return (
                <tr key={`${sample.checkedAt}-${index}`}>
                  <td>{timeLabel(sample.checkedAt)}</td>
                  <td><span className={`ops-status-pill ops-status-${status}`}>{statusLabel(status)}</span></td>
                  <td>{formatNumber(sample.memory?.heapUsedMb)} MB ({formatPercent(heapPercent)})</td>
                  <td>{formatNumber(sample.memory?.rssMb)} MB ({formatPercent(rssPercent)})</td>
                  <td>{formatNumber(sample.memory?.heapTotalMb)} MB</td>
                  <td>{formatNumber(sample.memory?.externalMb)} MB</td>
                  <td>{formatDuration(sample.uptimeSec)}</td>
                  <td>{sample.db?.status || "unknown"}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}

export default function OpsDashboard() {
  const [samples, setSamples] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [paused, setPaused] = useState(false);
  const [copied, setCopied] = useState(false);
  const inFlightRef = useRef(false);
  const latest = samples.at(-1) || null;
  const latestStatus = latest ? statusForHealth(latest) : error ? "critical" : "ok";

  const loadHealth = useCallback(() => {
    if (inFlightRef.current || document.visibilityState === "hidden") return;
    inFlightRef.current = true;
    fetch(withBasePath("/api/health"), { cache: "no-store" })
      .then((response) => (response.ok ? response.json() : Promise.reject(response)))
      .then((health) => {
        setSamples((current) => [...current.slice(-(MAX_SAMPLES - 1)), health]);
        setError("");
      })
      .catch(() => setError("Health endpoint is unavailable"))
      .finally(() => {
        inFlightRef.current = false;
        setLoading(false);
      });
  }, []);

  useEffect(() => {
    loadHealth();
  }, [loadHealth]);

  useEffect(() => {
    if (paused) return undefined;
    const interval = window.setInterval(loadHealth, REFRESH_MS);
    document.addEventListener("visibilitychange", loadHealth);
    return () => {
      window.clearInterval(interval);
      document.removeEventListener("visibilitychange", loadHealth);
    };
  }, [loadHealth, paused]);

  const metrics = useMemo(() => {
    const memory = latest?.memory || {};
    const heapPercent = ((memory.heapUsedMb || 0) / HEAP_LIMIT_MB) * 100;
    const rssPercent = ((memory.rssMb || 0) / HEAP_LIMIT_MB) * 100;
    const dbConnected = latest?.db?.status === "connected";
    return {
      heapPercent,
      rssPercent,
      heapStatus: memory.heapUsedMb >= THRESHOLDS.heapCritMb ? "critical" : memory.heapUsedMb >= THRESHOLDS.heapWarnMb ? "warning" : "ok",
      rssStatus: memory.rssMb >= THRESHOLDS.rssCritMb ? "critical" : memory.rssMb >= THRESHOLDS.rssWarnMb ? "warning" : "ok",
      dbStatus: dbConnected ? "ok" : "warning",
      uptimeStatus: latest?.uptimeSec && latest.uptimeSec < THRESHOLDS.uptimeCritSec ? "warning" : "ok"
    };
  }, [latest]);

  const copyEndpoint = async () => {
    await navigator.clipboard?.writeText(`${window.location.origin}${withBasePath("/api/health")}`);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1200);
  };

  return (
    <main className="ops-dashboard-page">
      <aside className="ops-sidebar">
        <div className="ops-brand">
          <Server size={34} />
          <div>
            <strong>Quest Room</strong>
            <span>Operations</span>
          </div>
        </div>
        <nav aria-label="Ops sections">
          <a href="#overview">Overview</a>
          <a href="#memory">Memory</a>
          <a href="#runtime">Runtime</a>
          <a href="#samples">Samples</a>
        </nav>
        <div className="ops-sidebar-foot">
          <span>Endpoint</span>
          <code>/api/health</code>
        </div>
      </aside>

      <section className="ops-main">
        <header className="ops-header" id="overview">
          <div>
            <h1>Quest Room Ops</h1>
            <p>System Health Dashboard</p>
          </div>
          <div className="ops-header-actions">
            <span className={`ops-live ops-status-${latestStatus}`}>{error ? "Offline" : paused ? "Paused" : "Live"}</span>
            <button type="button" onClick={loadHealth} disabled={inFlightRef.current}>
              <RefreshCw size={18} />
              Refresh
            </button>
            <button type="button" onClick={() => setPaused((current) => !current)}>
              {paused ? <CirclePlay size={18} /> : <CirclePause size={18} />}
              {paused ? "Resume" : "Pause"}
            </button>
          </div>
        </header>

        {error && <p className="ops-error">{error}</p>}
        {loading && !latest && <p className="ops-loading">Loading health data...</p>}

        {latest && (
          <>
            <section className="ops-metrics-grid">
              <MetricCard
                icon={MemoryStick}
                title="Heap Used"
                value={`${formatNumber(latest.memory?.heapUsedMb)} MB`}
                detail={`${formatPercent(metrics.heapPercent)} of ${formatNumber(HEAP_LIMIT_MB)} MB`}
                status={metrics.heapStatus}
                percent={metrics.heapPercent}
                accent="coral"
              />
              <MetricCard
                icon={HardDrive}
                title="RSS Memory"
                value={`${formatNumber(latest.memory?.rssMb)} MB`}
                detail={`${formatPercent(metrics.rssPercent)} of ${formatNumber(HEAP_LIMIT_MB)} MB`}
                status={metrics.rssStatus}
                percent={metrics.rssPercent}
                accent="gold"
              />
              <MetricCard
                icon={Database}
                title="Database"
                value={latest.db?.status || "unknown"}
                detail={`readyState: ${latest.db?.readyState ?? "-"}`}
                status={metrics.dbStatus}
                percent={latest.db?.status === "connected" ? 100 : 18}
                accent="teal"
              />
              <MetricCard
                icon={Clock3}
                title="Uptime"
                value={formatDuration(latest.uptimeSec)}
                detail={`Checked ${timeLabel(latest.checkedAt)}`}
                status={metrics.uptimeStatus}
                percent={100}
                accent="blue"
              />
            </section>

            <section className="ops-content-grid" id="memory">
              <MemoryChart samples={samples} />
              <div className="ops-side-stack" id="runtime">
                <RuntimePanel runtime={latest.runtime} />
                <ThresholdPanel />
                <section className="ops-card ops-endpoint-card">
                  <div className="ops-section-heading">
                    <div>
                      <h2>Health Endpoint</h2>
                      <p>{latest.checkedAt ? new Date(latest.checkedAt).toLocaleString() : "-"}</p>
                    </div>
                    <button type="button" onClick={copyEndpoint} aria-label="Copy health endpoint">
                      <Copy size={18} />
                    </button>
                  </div>
                  <code>{withBasePath("/api/health")}</code>
                  {copied && <span className="ops-copied">Copied</span>}
                </section>
              </div>
            </section>

            <div id="samples">
              <RecentSamples samples={samples} />
            </div>
          </>
        )}
      </section>
    </main>
  );
}
