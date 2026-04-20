/**
 * Google Gemini API client (free tier)
 * Model: gemini-1.5-flash  – 15 RPM / 1M TPM on the free plan
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

const GEMINI_BASE = 'https://generativelanguage.googleapis.com/v1beta/models';
const DEFAULT_MODEL = 'gemini-2.0-flash';

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

/**
 * Call the Gemini generateContent endpoint.
 */
export async function callGemini(
  apiKey: string,
  systemPrompt: string,
  history: Array<{ role: 'user' | 'assistant'; content: string }>,
  userMessage: string,
  model = DEFAULT_MODEL
): Promise<string> {
  const url = `${GEMINI_BASE}/${model}:generateContent?key=${apiKey}`;

  // Gemini requires the conversation to end with a user turn
  const messages: GeminiMessage[] = [
    ...toGeminiHistory(history.slice(0, -1)), // all but the last (already the user msg)
    { role: 'user', parts: [{ text: userMessage }] },
  ];

  const body: GeminiRequest = {
    contents: messages,
    systemInstruction: { parts: [{ text: systemPrompt }] },
    generationConfig: {
      temperature: 0.8,
      maxOutputTokens: 1024,
      topP: 0.95,
    },
  };

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
