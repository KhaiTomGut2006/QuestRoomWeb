# Quest Room Ops Dashboard

Standalone dashboard process for monitoring QuestRoomWeb without depending on the game process for rendering.

## Run Locally

```bash
QUESTROOM_HEALTH_URL=http://127.0.0.1:3001/questroom/api/health npm run ops:dashboard
```

Open:

```text
http://127.0.0.1:3003
```

## Production PM2

`ecosystem.config.cjs` now includes a separate `questroom-ops` app.

Recommended Nginx shape:

```nginx
location /questroom/ops-external/ {
  proxy_pass http://127.0.0.1:3003/;
}
```

The dashboard reads:

```env
QUESTROOM_HEALTH_URL=http://127.0.0.1:3001/questroom/api/health
OPS_DASHBOARD_PORT=3003
OPS_DASHBOARD_HOST=127.0.0.1
OPS_DASHBOARD_POLL_MS=15000
```

Optional basic auth:

```env
OPS_DASHBOARD_BASIC_AUTH=admin:change-this-password
```

If the game process crashes, this dashboard should still load and show `health_unavailable` until the game process recovers.
