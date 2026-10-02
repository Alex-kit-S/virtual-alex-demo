#!/usr/bin/env node
// @ts-check
// scripts/tests/test-heartbeat-check.mjs - the 48-hour heartbeat rule, and the workflow that runs it.
//
// WHAT. Proves scripts/heartbeat-check.mjs fails an absent run log, a stale Routine row, a log with no
// dated row and a log of interactive session rows only, refuses a bad window, and passes a Routine row
// inside the window whatever the line order, with the defaults the workflow relies on. Then holds the
// workflow an owner's repository runs it from: a daily cron and a manual trigger, the gate step that asks
// whether the repository is a template, the condition on every later step evaluated over its inputs, the
// script call and a read-only token. Deleted, it would let the alarm pass a dead system, lose its
// schedule, or mail a failure every morning from the template, with every other test green.
//
// HOW. Runs the script as a child against fixtures in a temp folder, --now pinned. The defaults are
// measured by running a copy of the script, beside the libraries it imports, in a temp tree with no
// --file and no --max-hours, never by reading its source. The workflow is read as text from
// variants/online/.github/workflows/heartbeat.yml in the Kit, or from .github/workflows/heartbeat.yml in
// the online tree, which has no variants/ folder.
//
// NEVER. Writes outside its temp folder, which it removes at the end, or reaches the network. Reads the
// script's source: its defaults are behaviour, and behaviour is measured by running it.
//
// Usage: node scripts/tests/test-heartbeat-check.mjs
// Exit: 0 every assertion held - 1 one failed, or no heartbeat.yml was found

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, describe, test } from 'node:test';
import { fileURLToPath } from 'node:url';

const KIT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const SCRIPT = path.join(KIT, 'scripts', 'heartbeat-check.mjs');
// The script and the libraries it imports, which a copy of the script needs beside it to run.
const CLI_FILES = [
  'scripts/heartbeat-check.mjs',
  'scripts/lib/repo-root.js',
  'scripts/lib/run-log-read.js',
  'scripts/lib/args.js',
  'scripts/lib/errors.js',
  'scripts/lib/exit-codes.js'
];
// The workflow lives under variants/online/ in the Kit and at its real path in the online tree, so the
// test reads whichever of the two the tree it runs in holds.
const YML = [
  path.join(KIT, 'variants', 'online', '.github', 'workflows', 'heartbeat.yml'),
  path.join(KIT, '.github', 'workflows', 'heartbeat.yml')
].find((p) => fs.existsSync(p));
if (!YML) {
  console.log(
    'test-heartbeat-check: no heartbeat.yml found under variants/online/.github/workflows/ or .github/workflows/'
  );
  process.exit(1);
}
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'alex-heartbeat-'));
after(() => fs.rmSync(TMP, { recursive: true, force: true }));
const NOW = '2026-09-23T07:00:00Z';
/** @param {string} file @param {string[]} [extra] */
const run = (file, extra = []) => {
  const r = spawnSync(process.execPath, [SCRIPT, '--file', file, '--now', NOW, ...extra], { encoding: 'utf8' });
  return { code: r.status, out: (r.stdout + r.stderr).trim() };
};
/** @param {string} at @param {string} [job] */
const row = (at, job = 'triage') =>
  JSON.stringify({
    at,
    canary: 'ok',
    job,
    missed: 0,
    model: 'claude-sonnet-4-6',
    reason: null,
    session_url: null,
    status: 'COMPLETE'
  });
/**
 * Copies the script and its libraries into `tree`, each at its place in the Kit.
 * @param {string} tree
 * @returns {string} the copied script
 */
function copyCli(tree) {
  for (const rel of CLI_FILES) {
    const to = path.join(tree, ...rel.split('/'));
    fs.mkdirSync(path.dirname(to), { recursive: true });
    fs.copyFileSync(path.join(KIT, ...rel.split('/')), to);
  }
  return path.join(tree, 'scripts', 'heartbeat-check.mjs');
}

