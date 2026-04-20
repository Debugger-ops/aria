import { NextRequest } from 'next/server';
import { ChatRequest, ChatResponse } from '@/lib/types';
import {
  getMockResponse,
  getServerHistory,
  appendServerHistory,
  generateId,
} from '@/lib/chatLogic';
import { callGemini } from '@/lib/gemini';
import { saveMessage, initDb } from '@/lib/db';

export const runtime = 'nodejs';

// ── System persona ───────────────────────────────────────────────

const SYSTEM_PROMPT = `
You are Aria, a free, intelligent AI assistant designed to help users with:

1. CODE & DEBUGGING
   - Explain code clearly, find bugs, suggest fixes and optimisations
   - Support all major languages: JS/TS, Python, Go, Rust, Java, C/C++, SQL, etc.
   - When showing code, always wrap it in triple-backtick fenced code blocks with the language tag

2. GENERAL CONVERSATION
   - Be warm, friendly and emotionally intelligent
   - Listen carefully, respond thoughtfully, and make the person feel heard

3. DUE PROCESS & WORKFLOWS
   - Walk users through step-by-step processes with clear numbered lists
   - Offer checklists, templates, and structured guidance for any workflow
   - Ask clarifying questions if the task is ambiguous before diving in

4. DOCUMENTS & CONTENT
   - Write, summarise, edit and improve any text: emails, reports, essays, posts
   - Match the tone the user asks for (formal, casual, professional, creative)

STYLE RULES:
- Be concise but complete — no padding or unnecessary fluff
- Use markdown formatting (bold, lists, code blocks) when it aids clarity
- If you don't know something, say so honestly rather than guessing
- Always prioritise the user's actual need over a literal reading of their words
`.trim();

// ── Route handler ────────────────────────────────────────────────

export async function POST(request: NextRequest): Promise<Response> {
  try {
    // Ensure data directory exists
    initDb();

    const body: ChatRequest = await request.json();
    const { message, sessionId: rawSessionId } = body;

    if (!message || typeof message !== 'string' || message.trim() === '') {
      return Response.json(
        { error: 'Message must be a non-empty string.' },
        { status: 400 }
      );
    }

    const sessionId = rawSessionId || generateId();
    const trimmed = message.trim();

    // Generate IDs for both messages upfront
    const userMsgId = generateId();
    const aiMsgId   = generateId();

    // Append user message to server-side history
    appendServerHistory(sessionId, 'user', trimmed);

    // ── Derive a short session title from the first user message ─
    const sessionTitle = trimmed.slice(0, 50) + (trimmed.length > 50 ? '…' : '');

    // Persist user message to DB
    saveMessage(sessionId, sessionTitle, 'user', trimmed, userMsgId);

    let reply: string;
    const geminiKey = process.env.GEMINI_API_KEY;

    if (geminiKey) {
      // ── Google Gemini (free) ──────────────────────────────────
      const history = getServerHistory(sessionId);
      try {
        reply = await callGemini(geminiKey, SYSTEM_PROMPT, history, trimmed);
      } catch (geminiErr) {
        // Graceful fallback: quota exhausted, model unavailable, network error, etc.
        console.warn('/api/chat Gemini unavailable, using smart fallback:', (geminiErr as Error).message);
        await new Promise((r) => setTimeout(r, 400 + Math.random() * 400));
        reply = getMockResponse(trimmed);
      }
    } else {
      // ── Mock fallback (no API key needed) ─────────────────────
      await new Promise((r) => setTimeout(r, 600 + Math.random() * 700));
      reply = getMockResponse(trimmed);
    }

    // Append AI reply to server-side history
    appendServerHistory(sessionId, 'assistant', reply);

    // Persist AI reply to DB — include the aiMsgId so feedback can reference it
    saveMessage(sessionId, sessionTitle, 'assistant', reply, aiMsgId);

    const response: ChatResponse = { reply, sessionId, aiMsgId };
    return Response.json(response, { status: 200 });
  } catch (err) {
    console.error('/api/chat error:', err);
    const message =
      err instanceof Error ? err.message : 'Internal server error.';
    return Response.json({ error: message }, { status: 500 });
  }
}

// Health-check
export async function GET(): Promise<Response> {
  const hasKey = Boolean(process.env.GEMINI_API_KEY);
  return Response.json({
    status: 'ok',
    provider: hasKey ? 'gemini' : 'mock',
    model: hasKey ? (process.env.GEMINI_MODEL ?? 'gemini-2.0-flash') : 'mock-engine',
    timestamp: new Date().toISOString(),
  });
}
