---
name: api-data-flow-optimization
description: Use when designing, adding, reviewing, or modifying QuestRoomWeb API routes, client fetches, polling intervals, Socket.IO events, asset loading, uploads, background sync, or any client-server data flow for 100+ concurrent players. Enforce minimal requests, low-frequency polling, event-driven realtime updates, bounded payloads, caching, throttling, DB projections, and load-aware tests before accepting the change.
---

# API Data Flow Optimization

## Goal

Use this skill before adding or changing any QuestRoomWeb data flow between the client, API routes, Socket.IO server, database, object storage, or asset server. The target is stable gameplay for 100+ concurrent players without request storms, oversized payloads, frequent DB writes, or repeated asset downloads.

Short rule: realtime uses sockets, user actions use APIs, static data uses cache, media uses direct upload/CDN, and every flow sends only the fields the UI actually needs.

## Hard Rules

- Do not add API polling faster than 60 seconds unless the need is proven and the code has debounce/throttle plus an in-flight guard.
- Do not use API polling for realtime gameplay such as movement, reactions, room presence, or timer state. Use Socket.IO events.
- Do not write to the database on every movement tick. Send realtime movement through sockets and persist only throttled snapshots, such as every 30-60 seconds, tab hidden, disconnect, or stage change.
- Do not enable Socket.IO polling as the production default. Keep websocket-only unless temporarily debugging a proxy through an env flag.
- Do not return a full member object from endpoints that change only a small value. Return a delta, such as `{ ok, coins, reward, position }`.
- Do not run unbounded list queries or aggregation on hot paths. Use `$limit`, TTL cache, pending request dedupe, and projections.
- Do not rebuild the global/social feed from `Member.npcQuestSubmissions` on user requests. Read feed/status from `SocialPost` and sync submissions into it.
- Do not make users wait for the attendance bot when a usable stale friends cache exists. Return stale cache immediately and refresh in the background.
- Do not load local assets through uncached paths. Use `withOptimizedAsset()` and immutable cache headers.
- Do not route production media uploads through server memory when direct storage is available. Prefer R2/Vercel Blob direct upload and keep GridFS fallback guarded by env and size limits.
- Do not add a new flow without estimating its requests/events per minute for 100 concurrent players and verifying it with a load-aware test or a clear reason why concurrency does not apply.

## Classify The Flow First

Choose the transport only after classifying the flow:

| Flow type | Examples | Preferred transport | Allowed frequency |
| --- | --- | --- | --- |
| Realtime gameplay | movement, reactions, presence, room patches | Socket.IO | throttled 90-300ms, delta payloads only |
| User action | shop, accept quest, submit quest, gamble, trade | API POST/PATCH/DELETE | only when the user acts |
| Background status | member refresh, social unread, rooms list | API GET | 120-300s or visibility/on-demand |
| Modal/on-demand | ranking, friends, global feed, profile | API GET | modal open, cached/deduped, paginated/limited |
| Static/template | levels, quest templates, hint templates, config | API GET with cache | TTL 5-30 minutes or explicit invalidation |
| Media/asset | images, sounds, evidence uploads | CDN/object storage | browser immutable cache or direct upload |

If a new realtime flow is about to use `fetch()`, stop and design a socket event first. If a new static flow is about to load on every render, stop and add cache.

## Payload Budget

- Socket movement event: <= 200 bytes. Send only `id`, `x`, `y`, `action`, and `updatedAt`.
- Room patch: send only changed players, not the whole room every frame.
- Initial room state: send public presence fields only. Do not include submissions, coins, quest details, or private profile data.
- Background API response: prefer <= 5-20 KB per request.
- Modal list: limit to 20-50 items per page and add cache or pagination when data can grow.
- Profile: cap submissions with `submissionLimit`; never send another user's private inventory fields.
- Global feed: read from `SocialPost`, limit posts, cache by class/viewer, dedupe pending loads, and never `$unwind` member submissions on a normal user request.
- Upload config: keep responses small. File bytes should not pass through Next.js API routes in production.

## Database Rules

- Use `.select()`, projection, `.lean()`, `.limit()`, and `.maxTimeMS()` for list/query endpoints.
- Prefer atomic updates such as `updateOne`, `findOneAndUpdate`, `$inc`, `$set`, and `$push` for small field changes.
- If `member.save()` is required for complex business logic, first restrict fields with `MEMBER_INTERACTION_SELECT` or an equivalent minimal select.
- Every list or aggregate endpoint must have TTL cache or pending promise dedupe to avoid duplicate concurrent queries.
- Materialize expensive feeds. For social/global posts, `SocialPost` is the read model and `Member.npcQuestSubmissions` is the legacy/profile history source.
- Invalidate only the caches related to an action, such as global posts, room players, or ranking.
- Avoid `$unwind` on large arrays in frequently called endpoints. If it is required for migration/backfill, run it outside hot user requests or use bounded batch reads.

