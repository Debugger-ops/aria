// lib/expression.ts — Safe arithmetic evaluation for the `calculate` tool.
//
// A recursive-descent parser, deliberately NOT eval() or new Function(). The
// expression string is model-generated and partly influenceable by whatever the
// user typed, so it must never reach a JavaScript interpreter. Kept dependency
// free so it can be unit tested in isolation.
//
// Grammar:
//   expr    := term (('+' | '-') term)*
//   term    := unary (('*' | '/' | '%') unary)*
//   unary   := ('-' | '+') unary | power
//   power   := primary ('^' unary)?          -- right associative
//   primary := number | '(' expr ')' | ident '(' expr ')' | constant

// Null-prototype maps. With a plain object literal, `'constructor' in CONSTANTS`
// is true via the prototype chain and `FUNCTIONS['constructor']` resolves to the
// Object constructor — so `constructor(2)` would reach a callable. Every lookup
// below additionally goes through Object.hasOwn, belt and braces.
export const CONSTANTS: Record<string, number> = Object.assign(
  Object.create(null),
  { pi: Math.PI, e: Math.E },
);

export const FUNCTIONS: Record<string, (n: number) => number> = Object.assign(Object.create(null), {
  sqrt: Math.sqrt, abs: Math.abs, round: Math.round, floor: Math.floor,
  ceil: Math.ceil, sin: Math.sin, cos: Math.cos, tan: Math.tan,
  asin: Math.asin, acos: Math.acos, atan: Math.atan,
  ln: Math.log, log: Math.log10, log2: Math.log2, exp: Math.exp,
});

export function evaluateExpression(input: string): number {
  let pos = 0;
  const src = input.replace(/\s+/g, '');
  if (!src) throw new Error('empty expression');

  function peek(): string { return src[pos] ?? ''; }
  function eat(ch: string): boolean {
    if (src[pos] === ch) { pos++; return true; }
    return false;
  }

  function parseExpr(): number {
    let left = parseTerm();
    for (;;) {
      if (eat('+')) left += parseTerm();
      else if (eat('-')) left -= parseTerm();
      else return left;
    }
  }

  function parseTerm(): number {
    let left = parseUnary();
    for (;;) {
      if (eat('*')) left *= parseUnary();
      else if (eat('/')) {
        const d = parseUnary();
        if (d === 0) throw new Error('division by zero');
        left /= d;
      } else if (eat('%')) {
        const d = parseUnary();
        if (d === 0) throw new Error('modulo by zero');
        left %= d;
      } else return left;
    }
  }

  function parseUnary(): number {
    if (eat('-')) return -parseUnary();
    if (eat('+')) return parseUnary();
    return parsePower();
  }

  function parsePower(): number {
    const base = parsePrimary();
    if (eat('^')) return Math.pow(base, parseUnary());
    return base;
  }

  function parsePrimary(): number {
    if (eat('(')) {
      const value = parseExpr();
      if (!eat(')')) throw new Error('missing closing parenthesis');
      return value;
    }

    const numMatch = /^\d+(\.\d+)?([eE][+-]?\d+)?/.exec(src.slice(pos));
    if (numMatch) {
      pos += numMatch[0].length;
      return parseFloat(numMatch[0]);
    }

    const identMatch = /^[a-zA-Z][a-zA-Z0-9_]*/.exec(src.slice(pos));
    if (identMatch) {
      const name = identMatch[0].toLowerCase();
      pos += identMatch[0].length;

      if (eat('(')) {
        if (!Object.hasOwn(FUNCTIONS, name)) throw new Error(`unknown function "${name}"`);
        const fn = FUNCTIONS[name];
        const arg = parseExpr();
        if (!eat(')')) throw new Error(`missing closing parenthesis after ${name}(`);
        const value = fn(arg);
        if (typeof value !== 'number') throw new Error(`"${name}" did not return a number`);
        return value;
      }

      if (Object.hasOwn(CONSTANTS, name)) return CONSTANTS[name];
      throw new Error(`unknown identifier "${name}"`);
    }

    throw new Error(`unexpected character "${peek() || 'end of input'}" at position ${pos}`);
  }

  const result = parseExpr();
  if (pos < src.length) throw new Error(`unexpected trailing input "${src.slice(pos)}"`);
  if (!Number.isFinite(result)) throw new Error('result is not a finite number');
  return result;
}
