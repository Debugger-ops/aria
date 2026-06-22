# Real-Time Admin Dashboard — Redis + Kafka

This document explains the live-update architecture added to fix the admin
dashboard that "wasn't updating", and how Redis and Kafka are used.

## The original problem

The dashboard (`app/admin/page.tsx`) only loaded data **once on mount** and on a
manual **Refresh** click. Two issues made it feel stuck:

1. **No live updates.** New chats and ratings never showed up until you reloaded.
2. **Browser caching.** The `fetch('/api/admin?...')` calls had no cache policy,
   so the browser could serve a stale cached copy even when you did refresh.

## What was added

```
 chat / feedback route
        │  saveMessage() / saveFeedback()   (MongoDB — unchanged)
        │
        └─ emitEvent()                      ← lib/events.ts
              ├─ Kafka  produceEvent()  →  topic "aria.events"   (durable log)
              ├─ Redis  cacheDel()      →  invalidate "aria:stats"
              └─ Redis  publish()       →  channel "aria:updates"
                                                   │
 admin dashboard  ◄── SSE /api/admin/stream ◄── Redis SUBSCRIBE
   (EventSource)        pushes fresh stats        (or 5s polling fallback)
```

### Redis — two jobs (`lib/redis.ts`)
- **Cache:** `getAdminStats()` is cached under `aria:stats` (30s TTL) and
  invalidated on every event, so reads are cheap but never stale.
- **Pub/sub:** `emitEvent()` publishes to `aria:updates`; the SSE endpoint
  subscribes and pushes new stats to the browser in milliseconds.

### Kafka — durable event stream (`lib/kafka.ts`)
- Every message/rating is produced to the `aria.events` topic — an append-only
  log you can replay, feed to analytics, or fan out to other consumers.
- `scripts/consumer.mjs` is a sample consumer that maintains rolling analytics
  counters in Redis (`aria:analytics:*`). Run it with `npm run consumer`.

### Live updates (`app/api/admin/stream/route.ts` + dashboard)
- New **SSE endpoint** streams `stats` events to the dashboard. The dashboard
  connects via `EventSource` and updates state with no spinner flicker.
- A header pill shows the mode: **Live** (Redis pub/sub) or **Auto** (polling).

### The caching bug fix
- All dashboard fetches now use `cache: 'no-store'`.

## Graceful degradation (important)

**Everything is optional.** If `REDIS_URL` / `KAFKA_BROKERS` are not set, each
helper becomes a safe no-op and the dashboard falls back to **5-second polling**.
The app runs exactly as before — just without the millisecond push updates.

## Running it locally

```bash
# 1. Start Redis + Kafka (KRaft, no Zookeeper)
docker compose up -d

# 2. Add to .env.local
REDIS_URL=redis://localhost:6379
KAFKA_BROKERS=localhost:9092

# 3. Run the app (and optionally the analytics consumer)
npm run dev
npm run consumer        # optional, in a second terminal
```

Open `/admin`, chat in another tab, and watch the numbers move with the **Live**
pill lit.

## Files

| File | Purpose |
|------|---------|
| `lib/redis.ts` | Redis client, stats cache, pub/sub helpers |
| `lib/kafka.ts` | Kafka producer (lazy, graceful) |
| `lib/events.ts` | `emitEvent()` — fans out to Kafka + Redis |
| `app/api/admin/stream/route.ts` | SSE live-update endpoint |
| `scripts/consumer.mjs` | Sample Kafka analytics consumer |
| `docker-compose.yml` | Local Redis + Kafka |
| `lib/db.ts` | `getAdminStats()` now Redis-cached |
| `app/api/chat/route.ts`, `app/api/feedback/route.ts` | emit events |
| `app/admin/page.tsx` | EventSource live updates + `no-store` fetches |
