/**
 * lib/db.ts
 *
 * File-based database for collecting conversation data + feedback
 * for AI training. No external packages needed — uses Node.js fs only.
 *
 * Data layout (all in /data at project root):
 *   data/conversations/  — one JSON file per session
 *   data/feedback.json   — all thumbs up / thumbs down entries
 *   data/training.jsonl  — auto-generated fine-tuning export (OpenAI format)
 */

import fs from 'fs';
import path from 'path';

// ── Paths ────────────────────────────────────────────────────────

const DATA_DIR        = path.join(process.cwd(), 'data');
const CONV_DIR        = path.join(DATA_DIR, 'conversations');
const FEEDBACK_FILE   = path.join(DATA_DIR, 'feedback.json');
const TRAINING_FILE   = path.join(DATA_DIR, 'training.jsonl');

// ── Types ────────────────────────────────────────────────────────

export type MessageRole = 'user' | 'assistant';

export interface DbMessage {
  id: string;
  role: MessageRole;
  content: string;
  timestamp: string; // ISO string
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
  userMessage: string;   // the user turn that preceded this AI reply
  aiReply: string;       // the AI reply being rated
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

// ── Init ─────────────────────────────────────────────────────────

export function initDb(): void {
  [DATA_DIR, CONV_DIR].forEach((dir) => {
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  });
  if (!fs.existsSync(FEEDBACK_FILE)) {
    fs.writeFileSync(FEEDBACK_FILE, JSON.stringify([], null, 2), 'utf-8');
  }
}

// ── Conversations ─────────────────────────────────────────────────

function convPath(sessionId: string): string {
  return path.join(CONV_DIR, `${sessionId}.json`);
}

function readConversation(sessionId: string): DbConversation | null {
  const p = convPath(sessionId);
  if (!fs.existsSync(p)) return null;
  try {
    return JSON.parse(fs.readFileSync(p, 'utf-8')) as DbConversation;
  } catch {
    return null;
  }
}

function writeConversation(conv: DbConversation): void {
  fs.writeFileSync(convPath(conv.sessionId), JSON.stringify(conv, null, 2), 'utf-8');
}

export function saveMessage(
  sessionId: string,
  title: string,
  role: MessageRole,
  content: string,
  messageId: string,
): void {
  initDb();
  const now = new Date().toISOString();
  let conv = readConversation(sessionId);

  if (!conv) {
    conv = {
      sessionId,
      title,
      createdAt: now,
      updatedAt: now,
      messages: [],
    };
  }

  conv.title = title;
  conv.updatedAt = now;
  conv.messages.push({ id: messageId, role, content, timestamp: now });

  writeConversation(conv);
}

export function getAllConversations(): DbConversation[] {
  initDb();
  if (!fs.existsSync(CONV_DIR)) return [];
  return fs
    .readdirSync(CONV_DIR)
    .filter((f) => f.endsWith('.json'))
    .map((f) => {
      try {
        return JSON.parse(fs.readFileSync(path.join(CONV_DIR, f), 'utf-8')) as DbConversation;
      } catch {
        return null;
      }
    })
    .filter(Boolean) as DbConversation[];
}

// ── Feedback ──────────────────────────────────────────────────────

function readFeedback(): DbFeedback[] {
  initDb();
  try {
    return JSON.parse(fs.readFileSync(FEEDBACK_FILE, 'utf-8')) as DbFeedback[];
  } catch {
    return [];
  }
}

function writeFeedback(entries: DbFeedback[]): void {
  fs.writeFileSync(FEEDBACK_FILE, JSON.stringify(entries, null, 2), 'utf-8');
}

export function saveFeedback(
  messageId: string,
  sessionId: string,
  rating: 'up' | 'down',
  userMessage: string,
  aiReply: string,
): void {
  initDb();
  const entries = readFeedback();

  // Remove any existing rating for this message (allow changing vote)
  const filtered = entries.filter((e) => e.messageId !== messageId);

  filtered.push({
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    messageId,
    sessionId,
    rating,
    userMessage,
    aiReply,
    createdAt: new Date().toISOString(),
  });

  writeFeedback(filtered);
}

export function getFeedbackForMessage(messageId: string): DbFeedback | null {
  const entries = readFeedback();
  return entries.find((e) => e.messageId === messageId) ?? null;
}

// ── Stats ─────────────────────────────────────────────────────────

export function getAdminStats(): AdminStats {
  initDb();
  const convs = getAllConversations();
  const feedback = readFeedback();

  let totalMessages = 0;
  let totalUserMessages = 0;
  let totalAiMessages = 0;

  for (const c of convs) {
    totalMessages += c.messages.length;
    totalUserMessages += c.messages.filter((m) => m.role === 'user').length;
    totalAiMessages  += c.messages.filter((m) => m.role === 'assistant').length;
  }

  return {
    totalConversations: convs.length,
    totalMessages,
    totalUserMessages,
    totalAiMessages,
    thumbsUp:   feedback.filter((f) => f.rating === 'up').length,
    thumbsDown: feedback.filter((f) => f.rating === 'down').length,
    exportableTrainingPairs: totalAiMessages, // every user→AI pair is a training candidate
  };
}

// ── Export: JSONL for fine-tuning ─────────────────────────────────
//
// Produces two export formats:
//
// "openai"   — OpenAI / Anthropic fine-tuning format
//   {"messages":[{"role":"system","content":"..."},{"role":"user","content":"..."},{"role":"assistant","content":"..."}]}
//
// "simple"   — Simple prompt/completion pairs
//   {"prompt":"...","completion":"..."}

const SYSTEM_PROMPT_EXPORT = `You are Aria, a warm and intelligent AI companion. Be helpful, empathetic, and concise.`;

export function exportTrainingData(
  format: 'openai' | 'simple' = 'openai',
  onlyPositive = false,
): string {
  initDb();
  const convs = getAllConversations();
  const feedback = readFeedback();
  const positiveIds = new Set(feedback.filter((f) => f.rating === 'up').map((f) => f.messageId));

  const lines: string[] = [];

  for (const conv of convs) {
    const msgs = conv.messages;

    for (let i = 0; i < msgs.length - 1; i++) {
      const cur  = msgs[i];
      const next = msgs[i + 1];

      if (cur.role !== 'user' || next.role !== 'assistant') continue;
      if (onlyPositive && !positiveIds.has(next.id)) continue;

      if (format === 'openai') {
        lines.push(
          JSON.stringify({
            messages: [
              { role: 'system',    content: SYSTEM_PROMPT_EXPORT },
              { role: 'user',      content: cur.content },
              { role: 'assistant', content: next.content },
            ],
          })
        );
      } else {
        lines.push(
          JSON.stringify({
            prompt:     cur.content,
            completion: next.content,
          })
        );
      }
    }
  }

  const output = lines.join('\n');

  // Also write to disk for easy access
  fs.writeFileSync(TRAINING_FILE, output, 'utf-8');

  return output;
}

export function getRecentConversations(limit = 20): DbConversation[] {
  return getAllConversations()
    .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime())
    .slice(0, limit);
}
