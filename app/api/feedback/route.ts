import { NextRequest } from 'next/server';
import { saveFeedback } from '@/lib/db';

export const runtime = 'nodejs';

interface FeedbackBody {
  messageId: string;
  sessionId: string;
  rating: 'up' | 'down';
  userMessage: string;
  aiReply: string;
}

export async function POST(request: NextRequest): Promise<Response> {
  try {
    const body: FeedbackBody = await request.json();
    const { messageId, sessionId, rating, userMessage, aiReply } = body;

    if (!messageId || !sessionId || !rating || !userMessage || !aiReply) {
      return Response.json(
        { error: 'Missing required fields: messageId, sessionId, rating, userMessage, aiReply' },
        { status: 400 }
      );
    }

    if (rating !== 'up' && rating !== 'down') {
      return Response.json({ error: 'rating must be "up" or "down"' }, { status: 400 });
    }

    saveFeedback(messageId, sessionId, rating, userMessage, aiReply);

    return Response.json({ success: true }, { status: 200 });
  } catch (err) {
    console.error('/api/feedback error:', err);
    return Response.json({ error: 'Internal server error' }, { status: 500 });
  }
}
