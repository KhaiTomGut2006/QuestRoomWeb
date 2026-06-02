# Phase 0 Performance Runbook

This safety net is intentionally read-only by default. Run it before and after each optimization phase.

## Runtime metrics

Enable the internal endpoint in production:

```env
METRICS_ENABLED=true
METRICS_TOKEN=replace-with-a-long-random-token
```

Read the current process snapshot:

```powershell
Invoke-RestMethod `
  -Uri "https://api.hamsterquest.com/questroom/internal/metrics" `
  -Headers @{ Authorization = "Bearer $env:METRICS_TOKEN" }
```

The snapshot includes HTTP latency, HTTP response bytes, socket event counts, approximate socket payload bytes, memory, event-loop delay, active sockets, room count, and retained offline players.

## API contract snapshot

Run the unauthenticated smoke test:

```powershell
$env:SNAPSHOT_BASE_URL = "http://localhost:3000"
npm run phase0:snapshot -- --write=reports/phase0/api-snapshot.local.json
```

To verify authenticated response contracts, copy a valid session cookie into the environment first:

```powershell
$env:SNAPSHOT_COOKIE = "next-auth.session-token=..."
npm run phase0:snapshot -- --write=reports/phase0/api-snapshot.authenticated.json
```

## Safe HTTP load matrix

The default load test calls only public read-only endpoints:

```powershell
$env:LOAD_BASE_URL = "http://localhost:3000"
$env:LOAD_DURATION_MS = "30000"

foreach ($users in 50, 100, 300, 500) {
  $env:LOAD_CONCURRENCY = "$users"
  npm run phase0:load:http
}
```

Use a production-like environment for capacity decisions. Local development results are useful only for regression comparison.

## Socket connection test

The default socket test connects and disconnects without joining rooms:

```powershell
$env:LOAD_SOCKET_CLIENTS = "100"
$env:LOAD_DURATION_MS = "10000"
npm run phase0:load:socket
```

Room joins and movement are opt-in because the legacy room presence implementation retains offline players until Phase 2:

```powershell
$env:LOAD_SOCKET_JOIN = "true"
$env:LOAD_SOCKET_MOVES_PER_SECOND = "2"
npm run phase0:load:socket
```

Restart the test server after movement tests until Phase 2 is deployed.

## Phase 2 socket rollout

Deploy the Phase 2 code with delta mode disabled first:

```env
SOCKET_DELTA_V2=false
SOCKET_PRESENCE_GRACE_MS=15000
```

After verifying reconnect behavior, enable compact movement payloads:

```env
SOCKET_DELTA_V2=true
```

New clients advertise delta support during `player:join`. Older clients continue receiving the legacy `player:upsert` movement payload.

Compare legacy and delta traffic with the socket load test:

```powershell
$env:LOAD_SOCKET_JOIN = "true"
$env:LOAD_SOCKET_DELTA_V2 = "true"
$env:LOAD_SOCKET_CLIENTS = "100"
$env:LOAD_SOCKET_MOVES_PER_SECOND = "2"
npm run phase0:load:socket
```

Read `/internal/metrics` after the run and compare `socket.outgoing` bytes.

## Rollout flags

Keep migration flags disabled until their implementation phase is ready:

```env
SOCIAL_READ_V2=false
SOCIAL_DUAL_WRITE=false
SOCKET_DELTA_V2=false
REDIS_ADAPTER_ENABLED=false
DEFER_BGM_LOAD=true
```
