// tests/agent.test.ts — Unit tests for the agent's pure logic.
//
// Run with:  npm test
// Uses the Node 22 built-in test runner and native TypeScript type stripping,
// so there is no test framework to install.

import test from 'node:test';
import assert from 'node:assert/strict';

import { evaluateExpression } from '../lib/expression.ts';
import { checkFetchUrl, isBlockedHost } from '../lib/url-guard.ts';

// ── calculate: correctness ────────────────────────────────────────

test('evaluates arithmetic with correct precedence', () => {
  assert.equal(evaluateExpression('2 + 3 * 4'), 14);
  assert.equal(evaluateExpression('(2 + 3) * 4'), 20);
  assert.equal(evaluateExpression('10 - 2 - 3'), 5);        // left associative
  assert.equal(evaluateExpression('100 / 5 / 2'), 10);
  assert.equal(evaluateExpression('7 % 3'), 1);
});

test('exponentiation is right associative', () => {
  assert.equal(evaluateExpression('2 ^ 3 ^ 2'), 512);        // not 64
  assert.equal(evaluateExpression('2 ^ -1'), 0.5);
});

test('handles unary minus and nesting', () => {
  assert.equal(evaluateExpression('-5 + 3'), -2);
  assert.equal(evaluateExpression('--5'), 5);
  assert.equal(evaluateExpression('-(3 * 2)'), -6);
});

test('supports constants and functions', () => {
  assert.equal(evaluateExpression('sqrt(16)'), 4);
  assert.equal(evaluateExpression('round(2.7)'), 3);
  assert.ok(Math.abs(evaluateExpression('pi') - Math.PI) < 1e-12);
  assert.ok(Math.abs(evaluateExpression('log(1000) - 3') ) < 1e-12);
  assert.ok(Math.abs(evaluateExpression('sqrt(2) / 2') - 0.7071067811865476) < 1e-12);
});

test('handles the compound-growth case the model will actually hit', () => {
  // Asserted against the reference computation rather than a typed-in literal:
  // the point of the test is that ^ binds tighter than *, i.e. 1250 * (1.08^5)
  // and not (1250 * 1.08)^5.
  const expected = 1250 * Math.pow(1.08, 5);
  assert.ok(Math.abs(evaluateExpression('1250 * 1.08^5') - expected) < 1e-9);
  assert.ok(Math.abs(evaluateExpression('1250 * 1.08 ^ 5') - expected) < 1e-9);
  assert.notEqual(Math.round(expected), Math.round(Math.pow(1250 * 1.08, 5)));
});

// ── calculate: it must reject, not execute ────────────────────────

test('refuses to execute JavaScript', () => {
  const attacks = [
    'process.exit(1)',
    'require("fs")',
    'globalThis',
    'constructor',
    '1;console.log(1)',
    'this.constructor.constructor("return 1")()',
    '[].map(x=>x)',
    // Prototype-chain reachable names: a plain-object lookup table resolves
    // these to real callables, so the parser must reject them explicitly.
    'constructor',
    'constructor(2)',
    'toString',
    'toString(2)',
    'valueOf(1)',
    'hasOwnProperty(1)',
    '__proto__',
  ];
  for (const attack of attacks) {
    assert.throws(
      () => evaluateExpression(attack),
      /unknown|unexpected|empty|parenthesis|trailing|not a number/i,
      `expected "${attack}" to be rejected`,
    );
  }
});

test('reports malformed input instead of hanging or NaN', () => {
  assert.throws(() => evaluateExpression('2 +'), /unexpected/i);
  assert.throws(() => evaluateExpression('(2 + 3'), /closing parenthesis/i);
  assert.throws(() => evaluateExpression('2 + 3)'), /trailing/i);
  assert.throws(() => evaluateExpression('1 / 0'), /division by zero/i);
  assert.throws(() => evaluateExpression('nope(2)'), /unknown function/i);
  assert.throws(() => evaluateExpression('foo'), /unknown identifier/i);
  assert.throws(() => evaluateExpression(''), /empty/i);
});

// ── fetch_url: SSRF guard ─────────────────────────────────────────

test('blocks private, loopback and link-local hosts', () => {
  const blocked = [
    'localhost',
    '127.0.0.1',
    '0.0.0.0',
    '10.1.2.3',
    '192.168.0.1',
    '172.16.0.1',
    '172.31.255.254',
    '169.254.169.254',     // cloud metadata
    '::1',
    'db.internal',
    'printer.local',
  ];
  for (const host of blocked) {
    assert.equal(isBlockedHost(host), true, `expected ${host} to be blocked`);
  }
});

test('allows ordinary public hosts', () => {
  const allowed = ['example.com', 'en.wikipedia.org', 'api.github.com', '8.8.8.8', '172.32.0.1'];
  for (const host of allowed) {
    assert.equal(isBlockedHost(host), false, `expected ${host} to be allowed`);
  }
});

test('checkFetchUrl rejects non-http schemes', () => {
  for (const url of ['file:///etc/passwd', 'ftp://example.com', 'javascript:alert(1)', 'data:text/html,x']) {
    const result = checkFetchUrl(url);
    assert.equal(result.ok, false, `expected ${url} to be refused`);
  }
});

test('checkFetchUrl rejects the metadata endpoint', () => {
  const result = checkFetchUrl('http://169.254.169.254/latest/meta-data/');
  assert.equal(result.ok, false);
  if (!result.ok) assert.match(result.reason, /private or internal/i);
});

test('checkFetchUrl accepts a normal page', () => {
  const result = checkFetchUrl('https://example.com/docs?q=1');
  assert.equal(result.ok, true);
  if (result.ok) assert.equal(result.url.hostname, 'example.com');
});

test('checkFetchUrl rejects empty and malformed input', () => {
  assert.equal(checkFetchUrl('').ok, false);
  assert.equal(checkFetchUrl('not a url').ok, false);
});
