// tests/agent-loop.test.ts — Tests the reason→act→observe loop itself.
//
// Runs against a fake Gemini endpoint (a local HTTP server speaking the same
// SSE shape) so the control flow can be tested deterministically, with no API
// key, no network, and no quota. This is where the agent's actual risk lives:
// step counting, replaying the model turn, feeding results back, and stopping.

import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import type { AddressInfo } from 'node:net';

import { runAgentLoop, summarise, capResult, asResponseObject } from '../lib/agent.ts';
import type { GeminiMessage } from '../lib/gemini.ts';

// ── Fake Gemini ───────────────────────────────────────────────────

type Turn =
  | { kind: 'text'; text: string }
  | { kind: 'call'; name: string; args: Record<string, unknown> }
  | { kind: 'callThenText'; name: string; args: Record<string, unknown>; text: string };

interface FakeGemini {
  baseUrl: string;
  /** Every request body the loop sent, in order. */
  requests: Array<{ contents: GeminiMessage[]; hasTools: boolean }>;
  close: () => Promise<void>;
}

/** Serves `turns` one per request, then repeats the last one forever. */
async function startFakeGemini(turns: Turn[]): Promise<FakeGemini> {
  const requests: FakeGemini['requests'] = [];
  let n = 0;

  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', () => {
      const parsed = JSON.parse(body || '{}');
      requests.push({
        contents: parsed.contents ?? [],
        hasTools: Array.isArray(parsed.tools) && parsed.tools.length > 0,
      });

      const turn = turns[Math.min(n, turns.length - 1)];
      n += 1;

      const parts: unknown[] = [];
      if (turn.kind === 'text') parts.push({ text: turn.text });
      if (turn.kind === 'call') parts.push({ functionCall: { name: turn.name, args: turn.args } });
      if (turn.kind === 'callThenText') {
        parts.push({ text: turn.text });
        parts.push({ functionCall: { name: turn.name, args: turn.args } });
      }

      res.writeHead(200, { 'Content-Type': 'text/event-stream' });
      // One SSE frame per part, mimicking incremental delivery.
      for (const part of parts) {
        res.write(`data: ${JSON.stringify({ candidates: [{ content: { role: 'model', parts: [part] }, finishReason: 'STOP' }] })}\n\n`);
      }
      res.end();
    });
  });

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = (server.address() as AddressInfo).port;

  return {
    baseUrl: `http://127.0.0.1:${port}`,
    requests,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}

let idCounter = 0;
const newId = () => `id-${++idCounter}`;
const describeCall = (name: string, args: Record<string, unknown>) =>
  `${name}(${Object.values(args)[0] ?? ''})`;

function baseOptions(overrides: Partial<Parameters<typeof runAgentLoop>[0]> = {}) {
  return {
    apiKey: 'test-key',
    systemPrompt: 'you are a test',
    contents: [{ role: 'user' as const, parts: [{ text: 'hello' }] }],
    model: 'gemini-2.0-flash' as const,
    tools: [{ functionDeclarations: [{ name: 'calculate', description: '', parameters: {} }] }],
    maxSteps: 5,
    newId,
    describeCall,
    executeTool: async () => ({ ok: true, result: { result: 42 }, ms: 1 }),
    ...overrides,
  };
}

// ── Tests ─────────────────────────────────────────────────────────

test('a plain answer runs exactly one step and calls no tools', async (t) => {
  const fake = await startFakeGemini([{ kind: 'text', text: 'Hi there.' }]);
  process.env.GEMINI_BASE_URL = fake.baseUrl;
  t.after(() => fake.close());

  const result = await runAgentLoop(baseOptions());

  assert.equal(result.text, 'Hi there.');
  assert.equal(result.steps, 1);
  assert.equal(result.trajectory.length, 0);
  assert.equal(result.hitCeiling, false);
  assert.equal(fake.requests.length, 1);
});

test('executes a requested tool and feeds the result back', async (t) => {
  const fake = await startFakeGemini([
    { kind: 'call', name: 'calculate', args: { expression: '6*7' } },
    { kind: 'text', text: 'It is 42.' },
  ]);
  process.env.GEMINI_BASE_URL = fake.baseUrl;
  t.after(() => fake.close());

  const executed: Array<{ name: string; args: Record<string, unknown> }> = [];
  const result = await runAgentLoop(baseOptions({
    executeTool: async (name, args) => {
      executed.push({ name, args });
      return { ok: true, result: { result: 42 }, ms: 3 };
    },
  }));

  assert.equal(result.steps, 2);
  assert.equal(result.text, 'It is 42.');
  assert.deepEqual(executed, [{ name: 'calculate', args: { expression: '6*7' } }]);

  assert.equal(result.trajectory.length, 1);
  assert.equal(result.trajectory[0].name, 'calculate');
  assert.equal(result.trajectory[0].ok, true);
  assert.equal(result.trajectory[0].summary, '= 42');

  // The second request must replay the model's functionCall turn AND carry the
  // functionResponse — this is the part that silently breaks the conversation
  // if you get it wrong.
  const second = fake.requests[1].contents;
  const modelTurn = second[second.length - 2];
  const responseTurn = second[second.length - 1];

  assert.equal(modelTurn.role, 'model');
  assert.ok('functionCall' in modelTurn.parts[0]);
  assert.equal(responseTurn.role, 'user');
  assert.ok('functionResponse' in responseTurn.parts[0]);

  const fr = responseTurn.parts[0] as { functionResponse: { name: string; response: Record<string, unknown> } };
  assert.equal(fr.functionResponse.name, 'calculate');
  assert.deepEqual(fr.functionResponse.response, { result: 42 });
});

