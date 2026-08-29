/**
 * Google Gemini API client (free tier)
 * Models: gemini-2.0-flash (default), gemini-1.5-pro, gemini-1.5-flash
 * Docs:  https://ai.google.dev/gemini-api/docs
 *
 * Supports both plain chat completion and tool-calling (function calling) turns.
 * The agent loop in app/api/chat/route.ts drives the multi-turn behaviour; this
 * module only knows how to execute ONE turn and report what came back.
 */

// ── Wire format ───────────────────────────────────────────────────

export interface FunctionCall {
  name: string;
  args: Record<string, unknown>;
}

export type GeminiPart =
  | { text: string }
  | { functionCall: FunctionCall }
  | { functionResponse: { name: string; response: Record<string, unknown> } };

export interface GeminiMessage {
  role: 'user' | 'model';
  parts: GeminiPart[];
}

export interface GeminiFunctionDeclaration {
  name: string;
  description: string;
  parameters: unknown;
}

export interface GeminiToolBlock {
  functionDeclarations: GeminiFunctionDeclaration[];
}

export interface GeminiRequest {
  contents: GeminiMessage[];
  systemInstruction?: { parts: Array<{ text: string }> };
  tools?: GeminiToolBlock[];
  toolConfig?: { functionCallingConfig: { mode: 'AUTO' | 'ANY' | 'NONE' } };
  generationConfig?: {
    temperature?: number;
    maxOutputTokens?: number;
    topP?: number;
  };
}

export interface GeminiResponse {
  candidates: Array<{
    content: { role: string; parts: GeminiPart[] };
    finishReason: string;
  }>;
  usageMetadata?: {
    promptTokenCount: number;
    candidatesTokenCount: number;
  };
}

export type GeminiModel =
  | 'gemini-2.0-flash'
  | 'gemini-1.5-flash'
  | 'gemini-1.5-pro'
  | 'gemini-2.0-flash-thinking-exp';

export const GEMINI_MODELS: { id: GeminiModel; label: string; description: string }[] = [
  { id: 'gemini-2.0-flash',              label: 'Gemini 2.0 Flash',          description: 'Fastest · great for chat' },
  { id: 'gemini-1.5-flash',              label: 'Gemini 1.5 Flash',          description: 'Fast · balanced' },
  { id: 'gemini-1.5-pro',                label: 'Gemini 1.5 Pro',            description: 'Smartest · best reasoning' },
  { id: 'gemini-2.0-flash-thinking-exp', label: 'Gemini 2.0 Flash Thinking', description: 'Experimental · chain-of-thought' },
];

export const DEFAULT_MODEL: GeminiModel = 'gemini-2.0-flash';

/**
 * Not every model supports function calling — the thinking-mode preview in
 * particular rejects a `tools` block. The agent loop degrades to plain chat
 * for these rather than erroring out.
 */
const NO_TOOL_SUPPORT: ReadonlySet<GeminiModel> = new Set<GeminiModel>([
  'gemini-2.0-flash-thinking-exp',
]);

export function supportsTools(model: GeminiModel): boolean {
  return !NO_TOOL_SUPPORT.has(model);
}

const DEFAULT_GEMINI_BASE = 'https://generativelanguage.googleapis.com/v1beta/models';

// Read per call, not once at module load, so the endpoint can be overridden by
// the environment at any point — a proxy, a regional endpoint, or the local
// emulator the agent-loop tests spin up.
function geminiBase(): string {
  // Bracket access on purpose: Next inlines `process.env.FOO` member access at
  // build time, which would freeze this to whatever was set when the bundle was
  // built. Bracket access stays a real runtime lookup.
  return process.env['GEMINI_BASE_URL'] || DEFAULT_GEMINI_BASE;
}

// ── Helpers ───────────────────────────────────────────────────────

export function isTextPart(p: GeminiPart): p is { text: string } {
  return typeof (p as { text?: unknown }).text === 'string';
}

export function isFunctionCallPart(p: GeminiPart): p is { functionCall: FunctionCall } {
  return typeof (p as { functionCall?: unknown }).functionCall === 'object'
    && (p as { functionCall?: unknown }).functionCall !== null;
}

/**
 * Converts our internal history format → Gemini's message format.
 * Gemini requires alternating user/model turns.
 */
export function toGeminiHistory(
  history: Array<{ role: 'user' | 'assistant'; content: string }>
): GeminiMessage[] {
  return history.map((m) => ({
    role: m.role === 'assistant' ? 'model' : 'user',
    parts: [{ text: m.content }],
  }));
}

