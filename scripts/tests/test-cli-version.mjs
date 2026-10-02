#!/usr/bin/env node
// scripts/tests/test-cli-version.mjs - characterization of scripts/lib/cli-version.js beyond T10 of
// test-autosave.mjs.
//
// WHAT. The exported seams (parseVersion, atLeast, verdict with an injected run), a CLI that exits
// non-zero, --show on the old and the unknown paths, the timeout variable's fallback, an unknown CLI
// flag, and a known defect pinned as it behaves today. Deleted, a parse, timeout or exit-code path
// could silently drift with nothing to catch it.
//
// HOW. A fake `claude` in a temp folder this file deletes stands in for the CLI; nothing depends on
// the CLI this machine has.
//
// NEVER. Blocks: every path must exit 0 (a SessionStart hook that errors is worse than the risk it
// reports). Flips a PINNED DEFECT assertion on its own: it pins today's behaviour, and only a FIX row
// in the ratchet flips it. CV-D4: the first N.N.N in the answer wins, so a banner that names another
// version first hides an old CLI.
//
// Usage: node scripts/tests/test-cli-version.mjs
// Exit: 0 all pass - 1 any failure

import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const KIT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const PROBE = path.join(KIT, 'scripts', 'lib', 'cli-version.js');
const mod = createRequire(import.meta.url)(PROBE);
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'alex-cli-version-'));
after(() => fs.rmSync(TMP, { recursive: true, force: true, maxRetries: 5 }));

const CONSEQUENCE =
  'whether a save the commit gate refuses reaches Alex on this CLI has not been measured. Say so in your first reply, and ask the owner to check the autosave log with /alex-status before trusting that anything was saved.';
const PATH_KEY = Object.keys(process.env).find((k) => k.toUpperCase() === 'PATH') || 'PATH';
let n = 0;
// a fresh bin folder per fake, so no case sees another's answer
function fake({ win, sh }) {
  const bin = path.join(TMP, `bin-${++n}`);
  fs.mkdirSync(bin);
  if (process.platform === 'win32') fs.writeFileSync(path.join(bin, 'claude.cmd'), `@echo off\r\n${win}\r\n`);
  else {
    fs.writeFileSync(path.join(bin, 'claude'), `#!/bin/sh\n${sh}\n`);
    fs.chmodSync(path.join(bin, 'claude'), 0o755);
  }
  return bin;
}
function probe(bin, args = [], env = {}) {
  const r = spawnSync(process.execPath, [PROBE, ...args], {
    encoding: 'utf8',
    timeout: 30000,
    env: {
      ...process.env,
      [PATH_KEY]: `${bin}${path.delimiter}${process.env[PATH_KEY] || ''}`,
      ALEX_CLI_VERSION_TIMEOUT_MS: '3000',
      NODE_OPTIONS: '--no-deprecation',
      ...env
    }
  });
  return { code: r.status, stdout: r.stdout || '', stderr: r.stderr || '' };
}

test('the exported seams: the floor text, parseVersion takes the first N.N.N, atLeast compares three numbers', () => {
  assert.deepEqual(Object.keys(mod).sort(), ['FLOOR_TEXT', 'atLeast', 'parseVersion', 'verdict']);
  assert.equal(mod.FLOOR_TEXT, '2.1.227');
  assert.deepEqual(mod.parseVersion('2.1.259 (Claude Code)'), [2, 1, 259]);
  assert.deepEqual(mod.parseVersion('v10.0.1-beta'), [10, 0, 1]);
  assert.equal(mod.parseVersion('2.1'), null);
  assert.equal(mod.parseVersion(undefined), null);
  assert.equal(mod.atLeast([2, 1, 227]), true);
  assert.equal(mod.atLeast([2, 1, 226]), false);
  assert.equal(mod.atLeast([2, 2, 0]), true);
  assert.equal(mod.atLeast([1, 99, 999]), false);
  assert.equal(mod.atLeast([3, 0, 0], [3, 0, 1]), false);
});

