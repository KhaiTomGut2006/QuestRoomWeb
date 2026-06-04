module.exports = {
  apps: [
    {
      name: "questroom",
      script: "server.js",
      exec_mode: "fork",
      instances: 1,
      node_args: `--max-old-space-size=${process.env.NODE_MAX_OLD_SPACE_MB || 1536}`,
      max_memory_restart: process.env.PM2_MAX_MEMORY_RESTART || "1800M",
      env: {
        NODE_ENV: "production",
        PORT: process.env.PORT || "3001",
        NEXT_PUBLIC_SOCKET_ALLOW_POLLING: process.env.NEXT_PUBLIC_SOCKET_ALLOW_POLLING || "false",
        SOCKET_ALLOW_POLLING: process.env.SOCKET_ALLOW_POLLING || "false",
        NPC_CYCLE_RESTORE_ENABLED: process.env.NPC_CYCLE_RESTORE_ENABLED || "false",
        NPC_CYCLE_RESTORE_JITTER_MS: process.env.NPC_CYCLE_RESTORE_JITTER_MS || "30000",
        NPC_CYCLE_RESTORE_CACHE_TTL_MS: process.env.NPC_CYCLE_RESTORE_CACHE_TTL_MS || "15000",
        ENABLE_SERVER_METRICS: process.env.ENABLE_SERVER_METRICS || "true",
        SERVER_METRICS_INTERVAL_MS: process.env.SERVER_METRICS_INTERVAL_MS || "15000",
        SERVER_METRICS_RSS_WARN_MB: process.env.SERVER_METRICS_RSS_WARN_MB || "512"
      }
    }
  ]
};
