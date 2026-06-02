const { EventEmitter } = require("node:events");

if (!globalThis.__questRoomRuntimeEvents) {
  globalThis.__questRoomRuntimeEvents = new EventEmitter();
  globalThis.__questRoomRuntimeEvents.setMaxListeners(50);
}

function publishMemberRefresh(discordIds, reason = "member-updated") {
  const ids = [...new Set(
    (Array.isArray(discordIds) ? discordIds : [discordIds])
      .map((value) => String(value || "").trim())
      .filter(Boolean)
  )];
  if (ids.length) publishRuntimeEvent("member:refresh", { discordIds: ids, reason });
}

function publishLevelsRefresh() {
  publishRuntimeEvent("levels:refresh");
}

function publishSocialRefresh() {
  publishRuntimeEvent("social:refresh");
}

const ALLOWED_EVENTS = new Set(["member:refresh", "levels:refresh", "social:refresh"]);

function deliverRuntimeEvent(type, payload) {
  if (!ALLOWED_EVENTS.has(type)) return false;
  globalThis.__questRoomRuntimeEvents.emit(type, payload);
  return true;
}

function publishRuntimeEvent(type, payload) {
  if (!ALLOWED_EVENTS.has(type)) return;
  const token = String(process.env.NEXTAUTH_SECRET || "").trim();
  if (!token || typeof fetch !== "function") {
    deliverRuntimeEvent(type, payload);
    return;
  }

  const rawBasePath = process.env.NEXT_PUBLIC_BASE_PATH || "";
  const basePath = rawBasePath ? `/${rawBasePath.replace(/^\/+|\/+$/g, "")}` : "";
  const port = Number(process.env.PORT || 3000);
  void fetch(`http://127.0.0.1:${port}${basePath}/internal/runtime-event`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-QuestRoom-Internal-Token": token
    },
    body: JSON.stringify({ type, payload })
  }).catch(() => deliverRuntimeEvent(type, payload));
}

module.exports = {
  events: globalThis.__questRoomRuntimeEvents,
  deliverRuntimeEvent,
  publishMemberRefresh,
  publishLevelsRefresh,
  publishSocialRefresh
};
