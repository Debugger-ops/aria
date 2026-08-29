import { NextRequest } from 'next/server';
import { ChatRequest } from '@/lib/types';
import {
  getMockResponse,
  getServerHistory,
  appendServerHistory,
  generateId,
} from '@/lib/chatLogic';
import {
  buildContents,
  supportsTools,
  GeminiMessage,
  GeminiModel,
  DEFAULT_MODEL,
} from '@/lib/gemini';
import { runAgentLoop } from '@/lib/agent';
import { toolDeclarations, runTool, describeToolCall, ToolContext } from '@/lib/tools';
import { saveMessage, DbToolCall } from '@/lib/db';
import { emitEvent } from '@/lib/events';
import { getSessionUser, getUserApiKey } from '@/lib/auth';

export const runtime = 'nodejs';

// ── Agent configuration ──────────────────────────────────────────
//
// MAX_STEPS bounds the reason→act→observe loop. Without a ceiling a model that
// keeps asking for tools would spin until the request times out, burning quota
// on every iteration. Five is comfortably above what a well-formed request
// needs (most finish in 1–2) and low enough to cap worst-case cost and latency.

const MAX_STEPS = 5;

/** Tool results larger than this are truncated before going back to the model. */
const MAX_RESULT_CHARS = 12_000;

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

TOOL USE:
You have tools available. Use them instead of guessing.
- Use \`calculate\` for any arithmetic beyond trivial mental math. Never state a
  computed number you have not verified with it.
- Use \`fetch_url\` when the user gives you a link, or when you need the current
  contents of a page whose address you already know.
- Use \`search_past_conversations\` when the user refers to something discussed
  earlier that is not in the current conversation.
Call tools only when they genuinely help — a normal chat message needs none.
If a tool returns an error, tell the user plainly what failed and continue;
do not silently retry the same call with the same arguments.
After a tool returns, answer the user's actual question using the result.

STYLE RULES:
- Be concise but complete — no padding or unnecessary fluff
- Use markdown formatting (bold, lists, code blocks) when it aids clarity
- If you don't know something, say so honestly rather than guessing
- Always prioritise the user's actual need over a literal reading of their words
`.trim();

// ── SSE helpers ──────────────────────────────────────────────────

const enc = new TextEncoder();

function sse(payload: Record<string, unknown>): Uint8Array {
  return enc.encode(`data: ${JSON.stringify(payload)}\n\n`);
}

const sseChunk = (text: string) => sse({ type: 'chunk', text });
const sseError = (message: string) => sse({ type: 'error', message });
const sseDone = (aiMsgId: string, sessionId: string, toolCalls: DbToolCall[]) =>
  sse({ type: 'done', aiMsgId, sessionId, toolCalls });

const sseToolCall = (id: string, name: string, label: string, step: number) =>
  sse({ type: 'tool_call', id, name, label, step });

const sseToolResult = (id: string, name: string, ok: boolean, ms: number, summary: string) =>
  sse({ type: 'tool_result', id, name, ok, ms, summary });

// ── Mock streaming (no API key configured) ───────────────────────

async function* mockStream(text: string): AsyncGenerator<string> {
  const words = text.split(' ');
  for (const word of words) {
    yield word + ' ';
    await new Promise((r) => setTimeout(r, 18 + Math.random() * 25));
  }
}

// ── Best-effort persistence ──────────────────────────────────────
//
// Conversation storage is a nice-to-have, not a precondition for answering.
// If Mongo is unreachable the user should still get their reply — losing the
// transcript is a much smaller failure than losing the conversation. Errors are
// logged once and swallowed.

async function safeSave(
  label: string,
  fn: () => Promise<void>,
): Promise<boolean> {
  try {
    await fn();
    return true;
  } catch (err) {
    console.warn(`[chat] ${label} failed (continuing without persistence):`, (err as Error).message);
    return false;
  }
}