describe('heartbeat-check.mjs: the 48-hour rule', () => {
  test('N1 NEGATIVE an absent run log fails (exit 1) and says so', () => {
    const r = run(path.join(TMP, 'absent.jsonl'));
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, /FAIL - .*absent/);
  });

  test('N2 NEGATIVE a newest row 49 hours old fails and prints the age', () => {
    const f = path.join(TMP, 'stale.jsonl');
    fs.writeFileSync(f, `${[row('2026-09-20T07:00:00Z'), row('2026-09-21T06:00:00Z', 'brief')].join('\n')}\n`);
    const r = run(f);
    assert.equal(r.code, 1, r.out);
    assert.match(
      r.out,
      /FAIL - the newest run-log row is 49 hour\(s\) old \(job brief, at 2026-09-21T06:00:00Z\), over the 48-hour window/
    );
  });

  test('N3 NEGATIVE a file with no dated row fails', () => {
    const f = path.join(TMP, 'noat.jsonl');
    fs.writeFileSync(f, '{"job":"triage"}\nnot json\n');
    const r = run(f);
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, /no row with an at field/);
  });

  test('N5 NEGATIVE an interactive session row does not mask a Routine row, and session rows alone fail', () => {
    const f = path.join(TMP, 'session-masks.jsonl');
    fs.writeFileSync(
      f,
      `${[row('2026-09-21T06:00:00Z', 'brief'), row('2026-09-23T06:30:00Z', 'session')].join('\n')}\n`
    );
    const r = run(f);
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, /49 hour\(s\) old \(job brief/, 'a fresh session row does not mask a Routine row 49 hours old');

    const f2 = path.join(TMP, 'sessions-only.jsonl');
    fs.writeFileSync(f2, `${row('2026-09-23T06:30:00Z', 'session')}\n`);
    const r2 = run(f2);
    assert.equal(r2.code, 1, r2.out);
    assert.match(r2.out, /only interactive session rows/, 'session rows alone fail: no Routine has ever written');
  });

  test('N4 NEGATIVE a non-numeric --max-hours is refused (exit 2)', () => {
    const r = run(path.join(TMP, 'stale.jsonl'), ['--max-hours', 'soon']);
    assert.equal(r.code, 2, r.out);
    assert.match(r.out, /REFUSED/);
  });

  test('P1 a newest row 47 hours old passes, whatever the line order', () => {
    const f = path.join(TMP, 'fresh.jsonl');
    fs.writeFileSync(f, `${[row('2026-09-21T08:00:00Z'), row('2026-09-19T08:00:00Z', 'radar')].join('\n')}\n`);
    const r = run(f);
    assert.equal(r.code, 0, r.out);
    assert.match(
      r.out,
      /OK - the newest run-log row is 47 hour\(s\) old \(job triage, at 2026-09-21T08:00:00Z\), inside the 48-hour window/
    );
  });

  test('P2 the default file is system/run-log.jsonl and the default window is 48 hours', () => {
    // Measured by running a copy of the script in a temp tree with no --file and no --max-hours, never
    // by reading its source: the workflow calls it with no arguments, so the defaults ARE its behaviour.
    const tree = path.join(TMP, 'defaults');
    const script = copyCli(tree);
    const bare = () => {
      const r = spawnSync(process.execPath, [script, '--now', NOW], { encoding: 'utf8' });
      return { code: r.status, out: (r.stdout + r.stderr).trim() };
    };
    const absent = bare();
    assert.equal(absent.code, 1, absent.out);
    assert.match(
      absent.out,
      /FAIL - system\/run-log\.jsonl is absent/,
      'with no --file the file read is system/run-log.jsonl beside scripts/, and here it is absent'
    );

    fs.mkdirSync(path.join(tree, 'system'), { recursive: true });
    fs.writeFileSync(path.join(tree, 'system', 'run-log.jsonl'), `${row('2026-09-21T06:00:00Z')}\n`);
    const over = bare();
    assert.equal(over.code, 1, over.out);
    assert.match(
      over.out,
      /49 hour\(s\) old .*, over the 48-hour window/,
      'with no --max-hours a row 49 hours old is over the window, which is 48 hours'
    );

    fs.writeFileSync(path.join(tree, 'system', 'run-log.jsonl'), `${row('2026-09-21T08:00:00Z')}\n`);
    const inside = bare();
    assert.equal(inside.code, 0, inside.out);
    assert.match(
      inside.out,
      /47 hour\(s\) old .*, inside the 48-hour window/,
      'the file is read and a row 47 hours old is inside the 48-hour window'
    );
  });
});

