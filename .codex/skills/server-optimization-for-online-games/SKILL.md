---
name: server-optimization-for-online-games
description: Use when writing, reviewing, or modifying any server-side code in QuestRoomWeb — including API routes, Socket.IO event handlers, in-memory caches, MongoDB queries, file uploads, or background tasks. Enforce professional-grade patterns for memory safety, bounded data structures, efficient queries, graceful degradation, and scalable architecture for 100-500+ concurrent players. This skill focuses on the server process itself; for client-server data flow decisions, see api-data-flow-optimization.
---

# Server Optimization for Online Games

## Goal

Use this skill when writing or reviewing **any server-side code** in QuestRoomWeb. The target is a single-process Node.js game server that stays stable under 500 concurrent players with predictable memory usage, fast response times, and zero silent data loss.

This skill covers the **server internals**: memory management, in-memory data structures, database access, process lifecycle, and operational safety. For **what data flows between client and server** (transport choice, polling intervals, payload shapes), see the companion `api-data-flow-optimization` skill.

Short rule: every `Map` has a cap, every cache has a prune, every query has a limit, every buffer has a ceiling, every timer has a cleanup, and every process restart preserves game state.

---

## Hard Rules — Memory Safety

These rules are non-negotiable. Breaking any one of them creates a memory leak that will crash the server under sustained load.

### 1. Every In-Memory Map/Set Must Have a Size Limit and Cleanup

```js
// ✅ CORRECT — bounded with TTL + max size + prune function
const CACHE_MAX = Math.max(50, Number(process.env.MY_CACHE_MAX || 200));
const CACHE_TTL_MS = Math.max(5_000, Number(process.env.MY_CACHE_TTL_MS || 30_000));
const myCache = new Map();

function pruneMyCache(now = Date.now()) {
  for (const [key, entry] of myCache) {
    if (!entry || now - entry.cachedAt >= CACHE_TTL_MS) myCache.delete(key);
  }
  if (myCache.size <= CACHE_MAX) return;
  const overflow = myCache.size - CACHE_MAX;
  const oldestKeys = [...myCache.entries()]
    .sort(([, a], [, b]) => (a?.cachedAt || 0) - (b?.cachedAt || 0))
    .slice(0, overflow)
    .map(([key]) => key);
  for (const key of oldestKeys) myCache.delete(key);
}

// ❌ WRONG — unbounded Map, no TTL, no prune
const dangerousCache = new Map();
dangerousCache.set(key, data); // grows forever
```

**Checklist for every new `Map`/`Set`/`Object` used as server state:**
- [ ] Has a `MAX_SIZE` constant (configurable via env)
- [ ] Has a `TTL_MS` constant (configurable via env)
- [ ] Has a `prune*()` function called on reads and periodically
- [ ] Entries store a timestamp (`cachedAt`, `loadedAt`, `rememberedAt`, etc.)
- [ ] Is cleaned up on socket disconnect / player leave
- [ ] Is cleared in the pressure relief handler (`__questRoomRuntimePressureRelief`)

### 2. Every Socket Disconnect Must Clean Up All Associated State

When a player disconnects, **every** Map/Set/Timer that references their socket ID or player ID must be cleaned:

```js
socket.on("disconnect", () => {
  // Clean ALL per-socket state:
  clearCycleRestoreTimer(socket.id);
  clearPersonalTimer(socket.id);
  socketFrozenMs.delete(socket.id);
  socketPermanentReductionMs.delete(socket.id);
  socketToPlayer.delete(socket.id);
  socketPlayerCoins.delete(socket.id);
  forgetActiveNpcVisit(activePlayerId);
  // IMPORTANT: Also clean playerStages, playerNpcQuest, etc. via detachPlayer
  detachPlayer({ removeIfOffline: true });
});
```

**When adding a new per-socket or per-player Map:**
1. Add its `.delete()` call to the `disconnect` handler
2. Add it to `detachPlayer()` if keyed by player ID
3. Add it to the pressure relief handler if applicable
4. Document it in the `[server-metrics]` log output

### 3. Never Buffer Entire Files in Heap Memory