test('verdict with an injected run: healthy, old, a failure with its reason, versionless text, and a run that throws', () => {
  assert.deepEqual(
    mod.verdict(() => ({ ok: true, stdout: ' 2.1.300 (Claude Code)\n' })),
    { raw: '2.1.300 (Claude Code)', version: '2.1.300', line: '' }
  );
  assert.deepEqual(
    mod.verdict(() => ({ ok: true, stdout: '2.0.9' })),
    { raw: '2.0.9', version: '2.0.9', line: `---CLI-OLD--- Claude Code 2.0.9 is older than 2.1.227: ${CONSEQUENCE}` }
  );
  assert.deepEqual(
    mod.verdict(() => ({ ok: false, why: 'claude --version exited 3' })),
    {
      raw: '',
      version: null,
      line: `---CLI-UNKNOWN--- The Claude Code version could not be read (claude --version exited 3), so ${CONSEQUENCE}`
    }
  );
  const long = 'x'.repeat(60);
  assert.equal(
    mod.verdict(() => ({ ok: true, stdout: long })).line,
    `---CLI-UNKNOWN--- The Claude Code version could not be read (no version in "${'x'.repeat(40)}"), so ${CONSEQUENCE}`
  );
  assert.deepEqual(
    mod.verdict(() => {
      throw new Error('spawn exploded');
    }),
    {
      raw: '',
      version: null,
      line: `---CLI-UNKNOWN--- The Claude Code version could not be read (spawn exploded), so ${CONSEQUENCE}`
    }
  );
});

test('a CLI that exits non-zero: CLI-UNKNOWN naming the exit code, and exit 0', () => {
  const bin = fake({ win: 'exit /b 3', sh: 'exit 3' });
  assert.deepEqual(probe(bin), {
    code: 0,
    stderr: '',
    stdout: `---CLI-UNKNOWN--- The Claude Code version could not be read (claude --version exited 3), so ${CONSEQUENCE}\n`
  });
});

test('--show on an old CLI prints the raw answer and the CLI-OLD line, and no "at or above" verdict', () => {
  const bin = fake({ win: 'echo 2.1.100 (Claude Code)', sh: 'echo "2.1.100 (Claude Code)"' });
  assert.deepEqual(probe(bin, ['--show']), {
    code: 0,
    stderr: '',
    stdout: `claude --version: 2.1.100 (Claude Code)\n---CLI-OLD--- Claude Code 2.1.100 is older than 2.1.227: ${CONSEQUENCE}\n`
  });
});

test('--show when the answer carries no version prints "(no answer)" only when nothing came back', () => {
  const junk = fake({ win: 'echo not a version', sh: 'echo "not a version"' });
  assert.deepEqual(probe(junk, ['--show']), {
    code: 0,
    stderr: '',
    stdout: `claude --version: not a version\n---CLI-UNKNOWN--- The Claude Code version could not be read (no version in "not a version"), so ${CONSEQUENCE}\n`
  });
  const failing = fake({ win: 'exit /b 1', sh: 'exit 1' });
  assert.equal(probe(failing, ['--show']).stdout.split('\n')[0], 'claude --version: (no answer)');
});

test('ALEX_CLI_VERSION_TIMEOUT_MS sets the wait; 0 or junk falls back to 5000 ms, and the line names the wait', () => {
  const hang = fake({ win: ':loop\r\ngoto loop', sh: 'exec sleep 30' });
  const t0 = Date.now();
  const short = probe(hang, [], { ALEX_CLI_VERSION_TIMEOUT_MS: '1500' });
  assert.equal(short.code, 0);
  assert.equal(
    short.stdout,
    `---CLI-UNKNOWN--- The Claude Code version could not be read (no answer within 1500 ms), so ${CONSEQUENCE}\n`
  );
  assert.ok(Date.now() - t0 < 12000);
  const fallback = probe(hang, [], { ALEX_CLI_VERSION_TIMEOUT_MS: '0' });
  assert.equal(
    fallback.stdout,
    `---CLI-UNKNOWN--- The Claude Code version could not be read (no answer within 5000 ms), so ${CONSEQUENCE}\n`
  );
});

test('an unknown flag warns on stderr by name and does not change --show or the exit code', () => {
  const bin = fake({ win: 'echo 2.1.300 (Claude Code)', sh: 'echo "2.1.300 (Claude Code)"' });
  const r = probe(bin, ['--show', '--bogus']);
  assert.equal(r.code, 0);
  assert.equal(r.stderr, 'cli-version: WARNING - ignored --bogus: unknown flag --bogus\n');
  assert.equal(
    r.stdout,
    'claude --version: 2.1.300 (Claude Code)\ncli-version: 2.1.300 is at or above 2.1.227; hook messages reaching Alex is confirmed on 2.1.259, not separately measured at every version above the floor.\n'
  );
});

test('PINNED DEFECT CV-D4: a banner naming another version first hides an old CLI (read as healthy, silent)', () => {
  const bin = fake({
    win: 'echo Node 24.16.0 runtime, Claude Code 2.1.100',
    sh: 'echo "Node 24.16.0 runtime, Claude Code 2.1.100"'
  });
  assert.deepEqual(probe(bin), { code: 0, stdout: '', stderr: '' });
  assert.deepEqual(
    mod.verdict(() => ({ ok: true, stdout: 'Node 24.16.0 runtime, Claude Code 2.1.100' })).version,
    '24.16.0'
  );
});
