function enabled(name, fallback = false) {
  const value = process.env[name];
  if (value === undefined) return fallback;
  return String(value).toLowerCase() === "true";
}

export function getFeatureFlags() {
  return {
    socialReadV2: enabled("SOCIAL_READ_V2"),
    socialDualWrite: enabled("SOCIAL_DUAL_WRITE"),
    socketDeltaV2: enabled("SOCKET_DELTA_V2"),
    redisAdapterEnabled: enabled("REDIS_ADAPTER_ENABLED"),
    deferBgmLoad: enabled("DEFER_BGM_LOAD", true)
  };
}
