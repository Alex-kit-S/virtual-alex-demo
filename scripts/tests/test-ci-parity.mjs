#!/usr/bin/env node
// scripts/tests/test-ci-parity.mjs - the CI step lists cannot drift apart without saying why.
//
// WHAT. This Kit carries THREE CI step lists: the Kit's Windows job and macOS job in
// .github/workflows/ci.yml, and the online template's Ubuntu job in
// variants/online/.github/workflows/ci.yml, which the generator lands at .github/workflows/ci.yml in
// the template. Nothing compared them, and they had drifted (fleet seat 2, finding 5): the online
// list ran a test the Kit did not, and the Kit ran six tests the online list did not, so a test
// written for the tree it ships into could silently never run there.
//
// THE RULE, two legs:
//   P  PARITY. A step present in one list and absent from another fails, unless an exemption below
//      names that list, that step and a reason. A step is identified by what it RUNS (the command
//      of a one-line `run:`, the action of a `uses:`), never by its display name, because the same
//      test carries different names in different jobs.
//   O  ORPHANS. Every test file in scripts/tests/ must be run by at least one list, or be named
//      below with a reason. A test nothing runs is indistinguishable from a passing one.
//   Stale exemptions fail too: one naming a step that list now runs, or a step no list runs any
//   more. An exemption that outlives its reason is how a list goes back to drifting.
//
// IN WHICH TREE. In the Kit, all three lists exist and both legs run. In a generated template only
// the online list exists (variants/ is a drop row), so leg P has nothing to compare and says so, and
// leg O runs against the one list the template CI actually has. Honest in the tree it ships into.
//
// HOW. node scripts/tests/test-ci-parity.mjs      (exit 0 = all pass)
//
// NEVER. It never edits a workflow. It reads.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const KIT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

// Why a step is absent from a list. `list` is kit-windows, kit-macos or online; `step` is the
// identity printed by a failure (copy it from there).
export const EXEMPT = [
  { list: 'kit-macos', step: 'run .\\scripts\\tests\\test-soul-canary.ps1', reason: 'Windows PowerShell 5.1 test of a .ps1 library the Windows installs run; the macOS runner has no Windows PowerShell and macOS installs run the node wrappers instead' },
  { list: 'online', step: 'run .\\scripts\\tests\\test-soul-canary.ps1', reason: 'the .ps1 files are drop rows in system/kit-manifest.json, so the test and the library it tests are absent from the online tree' },
  { list: 'kit-macos', step: 'run .\\scripts\\tests\\test-completion-sentinel.ps1', reason: 'Windows PowerShell 5.1 test of scripts/lib/close-out.ps1; the macOS runner has no Windows PowerShell and macOS installs close out through run-job.mjs' },
  { list: 'online', step: 'run .\\scripts\\tests\\test-completion-sentinel.ps1', reason: 'the .ps1 files are drop rows in system/kit-manifest.json, so the test and scripts/lib/close-out.ps1 are absent from the online tree' },
  { list: 'kit-windows', step: 'block Doctor runs on darwin (exit 0/2 are both healthy verdicts; 1 is a script error)', reason: 'a darwin smoke of bootstrap.mjs on a bare runner, the only Mac rig this project has; Windows installs run the same doctor logic through test-doctor-honesty, which every list runs' },
  { list: 'online', step: 'block Doctor runs on darwin (exit 0/2 are both healthy verdicts; 1 is a script error)', reason: 'a darwin smoke; online there is no Mac and nothing is installed, and test-doctor-honesty covers the doctor logic in this list' },
  { list: 'kit-windows', step: 'block Launcher syntax (bash -n on every .command)', reason: '.command launchers are macOS files; Windows installs use the .cmd twins' },
  { list: 'online', step: 'block Launcher syntax (bash -n on every .command)', reason: 'the launchers are drop rows online: nothing is installed or started locally' },
  { list: 'kit-windows', step: 'block Generate + plutil-lint every launchd plist (real lint, darwin only has plutil)', reason: 'plutil exists only on darwin; the plist shape itself is tested in every list by test-gen-launchd' },
  { list: 'online', step: 'block Generate + plutil-lint every launchd plist (real lint, darwin only has plutil)', reason: 'online there is no launchd: the five Routines are the scheduler' },
  { list: 'online', step: 'run node scripts/tests/test-seed-contract.mjs', reason: 'the seed contract checker is fleet tooling for the operator and is a drop row in system/kit-manifest.json, so the test and the script it tests are absent from the online tree' },
  { list: 'online', step: 'run node scripts/tests/test-new-virtual-alex.mjs', reason: 'the fleet script is operator tooling and is a drop row in system/kit-manifest.json, so the test and the script it tests are absent from the online tree' },
  { list: 'online', step: 'run node scripts/clone-scrub-check.js', reason: 'the donor-identity scan hunts the Kit author, so its patterns are that identity and it is a drop row (donor-scrub) in system/kit-manifest.json; scripts/build-online-template.mjs runs it over every generated tree before --check reports or --push commits' },
  { list: 'online', step: 'run node scripts/tests/test-clone-scrub-scope.mjs', reason: 'the test of the donor-identity scan, including its build-time legs; it sits in the same drop row as the scanner, so it and the script it tests are absent from the online tree' },
];
export const ORPHAN_EXEMPT = [
  { file: 'test-soul-canary-live.ps1', reason: 'a LIVE test that spends a real claude -p call to prove the SessionStart hook injects soul.md; run on demand, never in CI, which has no Claude account' },
];

