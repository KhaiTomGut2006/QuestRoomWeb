module.exports = {
  apps: [
    {
      name: "questroom",
      script: "server.js",
      exec_mode: "fork",
      instances: 1,
      node_args: "--max-old-space-size=768",
      max_memory_restart: "900M",
      env: {
        NODE_ENV: "production",
        PORT: process.env.PORT || 3000,
        NEXT_PUBLIC_SOCKET_ALLOW_POLLING: process.env.NEXT_PUBLIC_SOCKET_ALLOW_POLLING || "false",
        SOCKET_ALLOW_POLLING: process.env.SOCKET_ALLOW_POLLING || "false",
        NPC_CYCLE_RESTORE_JITTER_MS: process.env.NPC_CYCLE_RESTORE_JITTER_MS || "30000",
        NPC_CYCLE_RESTORE_CACHE_TTL_MS: process.env.NPC_CYCLE_RESTORE_CACHE_TTL_MS || "15000",
        ENABLE_SERVER_METRICS: process.env.ENABLE_SERVER_METRICS || "true",
        SERVER_METRICS_RSS_WARN_MB: process.env.SERVER_METRICS_RSS_WARN_MB || "768"
      }
    }
  ]
};