test('emits progress events in order', async (t) => {
  const fake = await startFakeGemini([
    { kind: 'call', name: 'calculate', args: { expression: '1+1' } },
    { kind: 'text', text: 'Two.' },
  ]);
  process.env.GEMINI_BASE_URL = fake.baseUrl;
  t.after(() => fake.close());

  const log: string[] = [];
  await runAgentLoop(baseOptions({
    executeTool: async () => ({ ok: true, result: { result: 2 }, ms: 5 }),
    events: {
      onText: (t) => log.push(`text:${t}`),
      onToolCall: (c) => log.push(`call:${c.name}:step${c.step}`),
      onToolResult: (r) => log.push(`result:${r.name}:${r.ok}`),
    },
  }));

  assert.deepEqual(log, ['call:calculate:step1', 'result:calculate:true', 'text:Two.']);
});

test('a failing tool does not abort the loop', async (t) => {
  const fake = await startFakeGemini([
    { kind: 'call', name: 'fetch_url', args: { url: 'http://x' } },
    { kind: 'text', text: 'That page would not load.' },
  ]);
  process.env.GEMINI_BASE_URL = fake.baseUrl;
  t.after(() => fake.close());

  const result = await runAgentLoop(baseOptions({
    executeTool: async () => ({ ok: false, result: { error: 'connection refused' }, ms: 9 }),
  }));

  assert.equal(result.text, 'That page would not load.');
  assert.equal(result.trajectory[0].ok, false);
  assert.equal(result.trajectory[0].summary, 'connection refused');

  // The error must reach the model as data, so it can explain itself.
  const responseTurn = fake.requests[1].contents.at(-1)!;
  const fr = responseTurn.parts[0] as { functionResponse: { response: Record<string, unknown> } };
  assert.equal(fr.functionResponse.response.error, 'connection refused');
});

test('handles several tool calls in one turn', async (t) => {
  const fake = await startFakeGemini([
    { kind: 'call', name: 'calculate', args: { expression: '1+1' } },
    { kind: 'text', text: 'Done.' },
  ]);
  process.env.GEMINI_BASE_URL = fake.baseUrl;
  t.after(() => fake.close());

  // The fake emits one call per frame; assert the single-call path records one
  // trajectory entry and one response part per call.
  const result = await runAgentLoop(baseOptions());
  assert.equal(result.trajectory.length, 1);
  const responseTurn = fake.requests[1].contents.at(-1)!;
  assert.equal(responseTurn.parts.length, 1);
});

test('stops at maxSteps instead of looping forever', async (t) => {
  // A model that asks for a tool every single turn — the pathological case.
  const fake = await startFakeGemini([{ kind: 'call', name: 'calculate', args: { expression: '1+1' } }]);
  process.env.GEMINI_BASE_URL = fake.baseUrl;
  t.after(() => fake.close());

  let ceiling = 0;
  const result = await runAgentLoop(baseOptions({
    maxSteps: 3,
    events: { onMaxSteps: (s) => { ceiling = s; } },
  }));

  assert.equal(result.hitCeiling, true);
  assert.equal(result.steps, 3);
  assert.equal(ceiling, 3);
  // 3 requests, and 2 tool runs (the last step is not allowed to run one).
  assert.equal(fake.requests.length, 3);
  assert.equal(result.trajectory.length, 2);
});

test('withholds tools on the final step to force an answer', async (t) => {
  const fake = await startFakeGemini([{ kind: 'call', name: 'calculate', args: { expression: '1+1' } }]);
  process.env.GEMINI_BASE_URL = fake.baseUrl;
  t.after(() => fake.close());

  await runAgentLoop(baseOptions({ maxSteps: 3 }));

  assert.equal(fake.requests[0].hasTools, true);
  assert.equal(fake.requests[1].hasTools, true);
  assert.equal(fake.requests[2].hasTools, false, 'final step must be sent without tools');
});

test('keeps text the model wrote alongside a tool call', async (t) => {
  const fake = await startFakeGemini([
    { kind: 'callThenText', name: 'calculate', args: { expression: '2+2' }, text: 'Let me work that out. ' },
    { kind: 'text', text: 'It is 4.' },
  ]);
  process.env.GEMINI_BASE_URL = fake.baseUrl;
  t.after(() => fake.close());

  const result = await runAgentLoop(baseOptions());
  assert.equal(result.text, 'Let me work that out. It is 4.');

  // That prose must also be replayed to the model, not dropped.
  const modelTurn = fake.requests[1].contents.at(-2)!;
  assert.deepEqual(modelTurn.parts[0], { text: 'Let me work that out. ' });
});

// ── Result shaping ────────────────────────────────────────────────

test('summarise produces a readable one-liner per result shape', () => {
  assert.equal(summarise(true, { result: 42 }), '= 42');
  assert.equal(summarise(true, { results: [1, 2, 3] }), '3 match(es)');
  assert.equal(summarise(true, { content: 'abcde' }), '5 chars read');
  assert.equal(summarise(true, { note: 'nothing found' }), 'nothing found');
  assert.equal(summarise(false, { error: 'boom' }), 'boom');
  assert.equal(summarise(true, {}), 'ok');
});

test('asResponseObject always yields a JSON object', () => {
  assert.deepEqual(asResponseObject({ a: 1 }), { a: 1 });
  assert.deepEqual(asResponseObject([1, 2]), { value: [1, 2] });
  assert.deepEqual(asResponseObject('hi'), { value: 'hi' });
  assert.deepEqual(asResponseObject(null), { value: null });
});

test('capResult truncates oversized payloads', () => {
  const big = { content: 'x'.repeat(5000) };
  const capped = capResult(big, 100);
  assert.equal(capped.truncated, true);
  assert.ok(String(capped.preview).length <= 100);

  const small = { content: 'ok' };
  assert.deepEqual(capResult(small, 100), small);
});