// ------------------------------------------------------------------ a small, honest YAML reader
// Enough for these workflow files and no more: jobs at indent 2, steps as `      - ` items, keys at
// indent 8, and `run: |` blocks. It throws on a shape it does not understand rather than guessing,
// because a parser that silently drops a step would make this whole check vacuous.
export function parseJobs(text) {
  const lines = text.replace(/\r\n/g, '\n').split('\n');
  const jobs = {};
  let inJobs = false, job = null, step = null, block = null;
  const flush = () => { if (step && job) jobs[job].push(step); step = null; block = null; };
  for (const raw of lines) {
    if (/^jobs:\s*$/.test(raw)) { inJobs = true; continue; }
    if (!inJobs) continue;
    if (/^\S/.test(raw) && raw.trim()) { flush(); inJobs = false; continue; }
    const jm = raw.match(/^ {2}([A-Za-z0-9_-]+):\s*$/);
    if (jm) { flush(); job = jm[1]; jobs[job] = []; continue; }
    if (block !== null && (raw.trim() === '' || /^ {10,}/.test(raw))) { step.run_block.push(raw.trim()); continue; }
    block = null;
    const sm = raw.match(/^ {6}- (\w[\w-]*):\s*(.*)$/);
    if (sm) { flush(); step = { name: null, run: null, uses: null, run_block: null }; setKey(step, sm[1], sm[2]); if (sm[1] === 'run' && sm[2].trim() === '|') { step.run = null; step.run_block = []; block = true; } continue; }
    const km = raw.match(/^ {8}(\w[\w-]*):\s*(.*)$/);
    if (km && step) { setKey(step, km[1], km[2]); if (km[1] === 'run' && km[2].trim() === '|') { step.run = null; step.run_block = []; block = true; } continue; }
  }
  flush();
  for (const [name, steps] of Object.entries(jobs)) {
    for (const s of steps) if (!s.run && !s.uses && !s.run_block) throw new Error(`job ${name}: a step with neither run nor uses (${s.name || 'unnamed'}); the reader does not understand this shape`);
  }
  return jobs;
}
function setKey(step, key, val) {
  const v = val.trim().replace(/^(['"])(.*)\1$/, '$2');
  if (key === 'name') step.name = v;
  else if (key === 'run') step.run = v;
  else if (key === 'uses') step.uses = v;
}
export function stepId(s) {
  if (s.uses) return `uses ${s.uses}`;
  if (s.run) return `run ${s.run.replace(/\s+/g, ' ')}`;
  return `block ${s.name}`;
}
function runsText(steps) { return steps.map(s => [s.run || '', ...(s.run_block || [])].join('\n')).join('\n'); }

// ------------------------------------------------------------------ the check, as a pure function
export function checkParity({ lists, testFiles, exempt = EXEMPT, orphanExempt = ORPHAN_EXEMPT, parity = true }) {
  const problems = [];
  const ids = {};
  for (const [list, steps] of Object.entries(lists)) ids[list] = new Set(steps.map(stepId));
  const all = new Set(Object.values(ids).flatMap(s => [...s]));
  const names = Object.keys(lists);

  for (const e of exempt) {
    if (!e.reason || !String(e.reason).trim()) problems.push(`exemption without a reason: ${e.list} / ${e.step}`);
  }
  if (parity) {
    for (const id of [...all].sort()) {
      for (const list of names) {
        if (ids[list].has(id)) continue;
        if (!exempt.some(e => e.list === list && e.step === id)) {
          const where = names.filter(n => ids[n].has(id)).join(', ');
          problems.push(`DRIFT: "${id}" runs in ${where} and not in ${list}, with no exemption naming ${list}`);
        }
      }
    }
    for (const e of exempt) {
      if (!names.includes(e.list)) continue;
      if (ids[e.list].has(e.step)) problems.push(`STALE exemption: ${e.list} now runs "${e.step}"; remove the exemption`);
      else if (!all.has(e.step)) problems.push(`STALE exemption: no list runs "${e.step}" any more; remove the exemption`);
    }
  }
  const text = Object.values(lists).map(runsText).join('\n');
  for (const f of testFiles) {
    if (text.includes(`scripts/tests/${f}`) || text.includes(`scripts\\tests\\${f}`)) continue;
    const x = orphanExempt.find(o => o.file === f);
    if (!x) problems.push(`ORPHAN: scripts/tests/${f} is run by no CI list and has no exemption`);
    else if (!x.reason || !String(x.reason).trim()) problems.push(`orphan exemption without a reason: ${f}`);
  }
  for (const o of orphanExempt) {
    if (testFiles.includes(o.file) && (text.includes(`scripts/tests/${o.file}`) || text.includes(`scripts\\tests\\${o.file}`))) {
      problems.push(`STALE orphan exemption: a list now runs ${o.file}; remove the exemption`);
    }
  }
  return problems;
}

// ------------------------------------------------------------------ the tree in front of us
export function loadLists(root) {
  const kitCi = path.join(root, '.github', 'workflows', 'ci.yml');
  const onlineCi = path.join(root, 'variants', 'online', '.github', 'workflows', 'ci.yml');
  if (fs.existsSync(onlineCi)) {
    const k = parseJobs(fs.readFileSync(kitCi, 'utf8'));
    const o = parseJobs(fs.readFileSync(onlineCi, 'utf8'));
    for (const [j, file] of [['portable-tests', kitCi], ['portable-tests-macos', kitCi]]) if (!k[j]) throw new Error(`${file} has no job ${j}`);
    if (!o['portable-tests']) throw new Error(`${onlineCi} has no job portable-tests`);
    return { tree: 'kit', lists: { 'kit-windows': k['portable-tests'], 'kit-macos': k['portable-tests-macos'], online: o['portable-tests'] } };
  }
  const text = fs.readFileSync(kitCi, 'utf8');
  if (!/^# Virtual Alex CI/m.test(text)) throw new Error(`${kitCi}: no variants/online/ here, and this is not the Virtual Alex workflow either; cannot tell which tree this is`);
  const o = parseJobs(text);
  if (!o['portable-tests']) throw new Error(`${kitCi} has no job portable-tests`);
  return { tree: 'generated', lists: { online: o['portable-tests'] } };
}
export function testFilesIn(root) {
  return fs.readdirSync(path.join(root, 'scripts', 'tests'))
    .filter(f => /^(test[-_].*|portability-check)\.(mjs|js|cjs|py|ps1)$/.test(f)).sort();
}

// ------------------------------------------------------------------ run
const invokedDirectly = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedDirectly) {
  let pass = 0; const fails = [];
  const ok = (cond, name, detail) => {
    if (cond) { pass++; console.log(`PASS  ${name}${detail ? ` - ${detail}` : ''}`); }
    else { fails.push(`${name}${detail ? ` - ${detail}` : ''}`); console.log(`FAIL  ${name}${detail ? ` - ${detail}` : ''}`); }
  };

  // --- S. the check on synthetic lists, every refusal first
  const Y = (steps) => `jobs:\n  portable-tests:\n    runs-on: x\n    steps:\n${steps.map(s => `      - name: ${s}\n        run: node scripts/tests/${s}\n`).join('')}`;
  const a = parseJobs(Y(['test-a.mjs', 'test-b.mjs']))['portable-tests'];
  const b = parseJobs(Y(['test-a.mjs']))['portable-tests'];
  const s1 = checkParity({ lists: { 'kit-windows': a, online: b }, testFiles: ['test-a.mjs', 'test-b.mjs'], exempt: [], orphanExempt: [] });
  ok(s1.length === 1 && /DRIFT: "run node scripts\/tests\/test-b\.mjs" runs in kit-windows and not in online/.test(s1[0]), 'S1 NEGATIVE a step in one list and not the other is DRIFT', s1.join(' | '));
  const s2 = checkParity({ lists: { 'kit-windows': a, online: b }, testFiles: ['test-a.mjs', 'test-b.mjs'], exempt: [{ list: 'online', step: 'run node scripts/tests/test-b.mjs', reason: '' }], orphanExempt: [] });
  ok(s2.some(p => /exemption without a reason/.test(p)), 'S2 NEGATIVE an exemption with an empty reason is refused', s2.join(' | '));
  const s3 = checkParity({ lists: { 'kit-windows': a, online: b }, testFiles: ['test-a.mjs', 'test-b.mjs'], exempt: [{ list: 'online', step: 'run node scripts/tests/test-b.mjs', reason: 'a real reason' }], orphanExempt: [] });
  ok(s3.length === 0, 'S3 the same drift WITH a named reason passes');
  const s4 = checkParity({ lists: { 'kit-windows': a, online: a }, testFiles: ['test-a.mjs', 'test-b.mjs'], exempt: [{ list: 'online', step: 'run node scripts/tests/test-b.mjs', reason: 'a real reason' }], orphanExempt: [] });
  ok(s4.some(p => /STALE exemption: online now runs/.test(p)), 'S4 NEGATIVE an exemption for a step that list now runs is STALE', s4.join(' | '));
  const s5 = checkParity({ lists: { 'kit-windows': b, online: b }, testFiles: ['test-a.mjs', 'test-c.mjs'], exempt: [], orphanExempt: [] });
  ok(s5.some(p => /ORPHAN: scripts\/tests\/test-c\.mjs/.test(p)), 'S5 NEGATIVE a test file no list runs is an ORPHAN', s5.join(' | '));
  let threw = false; try { parseJobs('jobs:\n  j:\n    steps:\n      - name: nothing here\n'); } catch { threw = true; }
  ok(threw, 'S6 NEGATIVE the reader refuses a step it cannot understand rather than dropping it');

  // --- R. the real lists in front of us
  const { tree, lists } = loadLists(KIT);
  const files = testFilesIn(KIT);
  const sizes = Object.entries(lists).map(([k, v]) => `${k} ${v.length}`).join(', ');
  ok(Object.values(lists).every(v => v.length >= 10), `R0 the ${tree} tree's lists were read (${sizes} steps)`);
  if (tree === 'generated') console.log('      leg P skipped: a generated template carries one list; the parity leg runs in the Kit, where all three live');
  const problems = checkParity({ lists, testFiles: files, parity: tree === 'kit' });
  for (const p of problems) console.log(`      ${p}`);
  ok(problems.length === 0, `R1 ${tree === 'kit' ? 'the three CI lists agree, every difference exempted with a reason, and ' : ''}every test file is run by a list`, `${files.length} test file(s)`);

  // --- G. where the online job runs (2026-09-24, fleet seat 7). The online tests prove the TEMPLATE:
  // they belong in the template and in each seed (both are GitHub template repositories) and on a
  // manual dispatch, never in a template-born owner repository, which autosaves dozens of times a day
  // and holds content no Kit manifest claims. The gate used the org name as a proxy for "template or
  // seed", and the first owner repository inside the org (the demo) ran the template's tests over an
  // owner's vault and failed P4 of test-build-online-template. The truth table is evaluated, not matched.
  {
    const onlineCi = [path.join(KIT, 'variants', 'online', '.github', 'workflows', 'ci.yml'), path.join(KIT, '.github', 'workflows', 'ci.yml')]
      .find((p) => fs.existsSync(p) && /^# Virtual Alex CI/m.test(fs.readFileSync(p, 'utf8')));
    const gates = onlineCi ? [...fs.readFileSync(onlineCi, 'utf8').matchAll(/^ {4}if:\s*\$\{\{\s*(.+?)\s*\}\}\s*$/gm)].map((m) => m[1]) : [];
    const expr = gates.length === 1 ? gates[0] : null;
    const run = (event, repo, isTemplate) => {
      if (!expr) return true;
      const js = expr
        .replace(/github\.event\.repository\.is_template/g, String(isTemplate))
        .replace(/github\.event_name/g, JSON.stringify(event))
        .replace(/startsWith\(github\.repository,\s*'([^']*)'\)/g, (_, p) => String(repo.startsWith(p)));
      if (!/^[\s!|&()'"a-z_/.=-]+$/i.test(js)) throw new Error(`unexpected gate expression: ${expr}`);
      return Function(`"use strict"; return (${js.replace(/'/g, '"')});`)();
    };
    ok(gates.length === 1, 'G0 the online job carries exactly one if: gate', `${gates.length} found in ${onlineCi ? path.relative(KIT, onlineCi).replace(/\\/g, '/') : 'no online ci.yml'}`);
    ok(run('push', 'Alex-kit-S/virtual-alex', true) === true, 'G1 a push to the template runs the tests');
    ok(run('push', 'Alex-kit-S/virtual-alex-owner-seed', true) === true, 'G2 a push to a seed runs the tests');
    ok(run('push', 'Alex-kit-S/virtual-alex-demo', false) === false, 'G3 NEGATIVE a push to an owner repository INSIDE the template org is skipped');
    ok(run('push', 'an-owner/alex', false) === false, 'G4 NEGATIVE a push to an owner repository outside the org is skipped');
    ok(run('workflow_dispatch', 'an-owner/alex', false) === true, 'G5 a manual dispatch runs anywhere');
  }

  console.log('');
  if (fails.length) { console.log(`${fails.length} FAILURE(S)`); process.exit(1); }
  console.log(`ALL PASS (${pass})`);
}