```js
// ❌ WRONG — entire file sits in V8 heap as a Buffer
const buffer = Buffer.from(await file.arrayBuffer());
await s3.send(new PutObjectCommand({ Body: buffer }));

// ✅ CORRECT — stream directly without heap buffering
const stream = file.stream();
await s3.send(new PutObjectCommand({ Body: stream }));
```

For file uploads (images, videos, evidence):
- Use **streaming** when uploading to R2/S3/external storage
- If streaming is not possible, enforce **strict size limits** and **concurrent upload limits**
- GridFS writes already use streams — keep that pattern
- Monitor `externalMb` in server metrics for buffer pressure

### 4. Never Let Arrays in MongoDB Documents Grow Unbounded

```js
// ❌ WRONG — array grows forever per member
member.npcQuestSubmissions.push(newSubmission);

// ✅ CORRECT — cap the array, keep only recent entries
const MAX = Number(process.env.MAX_NPC_QUEST_SUBMISSIONS || 50);
if (member.npcQuestSubmissions.length >= MAX) {
  member.npcQuestSubmissions = member.npcQuestSubmissions.slice(-MAX + 1);
  member.markModified("npcQuestSubmissions");
}
member.npcQuestSubmissions.push(newSubmission);
```

MongoDB has a 16MB document limit. Unbounded arrays in frequently-updated documents will:
- Slow down every query that loads that document
- Increase memory usage on the server (Mongoose hydration)
- Eventually hit the 16MB wall and cause write failures

---

## Hard Rules — Database Efficiency

### 5. Every List/Find Query Must Use Projection, Lean, Limit, and Timeout

```js
// ✅ CORRECT — all four safeguards present
const members = await Member.find({ stage: stageKey })
  .select("discord_id nick nickname discordData stage roomPosition")  // projection
  .lean()                    // skip Mongoose hydration, save ~40% memory
  .limit(MAX_ROOM_PLAYERS)   // hard cap on results
  .maxTimeMS(5_000);         // kill slow queries

// ❌ WRONG — loads entire documents, no limit, no timeout
const members = await Member.find({ stage: stageKey });
```

### 6. Every Field Used in a Query Filter or Sort Must Have an Index

Before writing a `find()` or `findOne()` with a filter, verify the index exists:

```js
// If you write this query:
Member.find({ "profileAchievements.label": levelName })

// Then Member.js MUST have this index:
MemberSchema.index({ "profileAchievements.label": 1 });
```

**Current QuestRoomWeb indexes to maintain:**

| Collection | Index | Purpose |
|------------|-------|---------|
| `members` | `{ discord_id: 1 }` (unique, sparse) | Primary lookup |
| `members` | `{ stage: 1, lastAuthentication: -1 }` | Room player queries |
| `members` | `{ discord_id: 1, socialLastSeenAt: 1 }` | Social status |
| `members` | `{ "npcQuestSubmissions.submittedAt": -1 }` | Backfill ordering |
| `members` | `{ "questChallenge.approvedAt": -1 }` | Challenge sync |
| `members` | `{ "profileAchievements.label": 1 }` | Stage ranking |
| `members` | `{ courses: 1 }` | Friends by course |
| `social_posts` | `{ visible: 1, publishedAt: -1, postId: -1 }` | Feed pagination |
| `social_posts` | `{ authorId: 1, visible: 1, publishedAt: -1 }` | Per-author feed |
| `quest_templates` | `{ difficulty: 1 }` | Quest shop queries |

**When adding a new query pattern**: add the index in the model file, document it here, and verify with `.explain()` that the query uses it.

### 7. Prefer Atomic Updates Over Read-Modify-Save

```js
// ✅ CORRECT — atomic, no race condition
await Member.updateOne(
  { discord_id: id },
  { $inc: { coin: amount } }
);

// ❌ RISKY — race condition if two requests modify concurrently
const member = await Member.findOne({ discord_id: id });
member.coin = String(Number(member.coin) + amount);
await member.save();
```

Use `findOneAndUpdate` with `$set`, `$inc`, `$push`, `$pull` when possible. Reserve `member.save()` for complex multi-field business logic that truly requires read-modify-save.

