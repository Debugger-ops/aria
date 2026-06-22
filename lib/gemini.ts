/**
 * Google Gemini API client (free tier)
 * Models: gemini-2.0-flash (default), gemini-1.5-pro, gemini-1.5-flash
 * Docs:  https://ai.google.dev/gemini-api/docs
 */

export interface GeminiMessage {
  role: 'user' | 'model';
  parts: Array<{ text: string }>;
}

export interface GeminiRequest {
  contents: GeminiMessage[];
  systemInstruction?: { parts: Array<{ text: string }> };
  generationConfig?: {
    temperature?: number;
    maxOutputTokens?: number;
    topP?: number;
  };
}

export interface GeminiResponse {
  candidates: Array<{
    content: { role: string; parts: Array<{ text: string }> };
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
  { id: 'gemini-2.0-flash',              label: 'Gemini 2.0 Flash',         description: 'Fastest · great for chat' },
  { id: 'gemini-1.5-flash',              label: 'Gemini 1.5 Flash',         description: 'Fast · balanced' },
  { id: 'gemini-1.5-pro',               label: 'Gemini 1.5 Pro',            description: 'Smartest · best reasoning' },
  { id: 'gemini-2.0-flash-thinking-exp', label: 'Gemini 2.0 Flash Thinking', description: 'Experimental · chain-of-thought' },
];

export const DEFAULT_MODEL: GeminiModel = 'gemini-2.0-flash';

const GEMINI_BASE = 'https://generativelanguage.googleapis.com/v1beta/models';

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

function buildMessages(
  history: Array<{ role: 'user' | 'assistant'; content: string }>,
  userMessage: string
): GeminiMessage[] {
  return [
    ...toGeminiHistory(history.slice(0, -1)),
    { role: 'user', parts: [{ text: userMessage }] },
  ];
}

function buildBody(
  messages: GeminiMessage[],
  systemPrompt: string
): GeminiRequest {
  return {
    contents: messages,
    systemInstruction: { parts: [{ text: systemPrompt }] },
    generationConfig: {
      temperature: 0.8,
      maxOutputTokens: 2048,
      topP: 0.95,
    },
  };
}

/**
 * Non-streaming Gemini call (fallback).
 */
export async function callGemini(
  apiKey: string,
  systemPrompt: string,
  history: Array<{ role: 'user' | 'assistant'; content: string }>,
  userMessage: string,
  model: GeminiModel = DEFAULT_MODEL
): Promise<string> {
  const url = `${GEMINI_BASE}/${model}:generateContent?key=${apiKey}`;
  const messages = buildMessages(history, userMessage);
  const body = buildBody(messages, systemPrompt);

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
  const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!text) throw new Error('Gemini returned an empty response');
  return text.trim();
}

/**
 * Streaming Gemini call — returns an async generator that yields text chunks.
 */
export async function* callGeminiStream(
  apiKey: string,
  systemPrompt: string,
  history: Array<{ role: 'user' | 'assistant'; content: string }>,
  userMessage: string,
  model: GeminiModel = DEFAULT_MODEL
): AsyncGenerator<string> {
  const url = `${GEMINI_BASE}/${model}:streamGenerateContent?alt=sse&key=${apiKey}`;
  const messages = buildMessages(history, userMessage);
  const body = buildBody(messages, systemPrompt);

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
        const chunk = parsed.candidates?.[0]?.content?.parts?.[0]?.text;
        if (chunk) yield chunk;
      } catch {
        // malformed chunk — skip
      }
    }
  }
}
