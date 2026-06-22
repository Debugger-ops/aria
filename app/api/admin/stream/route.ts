import { NextRequest } from 'next/server';
import { getSessionUser } from '@/lib/auth';
import { getAdminStats } from '@/lib/db';
import { createSubscriber, UPDATES_CHANNEL, REDIS_ENABLED } from '@/lib/redis';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// GET /api/admin/stream — Server-Sent Events.
//
// Pushes fresh admin stats to the dashboard the instant something changes:
//   • With Redis → subscribes to the pub/sub channel that emitEvent() publishes
//     to, so updates arrive in milliseconds (event-driven, no polling).
//   • Without Redis → falls back to polling the DB every few seconds so the
//     dashboard still updates without manual refresh.
//
// Either way the "admin dashboard not updating" problem is solved.

const enc = new TextEncoder();
const POLL_MS = 5000;
const HEARTBEAT_MS = 25000;

export async function GET(request: NextRequest): Promise<Response> {
  const user = await getSessionUser();
  if (!user) return Response.json({ error: 'Not authenticated.' }, { status: 401 });
  if (user.role !== 'admin') return Response.json({ error: 'Admin access required.' }, { status: 403 });

  const stream = new ReadableStream({
    async start(controller) {
      let closed = false;
      const send = (event: string, data: unknown) => {
        if (closed) return;
        try {
          controller.enqueue(enc.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
        } catch { /* controller already closed */ }
      };

      const pushStats = async () => {
        try {
          send('stats', await getAdminStats());
        } catch (err) {
          console.warn('[sse] stats fetch failed:', (err as Error).message);
        }
      };

      // Initial snapshot + tell the client which mode we're in.
      send('meta', { mode: REDIS_ENABLED ? 'realtime' : 'polling', ts: Date.now() });
      await pushStats();

      const heartbeat = setInterval(() => send('ping', { ts: Date.now() }), HEARTBEAT_MS);
      let poll: ReturnType<typeof setInterval> | null = null;

      const subscriber = createSubscriber();
      if (subscriber) {
        // Event-driven path: refresh stats whenever an update is published.
        subscriber.subscribe(UPDATES_CHANNEL).catch((e) =>
          console.warn('[sse] subscribe failed:', (e as Error).message),
        );
        subscriber.on('message', (_channel, raw) => {
          let evt: unknown = null;
          try { evt = JSON.parse(raw); } catch { /* ignore */ }
          send('event', evt);
          void pushStats();
        });
      } else {
        // Fallback path: poll on an interval.
        poll = setInterval(pushStats, POLL_MS);
      }

      const cleanup = () => {
        if (closed) return;
        closed = true;
        clearInterval(heartbeat);
        if (poll) clearInterval(poll);
        if (subscriber) subscriber.quit().catch(() => subscriber.disconnect());
        try { controller.close(); } catch { /* already closed */ }
      };

      request.signal.addEventListener('abort', cleanup);
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    },
  });
}