### 8. Never Run Redundant Database Operations

```js
// ❌ WRONG — $setOnInsert already handles the insert case
await Member.findOneAndUpdate(
  { discord_id },
  { $set: { ... }, $setOnInsert: { stage: "game-demo-1" } },
  { upsert: true }
);
// These 3 updateOne calls duplicate what $setOnInsert already did:
await Member.updateOne({ discord_id, stage: { $exists: false } }, { $set: { stage } });
await Member.updateOne({ discord_id, quest: { $exists: false } }, { $set: { quest } });
await Member.updateOne({ discord_id, roomPosition: { $exists: false } }, { $set: { roomPosition } });

// ✅ CORRECT — one operation handles both insert and update
await Member.findOneAndUpdate(
  { discord_id },
  { $set: { lastAuthentication: new Date() }, $setOnInsert: { stage, quest, roomPosition } },
  { upsert: true, new: true }
);
```

---

## Hard Rules — Socket.IO & Realtime

### 9. Broadcast Events to the Narrowest Possible Scope

```js
// ❌ WRONG — sends to ALL connected sockets across ALL stages
socket.broadcast.emit("social:notification", data);

// ✅ CORRECT — sends only to sockets in the same room/stage
socket.to(activeStage).emit("social:notification", data);

// ✅ ALSO CORRECT — server-wide is fine for targeted events
io.to(activeStage).emit("challenge:announce", data);
```

| Event type | Scope | Reason |
|------------|-------|--------|
| Player movement/reaction | `io.to(stage)` | Only relevant to same room |
| Room state patch | `io.volatile.to(stage)` | Same room, lossy OK |
| Social notification | `socket.to(stage)` | Only visible to nearby players |
| Challenge announce | `io.to(stage)` | Same stage only |
| Member update | `socket.emit` (single socket) | Private to the player |
| Questroom reload | `io.to(stage)` or `socket.emit` | Stage-level or single player |

### 10. Batch and Throttle High-Frequency Events

Room state patches should be batched, not sent per-event:

```js
// ✅ CORRECT — buffer changes and flush periodically
function queueRoomPatch(stage, playerId, patch) {
  if (!roomPatchBuffers.has(stage)) roomPatchBuffers.set(stage, new Map());
  roomPatchBuffers.get(stage).set(playerId, patch);
  if (!roomPatchTimers.has(stage)) {
    roomPatchTimers.set(stage, setTimeout(() => {
      flushRoomPatch(stage);
      roomPatchTimers.delete(stage);
    }, ROOM_PATCH_INTERVAL_MS));  // 250ms
  }
}
```

**Tuning guideline:**
- `ROOM_PATCH_INTERVAL_MS`: 200–500ms. Lower = smoother, higher = less bandwidth
- At 250ms with 300 players: ~4 patches/sec × 300 players = 1,200 messages/sec
- At 100ms: 3,000 messages/sec — too much for a single Node.js process

### 11. Use Volatile Emit for Non-Critical Realtime Data

```js
// Volatile = OK to drop if the client is busy/lagging
io.volatile.to(stage).emit("room:state", roomState);

// Non-volatile = guaranteed delivery for important events
io.to(stage).emit("challenge:announce", data);
```

Movement, position, and room patches can be volatile. Quest submissions, rewards, and balance changes must not be.

---

## Cache Architecture

### The Four-Layer Cache Pattern Used in QuestRoomWeb

Every cacheable data source should follow this pattern:

```
Layer 1: Fresh cache (TTL 5-60s, returns immediately)
Layer 2: Pending promise dedupe (same cache key → share one in-flight query)
Layer 3: Stale cache fallback (TTL 60-900s, return stale + refresh in background)
Layer 4: Database query (with projection, limit, lean, maxTimeMS)
```

Implementation:

