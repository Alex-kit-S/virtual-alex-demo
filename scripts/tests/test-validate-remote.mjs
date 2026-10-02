#!/usr/bin/env node
// scripts/tests/test-validate-remote.mjs - validate-alex under CLAUDE_CODE_REMOTE=true: the drift
// legs WARN in the pre-commit context, the content legs still block, and the generator context never
// degrades.
//
// WHAT. Runs the REAL validator against this checkout with a --staged preview dir that carries one
// deliberately drifted file at a time, so nothing in the working tree is touched. The drift is a
// one-line change to a work/NN/CLAUDE.md Trifecta Gate line (V12). The content
// case removes a routing marker from CLAUDE.md (G2). Every refusal shown before the pass. Deleted, a
// drift leg that stopped degrading under CLAUDE_CODE_REMOTE=true would block every online session on a
// gap that only a person editing this repo's own docs can fix, and a content leg that started degrading
// would let a real defect through online.
//
// HOW. Every real-validator spawn below loads the shared scheduler-stub fixture
// (scripts/tests/fixtures/scheduler-stub.cjs) with an empty C4_LIVE, so V2's live-scheduler leg is a
// clean, silent "none registered" WARNING on every run here regardless of what the real machine's
// Task Scheduler holds - none of the assertions below read a V2 line, so a fixed, quiet answer never
// changes what is asserted, and no run here can reach a real scheduler binary or a blocker loaded
// ahead of it.
//
// NEVER. Writes into the checkout, reaches a network, or reaches a real scheduler binary.
//
// Usage: node scripts/tests/test-validate-remote.mjs
// Exit: 0 all pass - 1 a failure

import { test, describe, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const KIT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const VALIDATOR = path.join(KIT, 'scripts', 'validate-alex.js');
const SCHED_STUB = path.join(KIT, 'scripts', 'tests', 'fixtures', 'scheduler-stub.cjs');
const require = createRequire(import.meta.url);
const { isRemoteDrift, REMOTE_DRIFT_LEGS } = require(VALIDATOR);

function show(label, text) {
  const t = String(text || '')
    .trim()
    .split(/\r?\n/)
    .filter((l) => /FAILED|degraded|PASS|WARNING \(drift/.test(l));
  if (t.length) console.log(`      ${label}: ${t.join('\n      ')}`);
}
function run(args, env) {
  return spawnSync(process.execPath, ['-r', SCHED_STUB, VALIDATOR, ...args], {
    cwd: KIT,
    encoding: 'utf8',
    env: { ...process.env, CLAUDE_CODE_REMOTE: '', C4_LIVE: '', ...env }
  });
}
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'alex-validate-remote-'));
after(() => fs.rmSync(TMP, { recursive: true, force: true }));
function stagedWith(rel, mutate) {
  const dir = fs.mkdtempSync(path.join(TMP, 'staged-'));
  const src = fs.readFileSync(path.join(KIT, rel), 'utf8');
  const out = mutate(src);
  if (out === src) throw new Error(`the mutation of ${rel} changed nothing`);
  const dst = path.join(dir, rel);
  fs.mkdirSync(path.dirname(dst), { recursive: true });
  fs.writeFileSync(dst, out);
  return dir;
}

// the drift: the Trifecta Gate line of a project that declares one
const manifest = JSON.parse(fs.readFileSync(path.join(KIT, 'system', 'manifest.json'), 'utf8'));
const project = manifest.projects.find((p) => p.trifecta?.gate && p.work_dir);
if (!project) throw new Error('no project with a declared trifecta gate in system/manifest.json');
const claudeRel = `${project.work_dir.replace(/\\/g, '/')}/CLAUDE.md`;
const gateRe = new RegExp(`(Gate:\\s*\\**\\s*)${project.trifecta.gate.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`);
console.log(`drift fixture: ${claudeRel}, Gate: ${project.trifecta.gate} -> Gate: elsewhere`);

