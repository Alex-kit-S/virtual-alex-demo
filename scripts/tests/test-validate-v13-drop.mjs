#!/usr/bin/env node
// scripts/tests/test-validate-v13-drop.mjs - validate-alex V13 on a tree whose scheduled wrappers
// are drop rows (the Virtual Alex online tree): a pin whose file is absent AND claimed by a drop
// row in system/kit-manifest.json is skipped; a pin naming an absent file that no drop row claims
// still FAILS; on a laptop tree the files exist and are checked as before.
//
// WHAT. The online-shaped tree is a copy of this checkout under the OS temp dir with the six .ps1
// wrappers deleted (what the generator does through the local-wrappers drop row), so the test needs
// no network. The negative half of the skip is the PREVIOUS validator run on the same copy: it must
// print six FAILED V13 lines. That validator is the committed fixture
// scripts/tests/fixtures/validate-v13-pre-drop.cjs, which gives the old V13 failure from the same
// inputs, so the negative runs in every checkout, a shallow CI one included, and never reads git
// history; --old <file> runs a real earlier validator in its place.
//
// V21a/V21b: the same rule for the JSON standard's "enforced but
// absent" warning. system/fleet.json, a drop row, is silent on the online-shaped copy; an enforced
// path that is absent and not a drop row still warns. Deleted, this file would let a laptop-only file
// deleted by the generator's own drop rule reappear as a false FAILED V13 on every online CI run.
//
// HOW. Runs the REAL validator against both a laptop-shaped and an online-shaped copy of this
// checkout under the OS temp dir, so nothing in the working tree is touched. Every run loads the
// shared scheduler-stub fixture (scripts/tests/fixtures/scheduler-stub.cjs) with an empty C4_LIVE, so
// V2's live-scheduler leg never reaches this machine's real Task Scheduler - none of the cases here
// read a V2 line (only V13 and V21), so the fixed, silent answer never changes what is asserted. The
// shared fixture answers the real execFileSync('schtasks', ...) call the product code actually makes,
// so the product's own V2 query path runs unmodified underneath it.
//
// NEVER. Reaches the real Task Scheduler, or touches the working tree.
//
// Usage: node scripts/tests/test-validate-v13-drop.mjs [--old <validator.js>]
// Exit: 0 all pass - 1 a failure

import { test, describe, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const KIT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const SCHED_STUB = path.join(KIT, 'scripts', 'tests', 'fixtures', 'scheduler-stub.cjs');
const v13 = (res) =>
  String(res.stderr || '')
    .split(/\r?\n/)
    .filter((l) => /^FAILED V13:/.test(l));
const show = (label, lines) => {
  if (lines.length) console.log(`      ${label}: ${lines.join('\n      ')}`);
};
function runValidator(tree, extra = []) {
  return spawnSync(
    process.execPath,
    ['-r', SCHED_STUB, path.join(tree, 'scripts', 'validate-alex.js'), '--context=pre-commit', ...extra],
    {
      cwd: tree,
      encoding: 'utf8',
      env: { ...process.env, CLAUDE_CODE_REMOTE: '', C4_LIVE: '' }
    }
  );
}

const manifest = JSON.parse(fs.readFileSync(path.join(KIT, 'system', 'manifest.json'), 'utf8'));
const pins = Object.keys(manifest.meta.model_routing.local_wrappers.pins);
const kitManifest = JSON.parse(fs.readFileSync(path.join(KIT, 'system', 'kit-manifest.json'), 'utf8'));
const dropRow = kitManifest.components.find((r) => r.id === 'local-wrappers');

// ---------------------------------------------------------------- the online-shaped copy
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'alex-v13-drop-'));
after(() => fs.rmSync(TMP, { recursive: true, force: true }));
const TREE = path.join(TMP, 'online');
const SKIP = new Set([
  '.git',
  '.staging',
  '.staging-backup',
  '.claude/skills',
  '.agents/skills',
  'outputs',
  'vault',
  'refactor',
  'node_modules'
]);
function copyTree(src, dst, rel = '') {
  for (const e of fs.readdirSync(src, { withFileTypes: true })) {
    const r = rel ? `${rel}/${e.name}` : e.name;
    if (SKIP.has(r) || SKIP.has(e.name)) continue;
    const s = path.join(src, e.name);
    const d = path.join(dst, e.name);
    if (e.isSymbolicLink()) continue;
    if (e.isDirectory()) {
      fs.mkdirSync(d, { recursive: true });
      copyTree(s, d, r);
    } else fs.copyFileSync(s, d);
  }
}
fs.mkdirSync(TREE, { recursive: true });
copyTree(KIT, TREE);
// On the Kit the wrappers exist and are deleted here; on the online tree itself (this suite runs in
// the template's CI too) they were never there, so what is asserted is the RESULT, not the count.
const isWrapper = (f) => /^run-.*\.ps1$/.test(f) || f === 'auth-check.ps1';
let removed = 0;
for (const f of fs.readdirSync(path.join(TREE, 'scripts'))) {
  if (isWrapper(f)) {
    fs.rmSync(path.join(TREE, 'scripts', f));
    removed++;
  }
}

