// lib/kafka.ts — Kafka producer singleton with graceful fallback.
//
// Kafka is the durable event log / analytics backbone. Every meaningful action
// (a message sent, a reply generated, a rating given) is produced to a topic so
// it can be consumed by analytics workers, data pipelines, or replayed later.
//
// If KAFKA_BROKERS is not set, the producer becomes a no-op so the app runs
// without a broker. Producing is fire-and-forget and never blocks a request.

import { Kafka, type Producer, logLevel } from 'kafkajs';

const BROKERS = (process.env.KAFKA_BROKERS ?? '')
  .split(',')
  .map((b) => b.trim())
  .filter(Boolean);

export const KAFKA_ENABLED = BROKERS.length > 0;
export const EVENTS_TOPIC = process.env.KAFKA_EVENTS_TOPIC ?? 'aria.events';
export const CLIENT_ID = 'aria-companion';

interface KafkaCache {
  kafka: Kafka | null;
  producer: Producer | null;
  connecting: Promise<Producer | null> | null;
  warned: boolean;
}

declare global {
  var _ariaKafka: KafkaCache | undefined;
}

const cache: KafkaCache =
  global._ariaKafka ?? { kafka: null, producer: null, connecting: null, warned: false };
global._ariaKafka = cache;

export function getKafka(): Kafka | null {
  if (!KAFKA_ENABLED) return null;
  if (!cache.kafka) {
    cache.kafka = new Kafka({
      clientId: CLIENT_ID,
      brokers: BROKERS,
      logLevel: logLevel.ERROR,
      retry: { retries: 3, initialRetryTime: 300 },
    });
  }
  return cache.kafka;
}

/** Lazily connect (and memoise) a shared producer. Returns null if disabled/down. */
export async function getProducer(): Promise<Producer | null> {
  if (!KAFKA_ENABLED) return null;
  if (cache.producer) return cache.producer;
  if (cache.connecting) return cache.connecting;

  const kafka = getKafka();
  if (!kafka) return null;

  cache.connecting = (async () => {
    try {
      const producer = kafka.producer({ allowAutoTopicCreation: true });
      await producer.connect();
      cache.producer = producer;
      return producer;
    } catch (err) {
      if (!cache.warned) {
        console.warn(
          '[kafka] producer connect failed — events will not be streamed:',
          (err as Error).message,
        );
        cache.warned = true;
      }
      return null;
    } finally {
      cache.connecting = null;
    }
  })();

  return cache.connecting;
}

/** Produce one event to the events topic. Fire-and-forget; never throws. */
export async function produceEvent(key: string, value: unknown): Promise<void> {
  try {
    const producer = await getProducer();
    if (!producer) return;
    await producer.send({
      topic: EVENTS_TOPIC,
      messages: [{ key, value: JSON.stringify(value) }],
    });
  } catch (err) {
    console.warn('[kafka] produce failed:', (err as Error).message);
  }
}
