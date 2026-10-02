#!/usr/bin/env node
// scripts/tests/test-validate-routines.mjs - validate-alex V19: every scheduler/routines/*.md file
// has a system/manifest.json routines[] row, every row names a file that exists, and every row has
// the shape gen-routines.js renders.
//
// WHAT. Runs the REAL validator against this checkout with a --staged preview dir carrying one
// mutated manifest at a time, so nothing in the working tree is touched. Every refusal shown before the
// pass. Deleted, an orphaned or malformed Routine prompt row could ship silently, and a Routine that
// scheduler/routines/ never actually holds would fail only when a person opened it.
//
// HOW. Every real-validator spawn loads the shared scheduler-stub fixture
// (scripts/tests/fixtures/scheduler-stub.cjs) with an empty C4_LIVE, so V2's live-scheduler leg is a
// clean, silent "none registered" WARNING on every run here - none of the cases below read a V2 line,
// so the fixed answer never changes what is asserted, and no run here can reach a real scheduler
// binary or a blocker loaded ahead of it.
//
// NEVER. Writes into the checkout, reaches a network, or reaches a real scheduler binary.
//
// Usage: node scripts/tests/test-validate-routines.mjs
// Exit: 0 all pass - 1 a failure

import { test, describe, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { makeRoot, pinnedGitEnv, writeGitConfig, buildBaseTree } from './fixtures/validator-tree.mjs';

const KIT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const VALIDATOR = path.join(KIT, 'scripts', 'validate-alex.js');
const SCHED_STUB = path.join(KIT, 'scripts', 'tests', 'fixtures', 'scheduler-stub.cjs');
const require = createRequire(import.meta.url);
const { routineRows, ROUTINES_DIR } = require(path.join(KIT, 'scripts', 'lib', 'gen-routines.js'));
const { REMOTE_DRIFT_LEGS } = require(VALIDATOR);

function v19Lines(res) {
  return String(res.stderr || '')
    .split(/\r?\n/)
    .filter((l) => /^FAILED V19:/.test(l));
}
function show(label, lines) {
  if (lines.length) console.log(`      ${label}: ${lines.join('\n      ')}`);
}
function run(stagedDir, env = {}, cwd = KIT) {
  return spawnSync(
    process.execPath,
    ['-r', SCHED_STUB, path.join(cwd, 'scripts', 'validate-alex.js'), '--context=pre-commit', `--staged=${stagedDir}`],
    {
      cwd,
      encoding: 'utf8',
      env: { ...process.env, CLAUDE_CODE_REMOTE: '', C4_LIVE: '', ...env }
    }
  );
}
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'alex-validate-routines-'));
after(() => fs.rmSync(TMP, { recursive: true, force: true }));
const manifest = JSON.parse(fs.readFileSync(path.join(KIT, 'system', 'manifest.json'), 'utf8'));

// N3 plants a real orphan file on disk, which V19 scans for by reading the routines directory
// directly (never through the --staged overlay the other cases use): it needs a full copy of the
// tree to write into, never the checkout itself.
const TREE_ROOT = makeRoot('alex-validate-routines-tree-');
const TREE_ENV = pinnedGitEnv(TREE_ROOT);
after(() => fs.rmSync(TREE_ROOT, { recursive: true, force: true }));
let TREE;
function treeCopy() {
  if (!TREE) {
    writeGitConfig(TREE_ROOT, 'validate-routines fixture');
    TREE = path.join(TREE_ROOT, 'tree');
    buildBaseTree(KIT, TREE, TREE_ENV);
  }
  return TREE;
}
function stagedManifest(mutate) {
  const dir = fs.mkdtempSync(path.join(TMP, 'staged-'));
  const m = JSON.parse(JSON.stringify(manifest));
  mutate(m);
  const dst = path.join(dir, 'system', 'manifest.json');
  fs.mkdirSync(path.dirname(dst), { recursive: true });
  fs.writeFileSync(dst, `${JSON.stringify(m, null, 2)}\n`);
  return dir;
}

const rows = routineRows(manifest);

