// lib/db.ts — MongoDB-backed conversation + feedback storage

import { connectToDatabase } from '@/lib/mongoose';
import { Conversation, Feedback } from '@/lib/models';
import { cacheGetJSON, cacheSetJSON, STATS_CACHE_KEY } from '@/lib/redis';

// ── Types (kept identical so callers don't change) ────────────────

export type MessageRole = 'user' | 'assistant';

export interface DbToolCall {
  name: string;
  args: string;
  ok: boolean;
  ms: number;
  summary: string;
}

export interface DbMessage {
  id: string;
  role: MessageRole;
  content: string;
  timestamp: string;
  toolCalls?: DbToolCall[];
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
  userId?: string,
  toolCalls?: DbToolCall[],
): Promise<void> {
  await connectToDatabase();
  const now = new Date().toISOString();
  const msg: DbMessage = { id: messageId, role, content, timestamp: now };
  if (toolCalls && toolCalls.length > 0) msg.toolCalls = toolCalls;

  // userId is set once, when the conversation is first created ($setOnInsert),
  // so a chat belongs to whoever started it.
  const onInsert: Record<string, string> = { createdAt: now };
  if (userId) onInsert.userId = userId;

  await Conversation.findOneAndUpdate(
    { sessionId },
    {
      $set:  { title, updatedAt: now },
      $push: { messages: msg },
      $setOnInsert: onInsert,
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

// ── Per-user (personal dashboard) ─────────────────────────────────

export async function getUserConversations(userId: string): Promise<DbConversation[]> {
  await connectToDatabase();
  const docs = await Conversation.find({ userId })
    .sort({ updatedAt: -1 })
    .lean();
  return docs as unknown as DbConversation[];
}

export interface UserStats {
  totalConversations: number;
  totalMessages: number;
  totalUserMessages: number;
  totalAiMessages: number;
}

export async function getUserStats(userId: string): Promise<UserStats> {
  await connectToDatabase();
  const convs = (await Conversation.find({ userId }).lean()) as unknown as DbConversation[];

  let totalMessages = 0, totalUserMessages = 0, totalAiMessages = 0;
  for (const c of convs) {
    totalMessages     += c.messages.length;
    totalUserMessages += c.messages.filter((m) => m.role === 'user').length;
    totalAiMessages   += c.messages.filter((m) => m.role === 'assistant').length;
  }

  return {
    totalConversations: convs.length,
    totalMessages,
    totalUserMessages,
    totalAiMessages,
  };
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

// ── Agent memory: full-text-ish search over a user's own history ───
//
// Backs the `search_past_conversations` tool. Deliberately scoped by userId so
// the agent can never read another account's conversations, no matter what the
// model is persuaded to ask for.

export interface MessageSearchHit {
  sessionId: string;
  title: string;
  role: MessageRole;
  timestamp: string;
  excerpt: string;
  score: number;
}

const STOPWORDS = new Set([
  'the','a','an','and','or','but','if','of','to','in','on','at','for','with',
  'about','what','did','i','say','my','me','we','was','is','are','it','that',
  'this','you','your','tell','remind','from','last','week','when','how',
]);

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length > 2 && !STOPWORDS.has(t));
}

/** Pull ~240 characters of context around the first matching term. */
function makeExcerpt(content: string, terms: string[]): string {
  const lower = content.toLowerCase();
  let idx = -1;
  for (const term of terms) {
    const found = lower.indexOf(term);
    if (found !== -1 && (idx === -1 || found < idx)) idx = found;
  }
  if (idx === -1) return content.slice(0, 240) + (content.length > 240 ? '…' : '');

  const start = Math.max(0, idx - 80);
  const end = Math.min(content.length, idx + 160);
  return (start > 0 ? '…' : '') + content.slice(start, end).trim() + (end < content.length ? '…' : '');
}

export async function searchUserMessages(
  userId: string,
  query: string,
  limit = 5,
): Promise<MessageSearchHit[]> {
  await connectToDatabase();

  const terms = tokenize(query);
  if (terms.length === 0) return [];

  // Cheap pre-filter in Mongo, precise scoring in memory. Conversations are
  // per-user and bounded, so this stays well inside a tool timeout.
  const convs = (await Conversation.find({ userId })
    .sort({ updatedAt: -1 })
    .limit(200)
    .lean()) as unknown as DbConversation[];

  const hits: MessageSearchHit[] = [];

  for (const conv of convs) {
    for (const msg of conv.messages ?? []) {
      const lower = msg.content.toLowerCase();
      let score = 0;
      for (const term of terms) {
        if (lower.includes(term)) score += 1;
      }
      if (score === 0) continue;

      // Prefer messages matching more of the query, then more recent ones.
      hits.push({
        sessionId: conv.sessionId,
        title: conv.title,
        role: msg.role,
        timestamp: msg.timestamp,
        excerpt: makeExcerpt(msg.content, terms),
        score: score / terms.length,
      });
    }
  }

  hits.sort((a, b) =>
    b.score !== a.score ? b.score - a.score : b.timestamp.localeCompare(a.timestamp),
  );

  return hits.slice(0, limit);
}
