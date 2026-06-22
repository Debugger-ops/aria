// scripts/consumer.mjs — Kafka analytics consumer (standalone worker).
//
// Demonstrates the streaming side of the pipeline: it consumes every event the
// app produces to the `aria.events` topic and maintains rolling analytics
// counters in Redis (per-type totals + per-day buckets). Run it alongside
// `next dev` to see the durable event log being processed:
//
//     node scripts/consumer.mjs
//
// It reads the same env vars as the app (KAFKA_BROKERS, REDIS_URL). If Kafka
// isn't configured it exits cleanly.

import { readFileSync } from 'node:fs';
import { Kafka, logLevel } from 'kafkajs';
import Redis from 'ioredis';

// Minimal .env.local loader (no external dependency needed).
try {
  for (const line of readFileSync(new URL('../.env.local', import.meta.url), 'utf8').split('\n')) {
    const m = line.match(/^\s*([\w.]+)\s*=\s*(.*)\s*$/);
    if (m && !line.trim().startsWith('#') && process.env[m[1]] === undefined) {
      process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
    }
  }
} catch { /* no .env.local — rely on real env */ }

const BROKERS = (process.env.KAFKA_BROKERS ?? '')
  .split(',')
  .map((b) => b.trim())
  .filter(Boolean);

const TOPIC = process.env.KAFKA_EVENTS_TOPIC ?? 'aria.events';

if (BROKERS.length === 0) {
  console.error('KAFKA_BROKERS not set — nothing to consume. Exiting.');
  process.exit(0);
}

const redis = process.env.REDIS_URL ? new Redis(process.env.REDIS_URL) : null;
if (redis) redis.on('error', (e) => console.warn('[consumer] redis error:', e.message));

const kafka = new Kafka({
  clientId: 'aria-analytics-consumer',
  brokers: BROKERS,
  logLevel: logLevel.ERROR,
});

const consumer = kafka.consumer({ groupId: 'aria-analytics' });

async function run() {
  await consumer.connect();
  await consumer.subscribe({ topic: TOPIC, fromBeginning: true });
  console.log(`[consumer] listening on "${TOPIC}" via ${BROKERS.join(', ')}`);

  await consumer.run({
    eachMessage: async ({ message }) => {
      let event;
      try {
        event = JSON.parse(message.value?.toString() ?? '{}');
      } catch {
        return;
      }
      const type = event.type ?? 'unknown';
      const day = (event.ts ?? new Date().toISOString()).slice(0, 10);

      console.log(`[consumer] ${day}  ${type}  session=${event.sessionId ?? '—'}`);

      if (redis) {
        try {
          await redis
            .multi()
            .hincrby('aria:analytics:totals', type, 1)
            .hincrby(`aria:analytics:byday:${day}`, type, 1)
            .expire(`aria:analytics:byday:${day}`, 60 * 60 * 24 * 30) // keep 30d
            .exec();
        } catch (e) {
          console.warn('[consumer] redis write failed:', e.message);
        }
      }
    },
  });
}

run().catch((err) => {
  console.error('[consumer] fatal:', err);
  process.exit(1);
});

const shutdown = async () => {
  console.log('\n[consumer] shutting down…');
  try { await consumer.disconnect(); } catch {}
  if (redis) redis.disconnect();
  process.exit(0);
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