async function safeSessionUser(): Promise<{ id?: string } | null> {
  try {
    return (await getSessionUser()) as { id?: string } | null;
  } catch (err) {
    console.warn('[chat] session lookup failed, treating as anonymous:', (err as Error).message);
    return null;
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
    const model: GeminiModel =
      requestedModel || (process.env.GEMINI_MODEL as GeminiModel) || DEFAULT_MODEL;

    const userMsgId = generateId();
    const aiMsgId = generateId();

    appendServerHistory(sessionId, 'user', trimmed);

    // Identify the owner up-front so the conversation is tagged to them, and so
    // tools that read private data know whose data they may touch.
    const sessionUser = await safeSessionUser();
    const userId = sessionUser?.id as string | undefined;

    const sessionTitle = trimmed.slice(0, 50) + (trimmed.length > 50 ? '…' : '');
    await safeSave('save user message', () =>
      saveMessage(sessionId, sessionTitle, 'user', trimmed, userMsgId, userId),
    );
    void emitEvent({ type: 'message.user', sessionId, userId, meta: { messageId: userMsgId } });

    let userKey: string | null = null;
    if (sessionUser?.id) {
      try {
        userKey = await getUserApiKey(sessionUser.id);
      } catch (err) {
        console.warn('[chat] per-user API key lookup failed:', (err as Error).message);
      }
    }
    const geminiKey = userKey || process.env.GEMINI_API_KEY;

    const toolCtx: ToolContext = { userId, sessionId };
    const useTools = supportsTools(model);

    // ── The agent loop ───────────────────────────────────────────
    const stream = new ReadableStream({
      async start(controller) {
        let fullReply = '';
        const trajectory: DbToolCall[] = [];

        /** Fallback path: canned response, streamed word by word. */
        const streamMock = async () => {
          for await (const chunk of mockStream(getMockResponse(trimmed))) {
            fullReply += chunk;
            controller.enqueue(sseChunk(chunk));
          }
        };

        try {
          if (!geminiKey) {
            await new Promise((r) => setTimeout(r, 300));
            await streamMock();
          } else {
            const history = getServerHistory(sessionId);
            const contents: GeminiMessage[] = buildContents(history, trimmed);
            const tools = useTools ? toolDeclarations() : undefined;

            try {
              const result = await runAgentLoop({
                apiKey: geminiKey,
                systemPrompt: SYSTEM_PROMPT,
                contents,
                model,
                tools,
                maxSteps: MAX_STEPS,
                maxResultChars: MAX_RESULT_CHARS,
                newId: generateId,
                describeCall: describeToolCall,
                executeTool: (name, args) => runTool(name, args, toolCtx),
                events: {
                  onText: (text) => {
                    fullReply += text;
                    controller.enqueue(sseChunk(text));
                  },
                  onToolCall: ({ id, name, label, step }) => {
                    controller.enqueue(sseToolCall(id, name, label, step));
                    void emitEvent({
                      type: 'tool.called',
                      sessionId,
                      userId,
                      meta: { tool: name, step, messageId: aiMsgId },
                    });
                  },
                  onToolResult: ({ id, name, ok, ms, summary }) => {
                    controller.enqueue(sseToolResult(id, name, ok, ms, summary));
                    void emitEvent({
                      type: ok ? 'tool.succeeded' : 'tool.failed',
                      sessionId,
                      userId,
                      meta: { tool: name, ms, summary, messageId: aiMsgId },
                    });
                  },
                  onMaxSteps: (steps) => {
                    void emitEvent({
                      type: 'agent.max_steps',
                      sessionId,
                      userId,
                      meta: { steps, messageId: aiMsgId },
                    });
                  },
                },
              });

              trajectory.push(...result.trajectory);

              if (result.hitCeiling && !fullReply.trim()) {
                const notice =
                  "I wasn't able to finish this within my tool-use limit. " +
                  'Could you narrow the question a little?';
                fullReply += notice;
                controller.enqueue(sseChunk(notice));
              }

              // A turn can legitimately end with tool calls and no prose.
              if (!fullReply.trim()) await streamMock();
            } catch (geminiErr) {
              console.warn('Gemini turn failed, falling back to mock:', (geminiErr as Error).message);
              await streamMock();
            }
          }

          const finalReply = fullReply.trim();
          appendServerHistory(sessionId, 'assistant', finalReply);
          const persisted = await safeSave('save assistant message', () =>
            saveMessage(
              sessionId, sessionTitle, 'assistant', finalReply, aiMsgId, userId,
              trajectory.length > 0 ? trajectory : undefined,
            ),
          );
          void emitEvent({
            type: 'message.assistant',
            sessionId,
            userId,
            meta: { messageId: aiMsgId, toolCalls: trajectory.length },
          });
          // Only advertise a dbMsgId the client can actually submit feedback
          // against — an unsaved message has no row to attach a rating to.
          controller.enqueue(sseDone(persisted ? aiMsgId : '', sessionId, trajectory));
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

// Health-check — now also advertises the agent's capabilities.
export async function GET(): Promise<Response> {
  const hasKey = Boolean(process.env.GEMINI_API_KEY);
  const model = hasKey ? (process.env.GEMINI_MODEL ?? DEFAULT_MODEL) : 'mock-engine';
  return Response.json({
    status: 'ok',
    mode: hasKey ? 'agent' : 'mock',
    provider: hasKey ? 'gemini' : 'mock',
    model,
    agent: {
      maxSteps: MAX_STEPS,
      tools: toolDeclarations()[0].functionDeclarations.map((d) => d.name),
    },
    timestamp: new Date().toISOString(),
  });
}
