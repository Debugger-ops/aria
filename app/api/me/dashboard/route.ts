import { NextRequest } from 'next/server';
import { getSessionUser } from '@/lib/auth';
import { getUserStats, getUserConversations } from '@/lib/db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// GET /api/me/dashboard?action=stats|conversations|chart-data
//
// Personal dashboard — returns ONLY the signed-in user's own data. Any
// authenticated user can call it (no admin role required); each user can only
// ever see their own conversations because every query is filtered by their id.
export async function GET(request: NextRequest): Promise<Response> {
  try {
    const user = await getSessionUser();
    if (!user) return Response.json({ error: 'Not authenticated.' }, { status: 401 });

    const userId = user.id as string;
    const action = new URL(request.url).searchParams.get('action') ?? 'stats';

    if (action === 'stats') {
      return Response.json(await getUserStats(userId), { status: 200 });
    }

    if (action === 'conversations') {
      return Response.json(await getUserConversations(userId), { status: 200 });
    }

    if (action === 'chart-data') {
      const convs = await getUserConversations(userId);
      const now = new Date();
      const days: Record<string, { user: number; ai: number }> = {};

      for (let i = 13; i >= 0; i--) {
        const d = new Date(now);
        d.setDate(d.getDate() - i);
        days[d.toISOString().slice(0, 10)] = { user: 0, ai: 0 };
      }

      for (const conv of convs) {
        for (const msg of conv.messages) {
          const key = msg.timestamp.slice(0, 10);
          if (days[key]) {
            if (msg.role === 'user') days[key].user++;
            else                     days[key].ai++;
          }
        }
      }

      const chartData = Object.entries(days).map(([date, counts]) => ({
        date,
        label: new Date(date + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
        ...counts,
        total: counts.user + counts.ai,
      }));

      return Response.json(chartData, { status: 200 });
    }

    return Response.json({ error: 'Unknown action' }, { status: 400 });
  } catch (err) {
    console.error('/api/me/dashboard error:', err);
    return Response.json({ error: 'Internal server error' }, { status: 500 });
  }
}