## Social Feed Read Model

Use `src/models/SocialPost.js` as the primary read model for global feed, social unread status, and social reactions.

- On NPC quest submit or challenge submit, upsert the submission into `SocialPost` immediately.
- Keep `Member.npcQuestSubmissions` for profile/history compatibility, but do not use it to build feed pages in request-time aggregate queries.
- `GET /api/player/global` must query `SocialPost.find()` with indexes, `limit`, `lean`, `maxTimeMS`, cache, and pending dedupe.
- `GET /api/player/social-status` must query the cached recent `SocialPost` activity list, not aggregate all member submissions.
- Reactions should update `SocialPost` first. Mirroring likes/dislikes back to legacy member submissions can happen in the background.
- Legacy data may be synced by bounded backfill using `SOCIAL_POST_BACKFILL_MEMBER_LIMIT` and `SOCIAL_POST_BACKFILL_INTERVAL_MS`.
- `POST /api/player/global/invalidate` should clear feed caches and refresh the `SocialPost` index when an external process approves or changes visible posts.

Relevant env knobs:

```env
GLOBAL_POSTS_CACHE_TTL_MS=15000
SOCIAL_POST_FEED_LIMIT=50
SOCIAL_POSTS_QUERY_MAX_TIME_MS=3000
SOCIAL_POST_AUTO_BACKFILL_ENABLED=false
SOCIAL_POST_BACKFILL_MEMBER_LIMIT=100
SOCIAL_POST_BACKFILL_SUBMISSIONS_PER_MEMBER=5
SOCIAL_POST_BACKFILL_MAX_OPERATIONS=500
SOCIAL_POST_BACKFILL_INTERVAL_MS=300000
```

Production default: keep `SOCIAL_POST_AUTO_BACKFILL_ENABLED=false`. New quest/challenge submissions already upsert into `SocialPost`; legacy backfill must not run from normal `/api/player/global` or `/api/player/social-status` traffic. Run `/api/player/global/invalidate` manually during a quiet period if legacy member submissions need to be indexed.

## Friends Stale Cache

Use stale cache for class friends because `/api/player/friends` can call an external attendance bot.

- Fresh cache is controlled by `FRIENDS_CACHE_TTL_MS`.
- Stale-but-usable cache is controlled by `FRIENDS_STALE_CACHE_TTL_MS`.
- If fresh cache exists, return it.
- If only stale cache exists and a refresh is needed, return stale cache immediately and refresh the bot/DB data in the background.
- If no cache exists, load from bot server with timeout and fallback to local DB.
- Keep bot calls deduped with `pendingClassFriends` so multiple users opening the modal at once do not create parallel bot requests for the same class.

Relevant env knobs:

```env
FRIENDS_CACHE_TTL_MS=60000
FRIENDS_STALE_CACHE_TTL_MS=900000
BOT_SERVER_TIMEOUT_MS=20000
```

## Current QuestRoomWeb Baseline

Keep this baseline unless a change proves a better load profile:

- `GET /api/player/me`: initial load plus 120s refresh while the tab is visible.
- `PATCH /api/player/me`: persisted position snapshot every 60s only when the position changed; response is `{ ok, position }`.
- `GET /api/player/rooms`: 300s refresh.
- `GET /api/player/room?stage=`: on-demand snapshot when the viewed stage changes.
- Socket `room:peek`: 60s and only while viewing another room.
- `GET /api/player/social-status`: 300s plus visibility event, with in-flight guard; reads recent `SocialPost` activity.
- `POST /api/player/social-status`: only when the social/global modal marks items as seen.
- `GET /api/quest-templates` and `GET /api/hint-templates`: client cache plus server TTL cache.
- `GET /api/player/ranking`: modal/on-demand with ranking cache.
- `GET /api/player/global`: modal/on-demand; read from `SocialPost`, keep cache, limit, and dedupe.
- `GET /api/player/friends`: modal/on-demand; may call an external bot server, so keep timeout, cache, stale cache, and dedupe.
- Socket `player:move`: server throttle at 90ms, batched room patch, no DB write.
- Socket `player:join`, `player:accessory`, `player:sync`, `player:reaction`, `quest:active`, and `social:publish`: send only compact state that the room or clients need.

## Endpoint Risk Map

