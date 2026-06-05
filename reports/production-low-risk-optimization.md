# Production Low-Risk Optimization

## What Changed

- Added `scripts/monitor-health.mjs` for repeated `/api/health` checks.
- Added `npm run monitor:health` as a lightweight ops command.
- Kept gameplay, Socket.IO, database models, and API behavior unchanged.

## Health Monitor

Run a single check:

```bash
HEALTH_MONITOR_SAMPLES=1 npm run monitor:health -- https://example.com/questroom/api/health
```

Run continuous checks every 15 seconds:

```bash
npm run monitor:health -- https://example.com/questroom/api/health
```

Useful environment knobs:

```env
HEALTH_URL=https://example.com/questroom/api/health
HEALTH_MONITOR_INTERVAL_MS=15000
HEALTH_MONITOR_TIMEOUT_MS=5000
HEALTH_WARN_HEAP_MB=1100
HEALTH_CRIT_HEAP_MB=1350
HEALTH_WARN_RSS_MB=1300
HEALTH_CRIT_RSS_MB=1650
HEALTH_REQUIRE_DB_CONNECTED=false
```

The script prints JSON lines and exits with:

- `0` for ok
- `1` if any sample reaches warning
- `2` if any sample reaches critical or the health endpoint fails

`HEALTH_REQUIRE_DB_CONNECTED` defaults to `false` because the app opens MongoDB lazily. Set it to `true` only if the monitor should fail when MongoDB is not already connected.

## Production Checklist

- Keep `ALLOW_GRIDFS_UPLOADS=false` in production.
- Keep R2 direct upload configured.
- Watch `heapUsedMb`, `rssMb`, `db.status`, and uptime resets.
- Alert before Node reaches the configured heap limit. With `NODE_MAX_OLD_SPACE_MB=1536`, start warning around 1100 MB heap and treat 1350 MB as critical.
- Check memory after players leave. If `heapUsedMb` does not fall over time, investigate retained socket state or caches.

## Nginx Guardrails

Apply rate limits carefully in production and test with real login/upload flows first.

```nginx
limit_req_zone $binary_remote_addr zone=questroom_api:10m rate=10r/s;
limit_req_zone $binary_remote_addr zone=questroom_upload:10m rate=2r/s;

location /questroom/api/player/npc-quest/upload {
  client_max_body_size 2m;
  limit_req zone=questroom_upload burst=5 nodelay;
  proxy_pass http://127.0.0.1:3001;
}

location /questroom/api/ {
  client_max_body_size 1m;
  limit_req zone=questroom_api burst=30 nodelay;
  proxy_pass http://127.0.0.1:3001;
}
```

If R2 direct upload is working, local upload bodies should stay small because file bytes go to R2, not through this server.
