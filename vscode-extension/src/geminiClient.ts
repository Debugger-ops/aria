/**
 * Gemini API client for the VS Code extension.
 * Uses the same free Gemini 1.5 Flash model as the web app.
 */

export interface ChatMessage {
  role: 'user' | 'model';
  parts: Array<{ text: string }>;
}

const BASE_URL = 'https://generativelanguage.googleapis.com/v1beta/models';

export const SYSTEM_PROMPT = `
You are Aria, a free AI coding assistant and companion living inside VS Code.
You help developers with:

CODE (primary focus):
- Explain what code does, clearly and concisely
- Find and fix bugs with clear reasoning
- Refactor and improve code quality
- Write unit tests
- Suggest best practices and patterns
- Answer any programming question

CONVERSATION & GENERAL:
- Friendly, warm, and patient
- Answer any question on any topic
- Help with writing, documents, planning, workflows

STYLE:
- Always wrap code in triple-backtick fenced blocks with the correct language tag
- Be concise but complete — no padding
- When explaining code, use short numbered steps
- If you're unsure, say so
`.trim();

export class GeminiClient {
  private history: ChatMessage[] = [];
  private apiKey: string;
  private model: string;

  constructor(apiKey: string, model = 'gemini-1.5-flash') {
    this.apiKey = apiKey;
    this.model = model;
  }

  setApiKey(key: string) { this.apiKey = key; }
  setModel(model: string) { this.model = model; }
  clearHistory() { this.history = []; }
  getHistory() { return [...this.history]; }

  async send(userText: string): Promise<string> {
    if (!this.apiKey) {
      throw new Error('No Gemini API key configured. Set aria.geminiApiKey in VS Code settings.');
    }

    this.history.push({ role: 'user', parts: [{ text: userText }] });

    const url = `${BASE_URL}/${this.model}:generateContent?key=${this.apiKey}`;

    const body = {
      contents: this.history,
      systemInstruction: { parts: [{ text: SYSTEM_PROMPT }] },
      generationConfig: {
        temperature: 0.7,
        maxOutputTokens: 2048,
        topP: 0.95,
      },
    };

    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const errText = await res.text();
      this.history.pop(); // revert
      throw new Error(`Gemini API error ${res.status}: ${errText}`);
    }

    const data = await res.json() as {
      candidates?: Array<{
        content: { role: string; parts: Array<{ text: string }> };
        finishReason: string;
      }>;
    };

    const reply = data.candidates?.[0]?.content?.parts?.[0]?.text?.trim();
    if (!reply) {
      this.history.pop();
      throw new Error('Gemini returned an empty response.');
    }

    this.history.push({ role: 'model', parts: [{ text: reply }] });

    // Keep history bounded (last 40 turns)
    if (this.history.length > 40) {
      this.history = this.history.slice(this.history.length - 40);
    }

    return reply;
  }
}
