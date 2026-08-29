// lib/tools.ts — Tool registry for the Aria agent.
//
// Each tool has two halves:
//   1. `declaration` — the JSON schema handed to Gemini so the model knows the
//      tool exists and how to call it.
//   2. `execute`     — the server-side implementation the agent loop invokes
//      when the model asks for it.
//
// Every executor is expected to RESOLVE, never reject. A thrown error inside a
// tool would kill the agent loop; instead we return `{ error: string }` so the
// model can read the failure, apologise, or try a different approach. That
// property — failures are data, not exceptions — is what keeps the loop stable.

import { searchUserMessages } from '@/lib/db';
import { evaluateExpression } from '@/lib/expression';
import { checkFetchUrl, isBlockedHost } from '@/lib/url-guard';

// ── Shared types ──────────────────────────────────────────────────

export interface ToolContext {
  /** Owner of the conversation, when signed in. Tools that read private data
   *  MUST check this — an anonymous caller gets no access to stored history. */
  userId?: string;
  sessionId: string;
}

export interface JsonSchema {
  type: 'object';
  properties: Record<string, {
    type: string;
    description: string;
    enum?: string[];
  }>;
  required?: string[];
}

export interface ToolDefinition {
  name: string;
  description: string;
  parameters: JsonSchema;
  /** Hard ceiling for this tool. The loop enforces it, not the tool. */
  timeoutMs: number;
  execute: (args: Record<string, unknown>, ctx: ToolContext) => Promise<unknown>;
}

// ── 1. search_past_conversations ──────────────────────────────────
// Gives the agent memory beyond the current context window by querying the
// MongoDB conversation store this app already writes to.

const searchPastConversations: ToolDefinition = {
  name: 'search_past_conversations',
  description:
    "Search the user's own previous conversations with Aria for something they " +
    'mentioned earlier. Use this when the user refers to a past discussion ' +
    '("what did I say about...", "the project I mentioned last week", "remind me ' +
    'what we decided") or when older context would make your answer materially ' +
    'better. Only searches conversations belonging to the signed-in user.',
  parameters: {
    type: 'object',
    properties: {
      query: {
        type: 'string',
        description:
          'Keywords to search for. Use the distinctive nouns from the request, ' +
          'not a full sentence. Example: "postgres migration deadline".',
      },
      limit: {
        type: 'string',
        description: 'Maximum number of matching messages to return. Defaults to 5, max 15.',
      },
    },
    required: ['query'],
  },
  timeoutMs: 8_000,
  async execute(args, ctx) {
    const query = String(args.query ?? '').trim();
    if (!query) return { error: 'The `query` argument is required and cannot be empty.' };

    if (!ctx.userId) {
      return {
        error:
          'No signed-in user, so there is no private history to search. Tell the ' +
          'user that conversation memory requires signing in.',
      };
    }

    const limit = Math.min(Math.max(parseInt(String(args.limit ?? '5'), 10) || 5, 1), 15);

    try {
      const hits = await searchUserMessages(ctx.userId, query, limit);
      if (hits.length === 0) {
        return { results: [], note: `No previous messages matched "${query}".` };
      }
      return {
        results: hits.map((h) => ({
          conversation: h.title,
          date: h.timestamp.slice(0, 10),
          who: h.role === 'user' ? 'the user' : 'you (Aria)',
          excerpt: h.excerpt,
        })),
      };
    } catch (err) {
      return { error: `Conversation search failed: ${(err as Error).message}` };
    }
  },
};

// ── 2. fetch_url ──────────────────────────────────────────────────
// Reads a public web page. The interesting part here is the SSRF guard: without
// it, the model could be talked into fetching http://169.254.169.254/ (cloud
// metadata) or a service on the app's private network and reading the result
// straight back to the user.

/** Strip tags, scripts and entities down to readable prose. */
function htmlToText(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<\/(p|div|li|h[1-6]|tr|section|article)>/gi, '\n')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

const MAX_FETCH_CHARS = 8_000;