```js
export async function getCachedData(key) {
  // Layer 1: Fresh cache
  const cached = cache.get(key);
  if (cached && Date.now() - cached.cachedAt < CACHE_TTL_MS) {
    return cloneData(cached.data);
  }

  // Layer 2: Pending dedupe
  if (pendingLoads.has(key)) {
    // Layer 3: Stale fallback while pending
    if (cached && Date.now() - cached.cachedAt < STALE_TTL_MS) {
      return cloneData(cached.data);
    }
    return cloneData(await pendingLoads.get(key));
  }

  // Layer 4: Fresh load
  const loadPromise = (async () => {
    const data = await Model.find(query).lean().limit(MAX).maxTimeMS(TIMEOUT);
    cache.set(key, { data, cachedAt: Date.now() });
    return data;
  })().finally(() => pendingLoads.delete(key));

  pendingLoads.set(key, loadPromise);
  return cloneData(await loadPromise);
}
```

**Current QuestRoomWeb cache inventory:**

| Cache | Max Size | Fresh TTL | Stale TTL | Prune | Location |
|-------|----------|-----------|-----------|-------|----------|
| `roomPlayersCache` | 200 stages | 5s | — | ✅ `pruneRoomPlayersCache` | player.js |
| `cachedStageRankings` | 50 keys | 60s | — | ✅ `pruneStageRankingsCache` | player.js |
| `cachedGlobalPosts` | 200 keys | 15s | — | ✅ `pruneGlobalPostsCache` | player.js |
| `cachedClassFriends` | 200 keys | 60s | 900s | ✅ `pruneClassFriendsCache` | player.js |
| `cachedSocialActivity` | 1 value | 10s | 120s | Single value replace | player.js |
| `cachedActiveClasses` | 1 value | 60s | — | Single value replace | player.js |
| `cachedLevels` | 1 value | 300s | — | Single value replace | player.js |
| `levelConfigCache` | per stage | 300s | — | TTL on read | server.js |
| `npcCycleRestoreCache` | 1,000 | 15s | — | ✅ `pruneNpcCycleRestoreCache` | server.js |
| `activeNpcVisits` | 2,000 | 300s | — | ✅ `pruneActiveNpcVisits` | server.js |

**When adding a new cache:** create it following this table's pattern — pick a max size, TTL, and prune function. Add it to this table. Add it to the pressure relief handler.

---

## Heap Guard & Process Lifecycle

### How the Heap Guard Works

QuestRoomWeb has a three-tier memory defense:

```
Tier 1: Heap Guard Warning (72% of NODE_MAX_OLD_SPACE_MB)
  → Log warnings, pause entry queue, shed non-critical requests

Tier 2: Heap Guard Critical (88% of NODE_MAX_OLD_SPACE_MB)
  → Clear all caches, disconnect load-test sockets, return 503 for non-essential routes

Tier 3: PM2 max_memory_restart (1800M RSS)
  → PM2 kills and restarts the process
```

**When adding new features:**
- Estimate the memory footprint per player: `(bytes per entry × max entries)`
- Verify total across all Maps stays well below the Warning threshold
- Add your cleanup to the pressure relief callback if applicable

### Memory Budget Estimation

For 300 concurrent players, estimate per-Map:

| Map | Per-entry size | Max entries | Total |
|-----|---------------|-------------|-------|
| `rooms` (player objects) | ~500B | 300 | 150 KB |
| `socketToPlayer` | ~50B | 300 | 15 KB |
| `playerStages` | ~50B | 300 | 15 KB |
| `activeNpcVisits` | ~500B | 2,000 | 1 MB |
| `npcCycleRestoreCache` | ~200B | 1,000 | 200 KB |
| `roomPlayersCache` | ~100KB per stage | 200 stages | 20 MB |
| `cachedClassFriends` | ~50KB per class | 200 classes | 10 MB |
| **Total estimate** | | | **~35 MB** |

Keep total in-memory state under 100MB to leave headroom for V8 garbage collection, Mongoose buffers, and Next.js SSR.

---

## API Route Patterns

### Request Rate Estimation

Before adding or modifying an API endpoint, calculate:

```
requests/minute = concurrent_players × frequency_per_player_per_minute
```

