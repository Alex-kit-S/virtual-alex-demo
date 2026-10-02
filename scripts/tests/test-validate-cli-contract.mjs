#!/usr/bin/env node
// scripts/tests/test-validate-cli-contract.mjs - the TEXT and CLI contracts other files read from
// scripts/validate-alex.js, pinned before anyone retypes it.
//
// WHAT. Deleted, a retype of validate-alex.js could silently break any of: the literal `const V_MAX =
// <n>;` line (system/recall/harvesters/h-validators.js parses it with /^const V_MAX\s*=\s*(\d+)\s*;/m);
// the FIRST `G1-G<n>` in the file (h-validators.js takes txt.match(/G1-G(\d+)/), today a comment); the
// export list's shapes and arities (generate-alex.js, four tests and a stub import it); the
// kitManifestDropClaim(stagedDir) declaration in scripts/lib/validate/shipped.js; the hook invocation
// `scripts/validate-alex.js --context=pre-commit --changed` in both pre-commit hooks; the output format
// (warnings then failures on stderr, one verdict line on stdout, exit 0 or 1); the command line's refusal
// of an unknown context and the forms it accepts silently; and the online classifier (which FAILED lines
// degrade under CLAUDE_CODE_REMOTE=true, decided by wording alone).
//
// HOW. The text-contract tests read validate-alex.js's own source once (SRC) and assert against it
// directly, no process spawned. The CLI legs run the real validator as a child process over a temp git
// repository scripts/tests/fixtures/validator-tree.mjs builds from this checkout's tracked files
// (`.agents/` left out), behind scripts/tests/fixtures/scheduler-stub.cjs with C4_LIVEJOBS_DIRECT=1, so
// liveJobs() answers empty with no schtasks round trip. `PINNED DEFECT R5-<n>` is asserted as it behaves
// today, so a fix flips that named test.
//
// NEVER. Writes into this checkout, reaches a network, or registers or queries a scheduled task.
//
// Usage: node scripts/tests/test-validate-cli-contract.mjs
// Exit: 0 every case passed - 1 one failed

import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import {
  makeRoot,
  pinnedGitEnv,
  writeGitConfig,
  buildBaseTree,
  makeTreeFactory,
  spawnCollect,
  lines
} from './fixtures/validator-tree.mjs';

const KIT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const VALIDATOR = path.join(KIT, 'scripts', 'validate-alex.js');
const STUB = path.join(KIT, 'scripts', 'tests', 'fixtures', 'scheduler-stub.cjs');
const require = createRequire(import.meta.url);
const ROOT = makeRoot('alex-validate-cli-');
const BASE = path.join(ROOT, 'base');
const ENV = pinnedGitEnv(ROOT);
const CONCURRENCY = Math.max(
  1,
  Math.min(4, (os.availableParallelism ? os.availableParallelism() : os.cpus().length) - 1)
);
const SRC = fs.readFileSync(VALIDATOR, 'utf8');
const SUITE = 'G1-G4 + V1-V21 (V6, V8, V20 retired)';

function read(dir, rel) {
  return fs.readFileSync(path.join(dir, rel), 'utf8');
}
function write(dir, rel, text) {
  fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
  fs.writeFileSync(path.join(dir, rel), text);
}
const tree = makeTreeFactory(BASE, ROOT);

function run(dir, args, env = {}) {
  return spawnCollect(['-r', STUB, path.join(dir, 'scripts', 'validate-alex.js'), ...args], {
    cwd: dir,
    env: { ...ENV, CLAUDE_CODE_REMOTE: '', C4_LIVEJOBS_DIRECT: '1', ...env }
  }).then((r) => ({ ...r, failed: lines(r.stderr).filter((l) => l.startsWith('FAILED ')) }));
}

before(() => {
  writeGitConfig(ROOT, 'cli fixture');
  buildBaseTree(KIT, BASE, ENV);
});
after(() => {
  fs.rmSync(ROOT, { recursive: true, force: true });
});