describe('validate-alex V13/V21: pins and enforced-JSON absence on a drop-shaped tree', () => {
  test('the six pinned wrappers are all claimed by the local-wrappers drop row', () => {
    assert.ok(
      dropRow && dropRow.online === 'drop' && pins.every((f) => dropRow.paths.includes(`scripts/${f}`)),
      pins.join(', ')
    );
  });

  test('the online-shaped copy has no scheduled wrapper', () => {
    const left = fs.readdirSync(path.join(TREE, 'scripts')).filter(isWrapper);
    assert.equal(
      left.length,
      0,
      `${removed} removed here; ${removed === 0 ? 'this tree never had them, the online shape' : 'the drop set of a laptop checkout'}`
    );
  });

  test('N0 NEGATIVE the PREVIOUS validator prints six FAILED V13 lines on the online-shaped copy', () => {
    const oldArg = process.argv.indexOf('--old');
    const oldValidator =
      oldArg >= 0
        ? path.resolve(process.argv[oldArg + 1])
        : path.join(KIT, 'scripts', 'tests', 'fixtures', 'validate-v13-pre-drop.cjs');
    const OLD = path.join(TMP, 'online-old');
    fs.mkdirSync(OLD, { recursive: true });
    copyTree(TREE, OLD);
    fs.copyFileSync(oldValidator, path.join(OLD, 'scripts', 'validate-alex.js'));
    const res = runValidator(OLD);
    const lines = v13(res);
    show('N0 (old validator)', lines);
    assert.ok(
      lines.length === pins.length && lines.every((l) => /which does not exist/.test(l)),
      `expected ${pins.length} FAILED V13 line(s), got ${lines.length}, exit ${res.status}`
    );
  });

  test('P1 the new validator prints no FAILED V13 line on the online-shaped copy (six absent pins, all drop rows)', () => {
    const res = runValidator(TREE);
    const lines = v13(res);
    show('P1', lines);
    assert.deepEqual(lines, [], `exit ${res.status}`);
    assert.ok(
      !/WARNING V13/.test(String(res.stderr || '')),
      'and no V13 warning either: a by-design absence is silent'
    );
  });

  test('N1 NEGATIVE an absent pin that NO drop row claims still fails on the copy', () => {
    const m = JSON.parse(JSON.stringify(manifest));
    m.meta.model_routing.local_wrappers.pins['run-nonexistent.ps1'] = m.meta.model_routing.default;
    const staged = path.join(TMP, 'staged-n1');
    fs.mkdirSync(path.join(staged, 'system'), { recursive: true });
    fs.writeFileSync(path.join(staged, 'system', 'manifest.json'), `${JSON.stringify(m, null, 2)}\n`);
    const res = runValidator(TREE, [`--staged=${staged}`]);
    const lines = v13(res);
    show('N1', lines);
    assert.ok(lines.length === 1 && /run-nonexistent\.ps1 which does not exist/.test(lines[0]), `exit ${res.status}`);
  });

  test('N2 NEGATIVE the same stale pin on the laptop tree (files present) fails too', () => {
    const m = JSON.parse(JSON.stringify(manifest));
    m.meta.model_routing.local_wrappers.pins['run-nonexistent.ps1'] = m.meta.model_routing.default;
    const staged = path.join(TMP, 'staged-n2');
    fs.mkdirSync(path.join(staged, 'system'), { recursive: true });
    fs.writeFileSync(path.join(staged, 'system', 'manifest.json'), `${JSON.stringify(m, null, 2)}\n`);
    const res = runValidator(KIT, [`--staged=${staged}`]);
    const lines = v13(res);
    show('N2', lines);
    assert.ok(lines.length === 1 && /run-nonexistent\.ps1 which does not exist/.test(lines[0]), `exit ${res.status}`);
  });

  test('N3 NEGATIVE a drop row that stops claiming the wrappers makes the copy fail again', () => {
    const km = JSON.parse(JSON.stringify(kitManifest));
    const row = km.components.find((r) => r.id === 'local-wrappers');
    row.paths = row.paths.filter((p) => !/^scripts\/(run-.*|auth-check)\.ps1$/.test(p));
    const staged = path.join(TMP, 'staged-n3');
    fs.mkdirSync(path.join(staged, 'system'), { recursive: true });
    fs.writeFileSync(path.join(staged, 'system', 'kit-manifest.json'), `${JSON.stringify(km, null, 2)}\n`);
    const res = runValidator(TREE, [`--staged=${staged}`]);
    const lines = v13(res);
    show('N3', lines);
    assert.equal(lines.length, pins.length, `the skip is the row, not the absence (${lines.length} line(s))`);
  });

  test('P2 the laptop checkout is unchanged', () => {
    const res = runValidator(KIT);
    const lines = v13(res);
    show('P2', lines);
    assert.deepEqual(lines, [], `exit ${res.status}`);
  });

  test('V21: the same rule for the JSON standard', () => {
    // system/fleet.json is the operator's fleet record, a drop row that never exists online, so an
    // "enforced but absent" warning for it would fire on every validate of every healthy owner
    // repository and teach its owner to ignore warnings. The V13 rule applies: absent AND drop-claimed
    // is silent; absent and NOT drop-claimed still warns.
    fs.rmSync(path.join(TREE, 'system', 'fleet.json'), { force: true });
    fs.rmSync(path.join(TREE, 'system', 'migrations-applied.json'), { force: true });
    const res = runValidator(TREE);
    const absent =
      String(res.stderr || '')
        .split(/\r?\n/)
        .find((l) => /^WARNING V21: enforced but absent/.test(l)) || '';
    assert.ok(
      !/system\/fleet\.json/.test(absent),
      `V21a NEGATIVE not warned about system/fleet.json (${absent.slice(0, 160) || 'no warning'})`
    );
    assert.ok(
      /system\/migrations-applied\.json/.test(absent),
      `V21b an absent, non-drop-row enforced path still warns (${absent.slice(0, 160) || 'no warning'})`
    );
  });
});