| Flow | Risk | Watch for |
| --- | --- | --- |
| `/api/player/global` | Medium | must stay on `SocialPost`; never reintroduce member aggregate plus `$unwind` |
| `/api/player/friends` | Medium | external bot server plus DB join; keep timeout/cache/stale-cache/dedupe |
| `/api/player/profile` | Medium | cap submissions and private fields |
| `/api/player/me` | Medium | authenticated background route; never reduce interval back to 5-15s |
| `/api/player/npc-quest` | Medium | action endpoint with growing submissions; keep payload bounded |
| `/api/player/npc-quest/upload` | High | media bytes; production must prefer direct upload/CDN |
| Socket movement | High | hottest event path; throttle, compact, batch, and avoid DB writes |
| Assets/music | Medium | immutable cache, WebP images, lazy audio, no large preload |

## Approved Patterns

Realtime movement:

```js
socket.emit("player:move", { x, y, action });
// Server validates the walkable area, throttles, stores in memory, and broadcasts a compact delta.
// Database position is saved separately by a throttled snapshot API.
```

Action endpoint:

```js
const result = await fetch("/api/player/npc-shop", { method: "POST", body });
// Response returns only the updated interaction state, not unrelated lists or a full global feed.
```

Social post upsert:

```js
// After a quest/challenge submission is saved, upsert a compact feed row.
await upsertSocialPostForSubmission(member, submission);
```

Friends stale cache:

```js
if (cached && cachedAge < FRIENDS_STALE_CACHE_TTL_MS) {
  refreshFriendsInBackground();
  return cloneFriends(cached.friends);
}
```

Static/template data:

```js
// Client cache plus server TTL cache plus invalidation on PUT.
fetch("/api/quest-templates?difficulty=easy");
```

Asset URL:

```js
import { withOptimizedAsset } from "@/lib/basePath";
const src = withOptimizedAsset("/assets/room1.png");
```

## Anti-Patterns

- `setInterval(() => fetch("/api/player/me"), 5000)` for every player.
- `fetch("/api/player/me", { method: "PATCH" })` on every mouse move or joystick tick.
- Returning `normalizeMember(member)` from every small action when the UI needs one field.
- Fetching `/api/player/global` while the modal is closed.
- Building `/api/player/global` from `Member.aggregate()` plus `$unwind` on every request.
- Making `/api/player/friends` wait for the attendance bot when stale cache is available.
- Loading `bgmusic.mp3` with preload auto or repeatedly constructing new long-lived `Audio()` objects.
- Uploading large evidence files through Next.js server memory in production.
- Querying all members and filtering in JavaScript on every request.
- Enabling Socket.IO polling transport by default to hide a proxy issue.

## Review Checklist

Before approving a new data flow, answer:

- Is this realtime, action, background, modal, static, or media?
- How many requests/events per minute will 100 players create?
- Is there an in-flight guard, debounce, throttle, cache, or dedupe?
- Does the payload contain only fields the UI needs now?
- Does the endpoint use projection, lean, limit, maxTimeMS, or cache for DB access?
- Can a write be atomic instead of read-modify-save?
- If the flow lists or aggregates data, does it have TTL cache and pending dedupe?
- If the flow touches assets/media, will browser/CDN cache work?
- Does it stop background work while the tab is hidden?
- Do tests prove the old behavior still works and the request count did not increase?

## Verification

Use the checks that match the change risk:

- Run `npm.cmd run check` after code changes.
- Search client request behavior: `rg -n "fetch\\(|setInterval|socket\\.emit|io\\(" src server.js`
- Search risky API behavior: `rg -n "aggregate|find\\(|save\\(|updateOne|limit\\(|lean\\(|Cache-Control" src/app/api src/lib/player.js`
- For socket/realtime changes, run a 100-120 websocket-client load test and verify clients use websocket-only.
- For assets, verify the HTTP header is `Cache-Control: public, max-age=31536000, immutable`.
- For modal/list endpoints, open the modal repeatedly and verify cache/dedupe prevents duplicate DB work.
- For global/social changes, verify `rg -n "aggregate|unwind" src/lib/player.js src/app/api/player/global src/app/api/player/social-status` returns no hot-path aggregate usage.
- For friends changes, verify stale cache can return immediately while a refresh is pending.
- For action endpoints, test success and error paths and verify the response is enough for the UI without unnecessary full-state refetches.

If a change significantly increases requests per minute, fix the data flow design before adding server resources.

## Production Operations

Use this checklist after deploying game updates or when the server was recently unstable under concurrent player load.

### Current QuestRoomWeb Production Shape

