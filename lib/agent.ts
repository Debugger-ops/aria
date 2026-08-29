// lib/agent.ts — The agent loop.
//
// Reason → act → observe, bounded. This module owns the control flow and
// nothing else: it does not know about HTTP, SSE, Mongo, or what any particular
// tool does. Tool execution arrives as a callback and progress leaves through
// an event object, which is what makes the loop unit-testable against a fake
// model endpoint (see tests/agent-loop.test.ts).

import { streamTurn } from '@/lib/gemini';
import type {
  GeminiMessage,
  GeminiPart,
  GeminiToolBlock,
  FunctionCall,
  GeminiModel,
} from '@/lib/gemini';

/** Result of running one tool, as the loop needs to see it. */
export interface ToolRun {
  ok: boolean;
  result: unknown;
  ms: number;
}

export interface AgentToolCall {
  id: string;
  name: string;
  label: string;
  step: number;
}

export interface AgentToolResult {
  id: string;
  name: string;
  ok: boolean;
  ms: number;
  summary: string;
}

export interface TrajectoryEntry {
  name: string;
  args: string;
  ok: boolean;
  ms: number;
  summary: string;
}

export interface AgentEvents {
  /** Model text, streamed as it arrives. */
  onText?: (text: string) => void;
  /** A tool is about to run. */
  onToolCall?: (call: AgentToolCall) => void;
  /** That tool finished. */
  onToolResult?: (result: AgentToolResult) => void;
  /** The loop hit its step ceiling with work still outstanding. */
  onMaxSteps?: (steps: number) => void;
}

export interface AgentOptions {
  apiKey: string;
  systemPrompt: string;
  /** Conversation so far. Mutated as the loop appends turns. */
  contents: GeminiMessage[];
  model: GeminiModel;
  /** Omit to run without tools (plain chat). */
  tools?: GeminiToolBlock[];
  /** Hard ceiling on loop iterations. */
  maxSteps: number;
  /** Cap on the JSON size of a tool result fed back to the model. */
  maxResultChars?: number;
  /** Injected so the loop stays free of tool implementations. */
  executeTool: (name: string, args: Record<string, unknown>) => Promise<ToolRun>;
  /** Injected so the loop does not depend on an ID scheme. */
  newId: () => string;
  /** Short display label for a call, e.g. `calculate(2+2)`. */
  describeCall: (name: string, args: Record<string, unknown>) => string;
  events?: AgentEvents;
}

export interface AgentResult {
  /** Everything the model said across all turns, concatenated. */
  text: string;
  trajectory: TrajectoryEntry[];
  /** How many iterations actually ran. */
  steps: number;
  /** True if the loop stopped because it hit `maxSteps`. */
  hitCeiling: boolean;
}

// ── Result shaping ────────────────────────────────────────────────

/** Gemini requires `functionResponse.response` to be a JSON object. */
export function asResponseObject(result: unknown): Record<string, unknown> {
  if (result && typeof result === 'object' && !Array.isArray(result)) {
    return result as Record<string, unknown>;
  }
  return { value: result };
}

/** Keep a runaway tool result from blowing the model's context window. */
export function capResult(obj: Record<string, unknown>, maxChars: number): Record<string, unknown> {
  const json = JSON.stringify(obj);
  if (json.length <= maxChars) return obj;
  return {
    truncated: true,
    note: `Result was ${json.length} characters and has been truncated.`,
    preview: json.slice(0, maxChars),
  };
}

/** One-line description of what a tool returned, for the UI and the DB. */
export function summarise(ok: boolean, result: unknown): string {
  const obj = asResponseObject(result);
  if (!ok) return String(obj.error ?? 'failed');
  if (typeof obj.result === 'number') return `= ${obj.result}`;
  if (Array.isArray(obj.results)) return `${obj.results.length} match(es)`;
  if (typeof obj.content === 'string') return `${obj.content.length} chars read`;
  if (typeof obj.note === 'string') return obj.note;
  return 'ok';
}

// ── The loop ──────────────────────────────────────────────────────

export async function runAgentLoop(opts: AgentOptions): Promise<AgentResult> {
  const {
    apiKey, systemPrompt, contents, model, tools, maxSteps,
    executeTool, newId, describeCall, events = {},
  } = opts;
  const maxResultChars = opts.maxResultChars ?? 12_000;

  let text = '';
  let steps = 0;
  let hitCeiling = false;
  const trajectory: TrajectoryEntry[] = [];

  for (;;) {
    steps += 1;

    // The final iteration runs with tools withheld, which forces the model to
    // answer from what it already has rather than requesting another call it
    // will never get to make.
    const lastStep = steps >= maxSteps;
    const turnTools = lastStep ? undefined : tools;

    const pending: FunctionCall[] = [];
    let turnText = '';

    for await (const event of streamTurn(apiKey, systemPrompt, contents, model, turnTools)) {
      if (event.type === 'text') {
        turnText += event.text;
        text += event.text;
        events.onText?.(event.text);
      } else {
        pending.push(event.call);
      }
    }

    // No tools requested → the model produced its final answer.
    if (pending.length === 0) break;

    if (lastStep) {
      hitCeiling = true;
      events.onMaxSteps?.(maxSteps);
      break;
    }

    // Replay the model's turn verbatim — its prose plus the calls it made.
    // The next request must contain it or the model loses the thread.
    const modelParts: GeminiPart[] = [];
    if (turnText) modelParts.push({ text: turnText });
    for (const call of pending) modelParts.push({ functionCall: call });
    contents.push({ role: 'model', parts: modelParts });

    // Run every requested tool, then return all results in a single turn.
    const responseParts: GeminiPart[] = [];

    for (const call of pending) {
      const id = newId();
      const label = describeCall(call.name, call.args);

      events.onToolCall?.({ id, name: call.name, label, step: steps });

      const { ok, result, ms } = await executeTool(call.name, call.args);
      const summary = summarise(ok, result);

      events.onToolResult?.({ id, name: call.name, ok, ms, summary });

      trajectory.push({ name: call.name, args: JSON.stringify(call.args), ok, ms, summary });

      responseParts.push({
        functionResponse: {
          name: call.name,
          response: capResult(asResponseObject(result), maxResultChars),
        },
      });
    }

    contents.push({ role: 'user', parts: responseParts });
  }

  return { text, trajectory, steps, hitCeiling };
}
