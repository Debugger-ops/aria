import { NextRequest } from 'next/server';
import { getAdminStats, exportTrainingData, getRecentConversations } from '@/lib/db';

export const runtime = 'nodejs';

// GET /api/admin?action=stats|export|conversations
export async function GET(request: NextRequest): Promise<Response> {
  try {
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

    if (action === 'export') {
      const format = (searchParams.get('format') ?? 'openai') as 'openai' | 'simple';
      const onlyPositive = searchParams.get('onlyPositive') === 'true';
      const data = exportTrainingData(format, onlyPositive);

      return new Response(data, {
        status: 200,
        headers: {
          'Content-Type': 'application/json',
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
