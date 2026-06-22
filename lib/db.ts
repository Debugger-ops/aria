// lib/db.ts — MongoDB-backed conversation + feedback storage

import { connectToDatabase } from '@/lib/mongoose';
import { Conversation, Feedback } from '@/lib/models';
import { cacheGetJSON, cacheSetJSON, STATS_CACHE_KEY } from '@/lib/redis';

// ── Types (kept identical so callers don't change) ────────────────

export type MessageRole = 'user' | 'assistant';

export interface DbMessage {
  id: string;
  role: MessageRole;
  content: string;
  timestamp: string;
}

export interface DbConversation {
  sessionId: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  messages: DbMessage[];
}

export interface DbFeedback {
  id: string;
  messageId: string;
  sessionId: string;
  rating: 'up' | 'down';
  userMessage: string;
  aiReply: string;
  createdAt: string;
}

export interface AdminStats {
  totalConversations: number;
  totalMessages: number;
  totalUserMessages: number;
  totalAiMessages: number;
  thumbsUp: number;
  thumbsDown: number;
  exportableTrainingPairs: number;
}

// ── Init (no-op — connection is handled per-call) ─────────────────

export function initDb(): void { /* handled by connectToDatabase() */ }

// ── Conversations ─────────────────────────────────────────────────

export async function saveMessage(
  sessionId: string,
  title: string,
  role: MessageRole,
  content: string,
  messageId: string,
): Promise<void> {
  await connectToDatabase();
  const now = new Date().toISOString();
  const msg: DbMessage = { id: messageId, role, content, timestamp: now };

  await Conversation.findOneAndUpdate(
    { sessionId },
    {
      $set:  { title, updatedAt: now },
      $push: { messages: msg },
      $setOnInsert: { createdAt: now },
    },
    { upsert: true, returnDocument: 'after' }
  );
}

export async function getAllConversations(): Promise<DbConversation[]> {
  await connectToDatabase();
  const docs = await Conversation.find({}).lean();
  return docs as unknown as DbConversation[];
}

export async function getRecentConversations(limit = 20): Promise<DbConversation[]> {
  await connectToDatabase();
  const docs = await Conversation.find({})
    .sort({ updatedAt: -1 })
    .limit(limit)
    .lean();
  return docs as unknown as DbConversation[];
}

// ── Feedback ──────────────────────────────────────────────────────

export async function saveFeedback(
  messageId: string,
  sessionId: string,
  rating: 'up' | 'down',
  userMessage: string,
  aiReply: string,
): Promise<void> {
  await connectToDatabase();
  const now = new Date().toISOString();
  await Feedback.findOneAndUpdate(
    { messageId },
    {
      $set: {
        id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
        sessionId,
        rating,
        userMessage,
        aiReply,
        createdAt: now,
      },
    },
    { upsert: true }
  );
}

export async function getFeedbackForMessage(messageId: string): Promise<DbFeedback | null> {
  await connectToDatabase();
  const doc = await Feedback.findOne({ messageId }).lean();
  return doc as unknown as DbFeedback | null;
}

// ── Stats ─────────────────────────────────────────────────────────

export async function getAdminStats(): Promise<AdminStats> {
  // Serve from Redis when warm — the cache is invalidated on every new
  // message/feedback event (see lib/events.ts), so it's never meaningfully stale.
  const cached = await cacheGetJSON<AdminStats>(STATS_CACHE_KEY);
  if (cached) return cached;

  await connectToDatabase();
  const [convs, feedback] = await Promise.all([
    Conversation.find({}).lean(),
    Feedback.find({}).lean(),
  ]);

  let totalMessages = 0, totalUserMessages = 0, totalAiMessages = 0;
  for (const c of convs) {
    const msgs = (c as unknown as DbConversation).messages;
    totalMessages     += msgs.length;
    totalUserMessages += msgs.filter(m => m.role === 'user').length;
    totalAiMessages   += msgs.filter(m => m.role === 'assistant').length;
  }

  const stats: AdminStats = {
    totalConversations:      convs.length,
    totalMessages,
    totalUserMessages,
    totalAiMessages,
    thumbsUp:                feedback.filter((f: Record<string, unknown>) => f.rating === 'up').length,
    thumbsDown:              feedback.filter((f: Record<string, unknown>) => f.rating === 'down').length,
    exportableTrainingPairs: totalAiMessages,
  };

  await cacheSetJSON(STATS_CACHE_KEY, stats);
  return stats;
}

// ── Export: JSONL for fine-tuning ─────────────────────────────────

const SYSTEM_PROMPT_EXPORT = `You are Aria, a warm and intelligent AI companion. Be helpful, empathetic, and concise.`;

export async function exportTrainingData(
  format: 'openai' | 'simple' = 'openai',
  onlyPositive = false,
): Promise<string> {
  await connectToDatabase();
  const [convs, feedback] = await Promise.all([
    Conversation.find({}).lean(),
    Feedback.find({}).lean(),
  ]);

  const positiveIds = new Set(
    feedback
      .filter((f: Record<string, unknown>) => f.rating === 'up')
      .map((f: Record<string, unknown>) => f.messageId as string)
  );

  const lines: string[] = [];

  for (const conv of convs) {
    const msgs = (conv as unknown as DbConversation).messages;
    for (let i = 0; i < msgs.length - 1; i++) {
      const cur  = msgs[i];
      const next = msgs[i + 1];
      if (cur.role !== 'user' || next.role !== 'assistant') continue;
      if (onlyPositive && !positiveIds.has(next.id)) continue;

      if (format === 'openai') {
        lines.push(JSON.stringify({
          messages: [
            { role: 'system',    content: SYSTEM_PROMPT_EXPORT },
            { role: 'user',      content: cur.content },
            { role: 'assistant', content: next.content },
          ],
        }));
      } else {
        lines.push(JSON.stringify({ prompt: cur.content, completion: next.content }));
      }
    }
  }

  return lines.join('\n');
}
