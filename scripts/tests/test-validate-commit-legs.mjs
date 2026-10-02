#!/usr/bin/env node
// scripts/tests/test-validate-commit-legs.mjs - validate-alex's commit-time legs through REAL git: V10 (the
// protected-file guard on the staged changeset) and V11 (a forced add of an ignored path), plus what the
// whole gate reads when git itself misbehaves.
//
// WHAT. Deleted, nothing would prove either leg runs through REAL git, or that the gate judges the WORKING
// TREE rather than the commit. Before this file only V10's pure evaluator had a test
// (test-protected-guard.js).
//
// HOW. Each test builds a temp git repository from this checkout's tracked files (`.agents/` left out: no
// leg reads it) with scripts/tests/fixtures/validator-tree.mjs, stages a change with git, and runs the
// validator exactly as the laptop hook does (`--context=pre-commit --changed`) and as the online hook does
// (the same with CLAUDE_CODE_REMOTE=true). The laptop Kit ignores every protected path but the colour law,
// so the append-only log is made trackable by a `.gitignore` negation first, as a real owner's change would
// have to. Every run loads scripts/tests/fixtures/scheduler-stub.cjs first, which refuses every schtasks,
// launchctl and crontab call and answers liveJobs() with an empty list, so nothing here asks this machine's
// scheduler anything.
//
// NEVER. Writes into this checkout, reaches a network, or registers or queries a scheduled task.
//
// Usage: node scripts/tests/test-validate-commit-legs.mjs
// Exit: 0 every case passed - 1 one failed

import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import {
  makeRoot,
  pinnedGitEnv,
  writeGitConfig,
  gitIn,
  buildBaseTree,
  makeTreeFactory,
  spawnCollect,
  lines
} from './fixtures/validator-tree.mjs';

const KIT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const require = createRequire(import.meta.url);
const STUB = path.join(KIT, 'scripts', 'tests', 'fixtures', 'scheduler-stub.cjs');
const ROOT = makeRoot('alex-commit-legs-');
const BASE = path.join(ROOT, 'base');
const ENV = pinnedGitEnv(ROOT);
const CONCURRENCY = Math.max(
  1,
  Math.min(4, (os.availableParallelism ? os.availableParallelism() : os.cpus().length) - 1)
);
const git = gitIn(ENV);

const LAPTOP = { args: ['--context=pre-commit', '--changed'], env: { CLAUDE_CODE_REMOTE: '' } };
const ONLINE = { args: ['--context=pre-commit', '--changed'], env: { CLAUDE_CODE_REMOTE: 'true' } };
const NO_CHANGED = { args: ['--context=pre-commit'], env: { CLAUDE_CODE_REMOTE: '' } };
const GENERATOR = { args: [], env: { CLAUDE_CODE_REMOTE: '' } };
const LOG_REL = 'system/human-actions.jsonl';
const COLOUR_LAW = 'brand/config/color-system.md';

function ignored(cwd, rel) {
  try {
    git(cwd, ['check-ignore', '-q', '--no-index', rel]);
    return true;
  } catch {
    return false;
  }
}
function read(dir, rel) {
  return fs.readFileSync(path.join(dir, rel), 'utf8');
}
function write(dir, rel, text) {
  fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
  fs.writeFileSync(path.join(dir, rel), text);
}

function run(dir, ctx, extraEnv = {}) {
  return spawnCollect(['-r', STUB, path.join(dir, 'scripts', 'validate-alex.js'), ...ctx.args], {
    cwd: dir,
    env: { ...ENV, C4_LIVEJOBS_DIRECT: '1', ...ctx.env, ...extraEnv }
  }).then((r) => ({
    ...r,
    failed: lines(r.stderr).filter((l) => l.startsWith('FAILED ')),
    warnings: lines(r.stderr).filter((l) => l.startsWith('WARNING'))
  }));
}