const fetchUrl: ToolDefinition = {
  name: 'fetch_url',
  description:
    'Fetch a public web page and return its readable text content. Use this when ' +
    'the user gives you a URL, or when you need current information from a page ' +
    'you already know the address of. This does NOT search the web — you must ' +
    'already have a specific URL. Content is truncated to roughly 8000 characters.',
  parameters: {
    type: 'object',
    properties: {
      url: {
        type: 'string',
        description: 'Full absolute URL including the https:// scheme.',
      },
    },
    required: ['url'],
  },
  timeoutMs: 12_000,
  async execute(args) {
    const check = checkFetchUrl(String(args.url ?? ''));
    if (!check.ok) return { error: check.reason };
    const parsed = check.url;

    try {
      const res = await fetch(parsed.toString(), {
        redirect: 'follow',
        headers: {
          'User-Agent': 'Aria-Agent/1.0 (+https://github.com/ai-companion-bot)',
          Accept: 'text/html,application/xhtml+xml,text/plain;q=0.9,*/*;q=0.8',
        },
      });

      if (!res.ok) {
        return { error: `The server returned HTTP ${res.status} ${res.statusText}.` };
      }

      // Re-check after redirects — a public URL can 302 into a private one.
      const finalHost = new URL(res.url).hostname;
      if (isBlockedHost(finalHost)) {
        return { error: `Refused: the URL redirected to a private address (${finalHost}).` };
      }

      const contentType = res.headers.get('content-type') ?? '';
      if (!/text\/|json|xml/i.test(contentType)) {
        return { error: `Unsupported content type "${contentType}" — this tool only reads text pages.` };
      }

      const body = await res.text();
      const text = /html/i.test(contentType) ? htmlToText(body) : body.trim();
      const truncated = text.length > MAX_FETCH_CHARS;

      return {
        url: res.url,
        truncated,
        content: truncated ? text.slice(0, MAX_FETCH_CHARS) + '\n\n…[truncated]' : text,
      };
    } catch (err) {
      return { error: `Could not fetch the page: ${(err as Error).message}` };
    }
  },
};

// ── 3. calculate ──────────────────────────────────────────────────
// A recursive-descent arithmetic parser. Deliberately NOT eval() / Function():
// the input string is model-generated and partly attacker-influenceable through
// the user's message, so it never gets to reach a JS interpreter.

const calculate: ToolDefinition = {
  name: 'calculate',
  description:
    'Evaluate an arithmetic expression exactly. Use this for ANY non-trivial ' +
    'calculation rather than doing the arithmetic yourself — percentages, ' +
    'compound growth, unit conversions, totals. Supports + - * / % ^, ' +
    'parentheses, the constants pi and e, and the functions sqrt, abs, round, ' +
    'floor, ceil, sin, cos, tan, asin, acos, atan, ln, log, log2, exp.',
  parameters: {
    type: 'object',
    properties: {
      expression: {
        type: 'string',
        description: 'The expression to evaluate, e.g. "1250 * 1.08^5" or "sqrt(2) / 2".',
      },
    },
    required: ['expression'],
  },
  timeoutMs: 2_000,
  async execute(args) {
    const expression = String(args.expression ?? '').trim();
    if (!expression) return { error: 'The `expression` argument is required.' };
    if (expression.length > 500) return { error: 'Expression is too long (max 500 characters).' };

    try {
      const value = evaluateExpression(expression);
      return { expression, result: value };
    } catch (err) {
      return { error: `Could not evaluate "${expression}": ${(err as Error).message}` };
    }
  },
};

// ── Registry ──────────────────────────────────────────────────────

export const TOOLS: ToolDefinition[] = [searchPastConversations, fetchUrl, calculate];

const TOOL_MAP = new Map(TOOLS.map((t) => [t.name, t]));

export function getTool(name: string): ToolDefinition | undefined {
  return TOOL_MAP.get(name);
}

/** The `tools` block sent to Gemini — schema only, no implementations. */
export function toolDeclarations() {
  return [{
    functionDeclarations: TOOLS.map(({ name, description, parameters }) => ({
      name,
      description,
      parameters,
    })),
  }];
}

/**
 * Run one tool call with a hard timeout, converting every possible failure —
 * unknown tool, thrown error, hang — into a value the model can read.
 */
export async function runTool(
  name: string,
  args: Record<string, unknown>,
  ctx: ToolContext,
): Promise<{ ok: boolean; result: unknown; ms: number }> {
  const started = Date.now();
  const tool = getTool(name);

  if (!tool) {
    return {
      ok: false,
      ms: 0,
      result: {
        error:
          `Unknown tool "${name}". Available tools: ` +
          TOOLS.map((t) => t.name).join(', ') + '.',
      },
    };
  }

  try {
    const result = await Promise.race([
      tool.execute(args, ctx),
      new Promise((_, reject) =>
        setTimeout(
          () => reject(new Error(`timed out after ${tool.timeoutMs}ms`)),
          tool.timeoutMs,
        ),
      ),
    ]);

    const ok = !(result && typeof result === 'object' && 'error' in (result as object));
    return { ok, result, ms: Date.now() - started };
  } catch (err) {
    return {
      ok: false,
      ms: Date.now() - started,
      result: { error: `Tool "${name}" failed: ${(err as Error).message}` },
    };
  }
}

/** Short human-readable label for the UI, e.g. `calculate(1250 * 1.08^5)`. */
export function describeToolCall(name: string, args: Record<string, unknown>): string {
  const primary =
    (args.query as string) ?? (args.url as string) ?? (args.expression as string) ?? '';
  const shown = String(primary).length > 60 ? String(primary).slice(0, 57) + '…' : String(primary);
  return shown ? `${name}(${shown})` : name;
}
