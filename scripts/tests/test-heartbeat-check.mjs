#!/usr/bin/env node
// scripts/tests/test-heartbeat-check.mjs - the 48-hour heartbeat rule (scripts/heartbeat-check.mjs,
// called by variants/online/.github/workflows/heartbeat.yml): absent and stale shown failing before
// the pass (plan Phase 4, seat 5, 2026-09-23).
//
// Run: node scripts/tests/test-heartbeat-check.mjs      (exit 0 = all pass)

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const KIT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const SCRIPT = path.join(KIT, 'scripts', 'heartbeat-check.mjs');
// The workflow lives under variants/online/ in the Kit and at its real path on the online tree
// (the generator lands it there and the online tree has no variants/ directory). The same rule
// seat 4 applied to its three suites: a fixture that names a variant-row path must be complete for
// both trees, or the template's CI fails on a file that only the Kit has.
const YML = [
  path.join(KIT, 'variants', 'online', '.github', 'workflows', 'heartbeat.yml'),
  path.join(KIT, '.github', 'workflows', 'heartbeat.yml'),
].find((p) => fs.existsSync(p));
if (!YML) { console.log('test-heartbeat-check: no heartbeat.yml found under variants/online/.github/workflows/ or .github/workflows/'); process.exit(1); }
let pass = 0; const fails = [];
function ok(cond, name, detail) {
  if (cond) { pass++; console.log(`PASS  ${name}${detail ? ` - ${detail}` : ''}`); }
  else fails.push(`${name}${detail ? ` - ${detail}` : ''}`);
}
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'alex-heartbeat-'));
const NOW = '2026-09-23T07:00:00Z';
const run = (file, extra = []) => {
  const r = spawnSync(process.execPath, [SCRIPT, '--file', file, '--now', NOW, ...extra], { encoding: 'utf8' });
  return { code: r.status, out: (r.stdout + r.stderr).trim() };
};
const row = (at, job = 'triage') => JSON.stringify({ at, canary: 'ok', job, missed: 0, model: 'claude-sonnet-4-6', reason: null, session_url: null, status: 'COMPLETE' });

