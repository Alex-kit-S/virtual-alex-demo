// @ts-check
// scripts/tests/test-repo-root.mjs - repoRoot names the checkout's root, and only a hook may be redirected.
//
// WHAT. Proves scripts/lib/repo-root.js: REPO is the folder two above scripts/lib/, whichever module system
// reads it and however the file was reached, and repoRoot() returns it; a hook gets CLAUDE_PROJECT_DIR when
// the harness sets it, and nothing else is ever redirected by that variable. Deleted, it would let the
// root drift by a folder, or let a variable left in a shell send a generator's writes into another
// checkout, with every other test green.
//
// HOW. Derives the expected root from this test's own place, scripts/tests/, and compares. Calls repoRoot
// with the variable set, empty and absent, as a hook and not. Copies the module into a scripts/lib/ folder
// inside a temp folder, links that folder, and has a node child require the copy through the link.
//
// NEVER. Writes outside its own temp folder, which it removes at the end, or changes this process's
// environment: every environment it tests is an object it passes.
//
// Usage: node scripts/tests/test-repo-root.mjs
// Exit: 0 every assertion held - 1 one failed

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { after, describe, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { REPO, repoRoot } from '../lib/repo-root.js';

const MODULE = fileURLToPath(new URL('../lib/repo-root.js', import.meta.url));
const EXPECTED = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const require = createRequire(import.meta.url);
const TEMP = fs.mkdtempSync(path.join(os.tmpdir(), 'test-repo-root-'));

after(() => fs.rmSync(TEMP, { recursive: true, force: true }));

describe('the root', () => {
  test('is the absolute folder two above scripts/lib/', () => {
    assert.equal(path.isAbsolute(REPO), true);
    assert.equal(REPO, EXPECTED);
    assert.equal(path.join(REPO, 'scripts', 'lib', 'repo-root.js'), MODULE);
  });

  test('repoRoot() returns it, and a require sees the same values as an import', () => {
    assert.equal(repoRoot(), REPO);
    assert.deepEqual(require(MODULE), { REPO, repoRoot });
  });

  test('is the real folder when the module is reached through a link', () => {
    const real = path.join(TEMP, 'real');
    fs.mkdirSync(path.join(real, 'scripts', 'lib'), { recursive: true });
    fs.copyFileSync(MODULE, path.join(real, 'scripts', 'lib', 'repo-root.js'));
    const linked = path.join(TEMP, 'linked');
    fs.symlinkSync(real, linked, 'junction');
    const through = path.join(linked, 'scripts', 'lib', 'repo-root.js');
    const script = `console.log(require(${JSON.stringify(through)}).REPO)`;
    const child = spawnSync(process.execPath, ['-e', script], { encoding: 'utf8', timeout: 30_000 });
    assert.equal(child.status, 0, child.stderr);
    // fs.realpathSync (the JavaScript one), not .native: node's own CommonJS loader resolves __dirname
    // through a link with the JS realpath, which keeps a Windows short (8.3) segment exactly as reached,
    // where .native would expand it to the long name and no longer match what require() actually produced.
    assert.equal(child.stdout.trim(), fs.realpathSync(real));
  });
});

describe('the project a hook is given', () => {
  const env = { CLAUDE_PROJECT_DIR: path.join(TEMP, 'opened-project') };

  test('is CLAUDE_PROJECT_DIR, as the harness wrote it, when the caller asks as a hook', () => {
    assert.equal(repoRoot({ hook: true, env }), env.CLAUDE_PROJECT_DIR);
    assert.equal(repoRoot({ hook: true, env: { CLAUDE_PROJECT_DIR: 'relative/as-written' } }), 'relative/as-written');
  });

  test('is the root when the variable is empty or absent', () => {
    assert.equal(repoRoot({ hook: true, env: { CLAUDE_PROJECT_DIR: '' } }), REPO);
    assert.equal(repoRoot({ hook: true, env: {} }), REPO);
  });

  test('never redirects a caller that did not ask as a hook', () => {
    assert.equal(repoRoot({ env }), REPO);
    assert.equal(repoRoot({ hook: false, env }), REPO);
  });
});
