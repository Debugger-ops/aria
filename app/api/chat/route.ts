import { NextRequest } from 'next/server';
import { ChatRequest } from '@/lib/types';
import {
  getMockResponse,
  getServerHistory,
  appendServerHistory,
  generateId,
} from '@/lib/chatLogic';
import { callGeminiStream, GeminiModel, DEFAULT_MODEL } from '@/lib/gemini';
import { saveMessage } from '@/lib/db';
import { emitEvent } from '@/lib/events';
import { getSessionUser, getUserApiKey } from '@/lib/auth';

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

// ── SSE helpers ──────────────────────────────────────────────────

const enc = new TextEncoder();

function sseChunk(text: string): Uint8Array {
  return enc.encode(`data: ${JSON.stringify({ type: 'chunk', text })}\n\n`);
}

function sseDone(aiMsgId: string, sessionId: string): Uint8Array {
  return enc.encode(`data: ${JSON.stringify({ type: 'done', aiMsgId, sessionId })}\n\n`);
}

function sseError(message: string): Uint8Array {
  return enc.encode(`data: ${JSON.stringify({ type: 'error', message })}\n\n`);
}

// ── Mock streaming (simulate token-by-token for demo) ────────────

async function* mockStream(text: string): AsyncGenerator<string> {
  const words = text.split(' ');
  for (const word of words) {
    yield word + ' ';
    await new Promise((r) => setTimeout(r, 18 + Math.random() * 25));
  }
}

// ── Route handler ────────────────────────────────────────────────

export async function POST(request: NextRequest): Promise<Response> {
  try {
    const body: ChatRequest & { model?: GeminiModel } = await request.json();
    const { message, sessionId: rawSessionId, model: requestedModel } = body;

    if (!message || typeof message !== 'string' || message.trim() === '') {
      return Response.json({ error: 'Message must be a non-empty string.' }, { status: 400 });
    }

    const sessionId = rawSessionId || generateId();
    const trimmed = message.trim();
    const model: GeminiModel = requestedModel || (process.env.GEMINI_MODEL as GeminiModel) || DEFAULT_MODEL;

    const userMsgId = generateId();
    const aiMsgId   = generateId();

    appendServerHistory(sessionId, 'user', trimmed);

    const sessionTitle = trimmed.slice(0, 50) + (trimmed.length > 50 ? '…' : '');
    await saveMessage(sessionId, sessionTitle, 'user', trimmed, userMsgId);
    void emitEvent({ type: 'message.user', sessionId, meta: { messageId: userMsgId } });

    const sessionUser = await getSessionUser();
    const userKey = sessionUser ? await getUserApiKey(sessionUser.id as string) : null;
    const geminiKey = userKey || process.env.GEMINI_API_KEY;

    // ── Build the streaming ReadableStream ───────────────────────
    const stream = new ReadableStream({
      async start(controller) {
        let fullReply = '';

        try {
          const history = getServerHistory(sessionId);

          if (geminiKey) {
            try {
              for await (const chunk of callGeminiStream(geminiKey, SYSTEM_PROMPT, history, trimmed, model)) {
                fullReply += chunk;
                controller.enqueue(sseChunk(chunk));
              }
            } catch (geminiErr) {
              console.warn('Gemini stream failed, falling back to mock:', (geminiErr as Error).message);
              const fallback = getMockResponse(trimmed);
              for await (const chunk of mockStream(fallback)) {
                fullReply += chunk;
                controller.enqueue(sseChunk(chunk));
              }
            }
          } else {
            await new Promise((r) => setTimeout(r, 300));
            const mock = getMockResponse(trimmed);
            for await (const chunk of mockStream(mock)) {
              fullReply += chunk;
              controller.enqueue(sseChunk(chunk));
            }
          }

          const finalReply = fullReply.trim();
          appendServerHistory(sessionId, 'assistant', finalReply);
          await saveMessage(sessionId, sessionTitle, 'assistant', finalReply, aiMsgId);
          void emitEvent({ type: 'message.assistant', sessionId, meta: { messageId: aiMsgId } });
          controller.enqueue(sseDone(aiMsgId, sessionId));
        } catch (err) {
          console.error('/api/chat stream error:', err);
          controller.enqueue(sseError((err as Error).message ?? 'Internal error'));
        } finally {
          controller.close();
        }
      },
    });

    return new Response(stream, {
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache, no-transform',
        'X-Accel-Buffering': 'no',
        Connection: 'keep-alive',
      },
    });
  } catch (err) {
    console.error('/api/chat error:', err);
    return Response.json({ error: (err as Error).message ?? 'Internal server error.' }, { status: 500 });
  }
}

// Health-check
export async function GET(): Promise<Response> {
  const hasKey = Boolean(process.env.GEMINI_API_KEY);
  return Response.json({
    status: 'ok',
    provider: hasKey ? 'gemini' : 'mock',
    model: hasKey ? (process.env.GEMINI_MODEL ?? DEFAULT_MODEL) : 'mock-engine',
    timestamp: new Date().toISOString(),
  });
}
