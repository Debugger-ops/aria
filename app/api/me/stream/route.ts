import { NextRequest } from 'next/server';
import { getSessionUser } from '@/lib/auth';
import { getUserStats } from '@/lib/db';
import { createSubscriber, UPDATES_CHANNEL, REDIS_ENABLED } from '@/lib/redis';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// GET /api/me/stream — Server-Sent Events for the PERSONAL dashboard.
//
// The mirror of /api/admin/stream, but scoped to one user:
//   • With Redis → subscribes to the same pub/sub channel emitEvent() writes
//     to, and ignores any event whose userId isn't this user's, so your
//     dashboard doesn't re-render every time somebody else sends a message.
//   • Without Redis → polls the DB on an interval, same as the admin stream.
//
// Only ever returns this user's own stats; there is no way to ask for another
// user's, because the id comes from the session cookie and not the request.

const enc = new TextEncoder();
const POLL_MS = 5000;
const HEARTBEAT_MS = 25000;

export async function GET(request: NextRequest): Promise<Response> {
  const user = await getSessionUser();
  if (!user) return Response.json({ error: 'Not authenticated.' }, { status: 401 });

  const userId = user.id as string;

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
          send('stats', await getUserStats(userId));
        } catch (err) {
          console.warn('[me/sse] stats fetch failed:', (err as Error).message);
        }
      };

      // Initial snapshot + tell the client which mode we're in.
      send('meta', { mode: REDIS_ENABLED ? 'realtime' : 'polling', ts: Date.now() });
      await pushStats();

      const heartbeat = setInterval(() => send('ping', { ts: Date.now() }), HEARTBEAT_MS);
      let poll: ReturnType<typeof setInterval> | null = null;

      const subscriber = createSubscriber();
      if (subscriber) {
        subscriber.subscribe(UPDATES_CHANNEL).catch((e) =>
          console.warn('[me/sse] subscribe failed:', (e as Error).message),
        );
        subscriber.on('message', (_channel, raw) => {
          let evt: { userId?: string } | null = null;
          try { evt = JSON.parse(raw); } catch { return; }

          // Somebody else's activity — not our business.
          if (!evt || evt.userId !== userId) return;

          send('event', evt);
          void pushStats();
        });
      } else {
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
