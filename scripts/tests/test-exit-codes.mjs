// @ts-check
// scripts/tests/test-exit-codes.mjs - the named exit codes keep the values docs/CODE-STANDARD.md gives them.
//
// WHAT. Proves scripts/lib/exit-codes.js holds exactly SUCCESS 0, FAILURE 1 and REFUSED 2, that nobody
// can change them at run time, and that both module systems read the same object. Deleted, it would let
// a code take another value, or a fourth code arrive, with every other test green, and the hook harness,
// git or a Routine would then read a number whose meaning nobody agreed.
//
// HOW. Reads the module through an ES import and through require, and asserts they are one object. Pins
// the exact key set and values, refuses a write to the frozen object, and ends a bare node child with
// each code to show a parent process reads back the same number.
//
// NEVER. Writes a file or reaches a network. The only children it starts are node -e processes that
// exit at once.
//
// Usage: node scripts/tests/test-exit-codes.mjs
// Exit: 0 every assertion held - 1 one failed

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import { EXIT } from '../lib/exit-codes.js';

const MODULE = fileURLToPath(new URL('../lib/exit-codes.js', import.meta.url));
const require = createRequire(import.meta.url);

test('the codes are exactly SUCCESS 0, FAILURE 1 and REFUSED 2', () => {
  assert.deepEqual({ ...EXIT }, { SUCCESS: 0, FAILURE: 1, REFUSED: 2 });
});

test('an ES import and a require see one object', () => {
  assert.equal(require(MODULE).EXIT, EXIT);
});

test('a write to the frozen object is refused', () => {
  assert.equal(Reflect.set(EXIT, 'REFUSED', 3), false);
  assert.equal(Reflect.set(EXIT, 'TIMEOUT', 124), false);
  assert.deepEqual({ ...EXIT }, { SUCCESS: 0, FAILURE: 1, REFUSED: 2 });
});

test('a child ending with each code hands that number to its parent', () => {
  for (const [name, code] of Object.entries(EXIT)) {
    const script = `process.exit(require(${JSON.stringify(MODULE)}).EXIT.${name})`;
    const child = spawnSync(process.execPath, ['-e', script], { encoding: 'utf8', timeout: 30_000 });
    assert.equal(child.status, code, `${name}: ${child.stderr}`);
  }
});