// P3: the workflow calls this script on a daily schedule plus workflow_dispatch. The scheduled fire is
// skipped where the repository is a GitHub TEMPLATE (the template itself and every seed): those carry no
// run log by construction and would mail a failure every morning for ever, while an owner's repository
// must always run it. The gate is the repository's template flag, never its org name, which would let a
// template outside the org fail every day. A schedule event carries no webhook payload, so
// github.event.repository.is_template does not exist on that fire; a first step asks the API instead,
// and the check's steps run unless the answer is exactly "true". The truth table below is evaluated, not
// matched.
describe('the heartbeat workflow (heartbeat.yml)', () => {
  const yml = fs.readFileSync(YML, 'utf8');
  const gateStep =
    /- name: [^\n]*\n\s+id: gate\n\s+if: \$\{\{ github\.event_name == 'schedule' \}\}\n(?:\s+[^\n]*\n)*?\s+template="\$\(gh api "repos\/\$\{GITHUB_REPOSITORY\}" --jq \.is_template\)"/.test(
      yml
    );
  const checkIf = (yml.match(/if: \$\{\{ (.+?) \}\}\n\s+run: node scripts\/heartbeat-check\.mjs/) || [])[1] || null;
  // the Actions expression, rewritten as JS for the two inputs it may use
  /** @param {string} event @param {boolean} isTemplate */
  const evalCheck = (event, isTemplate) => {
    if (!checkIf) return true;
    const gateOut = event === 'schedule' ? String(isTemplate) : ''; // a skipped step has no outputs
    const js = checkIf
      .replace(/steps\.gate\.outputs\.template/g, JSON.stringify(gateOut))
      .replace(/github\.event_name/g, JSON.stringify(event));
    if (!/^[\s!|&()'"a-z_=-]+$/i.test(js)) throw new Error(`unexpected check expression: ${checkIf}`);
    return Function(`"use strict"; return (${js.replace(/'/g, '"')});`)();
  };

  test('cron 0 7 * * * plus workflow_dispatch', () => {
    assert.match(yml, /schedule:\s*\n\s*- cron: '0 7 \* \* \*'/);
    assert.match(yml, /workflow_dispatch:/);
  });

  test('runs the script', () => {
    assert.match(yml, /run: node scripts\/heartbeat-check\.mjs/);
  });

  test('NEGATIVE-guard no gate on the org name (a template outside the org would fire daily)', () => {
    assert.doesNotMatch(yml, /startsWith\(github\.repository/);
  });

  test('on a schedule fire only, a gate step reads is_template from the API, and a failed read fails the job', () => {
    assert.ok(gateStep, yml);
  });

  test('the check step carries the gate', () => {
    assert.ok(Boolean(checkIf), checkIf || 'no if on the heartbeat-check step');
  });

  test('NEGATIVE the scheduled fire on a template (the template, a seed, a public template anywhere) is skipped', () => {
    assert.equal(evalCheck('schedule', true), false);
  });

  test('the scheduled fire in an owner repository runs', () => {
    assert.equal(evalCheck('schedule', false), true);
  });

  test('a manual dispatch on the template still runs (the proof the check fires)', () => {
    assert.equal(evalCheck('workflow_dispatch', true), true);
  });

  test('a manual dispatch in an owner repository runs', () => {
    assert.equal(evalCheck('workflow_dispatch', false), true);
  });

  test('every step after the gate is skipped on a template, so the scheduled fire there costs one API call', () => {
    const steps = (yml.split(/\n\s+steps:\n/)[1] || '').split(/\n(?= {6}- )/);
    const guarded = steps.filter((b) => /^ {6}- /.test(b) && !/id: gate/.test(b));
    assert.ok(guarded.length >= 3, `${guarded.length} step(s)`);
    assert.ok(
      guarded.every((b) => /steps\.gate\.outputs\.template != 'true'/.test(b)),
      `${guarded.length} step(s)`
    );
  });

  test('heartbeat.yml is read-only', () => {
    assert.match(yml, /contents: read/);
    assert.doesNotMatch(yml, /contents: write/);
  });
});
