const { loadEnvConfig } = require("@next/env");

loadEnvConfig(process.cwd());

const questroomPort = process.env.QUESTROOM_PORT || "3001";
const questroomOpsPort = process.env.OPS_DASHBOARD_PORT || "3003";
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
        HEAP_GUARD_WARN_MB: process.env.HEAP_GUARD_WARN_MB || "900",
        HEAP_GUARD_CRIT_MB: process.env.HEAP_GUARD_CRIT_MB || "1150",
        MEMBER_READ_QUERY_MAX_TIME_MS: process.env.MEMBER_READ_QUERY_MAX_TIME_MS || "3000",
        EXCLUDED_ACTIVE_CLASS_KEYS: process.env.EXCLUDED_ACTIVE_CLASS_KEYS || "AC 1,Hamster Hero",
        BOT_SERVER_TIMEOUT_MS: process.env.BOT_SERVER_TIMEOUT_MS || "3000",
        GAME_API_TOKEN: process.env.GAME_API_TOKEN || "",
        ADMIN_API_TOKEN: process.env.ADMIN_API_TOKEN || "",
        R2_ACCOUNT_ID: process.env.R2_ACCOUNT_ID || "",
        R2_ACCESS_KEY_ID: process.env.R2_ACCESS_KEY_ID || "",
        R2_SECRET_ACCESS_KEY: process.env.R2_SECRET_ACCESS_KEY || "",
        R2_BUCKET: process.env.R2_BUCKET || "",
        R2_PUBLIC_BASE_URL: process.env.R2_PUBLIC_BASE_URL || "",
        BLOB_READ_WRITE_TOKEN: process.env.BLOB_READ_WRITE_TOKEN || "",
        ALLOW_GRIDFS_UPLOADS: process.env.ALLOW_GRIDFS_UPLOADS || "false",
        GRIDFS_MAX_UPLOAD_MB: process.env.GRIDFS_MAX_UPLOAD_MB || "2",
        SERVER_UPLOAD_MAX_MB: process.env.SERVER_UPLOAD_MAX_MB || "2",
        MAX_ROOM_PLAYERS: process.env.MAX_ROOM_PLAYERS || "300",
        ROOM_PLAYERS_LIMIT: process.env.ROOM_PLAYERS_LIMIT || process.env.MAX_ROOM_PLAYERS || "300",
        ROOM_STATE_LIMIT: process.env.ROOM_STATE_LIMIT || process.env.MAX_ROOM_PLAYERS || "300",
        MONGODB_MAX_POOL_SIZE: process.env.MONGODB_MAX_POOL_SIZE || "30",
        ENTRY_QUEUE_ENABLED: process.env.ENTRY_QUEUE_ENABLED || "true",
        ENTRY_QUEUE_MAX_ACTIVE_LOADERS: process.env.ENTRY_QUEUE_MAX_ACTIVE_LOADERS || "4",
        ENTRY_QUEUE_ADMIT_PER_TICK: process.env.ENTRY_QUEUE_ADMIT_PER_TICK || "1",
        ENTRY_QUEUE_ACTIVE_TTL_MS: process.env.ENTRY_QUEUE_ACTIVE_TTL_MS || "45000",
        ENTRY_QUEUE_SOCKET_SESSION_TTL_MS: process.env.ENTRY_QUEUE_SOCKET_SESSION_TTL_MS || "21600000",
        ENTRY_QUEUE_MAX_SOCKET_SESSIONS: process.env.ENTRY_QUEUE_MAX_SOCKET_SESSIONS || "2000",
        ENTRY_QUEUE_CLIENT_TTL_MS: process.env.ENTRY_QUEUE_CLIENT_TTL_MS || "90000",
        ENTRY_QUEUE_RETRY_MS: process.env.ENTRY_QUEUE_RETRY_MS || "30000",
        ENTRY_QUEUE_PAUSED_RETRY_MS: process.env.ENTRY_QUEUE_PAUSED_RETRY_MS || "60000",
        ENTRY_QUEUE_FULL_RETRY_MS: process.env.ENTRY_QUEUE_FULL_RETRY_MS || "60000",
        ENTRY_QUEUE_ENFORCE_SOCKET: process.env.ENTRY_QUEUE_ENFORCE_SOCKET || "true",
        SOCIAL_POST_AUTO_BACKFILL_ENABLED: process.env.SOCIAL_POST_AUTO_BACKFILL_ENABLED || "false",
        SOCIAL_POST_BACKFILL_SUBMISSIONS_PER_MEMBER: process.env.SOCIAL_POST_BACKFILL_SUBMISSIONS_PER_MEMBER || "5",
        SOCIAL_POST_BACKFILL_MAX_OPERATIONS: process.env.SOCIAL_POST_BACKFILL_MAX_OPERATIONS || "500"
      }
    },
    {
      name: "questroom-ops",
      script: "ops-dashboard/server.mjs",
      exec_mode: "fork",
      instances: 1,
      max_memory_restart: process.env.OPS_DASHBOARD_MAX_MEMORY_RESTART || "256M",
      env: {
        NODE_ENV: "production",
        OPS_DASHBOARD_HOST: process.env.OPS_DASHBOARD_HOST || "127.0.0.1",
        OPS_DASHBOARD_PORT: questroomOpsPort,
        QUESTROOM_HEALTH_URL: process.env.QUESTROOM_HEALTH_URL || `http://127.0.0.1:${questroomPort}/questroom/api/health`,
        OPS_DASHBOARD_BASIC_AUTH: process.env.OPS_DASHBOARD_BASIC_AUTH || "",
        OPS_DASHBOARD_POLL_MS: process.env.OPS_DASHBOARD_POLL_MS || "15000"
      }
    }
  ]
};