describe('validate-alex text contracts (read from the source, no run)', () => {
  test('the one V_MAX declaration is the literal line `const V_MAX = 21;` at column 0, and its reader parses 21 from it', () => {
    const decls = SRC.split(/\r?\n/).filter((l) => /^\s*(const|let|var)\s+V_MAX\b/.test(l));
    assert.deepEqual(decls, ['const V_MAX = 21;']);
    const reader = /^const V_MAX\s*=\s*(\d+)\s*;/m;
    assert.equal(SRC.match(reader)[1], '21');
    assert.equal(SRC.match(/V1-V(\d+)\s+PASS/), null, 'the old printed-line fallback matches nothing today');
  });

  test('the first `G1-G<n>` in the file, which h-validators takes as g_count, is a comment, and it agrees with SUITE_RANGE', () => {
    const at = SRC.search(/G1-G(\d+)/);
    const lineNo = SRC.slice(0, at).split('\n').length;
    const line = SRC.split(/\r?\n/)[lineNo - 1];
    assert.match(line, /^\s*\/\//, `line ${lineNo} is a comment`);
    const { SUITE_RANGE } = require(VALIDATOR);
    assert.equal(SRC.match(/G1-G(\d+)/)[1], SUITE_RANGE.match(/^G1-G(\d+)/)[1]);
  });

  test('the export list, its shapes and arities', () => {
    const v = require(VALIDATOR);
    assert.deepEqual(Object.keys(v), [
      'runAll',
      'evaluateProtectedChangeset',
      'V10_PROTECTED',
      'readStagedChangeset',
      'SUITE_RANGE',
      'V_MAX',
      'V_RETIRED',
      'REMOTE_DRIFT_LEGS',
      'isRemoteDrift'
    ]);
    assert.equal(v.runAll.constructor.name, 'AsyncFunction');
    assert.equal(v.runAll.length, 0);
    assert.equal(v.evaluateProtectedChangeset.length, 1);
    assert.equal(v.readStagedChangeset.length, 0);
    assert.equal(v.isRemoteDrift.length, 1);
    assert.equal(v.SUITE_RANGE, SUITE);
    assert.equal(v.V_MAX, 21);
    assert.deepEqual(v.V_RETIRED, [6, 8, 20]);
    assert.deepEqual([...v.REMOTE_DRIFT_LEGS], ['V1', 'V2', 'V3', 'V4', 'V5', 'V7', 'V12', 'V13', 'V15', 'V17', 'V19']);
    assert.deepEqual(
      v.V10_PROTECTED.map((e) => `${e.kind} ${e.path}${e.dir ? ' (dir)' : ''}`),
      [
        'immutable vault/sources/ (dir)',
        'append vault/log.md',
        'append vault/projects/self-review/close-out-log.md',
        'append outputs/ledger.jsonl',
        'append system/human-actions.jsonl',
        'append system/pending-writes.jsonl',
        'flagged vault/identity.md',
        'flagged brand/config/color-system.md'
      ]
    );
  });

  test('requiring the module runs nothing: no output, no exit code', () => {
    const r = execFileSync(
      process.execPath,
      ['-e', `require(${JSON.stringify(VALIDATOR)}); process.stdout.write('loaded')`],
      { encoding: 'utf8', env: { ...ENV, CLAUDE_CODE_REMOTE: '' } }
    );
    assert.equal(r, 'loaded');
  });

  test('the kitManifestDropClaim(stagedDir) declaration lives in lib/validate/shipped.js', () => {
    assert.ok(
      fs
        .readFileSync(path.join(KIT, 'scripts', 'lib', 'validate', 'shipped.js'), 'utf8')
        .includes('function kitManifestDropClaim(stagedDir)')
    );
  });

  test('both pre-commit hooks call the validator by this path in the hook form', (t) => {
    const hooks = ['scripts/hooks/pre-commit', 'variants/online/scripts/hooks/pre-commit'].filter((h) =>
      fs.existsSync(path.join(KIT, h))
    );
    if (!hooks.length) {
      t.skip('no pre-commit hook ships in this tree');
      return;
    }
    for (const h of hooks)
      assert.ok(
        fs
          .readFileSync(path.join(KIT, h), 'utf8')
          .includes('"$NODE" "$ROOT/scripts/validate-alex.js" --context=pre-commit --changed'),
        h
      );
  });
});

describe('the online classifier: whether a FAILED line degrades is decided by its wording', () => {
  const { isRemoteDrift, REMOTE_DRIFT_LEGS } = require(VALIDATOR);
  test('every drift leg degrades; every other leg, a G leg, a WARNING and an unprefixed line do not', () => {
    for (const leg of REMOTE_DRIFT_LEGS) assert.equal(isRemoteDrift(`FAILED ${leg}: something drifted`), true, leg);
    for (const leg of ['G1', 'G2', 'G3', 'G4', 'V9', 'V10', 'V11', 'V14', 'V16', 'V21'])
      assert.equal(isRemoteDrift(`FAILED ${leg}: something`), false, leg);
    assert.equal(isRemoteDrift('WARNING V1: something'), false);
    assert.equal(isRemoteDrift('V1: something'), false);
  });
  test('the four words that make any line content: not found, not valid JSON, cannot parse, is required', () => {
    for (const w of ['not found', 'not valid JSON', 'cannot parse', 'is required'])
      assert.equal(isRemoteDrift(`FAILED V1: the thing ${w} here`), false, w);
  });
  test("V18 splits by wording: names `/, points at `, links to ' are drift; everything else is content", () => {
    assert.equal(isRemoteDrift('FAILED V18: a.md:1 names `/x`, which is not a command'), true);
    assert.equal(isRemoteDrift('FAILED V18: a.md:1 points at `work/99-x`, which is not a project'), true);
    assert.equal(isRemoteDrift("FAILED V18: docs/a.md:1 links to 'b.md', which does not exist"), true);
    assert.equal(isRemoteDrift('FAILED V18: a.md contains control byte(s)'), false);
    assert.equal(isRemoteDrift('FAILED V18: x.cmd:2 uses `call :fail`'), false);
  });
  test('PINNED DEFECT R5-6: a malformed V19 registry degrades and a V12 "was not found" blocks, by wording alone', () => {
    assert.equal(
      isRemoteDrift('FAILED V19: system/manifest.json routines[] is malformed - routines[0]: missing field name'),
      true
    );
    assert.equal(
      isRemoteDrift('FAILED V12: project 02 X declares gate "read-only" but work/02-x/CLAUDE.md was not found'),
      false
    );
  });
});

describe('validate-alex on the command line', { concurrency: CONCURRENCY }, () => {
  test('KNOWN-BAD CLI: an unknown --context is refused with exit 1 and one stderr line, before any check runs', async () => {
    const r = await run(tree(), ['--context=bogus']);
    assert.equal(r.status, 1);
    assert.equal(r.stdout, '');
    assert.deepEqual(lines(r.stderr), ["validate-alex: unknown --context 'bogus' (valid: generator, pre-commit)"]);
  });

  test('the output format: warnings, then failures, on stderr; nothing on stdout on a refusal; one verdict line on a pass', async () => {
    const dir = tree();
    const pass = await run(dir, ['--context=pre-commit']);
    assert.equal(pass.status, 0, pass.stderr);
    const warnings = lines(pass.stderr).filter((l) => l.startsWith('WARNING'));
    assert.deepEqual(lines(pass.stdout), [
      `validate-alex: ${SUITE} PASS (context=pre-commit, ${warnings.length} warning(s) - see above)`
    ]);
    assert.ok(
      warnings.length > 0,
      'fixture: a tracked tree always carries warnings (no install, no drafts, no soul.md)'
    );
    const text = read(dir, 'CLAUDE.md');
    write(dir, 'CLAUDE.md', text.replace('<!-- ROUTING-TABLE:END -->', '<!-- gone -->'));
    const fail = await run(dir, ['--context=pre-commit']);
    assert.equal(fail.status, 1);
    assert.equal(fail.stdout, '');
    const ls = lines(fail.stderr);
    const lastWarning = ls.map((l) => l.startsWith('WARNING')).lastIndexOf(true);
    const firstFailed = ls.findIndex((l) => l.startsWith('FAILED '));
    assert.ok(
      lastWarning >= 0 && firstFailed > lastWarning,
      'every WARNING line is printed before the first FAILED line'
    );
  });

  test("`--context pre-commit` with a space is read as the pre-commit context, not the generator's, so .staging/ is a NOTE, never armed", async () => {
    const dir = tree();
    write(dir, '.staging/docs/zz-slot.md', '{{ZZ_SLOT}}\n');
    const r = await run(dir, ['--context', 'pre-commit']);
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /PASS \(context=pre-commit, /);
    assert.ok(r.stderr.includes('NOTE .staging/ exists and is IGNORED in context=pre-commit'), r.stderr);
    assert.ok(!/ZZ_SLOT/.test(r.stderr), r.stderr);
    fs.rmSync(path.join(dir, '.staging'), { recursive: true, force: true });
    const clean = await run(dir, ['--context', 'pre-commit']);
    assert.match(clean.stdout, /PASS \(context=pre-commit, /);
    assert.ok(!clean.stderr.includes('NOTE .staging/'), clean.stderr);
  });

  test('an unknown flag refuses with exit 1 naming the flags this command takes, and a --staged folder that does not exist refuses too', async () => {
    const dir = tree();
    const missing = path.join(ROOT, 'no-such-dir');
    const withUnknown = await run(dir, ['--context=pre-commit', '--bogus', `--staged=${missing}`]);
    assert.equal(withUnknown.status, 1);
    assert.equal(withUnknown.stdout, '');
    assert.deepEqual(lines(withUnknown.stderr), [
      'validate-alex: unknown flag --bogus; this command takes --staged, --context, --changed'
    ]);
    const knownButMissing = await run(dir, ['--context=pre-commit', `--staged=${missing}`]);
    assert.equal(knownButMissing.status, 1);
    assert.equal(knownButMissing.stdout, '');
    assert.deepEqual(lines(knownButMissing.stderr), [`validate-alex: --staged '${missing}' does not exist`]);
  });

  test('PINNED DEFECT R5-3: a registry of `{}` crashes the run as one internal-error line, and every finding already collected is lost', async () => {
    const dir = tree();
    write(dir, 'CLAUDE.md', read(dir, 'CLAUDE.md').replace('<!-- ROUTING-TABLE:END -->', '<!-- gone -->'));
    write(dir, 'system/manifest.json', '{}\n');
    let message;
    try {
      ({}).projects.filter(() => true);
    } catch (e) {
      message = e.message;
    }
    for (const env of [{ CLAUDE_CODE_REMOTE: '' }, { CLAUDE_CODE_REMOTE: 'true' }]) {
      const r = await run(dir, ['--context=pre-commit', '--changed'], env);
      assert.equal(r.status, 1, r.stderr);
      assert.equal(r.stdout, '');
      assert.deepEqual(
        lines(r.stderr),
        [`validate-alex: internal error: ${message}`],
        'the G2 failure collected before the crash is not printed'
      );
    }
  });

  test('PINNED DEFECT R5-3: a registry with projects and no meta crashes the same way on meta', async () => {
    const dir = tree();
    write(dir, 'system/manifest.json', '{"projects":[]}\n');
    let message;
    try {
      const m = { projects: [] };
      m.meta.unnumbered;
    } catch (e) {
      message = e.message;
    }
    const r = await run(dir, ['--context=pre-commit']);
    assert.equal(r.status, 1, r.stderr);
    assert.deepEqual(lines(r.stderr), [`validate-alex: internal error: ${message}`]);
  });
});