const tree = makeTreeFactory(BASE, ROOT);
// The append-only log, tracked with two lines (a .gitignore negation first where the tree ignores it).
function trackLog(dir) {
  if (ignored(dir, LOG_REL)) {
    fs.appendFileSync(path.join(dir, '.gitignore'), `\n!${LOG_REL}\n`);
    assert.ok(!ignored(dir, LOG_REL), 'fixture: the negation makes the log trackable');
  }
  write(dir, LOG_REL, '{"n":1}\n{"n":2}\n');
  git(dir, ['add', '--', '.gitignore', LOG_REL]);
  git(dir, ['commit', '-qm', 'track the append-only log']);
}

before(() => {
  writeGitConfig(ROOT, 'commit-legs fixture');
  buildBaseTree(KIT, BASE, ENV);
});
after(() => {
  fs.rmSync(ROOT, { recursive: true, force: true });
});

describe('validate-alex V10 and V11 through real git', { concurrency: CONCURRENCY }, () => {
  test('KNOWN-BAD V10 (append-only shrunk): one line removed from the staged log; blocks both hooks; the leg sleeps outside the hook form', async () => {
    const dir = tree();
    trackLog(dir);
    write(dir, LOG_REL, '{"n":1}\n');
    git(dir, ['add', '--', LOG_REL]);
    const line = `FAILED V10: commit modifies append-only ${LOG_REL} with 1 removed line(s) (NEVER-TOUCH.md) - append-only files may only grow; --no-verify to override`;
    for (const [label, ctx] of [
      ['laptop', LAPTOP],
      ['online', ONLINE]
    ]) {
      const r = await run(dir, ctx);
      assert.equal(r.status, 1, `${label}\n${r.stderr}`);
      assert.deepEqual(r.failed, [line], label);
    }
    for (const [label, ctx] of [
      ['pre-commit without --changed', NO_CHANGED],
      ['generator', GENERATOR]
    ]) {
      const r = await run(dir, ctx);
      assert.equal(r.status, 0, `${label}\n${r.stderr}`);
      assert.ok(!/V10/.test(r.stderr), label);
    }
  });

  test('V10: an append-only log that only grows passes', async () => {
    const dir = tree();
    trackLog(dir);
    fs.appendFileSync(path.join(dir, LOG_REL), '{"n":3}\n');
    git(dir, ['add', '--', LOG_REL]);
    const r = await run(dir, LAPTOP);
    assert.equal(r.status, 0, r.stderr);
    assert.ok(!/V10/.test(r.stderr), r.stderr);
  });

  test('KNOWN-BAD V10 (append-only deleted): git rm of the log; blocks', async () => {
    const dir = tree();
    trackLog(dir);
    git(dir, ['rm', '-q', '--', LOG_REL]);
    const r = await run(dir, LAPTOP);
    assert.equal(r.status, 1, r.stderr);
    assert.deepEqual(r.failed, [
      `FAILED V10: commit deletes protected append path ${LOG_REL} (NEVER-TOUCH.md) - use 'git commit --no-verify' to override deliberately`
    ]);
  });

  test('KNOWN-BAD V10 (append-only renamed away): git mv of the log out of its home; judged on the old path; blocks', async () => {
    const dir = tree();
    trackLog(dir);
    git(dir, ['mv', '--', LOG_REL, 'docs/zz-moved.jsonl']);
    const r = await run(dir, LAPTOP);
    assert.equal(r.status, 1, r.stderr);
    assert.deepEqual(r.failed, [
      `FAILED V10: commit renames away protected append path ${LOG_REL} (NEVER-TOUCH.md) - use 'git commit --no-verify' to override deliberately`
    ]);
  });

  test('V10: a modified flagged path (the colour law) is surfaced as a WARNING and passes', async () => {
    const dir = tree();
    fs.appendFileSync(path.join(dir, COLOUR_LAW), '\nA note.\n');
    git(dir, ['add', '--', COLOUR_LAW]);
    const r = await run(dir, LAPTOP);
    assert.equal(r.status, 0, r.stderr);
    assert.ok(
      r.warnings.includes(
        `WARNING V10: commit modifies flagged ${COLOUR_LAW} (NEVER-TOUCH.md) - surfaced, not blocked`
      ),
      r.stderr
    );
  });

  test('KNOWN-BAD V10 (immutable modified): a tracked file under vault/sources/ changed; with V11 as well where the tree ignores vault/', async () => {
    const dir = tree();
    const rel = 'vault/sources/zz-source.md';
    const wasIgnored = ignored(dir, rel);
    write(dir, rel, 'original\n');
    git(dir, ['add', '-f', '--', rel]);
    git(dir, ['commit', '-qm', 'a source']);
    write(dir, rel, 'edited\n');
    git(dir, ['add', '-f', '--', rel]);
    const expected = [
      `FAILED V10: commit modifies immutable ${rel} (NEVER-TOUCH.md) - content is read-only; --no-verify to override`
    ];
    if (wasIgnored)
      expected.push(
        `FAILED V11: 1 gitignored path(s) are TRACKED (a forced 'git add -f' of an ignored file). On the PUBLIC repo this PUBLISHES them at the next push: ${rel}. Fix: 'git rm --cached <path>' (keeps the local file) or correct .gitignore. Deliberate override: 'git commit --no-verify'.`
      );
    const r = await run(dir, LAPTOP);
    assert.equal(r.status, 1, r.stderr);
    assert.deepEqual(r.failed, expected);
  });

  test('KNOWN-BAD V11: a forced add of an ignored file blocks both hooks', async () => {
    const dir = tree();
    const rel = ['zz-private.log', 'outputs/typed/zz-private.md', 'refactor/zz-private.md'].find((c) =>
      ignored(dir, c)
    );
    assert.ok(rel, 'fixture: a candidate path is ignored here');
    write(dir, rel, 'private\n');
    git(dir, ['add', '-f', '--', rel]);
    const line = `FAILED V11: 1 gitignored path(s) are TRACKED (a forced 'git add -f' of an ignored file). On the PUBLIC repo this PUBLISHES them at the next push: ${rel}. Fix: 'git rm --cached <path>' (keeps the local file) or correct .gitignore. Deliberate override: 'git commit --no-verify'.`;
    for (const [label, ctx] of [
      ['laptop', LAPTOP],
      ['online', ONLINE]
    ]) {
      const r = await run(dir, ctx);
      assert.equal(r.status, 1, `${label}\n${r.stderr}`);
      assert.deepEqual(r.failed, [line], label);
    }
    const g = await run(dir, GENERATOR);
    assert.equal(g.status, 0, g.stderr);
  });

  test('PINNED DEFECT R5-21: V11 says "On the PUBLIC repo" under every context, online included, which is never the public repo itself', async () => {
    const dir = tree();
    const rel = ['zz-private.log', 'outputs/typed/zz-private.md', 'refactor/zz-private.md'].find((c) =>
      ignored(dir, c)
    );
    assert.ok(rel, 'fixture: a candidate path is ignored here');
    write(dir, rel, 'private\n');
    git(dir, ['add', '-f', '--', rel]);
    const r = await run(dir, ONLINE);
    assert.equal(r.status, 1, r.stderr);
    assert.ok(r.failed[0].includes('On the PUBLIC repo'), r.stderr);
  });

  test('PINNED DEFECT R5-4: with an unreadable index V10 and V11 print SKIPPED, V21 reads a vanished tracked file as untracked, and the gate exits 0', async () => {
    const dir = tree();
    const audit = require(path.join(dir, 'scripts', 'json-standard-audit.js'));
    const rel = audit.parseContract(read(dir, audit.CONTRACT_REL)).find((x) => fs.existsSync(path.join(dir, x)));
    fs.rmSync(path.join(dir, rel));
    const healthy = await run(dir, LAPTOP);
    assert.equal(healthy.status, 1, 'control: with a readable index the vanished tracked file blocks');
    fs.writeFileSync(path.join(dir, '.git', 'index'), 'not an index at all\n');
    const r = await run(dir, LAPTOP);
    assert.equal(r.status, 0, r.stderr);
    assert.deepEqual(r.failed, []);
    assert.ok(
      r.warnings.some((w) => w.startsWith('WARNING V10 SKIPPED: could not read the staged changeset via git - ')),
      r.stderr
    );
    assert.ok(
      r.warnings.some((w) => w.startsWith('WARNING V11 SKIPPED: could not list tracked-vs-ignored paths via git - ')),
      r.stderr
    );
    const absentLine = r.warnings.find((w) =>
      w.startsWith('WARNING V21: enforced but absent, and not tracked by git here')
    );
    assert.ok(absentLine?.includes(rel), r.stderr);
    assert.ok(!r.warnings.some((w) => /tracked in-scope JSON file/.test(w)), 'the backlog line vanishes');
  });

  test('PINNED DEFECT R5-1: the gate reads the working tree, not the commit; a staged violation with a clean working copy passes', async () => {
    const dir = tree();
    const rel = 'system/manifest.json';
    const clean = read(dir, rel);
    const eol = clean.includes('\r\n') ? '\r\n' : '\n';
    const m = JSON.parse(clean);
    m.meta.constitution.byte_budget = 1000;
    const bad = JSON.stringify(m, null, 2).split('\n').join(eol) + eol;
    write(dir, rel, bad);
    git(dir, ['add', '--', rel]);
    write(dir, rel, clean);
    assert.match(
      git(dir, ['show', `:${rel}`]),
      /"byte_budget": 1000/,
      'fixture: the index holds the over-budget registry'
    );
    const staged = await run(dir, LAPTOP);
    assert.equal(staged.status, 0, staged.stderr);
    assert.deepEqual(staged.failed, []);
    git(dir, ['reset', '-q', '--', rel]);
    write(dir, rel, bad);
    const worktree = await run(dir, LAPTOP);
    assert.equal(worktree.status, 1, worktree.stderr);
    assert.equal(worktree.failed.length, 1);
    assert.match(
      worktree.failed[0],
      /^FAILED V16: CLAUDE\.md is \d+ B against meta\.constitution\.byte_budget 1000 B - /
    );
  });

  test('the evaluator refuses a type change (T) of a protected path, the same as it refuses a modify', () => {
    const { evaluateProtectedChangeset } = require(path.join(BASE, 'scripts', 'validate-alex.js'));
    assert.deepEqual(
      evaluateProtectedChangeset([{ status: 'T', path: 'vault/sources/x.md' }]).failures,
      [
        'FAILED V10: commit modifies immutable vault/sources/x.md (NEVER-TOUCH.md) - content is read-only; --no-verify to override'
      ],
      'T on an immutable path FAILS'
    );
    assert.deepEqual(
      evaluateProtectedChangeset([{ status: 'M', path: 'vault/sources/x.md', removed: '0' }]).failures,
      [
        'FAILED V10: commit modifies immutable vault/sources/x.md (NEVER-TOUCH.md) - content is read-only; --no-verify to override'
      ],
      'control: M is refused the same way'
    );
  });

  test('a protected append-only path swapped for a symlink in the index (a real git type change) still blocks the commit', async () => {
    const dir = tree();
    trackLog(dir);
    const sha = git(dir, ['ls-files', '-s', '--', LOG_REL]).trim().split(/\s+/)[1];
    assert.ok(sha, 'fixture: the tracked log has an index entry');
    git(dir, ['update-index', '--cacheinfo', `120000,${sha},${LOG_REL}`]);
    assert.equal(git(dir, ['diff', '--cached', '--name-status']).trim()[0], 'T', 'fixture: git reports a type change');
    const r = await run(dir, LAPTOP);
    assert.equal(r.status, 1, r.stderr);
    assert.deepEqual(r.failed, [
      `FAILED V10: commit modifies append-only ${LOG_REL} with non-text/unknown removed line(s) (NEVER-TOUCH.md) - append-only files may only grow; --no-verify to override`
    ]);
  });
});
