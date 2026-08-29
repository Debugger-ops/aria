// tests/alias-hook.mjs — Teaches the Node test runner the `@/*` path alias.
//
// The app uses the `@/lib/...` alias everywhere (it's configured in
// tsconfig.json and resolved by Turbopack). Node has no idea about it, so
// rather than contorting the source imports to suit the test runner, we
// register a resolve hook that mirrors the tsconfig mapping.
//
// Used via:  node --experimental-strip-types --import ./tests/alias-hook.mjs --test ...

import { registerHooks } from 'node:module';
import { pathToFileURL } from 'node:url';
import path from 'node:path';
import fs from 'node:fs';

const projectRoot = path.resolve(import.meta.dirname, '..');

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (!specifier.startsWith('@/')) return nextResolve(specifier, context);

    let target = path.join(projectRoot, specifier.slice(2));
    if (!fs.existsSync(target)) {
      for (const ext of ['.ts', '.tsx', '.mjs', '.js']) {
        if (fs.existsSync(target + ext)) { target += ext; break; }
      }
    }
    return nextResolve(pathToFileURL(target).href, context);
  },
});