| Endpoint | Players | Frequency | RPM | Acceptable? |
|----------|---------|-----------|-----|-------------|
| `GET /api/player/me` | 300 | 1/120s | 150 | ✅ |
| `GET /api/player/room` | 300 | 1/300s | 60 | ✅ |
| `GET /api/player/social-status` | 300 | 1/300s | 60 | ✅ |
| `POST /api/player/npc-quest` | 300 | 1/600s | 30 | ✅ |
| ~~`GET /api/player/me` at 5s interval~~ | 300 | 12/min | 3,600 | ❌ |
| ~~Unthrottled ranking fetch~~ | 300 | on-render | 3,000+ | ❌ |

**Hard limit**: No single endpoint should exceed **500 RPM** under normal 300-player load.

### Response Shape: Return Deltas, Not Full Objects

```js
// ❌ WRONG — returns the entire member + all submissions + all achievements
return NextResponse.json({ member: normalizeMember(member) });

// ✅ CORRECT — return only what changed
return NextResponse.json({ ok: true, coins: member.questCoin, reward: 50 });
```

### Error Handling: Always Use try/catch and Return Structured Errors

```js
export async function POST(request) {
  try {
    // ... business logic
    return NextResponse.json({ ok: true, result });
  } catch (error) {
    const status = ERROR_STATUS_MAP[error.message] || 500;
    return NextResponse.json({ error: error.message }, { status });
  }
}
```

Never let an unhandled exception crash the process from an API route.

---

## Anti-Patterns — Things That WILL Cause Memory Leaks

| Anti-Pattern | Why It's Dangerous | Fix |
|-------------|-------------------|-----|
| `new Map()` without max size | Grows forever until OOM | Add `MAX` + `prune()` |
| `array.push()` in MongoDB doc without cap | Document grows to 16MB | Add `.slice(-MAX)` before push |
| `Buffer.from(await file.arrayBuffer())` | Entire file in V8 heap | Use `file.stream()` |
| `socket.broadcast.emit()` for room events | O(all sockets) instead of O(room) | Use `socket.to(room).emit()` |
| Fire-and-forget `void promise.then(...)` with no `.catch()` | Silent failures, dangling promises | Always `.catch(console.warn)` |
| `Member.find({})` without `.limit()` | Loads entire collection | Always `.limit(N)` |
| `setInterval` without `clearInterval` on disconnect | Timer leak, callbacks reference dead sockets | Store timer ID, clear on disconnect |
| Cache without TTL | Stale data forever, never freed | Add TTL + periodic prune |
| `strict: false` on Mongoose schema | Documents can store arbitrary garbage | Use explicit schemas or validate on write |
| Storing version counters in Maps without cleanup | Grows with every unique key ever seen | Prune alongside parent cache |

---

## Environment Variable Reference

Server-tunable knobs for scaling. All have sensible defaults but can be adjusted per deployment:

### Memory & Process
```env
NODE_MAX_OLD_SPACE_MB=1536          # V8 heap limit
PM2_MAX_MEMORY_RESTART=1800M        # PM2 auto-restart RSS threshold
HEAP_GUARD_ENABLED=true             # Enable heap pressure detection
HEAP_GUARD_WARN_MB=                 # Auto: 72% of NODE_MAX_OLD_SPACE_MB
HEAP_GUARD_CRIT_MB=                 # Auto: 88% of NODE_MAX_OLD_SPACE_MB
```

### Caches & Limits
```env
ROOM_PLAYERS_CACHE_TTL_MS=5000      # Room player cache freshness
ROOM_PLAYERS_CACHE_MAX_STAGES=200   # Max cached stages
RANKING_CACHE_TTL_MS=60000          # Ranking cache freshness
RANKING_CACHE_MAX_KEYS=50           # Max cached rankings
RANKING_LIMIT=100                   # Max players in ranking
MAX_NPC_QUEST_SUBMISSIONS=50        # Cap on per-member submissions array
ACTIVE_NPC_VISITS_MAX=2000          # Max tracked NPC visits
ACTIVE_NPC_VISITS_TTL_MS=300000     # NPC visit TTL (5 minutes)
NPC_CYCLE_RESTORE_CACHE_MAX=1000    # Max cached NPC cycles
FRIENDS_CACHE_MAX_KEYS=200          # Max cached class friend lists
GLOBAL_POSTS_CACHE_MAX_KEYS=200     # Max cached feed pages
```

