import { NextRequest } from 'next/server';
import { getAdminStats, exportTrainingData, getRecentConversations, getAllConversations } from '@/lib/db';
import { getSessionUser, getAllUsers } from '@/lib/auth';

export const runtime = 'nodejs';

// GET /api/admin?action=stats|export|conversations|chart-data|users
export async function GET(request: NextRequest): Promise<Response> {
  try {
    // Auth check — admin only
    const user = await getSessionUser();
    if (!user) return Response.json({ error: 'Not authenticated.' }, { status: 401 });
    if (user.role !== 'admin') return Response.json({ error: 'Admin access required.' }, { status: 403 });

    const { searchParams } = new URL(request.url);
    const action = searchParams.get('action') ?? 'stats';

    if (action === 'stats') {
      const stats = getAdminStats();
      return Response.json(stats, { status: 200 });
    }

    if (action === 'conversations') {
      const convs = getRecentConversations(50);
      return Response.json(convs, { status: 200 });
    }

    if (action === 'users') {
      const users = getAllUsers();
      return Response.json(users, { status: 200 });
    }

    if (action === 'chart-data') {
      // Build messages-per-day for last 14 days
      const convs = getAllConversations();
      const now   = new Date();
      const days: Record<string, { user: number; ai: number }> = {};

      for (let i = 13; i >= 0; i--) {
        const d = new Date(now);
        d.setDate(d.getDate() - i);
        const key = d.toISOString().slice(0, 10);
        days[key] = { user: 0, ai: 0 };
      }

      for (const conv of convs) {
        for (const msg of conv.messages) {
          const key = msg.timestamp.slice(0, 10);
          if (days[key]) {
            if (msg.role === 'user')      days[key].user++;
            else                          days[key].ai++;
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

    if (action === 'export') {
      const format      = (searchParams.get('format') ?? 'openai') as 'openai' | 'simple';
      const onlyPositive = searchParams.get('onlyPositive') === 'true';
      const data = exportTrainingData(format, onlyPositive);

      return new Response(data, {
        status: 200,
        headers: {
          'Content-Type':        'application/json',
          'Content-Disposition': `attachment; filename="aria-training-${format}-${Date.now()}.jsonl"`,
        },
      });
    }

    return Response.json({ error: 'Unknown action' }, { status: 400 });
  } catch (err) {
    console.error('/api/admin error:', err);
    return Response.json({ error: 'Internal server error' }, { status: 500 });
  }
}