- QuestRoomWeb runs under the `/questroom` base path.
- QuestRoomWeb should listen on `PORT=3001`; port `3000` is used by another service.
- Socket.IO should stay websocket-only in production unless debugging a proxy problem.
- PM2 should run one `questroom` instance because Socket.IO room state is currently in process memory.
- `NPC_CYCLE_RESTORE_ENABLED=false` is the emergency-safe production default while memory growth is being diagnosed. NPC cycle timers still work in memory, but persisted cycle restore/write is skipped on socket join.

Expected production env knobs:

```env
PORT=3001
QUESTROOM_PORT=3001
NEXT_PUBLIC_BASE_PATH=/questroom
NEXT_PUBLIC_SOCKET_ALLOW_POLLING=false
SOCKET_ALLOW_POLLING=false
NODE_MAX_OLD_SPACE_MB=1536
PM2_MAX_MEMORY_RESTART=1800M
NPC_CYCLE_RESTORE_ENABLED=false
SERVER_METRICS_INTERVAL_MS=15000
SERVER_METRICS_RSS_WARN_MB=512
ALLOW_GRIDFS_UPLOADS=false
SOCIAL_POST_AUTO_BACKFILL_ENABLED=false
SOCIAL_POST_BACKFILL_SUBMISSIONS_PER_MEMBER=5
SOCIAL_POST_BACKFILL_MAX_OPERATIONS=500
MAX_ROOM_PLAYERS=300
ROOM_STATE_LIMIT=200
```

### Restart After A Game Update

After pulling code or editing `.env.local` on the server:

```bash
cd /var/www/QuestRoomWeb
npm run build
pm2 startOrReload ecosystem.config.cjs --only questroom --update-env
pm2 save
pm2 flush questroom
pm2 logs questroom --lines 120
```

If PM2 keeps reusing an old environment, fully recreate the app:

```bash
cd /var/www/QuestRoomWeb
pm2 delete questroom
unset PORT
PORT=3001 pm2 start ecosystem.config.cjs --only questroom --update-env
pm2 save
pm2 flush questroom
pm2 logs questroom --lines 120
```

Do not start QuestRoomWeb with `pm2 start npm --name questroom -- start` while also using `ecosystem.config.cjs`; that can create duplicate apps or stale env state.

### Confirm The Correct Port

QuestRoomWeb must bind to port `3001`.

```bash
pm2 env questroom | grep '^PORT'
sudo ss -ltnp | grep ':3001'
sudo ss -ltnp | grep ':3000'
```

Healthy QuestRoomWeb logs should include:

```text
QuestRoomWeb ready on http://0.0.0.0:3001
Open on this computer: http://localhost:3001/questroom
```

If logs show `EADDRINUSE ... port: 3000`, PM2 is still starting QuestRoomWeb with the wrong or stale port. Recreate the app with `QUESTROOM_PORT=3001 PORT=3001` and `--update-env`.

### What To Watch After Restart

For the first 10-20 minutes after opening the game to many players, watch:

```bash
pm2 ls
pm2 logs questroom --lines 120
curl -s http://127.0.0.1:3001/questroom/api/health
```

Important signs:

- `restart` count should not keep increasing.
- `mem` in `pm2 ls` should rise slowly and then stabilize, not climb continuously to the PM2 restart limit.
- Logs should not show `JavaScript heap out of memory`.
- Logs should not show `EADDRINUSE`.
- `[server-metrics]` should be reviewed when present.

When reading `[server-metrics]`, focus on:

- `rssMb` and `heapUsedMb`: memory growth.
- `externalMb`: native/buffer/media pressure.
- `lagMs`: event loop delay.
- `roomPlayers`, `socketToPlayer`, `socketPersonalTimers`: socket state size.
- `socketCycleRestoreTimers` and `npcCycleRestoreCache`: should stay near zero when `NPC_CYCLE_RESTORE_ENABLED=false`.
- `roomPatchBuffers` and `roomPatchTimers`: should not grow without clearing.

If memory continues to climb after `NPC_CYCLE_RESTORE_ENABLED=false`, the next suspects are large Next.js responses, asset/media handling, or another retained in-memory structure. Capture the latest `[server-metrics]` lines before the restart and investigate from those numbers.

### Nginx Checks

The `/questroom` upstream should proxy to `127.0.0.1:3001`, including websocket upgrade for Socket.IO.

```bash
sudo nginx -t
sudo systemctl reload nginx
curl -I http://127.0.0.1:3001/questroom
```

In browser/network logs, Socket.IO should use `transport=websocket`, not long-running `transport=polling` requests.