/** Build the opening `contents` array for a turn. */
export function buildContents(
  history: Array<{ role: 'user' | 'assistant'; content: string }>,
  userMessage: string
): GeminiMessage[] {
  return [
    ...toGeminiHistory(history.slice(0, -1)),
    { role: 'user', parts: [{ text: userMessage }] },
  ];
}

function buildBody(
  contents: GeminiMessage[],
  systemPrompt: string,
  tools?: GeminiToolBlock[],
): GeminiRequest {
  const body: GeminiRequest = {
    contents,
    systemInstruction: { parts: [{ text: systemPrompt }] },
    generationConfig: {
      temperature: 0.8,
      maxOutputTokens: 2048,
      topP: 0.95,
    },
  };

  if (tools && tools.length > 0) {
    body.tools = tools;
    body.toolConfig = { functionCallingConfig: { mode: 'AUTO' } };
  }

  return body;
}

// ── Non-streaming call (fallback) ─────────────────────────────────

export async function callGemini(
  apiKey: string,
  systemPrompt: string,
  history: Array<{ role: 'user' | 'assistant'; content: string }>,
  userMessage: string,
  model: GeminiModel = DEFAULT_MODEL
): Promise<string> {
  const url = `${geminiBase()}/${model}:generateContent?key=${apiKey}`;
  const body = buildBody(buildContents(history, userMessage), systemPrompt);

  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Gemini API error ${res.status}: ${err}`);
  }

  const data: GeminiResponse = await res.json();
  const parts = data.candidates?.[0]?.content?.parts ?? [];
  const text = parts.filter(isTextPart).map((p) => p.text).join('');
  if (!text) throw new Error('Gemini returned an empty response');
  return text.trim();
}

// ── Streaming: one agent turn ─────────────────────────────────────

/**
 * What a single model turn can emit. `text` arrives incrementally as the model
 * writes; `functionCall` arrives complete, and means the turn wants a tool run
 * before it can continue.
 */
export type TurnEvent =
  | { type: 'text'; text: string }
  | { type: 'functionCall'; call: FunctionCall };

/**
 * Streams ONE turn against the supplied `contents`. Does not loop — the caller
 * decides whether to execute the requested tools and call again. Yielding the
 * function calls rather than executing them here keeps this module free of any
 * knowledge about what the tools actually do.
 */
export async function* streamTurn(
  apiKey: string,
  systemPrompt: string,
  contents: GeminiMessage[],
  model: GeminiModel = DEFAULT_MODEL,
  tools?: GeminiToolBlock[],
): AsyncGenerator<TurnEvent> {
  const url = `${geminiBase()}/${model}:streamGenerateContent?alt=sse&key=${apiKey}`;
  const body = buildBody(contents, systemPrompt, tools);

  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Gemini stream error ${res.status}: ${err}`);
  }

  const reader = res.body!.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() ?? '';

    for (const line of lines) {
      if (!line.startsWith('data: ')) continue;
      const jsonStr = line.slice(6).trim();
      if (!jsonStr || jsonStr === '[DONE]') continue;

      try {
        const parsed: GeminiResponse = JSON.parse(jsonStr);
        const parts = parsed.candidates?.[0]?.content?.parts ?? [];

        for (const part of parts) {
          if (isFunctionCallPart(part)) {
            yield {
              type: 'functionCall',
              call: {
                name: part.functionCall.name,
                args: (part.functionCall.args ?? {}) as Record<string, unknown>,
              },
            };
          } else if (isTextPart(part) && part.text) {
            yield { type: 'text', text: part.text };
          }
        }
      } catch {
        // malformed chunk — skip
      }
    }
  }
}

/**
 * Backwards-compatible plain-text stream (no tools). Kept so any caller that
 * just wants tokens — the VS Code extension, the embed widget — is unaffected
 * by the agent work.
 */
export async function* callGeminiStream(
  apiKey: string,
  systemPrompt: string,
  history: Array<{ role: 'user' | 'assistant'; content: string }>,
  userMessage: string,
  model: GeminiModel = DEFAULT_MODEL
): AsyncGenerator<string> {
  const contents = buildContents(history, userMessage);
  for await (const event of streamTurn(apiKey, systemPrompt, contents, model)) {
    if (event.type === 'text') yield event.text;
  }
}