// N1: the file is absent (the template repository's state)
{
  const r = run(path.join(TMP, 'absent.jsonl'));
  console.log(`      N1: ${r.out}`);
  ok(r.code === 1 && /FAIL - .*absent/.test(r.out), 'N1 NEGATIVE an absent run log fails (exit 1) and says so', `exit ${r.code}`);
}
// N2: the newest row is 49 hours old (the plan's own case)
{
  const f = path.join(TMP, 'stale.jsonl');
  fs.writeFileSync(f, [row('2026-09-20T07:00:00Z'), row('2026-09-21T06:00:00Z', 'brief')].join('\n') + '\n');
  const r = run(f);
  console.log(`      N2: ${r.out}`);
  ok(r.code === 1 && /FAIL - the newest run-log row is 49 hour\(s\) old \(job brief, at 2026-09-21T06:00:00Z\), over the 48-hour window/.test(r.out), 'N2 NEGATIVE a newest row 49 hours old fails and prints the age', `exit ${r.code}`);
}
// N3: rows without a usable at
{
  const f = path.join(TMP, 'noat.jsonl');
  fs.writeFileSync(f, '{"job":"triage"}\nnot json\n');
  const r = run(f);
  console.log(`      N3: ${r.out}`);
  ok(r.code === 1 && /no row with an at field/.test(r.out), 'N3 NEGATIVE a file with no dated row fails', `exit ${r.code}`);
}
// N5: an interactive session row does not keep the heartbeat alive (test day 2026-09-23): a fresh
// `session` row next to a 49-hour-old Routine row still fails, and session rows alone fail
{
  const f = path.join(TMP, 'session-masks.jsonl');
  fs.writeFileSync(f, [row('2026-09-21T06:00:00Z', 'brief'), row('2026-09-23T06:30:00Z', 'session')].join('\n') + '\n');
  const r = run(f);
  console.log(`      N5: ${r.out}`);
  ok(r.code === 1 && /49 hour\(s\) old \(job brief/.test(r.out), 'N5 NEGATIVE a fresh session row does not mask a Routine row 49 hours old', `exit ${r.code}`);
  const f2 = path.join(TMP, 'sessions-only.jsonl');
  fs.writeFileSync(f2, row('2026-09-23T06:30:00Z', 'session') + '\n');
  const r2 = run(f2);
  ok(r2.code === 1 && /only interactive session rows/.test(r2.out), 'N5 NEGATIVE session rows alone fail: no Routine has ever written', `exit ${r2.code}`);
}
// N4: bad arguments refuse with exit 2
{
  const r = run(path.join(TMP, 'stale.jsonl'), ['--max-hours', 'soon']);
  ok(r.code === 2 && /REFUSED/.test(r.out), 'N4 NEGATIVE a non-numeric --max-hours is refused (exit 2)', `exit ${r.code}`);
}
// P1: a row 47 hours old passes and prints the age; the newest row wins whatever the file order
{
  const f = path.join(TMP, 'fresh.jsonl');
  fs.writeFileSync(f, [row('2026-09-21T08:00:00Z'), row('2026-09-19T08:00:00Z', 'radar')].join('\n') + '\n');
  const r = run(f);
  console.log(`      P1: ${r.out}`);
  ok(r.code === 0 && /OK - the newest run-log row is 47 hour\(s\) old \(job triage, at 2026-09-21T08:00:00Z\), inside the 48-hour window/.test(r.out), 'P1 a newest row 47 hours old passes, whatever the line order', `exit ${r.code}`);
}
// P2: the default file is system/run-log.jsonl and the default window is 48 hours
{
  const src = fs.readFileSync(SCRIPT, 'utf8');
  ok(/'--file', 'system\/run-log\.jsonl'/.test(src) && /'--max-hours', '48'/.test(src), 'P2 defaults: system/run-log.jsonl and 48 hours');
}
// P3: the workflow calls this script on a daily schedule plus workflow_dispatch. The scheduled fire
// is skipped where the repository is a GitHub TEMPLATE (the template itself and every seed): those
// carry no run log by construction and would mail a failure every morning for ever, while an owner's
// repository must always run it (review finding 2, 2026-09-23).
// Since 2026-09-24 (fleet Fix A, review finding F28) the gate is the repository's template flag,
// not its org: an org-name gate lets a template outside Alex-kit-S/ (a public one) fail every day.
// A schedule event carries NO webhook payload (GitHub's events reference: "Webhook event payload:
// Not applicable"), so github.event.repository.is_template does not exist on that fire; a first step
// asks the API instead, and the check's steps run unless the answer is exactly "true". The truth
// table below is evaluated, not matched.
{
  const yml = fs.readFileSync(YML, 'utf8');
  ok(/schedule:\s*\n\s*- cron: '0 7 \* \* \*'/.test(yml) && /workflow_dispatch:/.test(yml), 'P3 heartbeat.yml: cron 0 7 * * * plus workflow_dispatch');
  ok(/run: node scripts\/heartbeat-check\.mjs/.test(yml), 'P3 heartbeat.yml runs the script');
  ok(!/startsWith\(github\.repository/.test(yml), 'P3 NEGATIVE-guard no gate on the org name (a template outside the org would fire daily)');
  const gateStep = /- name: [^\n]*\n\s+id: gate\n\s+if: \$\{\{ github\.event_name == 'schedule' \}\}\n(?:\s+[^\n]*\n)*?\s+template="\$\(gh api "repos\/\$\{GITHUB_REPOSITORY\}" --jq \.is_template\)"/.test(yml);
  ok(gateStep, 'P3 on a schedule fire only, a gate step reads is_template from the API, and a failed read fails the job');
  const checkIf = (yml.match(/if: \$\{\{ (.+?) \}\}\n\s+run: node scripts\/heartbeat-check\.mjs/) || [])[1] || null;
  // the Actions expression, rewritten as JS for the two inputs it may use
  const evalCheck = (event, isTemplate) => {
    if (!checkIf) return true;
    const gateOut = event === 'schedule' ? String(isTemplate) : ''; // a skipped step has no outputs
    const js = checkIf
      .replace(/steps\.gate\.outputs\.template/g, JSON.stringify(gateOut))
      .replace(/github\.event_name/g, JSON.stringify(event));
    if (!/^[\s!|&()'"a-z_=-]+$/i.test(js)) throw new Error(`unexpected check expression: ${checkIf}`);
    return Function(`"use strict"; return (${js.replace(/'/g, '"')});`)();
  };
  ok(Boolean(checkIf), 'P3 the check step carries the gate', checkIf || 'no if on the heartbeat-check step');
  ok(evalCheck('schedule', true) === false, 'P3 NEGATIVE the scheduled fire on a template (the template, a seed, a public template anywhere) is skipped');
  ok(evalCheck('schedule', false) === true, 'P3 the scheduled fire in an owner repository runs');
  ok(evalCheck('workflow_dispatch', true) === true, 'P3 a manual dispatch on the template still runs (the proof the check fires)');
  ok(evalCheck('workflow_dispatch', false) === true, 'P3 a manual dispatch in an owner repository runs');
  const steps = (yml.split(/\n\s+steps:\n/)[1] || '').split(/\n(?= {6}- )/);
  const guarded = steps.filter((b) => /^ {6}- /.test(b) && !/id: gate/.test(b));
  ok(guarded.length >= 3 && guarded.every((b) => /steps\.gate\.outputs\.template != 'true'/.test(b)),
    'P3 every step after the gate is skipped on a template, so the scheduled fire there costs one API call', `${guarded.length} step(s)`);
  ok(/contents: read/.test(yml) && !/contents: write/.test(yml), 'P3 heartbeat.yml is read-only');
}

fs.rmSync(TMP, { recursive: true, force: true });
if (fails.length) {
  console.log(`test-heartbeat-check: ${fails.length} FAILED`);
  for (const f of fails) console.log(`  ${f}`);
  process.exit(1);
}
console.log(`test-heartbeat-check: ALL PASS (${pass})`);
