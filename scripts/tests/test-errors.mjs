// @ts-check
// scripts/tests/test-errors.mjs - Refusal carries its name and exit code, and isMain tells run from imported.
//
// WHAT. Proves scripts/lib/errors.js: a Refusal is an Error named 'Refusal' that carries exit code 2 unless
// its thrower names another, and is one class in both module systems; isMain is true only in the script
// node was started with, including one started through a linked folder, and false in a module that
// script imports. Deleted, it would let a refusal lose its exit code or its class across an import, and
// let a main guard read a linked run as an import, which ends a gate with 0 having decided nothing.
//
// HOW. Unit cases call isMain with a named started script: none, the same file, the file's URL, another
// file, the same missing path in another case, the file reached through a link to its folder, and a
// CommonJS file named without its extension. Then real node children, written into a temp folder: an ES
// module and a CommonJS module each print what isMain says when run, when imported by a sibling, and when
// run through the linked folder, and a CommonJS .js file prints it when node is started with its path
// minus the .js, which node's loader resolves and process.argv[1] keeps as typed.
//
// NEVER. Writes outside its own temp folder, which it removes at the end, or reaches a network.
//
// Usage: node scripts/tests/test-errors.mjs
// Exit: 0 every assertion held - 1 one failed

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { after, describe, test } from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { isMain, Refusal } from '../lib/errors.js';
import { EXIT } from '../lib/exit-codes.js';

const MODULE = fileURLToPath(new URL('../lib/errors.js', import.meta.url));
const require = createRequire(import.meta.url);
const TEMP = fs.mkdtempSync(path.join(os.tmpdir(), 'test-errors-'));
const REAL = path.join(TEMP, 'real');
const LINKED = path.join(TEMP, 'linked');

after(() => fs.rmSync(TEMP, { recursive: true, force: true }));

fs.mkdirSync(REAL);
fs.symlinkSync(REAL, LINKED, 'junction');
/** @type {(name: string, text: string) => void} */
const write = (name, text) => fs.writeFileSync(path.join(REAL, name), text);
write(
  'main.mjs',
  `import { isMain } from ${JSON.stringify(pathToFileURL(MODULE).href)};\nconsole.log(isMain(import.meta.url));\n`
);
write('imports-main.mjs', "import './main.mjs';\n");
write('main.cjs', `const { isMain } = require(${JSON.stringify(MODULE)});\nconsole.log(isMain(__filename));\n`);
write('requires-main.cjs', "require('./main.cjs');\n");
write('package.json', '{ "type": "commonjs" }\n');
write('cli.js', `const { isMain } = require(${JSON.stringify(MODULE)});\nconsole.log(isMain(__filename));\n`);

/**
 * What the child's isMain printed, when node is started with the given script.
 * @param {string} script
 */
function printed(script) {
  const child = spawnSync(process.execPath, [script], { encoding: 'utf8', timeout: 30_000 });
  assert.equal(child.status, 0, child.stderr);
  return child.stdout.trim();
}

describe('Refusal', () => {
  test('is an Error named Refusal that carries exit code 2 by default', () => {
    const e = new Refusal('pick exactly one of --check or --push');
    assert.ok(e instanceof Error);
    assert.deepEqual([e.name, e.message, e.exitCode], ['Refusal', 'pick exactly one of --check or --push', 2]);
    assert.equal(String(e), 'Refusal: pick exactly one of --check or --push');
    assert.equal(e.exitCode, EXIT.REFUSED);
  });

  test('carries the exit code its thrower names', () => {
    assert.equal(new Refusal('unknown flag --x', { exitCode: EXIT.FAILURE }).exitCode, 1);
  });

  test('is one class to an ES import and a require', () => {
    assert.equal(require(MODULE).Refusal, Refusal);
    assert.ok(new (require(MODULE).Refusal)('x') instanceof Refusal);
  });
});

describe('isMain, given the started script', () => {
  const file = path.join(REAL, 'main.mjs');

  test('is false when node was started with no script', () => {
    assert.equal(isMain(file, undefined), false);
    assert.equal(isMain(file, ''), false);
  });

  test('is true for the same file, named by path or by URL', () => {
    assert.equal(isMain(file, file), true);
    assert.equal(isMain(pathToFileURL(file).href, file), true);
  });

  test('is false for another file', () => {
    assert.equal(isMain(file, path.join(REAL, 'imports-main.mjs')), false);
  });

  test('ignores case on Windows only', () => {
    const missing = path.join(TEMP, 'absent', 'Main.mjs');
    assert.equal(isMain(missing, missing.toLowerCase()), process.platform === 'win32');
  });

  test('is true when the started script was reached through a linked folder', () => {
    assert.equal(isMain(file, path.join(LINKED, 'main.mjs')), true);
  });

  test('is true for a CommonJS file started by its path without the extension, as node resolves it', () => {
    assert.equal(isMain(path.join(REAL, 'cli.js'), path.join(REAL, 'cli')), true);
  });
});

describe('isMain in a real node process', () => {
  test('an ES module is main when run, and not when imported', () => {
    assert.equal(printed(path.join(REAL, 'main.mjs')), 'true');
    assert.equal(printed(path.join(REAL, 'imports-main.mjs')), 'false');
  });

  test('a CommonJS module is main when run, and not when required', () => {
    assert.equal(printed(path.join(REAL, 'main.cjs')), 'true');
    assert.equal(printed(path.join(REAL, 'requires-main.cjs')), 'false');
  });

  test('a module run through a linked folder is still main', () => {
    assert.equal(printed(path.join(LINKED, 'main.mjs')), 'true');
    assert.equal(printed(path.join(LINKED, 'main.cjs')), 'true');
  });

  test('a CommonJS module started by its extensionless path is main', () => {
    assert.equal(printed(path.join(REAL, 'cli')), 'true');
  });
});
