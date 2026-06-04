const { loadEnvConfig } = require("@next/env");

loadEnvConfig(process.cwd());

const questroomPort = process.env.QUESTROOM_PORT || "3001";
const nodeMaxOldSpaceMb = process.env.NODE_MAX_OLD_SPACE_MB || "1536";
const pm2MaxMemoryRestart = process.env.PM2_MAX_MEMORY_RESTART || "1800M";

module.exports = {
  apps: [
    {
      name: "questroom",
      script: "server.js",
      exec_mode: "fork",
      instances: 1,
      node_args: `--max-old-space-size=${nodeMaxOldSpaceMb}`,
      max_memory_restart: pm2MaxMemoryRestart,
      env: {
        NODE_ENV: "production",
        PORT: questroomPort,
        NEXT_PUBLIC_SOCKET_ALLOW_POLLING: process.env.NEXT_PUBLIC_SOCKET_ALLOW_POLLING || "false",
        SOCKET_ALLOW_POLLING: process.env.SOCKET_ALLOW_POLLING || "false",
        NPC_CYCLE_RESTORE_ENABLED: process.env.NPC_CYCLE_RESTORE_ENABLED || "false",
        NPC_CYCLE_RESTORE_JITTER_MS: process.env.NPC_CYCLE_RESTORE_JITTER_MS || "30000",
        NPC_CYCLE_RESTORE_CACHE_TTL_MS: process.env.NPC_CYCLE_RESTORE_CACHE_TTL_MS || "15000",
        ENABLE_SERVER_METRICS: process.env.ENABLE_SERVER_METRICS || "true",
        SERVER_METRICS_INTERVAL_MS: process.env.SERVER_METRICS_INTERVAL_MS || "15000",
        SERVER_METRICS_RSS_WARN_MB: process.env.SERVER_METRICS_RSS_WARN_MB || "512",
        MAX_ROOM_PLAYERS: process.env.MAX_ROOM_PLAYERS || "300",
        ROOM_STATE_LIMIT: process.env.ROOM_STATE_LIMIT || "200",
        SOCIAL_POST_AUTO_BACKFILL_ENABLED: process.env.SOCIAL_POST_AUTO_BACKFILL_ENABLED || "false",
        SOCIAL_POST_BACKFILL_SUBMISSIONS_PER_MEMBER: process.env.SOCIAL_POST_BACKFILL_SUBMISSIONS_PER_MEMBER || "5",
        SOCIAL_POST_BACKFILL_MAX_OPERATIONS: process.env.SOCIAL_POST_BACKFILL_MAX_OPERATIONS || "500"
      }
    }
  ]
};
