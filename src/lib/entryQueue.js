const DEFAULT_CLIENT_TTL_MS = 90_000;
const DEFAULT_ACTIVE_TTL_MS = 45_000;
const DEFAULT_MAX_QUEUE = 500;
const DEFAULT_RETRY_MS = 30_000;

function nowMs() {
  return Date.now();
}

function randomToken() {
  const random = globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random()}`;
  return String(random).replace(/[^a-zA-Z0-9._-]+/g, "");
}

function queueConfig() {
  const retryMs = Math.max(10_000, Number(process.env.ENTRY_QUEUE_RETRY_MS || DEFAULT_RETRY_MS));
  return {
    enabled: process.env.ENTRY_QUEUE_ENABLED !== "false",
    maxQueue: Math.max(20, Number(process.env.ENTRY_QUEUE_MAX_WAITING || DEFAULT_MAX_QUEUE)),
    maxActiveLoaders: Math.max(1, Number(process.env.ENTRY_QUEUE_MAX_ACTIVE_LOADERS || 4)),
    admitPerTick: Math.max(1, Number(process.env.ENTRY_QUEUE_ADMIT_PER_TICK || 1)),
    clientTtlMs: Math.max(10_000, Number(process.env.ENTRY_QUEUE_CLIENT_TTL_MS || DEFAULT_CLIENT_TTL_MS)),
    activeTtlMs: Math.max(10_000, Number(process.env.ENTRY_QUEUE_ACTIVE_TTL_MS || DEFAULT_ACTIVE_TTL_MS)),
    retryMs,
    pausedRetryMs: Math.max(retryMs, Number(process.env.ENTRY_QUEUE_PAUSED_RETRY_MS || 60_000)),
    fullRetryMs: Math.max(retryMs, Number(process.env.ENTRY_QUEUE_FULL_RETRY_MS || 60_000))
  };
}

function heapGuardStatus() {
  const runtime = globalThis.__questRoomRuntimeStats || null;
  const guard = runtime?.heapGuard || null;
  if (guard) return guard;
  const heapUsedMb = Math.round(process.memoryUsage().heapUsed / 1024 / 1024);
  const maxMb = Math.max(512, Number(process.env.NODE_MAX_OLD_SPACE_MB || 1536));
  const warnMb = Math.floor(maxMb * 0.72);
  const criticalMb = Math.floor(maxMb * 0.88);
  return {
    enabled: true,
    heapUsedMb,
    warnMb,
    criticalMb,
    warning: heapUsedMb >= warnMb,
    critical: heapUsedMb >= criticalMb
  };
}

function createQueueState() {
  return {
    waiting: new Map(),
    active: new Map(),
    tokens: new Map(),
    sequence: 0,
    lastAdmittedAt: 0,
    lastCleanupAt: 0
  };
}

const state = globalThis.__questRoomEntryQueue || createQueueState();
globalThis.__questRoomEntryQueue = state;

function cleanupQueue(config = queueConfig()) {
  const now = nowMs();
  if (now - state.lastCleanupAt < 2_000) return;
  state.lastCleanupAt = now;

  for (const [clientId, entry] of state.waiting) {
    if (now - entry.updatedAt > config.clientTtlMs) state.waiting.delete(clientId);
  }
  for (const [clientId, entry] of state.active) {
    if (now > entry.expiresAt) {
      state.active.delete(clientId);
      state.tokens.delete(entry.token);
    }
  }
}

function queuePosition(clientId) {
  let index = 1;
  for (const key of state.waiting.keys()) {
    if (key === clientId) return index;
    index += 1;
  }
  return 0;
}

function entryQueueStats() {
  const config = queueConfig();
  cleanupQueue(config);
  const guard = heapGuardStatus();
  return {
    enabled: config.enabled,
    waiting: state.waiting.size,
    active: state.active.size,
    maxActiveLoaders: config.maxActiveLoaders,
    admitPerTick: config.admitPerTick,
    paused: Boolean(guard?.warning || guard?.critical),
    heapGuard: guard,
    lastAdmittedAt: state.lastAdmittedAt ? new Date(state.lastAdmittedAt).toISOString() : null
  };
}

function advanceQueue(config = queueConfig()) {
  cleanupQueue(config);
  if (!config.enabled) return;
  const guard = heapGuardStatus();
  if (guard?.warning || guard?.critical) return;

  const activeCapacity = Math.max(0, config.maxActiveLoaders - state.active.size);
  const heapAwareAdmitLimit = config.admitPerTick;
  const admitCount = Math.min(activeCapacity, heapAwareAdmitLimit, state.waiting.size);
  if (admitCount <= 0) return;

  for (const clientId of [...state.waiting.keys()].slice(0, admitCount)) {
    const waiting = state.waiting.get(clientId);
    state.waiting.delete(clientId);
    const token = `admit-${randomToken()}`;
    const entry = {
      clientId,
      token,
      admittedAt: nowMs(),
      expiresAt: nowMs() + config.activeTtlMs,
      sequence: waiting?.sequence || 0
    };
    state.active.set(clientId, entry);
    state.tokens.set(token, entry);
    state.lastAdmittedAt = nowMs();
  }
}

function joinEntryQueue(clientId, metadata = {}) {
  const config = queueConfig();
  cleanupQueue(config);

  const normalizedClientId = String(clientId || "").trim().slice(0, 120);
  if (!normalizedClientId) {
    return { ok: false, status: "error", error: "client_id_required", retryMs: config.retryMs };
  }
  if (!config.enabled) {
    const token = `disabled-${randomToken()}`;
    return {
      ok: true,
      status: "admitted",
      token,
      position: 0,
      waiting: 0,
      active: state.active.size,
      retryMs: config.retryMs,
      disabled: true
    };
  }

  const existingActive = state.active.get(normalizedClientId);
  if (existingActive && nowMs() <= existingActive.expiresAt) {
    return {
      ok: true,
      status: "admitted",
      token: existingActive.token,
      position: 0,
      waiting: state.waiting.size,
      active: state.active.size,
      retryMs: config.retryMs,
      expiresAt: new Date(existingActive.expiresAt).toISOString()
    };
  }

  if (!state.waiting.has(normalizedClientId)) {
    if (state.waiting.size >= config.maxQueue) {
      return { ok: false, status: "full", error: "entry_queue_full", retryMs: config.fullRetryMs };
    }
    state.sequence += 1;
    state.waiting.set(normalizedClientId, {
      clientId: normalizedClientId,
      sequence: state.sequence,
      createdAt: nowMs(),
      updatedAt: nowMs(),
      metadata: {
        userAgent: String(metadata.userAgent || "").slice(0, 120)
      }
    });
  } else {
    state.waiting.get(normalizedClientId).updatedAt = nowMs();
  }

  advanceQueue(config);

  const admitted = state.active.get(normalizedClientId);
  if (admitted) {
    return {
      ok: true,
      status: "admitted",
      token: admitted.token,
      position: 0,
      waiting: state.waiting.size,
      active: state.active.size,
      retryMs: config.retryMs,
      expiresAt: new Date(admitted.expiresAt).toISOString()
    };
  }

  const guard = heapGuardStatus();
  return {
    ok: true,
    status: guard?.warning || guard?.critical ? "paused" : "waiting",
    position: queuePosition(normalizedClientId),
    waiting: state.waiting.size,
    active: state.active.size,
    maxActiveLoaders: config.maxActiveLoaders,
    retryMs: guard?.warning || guard?.critical ? config.pausedRetryMs : config.retryMs,
    heapGuard: guard
  };
}

function releaseEntryQueue(clientId, token = "") {
  const normalizedClientId = String(clientId || "").trim().slice(0, 120);
  const normalizedToken = String(token || "").trim();
  const active = state.active.get(normalizedClientId);
  if (active && (!normalizedToken || active.token === normalizedToken)) {
    state.active.delete(normalizedClientId);
    state.tokens.delete(active.token);
  }
  state.waiting.delete(normalizedClientId);
  advanceQueue();
  return entryQueueStats();
}

function validateEntryToken(clientId, token) {
  const config = queueConfig();
  if (!config.enabled) return true;
  const normalizedClientId = String(clientId || "").trim().slice(0, 120);
  const normalizedToken = String(token || "").trim();
  const entry = state.tokens.get(normalizedToken);
  return Boolean(
    entry
    && entry.clientId === normalizedClientId
    && nowMs() <= entry.expiresAt
  );
}

globalThis.__questRoomEntryQueueApi = {
  stats: entryQueueStats,
  validateToken: validateEntryToken,
  release: releaseEntryQueue
};

export {
  entryQueueStats,
  joinEntryQueue,
  releaseEntryQueue,
  validateEntryToken
};