describe('validate-alex under CLAUDE_CODE_REMOTE=true', () => {
  test('C0 the classifier: the drift set holds V2 and V12 and not V10, V11 or V16; a V18 dangling-command failure is drift and a V18 control-byte failure is content', () => {
    assert.ok(
      REMOTE_DRIFT_LEGS.has('V12') &&
        REMOTE_DRIFT_LEGS.has('V2') &&
        !REMOTE_DRIFT_LEGS.has('V10') &&
        !REMOTE_DRIFT_LEGS.has('V11') &&
        !REMOTE_DRIFT_LEGS.has('V16'),
      'the drift set holds V2 and V12 and not V10, V11 or V16'
    );
    assert.ok(
      isRemoteDrift(
        'FAILED V12: the "## Trifecta" section of work/02/CLAUDE.md has no "Gate: read-only" declaration line'
      ),
      'a V12 echo failure is drift'
    );
    assert.ok(
      !isRemoteDrift('FAILED V10: commit modifies immutable vault/sources/x.md (NEVER-TOUCH.md)'),
      'NEGATIVE a V10 failure is never drift'
    );
    assert.ok(!isRemoteDrift('FAILED V11: 2 gitignored path(s) are TRACKED'), 'NEGATIVE a V11 failure is never drift');
    assert.ok(
      !isRemoteDrift(
        'FAILED G2: CLAUDE.md (repo) must contain exactly one ROUTING-TABLE BEGIN/END pair - found BEGIN=1, END=0'
      ),
      'NEGATIVE a G2 structural failure is never drift'
    );
    assert.ok(
      !isRemoteDrift('FAILED V1: system/manifest.json is not valid JSON: Unexpected token'),
      'NEGATIVE an unparseable source is never drift, whatever its tag'
    );
    assert.ok(
      isRemoteDrift('FAILED V18: docs/x.md:3 names `/nothing`, which is not a command in this system.'),
      'a V18 dangling-command failure is drift'
    );
    assert.ok(
      !isRemoteDrift('FAILED V18: scripts/x.js contains control byte(s) (0x08) - almost always a backslash escape'),
      'NEGATIVE a V18 control-byte failure is content'
    );
  });

  test('A the baseline: degradation fires exactly when the no-variable run had a drift failure', () => {
    // The no-variable result is reported, not asserted: this suite also runs on the online tree, whose
    // constitution can carry a documented drift of its own (it named /update before that command was
    // written), and the online contract is the second line: under the variable the tree commits.
    const a = run(['--context=pre-commit']);
    show('baseline, no variable', a.stderr + a.stdout);
    console.log(
      `      baseline without the variable: exit ${a.status} (${(a.stderr.match(/^FAILED /gm) || []).length} FAILED line(s))`
    );
    const b = run(['--context=pre-commit'], { CLAUDE_CODE_REMOTE: 'true' });
    show('baseline, CLAUDE_CODE_REMOTE=true', b.stderr + b.stdout);
    assert.ok(
      b.status === 0 && !/^FAILED /m.test(b.stderr),
      `under CLAUDE_CODE_REMOTE=true this checkout passes with no FAILED line left (exit ${b.status})`
    );
    if (a.status !== 0) assert.match(b.stderr, /degraded/, `no-variable exit ${a.status}`);
    else assert.doesNotMatch(b.stderr, /degraded/, `no-variable exit ${a.status}`);
  });

  test('B and C: the one-line drift blocks without the variable, degrades to a WARNING with it, and never degrades in the generator context', () => {
    const dir = stagedWith(claudeRel, (s) => s.replace(gateRe, '$1elsewhere'));
    const n = run(['--context=pre-commit', `--staged=${dir}`]);
    show('no variable', n.stderr);
    assert.ok(
      n.status !== 0 && /FAILED V12/.test(n.stderr),
      `B NEGATIVE without the variable the drifted Gate line FAILS V12 and exits non-zero (exit ${n.status})`
    );
    const r = run(['--context=pre-commit', `--staged=${dir}`], { CLAUDE_CODE_REMOTE: 'true' });
    show('CLAUDE_CODE_REMOTE=true', r.stderr + r.stdout);
    assert.equal(r.status, 0, `C with CLAUDE_CODE_REMOTE=true the same drift exits 0 (exit ${r.status})`);
    assert.match(
      r.stderr,
      /WARNING \(drift, degraded under CLAUDE_CODE_REMOTE=true, context=pre-commit\) V12:/,
      'C the V12 line is printed as a WARNING that names the degradation'
    );
    assert.match(
      r.stderr,
      /\d+ drift failure\(s\) degraded to warnings/,
      'C the summary line counts the degraded failure(s)'
    );
    assert.doesNotMatch(r.stderr, /FAILED V12/, 'C no FAILED V12 line remains');
    assert.match(r.stdout, /validate-alex: .* PASS \(context=pre-commit/, 'C the verdict line is PASS');
    const g = run(['--context=generator', `--staged=${dir}`], { CLAUDE_CODE_REMOTE: 'true' });
    show('generator context', g.stderr);
    assert.ok(
      g.status !== 0 && /FAILED V12/.test(g.stderr) && !/degraded/.test(g.stderr),
      `C NEGATIVE the generator context never degrades, even with the variable set (exit ${g.status})`
    );
  });

  test('D: a content failure still blocks under the variable', () => {
    const dir = stagedWith('CLAUDE.md', (s) =>
      s.replace('<!-- ROUTING-TABLE:END -->', '<!-- routing table end marker removed -->')
    );
    const r = run(['--context=pre-commit', `--staged=${dir}`], { CLAUDE_CODE_REMOTE: 'true' });
    show('CLAUDE_CODE_REMOTE=true, G2 broken', r.stderr);
    assert.ok(
      r.status !== 0 && /FAILED G2/.test(r.stderr),
      `D NEGATIVE with CLAUDE_CODE_REMOTE=true a missing routing marker still FAILS G2 (content blocks) (exit ${r.status})`
    );
  });
});