### Socket & Realtime
```env
ROOM_PATCH_INTERVAL_MS=250          # Room patch batch interval
MAX_ROOM_PLAYERS=300                # Max players per room
ROOM_STATE_LIMIT=200                # Max players in room state response
SOCKET_ALLOW_POLLING=false          # Keep websocket-only in production
```

### Database
```env
MONGODB_MAX_POOL_SIZE=20            # Connection pool size (~1MB per connection)
MEMBER_LIST_QUERY_MAX_TIME_MS=5000  # Query timeout for list operations
SOCIAL_POSTS_QUERY_MAX_TIME_MS=3000 # Query timeout for social queries
```

---

## Review Checklist — Before Merging Server-Side Changes

### Memory Safety
- [ ] Every new `Map`/`Set` has a max size constant and prune function
- [ ] Every new per-socket state is cleaned in the `disconnect` handler
- [ ] No `Buffer.from(await file.arrayBuffer())` for files > 1MB
- [ ] No MongoDB array grows without a cap
- [ ] New state is cleared in the pressure relief handler

### Database
- [ ] Every `find()`/`findOne()` uses `.select()`, `.lean()`, `.limit()`, `.maxTimeMS()`
- [ ] Every query filter field has a matching index in the model file
- [ ] Prefer atomic updates (`$set`, `$inc`) over read-modify-save
- [ ] No redundant sequential queries that could be one operation

### Socket.IO
- [ ] Room events use `io.to(stage)` or `socket.to(stage)`, not `broadcast.emit`
- [ ] High-frequency events are batched (room patches) or throttled
- [ ] Non-critical events use `volatile.emit`
- [ ] New timers are cleared on disconnect

### API Routes
- [ ] Estimated RPM for 300 players stays under 500
- [ ] Response contains only fields the UI needs (delta, not full object)
- [ ] Has try/catch with structured error responses
- [ ] Cached/deduped if it's a read endpoint that multiple players hit
- [ ] No fire-and-forget promises without `.catch()`

### Observability
- [ ] New Maps are logged in `[server-metrics]` output
- [ ] New env knobs are documented in `.env.example`
- [ ] Estimated memory impact is calculated and documented

---

## Quick Reference — Current Architecture

```
┌─────────────────────────────────────────────────────────┐
│                    PM2 Process Manager                  │
│            max_memory_restart: 1800MB RSS               │
├─────────────────────────────────────────────────────────┤
│                 Node.js Process (single)                │
│              V8 heap limit: 1536MB                      │
│                                                         │
│  ┌─────────────────────────────────────────────────┐    │
│  │              Heap Guard                          │    │
│  │  Warning: ~1106MB  │  Critical: ~1352MB          │    │
│  │  → pause queue     │  → shed requests + caches   │    │
│  └─────────────────────────────────────────────────┘    │
│                                                         │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐  │
│  │  Next.js SSR  │  │  Socket.IO   │  │  Heap Guard  │  │
│  │  API Routes   │  │  Realtime    │  │  Entry Queue │  │
│  └──────┬───────┘  └──────┬───────┘  └──────────────┘  │
│         │                  │                             │
│  ┌──────┴──────────────────┴──────┐                     │
│  │        In-Memory State         │                     │
│  │  rooms, caches, timers, maps   │                     │
│  │  Target: < 100MB total         │                     │
│  └──────────────┬─────────────────┘                     │
│                 │                                        │
├─────────────────┼────────────────────────────────────────┤
│                 ▼                                        │
│  ┌──────────────────────┐  ┌─────────────────────┐      │
│  │  MongoDB Atlas        │  │  R2 Object Storage  │      │
│  │  Pool: 20 connections │  │  Media / Uploads    │      │
│  └──────────────────────┘  └─────────────────────┘      │
└─────────────────────────────────────────────────────────┘
```

This is a **single-process** architecture because Socket.IO room state is stored in process memory. Do not run multiple PM2 instances without first adding Redis adapter for Socket.IO and moving in-memory state to a shared store.
