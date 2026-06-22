// lib/events.ts — Unified event bus for the app.
//
// One call, three effects (each graceful / optional):
//   1. Kafka   → append the event to a durable topic (analytics / replay)
//   2. Redis   → invalidate the cached admin stats so the next read is fresh
//   3. Redis   → publish a lightweight notification so SSE clients update live
//
// Routes just call emitEvent(...) after they mutate data. The dashboard then
// updates within milliseconds instead of waiting for a manual refresh.

import { produceEvent } from '@/lib/kafka';
import { cacheDel, publishUpdate, STATS_CACHE_KEY } from '@/lib/redis';

export type AriaEventType =
  | 'message.user'
  | 'message.assistant'
  | 'feedback.up'
  | 'feedback.down';

export interface AriaEvent {
  type: AriaEventType;
  sessionId: string;
  /** ISO timestamp; defaults to now. */
  ts?: string;
  /** Optional extra context (messageId, etc.). */
  meta?: Record<string, unknown>;
}

/**
 * Fire-and-forget. Safe to `await` (it never throws) or to call without await.
 * When neither Redis nor Kafka is configured this is effectively a no-op and the
 * dashboard falls back to interval polling — so the app always works.
 */
export async function emitEvent(event: AriaEvent): Promise<void> {
  const payload: AriaEvent = { ts: new Date().toISOString(), ...event };

  await Promise.allSettled([
    produceEvent(payload.sessionId, payload), // 1. durable Kafka log
    cacheDel(STATS_CACHE_KEY),                 // 2. bust stats cache
    publishUpdate(payload),                    // 3. notify SSE subscribers
  ]);
}
