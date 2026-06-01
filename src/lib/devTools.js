const allowedDiscordIds = new Set(
  String(process.env.DEV_TOOL_DISCORD_IDS || "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean)
);

export function isDevToolsEnabled() {
  if (process.env.NODE_ENV !== "production") return true;
  return process.env.ENABLE_DEV_TOOLS === "true" && allowedDiscordIds.size > 0;
}

export function canUseDevTools(discordId) {
  if (!isDevToolsEnabled()) return false;
  if (process.env.NODE_ENV !== "production") return true;
  return allowedDiscordIds.has(String(discordId || ""));
}