describe('validate-alex V19: the Routine prompt registry', () => {
  test('the real registry carries at least five Routine rows, one prompt file per row on disk, and V19 is a drift leg', () => {
    assert.ok(
      rows.length >= 5,
      `the real registry carries at least five Routine rows (${rows.length} row(s): ${rows.map((r) => r.name).join(', ')})`
    );
    const onDisk = fs.readdirSync(path.join(KIT, ROUTINES_DIR)).filter((f) => f.endsWith('.md'));
    assert.equal(onDisk.length, rows.length, `one prompt file per row on disk (${onDisk.length} file(s))`);
    assert.ok(
      REMOTE_DRIFT_LEGS.has('V19'),
      'V19 is a drift leg (warns under CLAUDE_CODE_REMOTE, so an autosave never dies on it)'
    );
  });

  test('N1 NEGATIVE a routines row naming a missing prompt file FAILS V19', () => {
    const dir = stagedManifest((m) => {
      m.routines.push({ ...m.routines[0], name: 'ghost', prompt_file: `${ROUTINES_DIR}/ghost.md` });
    });
    const res = run(dir);
    const lines = v19Lines(res);
    show('N1', lines);
    assert.ok(
      res.status !== 0 && lines.some((l) => /ghost\.md/.test(l) && /does not exist/.test(l)),
      `exit ${res.status}`
    );
  });

  test('N2 NEGATIVE an orphan prompt file (its row removed) FAILS V19', () => {
    const victim = rows[0].name;
    const dir = stagedManifest((m) => {
      m.routines = m.routines.filter((r) => r.name !== victim);
    });
    const res = run(dir);
    const lines = v19Lines(res);
    show('N2', lines);
    assert.ok(
      res.status !== 0 &&
        lines.some((l) => l.includes(`${ROUTINES_DIR}/${victim}.md`) && /no routines\[\] row/.test(l)),
      `${ROUTINES_DIR}/${victim}.md with its row removed is an orphan and FAILS V19 (exit ${res.status})`
    );
  });

  test('N3 NEGATIVE a synthetic orphan file on disk FAILS V19', () => {
    // V19 reads the routines directory directly (never through --staged), so the orphan has to sit on
    // a real directory somewhere; a tree copy stands in for the checkout, never the checkout itself.
    const tree = treeCopy();
    const orphan = path.join(tree, ROUTINES_DIR, 'zz-synthetic-orphan-v19.md');
    fs.writeFileSync(orphan, '# synthetic orphan for the V19 negative test\n');
    const res = run(
      stagedManifest(() => {}),
      {},
      tree
    );
    const lines = v19Lines(res);
    show('N3', lines);
    assert.ok(res.status !== 0 && lines.some((l) => l.includes('zz-synthetic-orphan-v19.md')), `exit ${res.status}`);
  });

  test('N4 NEGATIVE a row with preset "monthly" (no such form preset) FAILS V19', () => {
    const dir = stagedManifest((m) => {
      m.routines[0].preset = 'monthly';
    });
    const res = run(dir);
    const lines = v19Lines(res);
    show('N4', lines);
    assert.ok(res.status !== 0 && lines.some((l) => /preset must be one of/.test(l)), `exit ${res.status}`);
  });

  test('N5 NEGATIVE a weekly row whose time_local has no weekday FAILS V19', () => {
    const dir = stagedManifest((m) => {
      const r = m.routines.find((x) => x.preset === 'weekly');
      r.time_local = '04:15';
    });
    const res = run(dir);
    const lines = v19Lines(res);
    show('N5', lines);
    assert.ok(res.status !== 0 && lines.some((l) => /names its weekday/.test(l)), `exit ${res.status}`);
  });

  test('N6 with CLAUDE_CODE_REMOTE=true the same orphan is a degraded WARNING and no FAILED V19 line remains', () => {
    const victim = rows[0].name;
    const dir = stagedManifest((m) => {
      m.routines = m.routines.filter((r) => r.name !== victim);
    });
    const res = run(dir, { CLAUDE_CODE_REMOTE: 'true' });
    const warned = String(res.stderr || '')
      .split(/\r?\n/)
      .filter((l) => /WARNING \(drift, degraded.*V19:/.test(l));
    show('N6', warned);
    assert.equal(v19Lines(res).length, 0);
    assert.equal(warned.length, 1);
  });

  test('P the real routines[] rows and the real prompt files pass V19 (no V19 line)', () => {
    const res = run(stagedManifest(() => {}));
    const lines = v19Lines(res);
    show('P', lines);
    assert.deepEqual(
      lines,
      [],
      `the real routines[] rows and the real prompt files pass V19 (validator exit ${res.status})`
    );
  });
});
