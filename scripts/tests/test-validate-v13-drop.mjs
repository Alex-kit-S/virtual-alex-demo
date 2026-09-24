#!/usr/bin/env node
// scripts/tests/test-validate-v13-drop.mjs - validate-alex V13 on a tree whose scheduled wrappers
// are drop rows (the Virtual Alex online tree): a pin whose file is absent AND claimed by a drop
// row in system/kit-manifest.json is skipped; a pin naming an absent file that no drop row claims
// still FAILS; on a laptop tree the files exist and are checked as before (plan Phase 4, seat 5,
// the RUN-STATE ruling, 2026-09-23). Every refusal shown before the pass.
//
// The online-shaped tree is a copy of this checkout under the OS temp dir with the six .ps1
// wrappers deleted (what the generator does through the local-wrappers drop row), so the test
// needs no network. The negative half of the skip is the PREVIOUS validator (git show HEAD~ or
// --old <file>) run on the same copy: it must print six FAILED V13 lines.
//
// V21a/V21b (fleet Fix C, review finding F15): the same rule for the JSON standard's "enforced but
// absent" warning. system/fleet.json, a drop row, is silent on the online-shaped copy; an enforced
// path that is absent and not a drop row still warns.
//
// Run: node scripts/tests/test-validate-v13-drop.mjs [--old <validator.js>]      (exit 0 = all pass)

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const KIT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
let pass = 0; const fails = [];
function ok(cond, name, detail) {
  if (cond) { pass++; console.log(`PASS  ${name}${detail ? ` - ${detail}` : ''}`); }
  else fails.push(`${name}${detail ? ` - ${detail}` : ''}`);
}
const v13 = (res) => String(res.stderr || '').split(/\r?\n/).filter((l) => /^FAILED V13:/.test(l));
const show = (label, lines) => { if (lines.length) console.log(`      ${label}: ${lines.join('\n      ')}`); };
function runValidator(tree, extra = []) {
  return spawnSync(process.execPath, [path.join(tree, 'scripts', 'validate-alex.js'), '--context=pre-commit', ...extra], {
    cwd: tree, encoding: 'utf8', env: { ...process.env, CLAUDE_CODE_REMOTE: '' },
  });
}

const manifest = JSON.parse(fs.readFileSync(path.join(KIT, 'system', 'manifest.json'), 'utf8'));
const pins = Object.keys(manifest.meta.model_routing.local_wrappers.pins);
const kitManifest = JSON.parse(fs.readFileSync(path.join(KIT, 'system', 'kit-manifest.json'), 'utf8'));
const dropRow = kitManifest.components.find((r) => r.id === 'local-wrappers');
ok(dropRow && dropRow.online === 'drop' && pins.every((f) => dropRow.paths.includes(`scripts/${f}`)), 'the six pinned wrappers are all claimed by the local-wrappers drop row', pins.join(', '));

// ---------------------------------------------------------------- the online-shaped copy
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'alex-v13-drop-'));
const TREE = path.join(TMP, 'online');
const SKIP = new Set(['.git', '.staging', '.staging-backup', '.claude/skills', '.agents/skills', 'outputs', 'vault', 'refactor', 'node_modules']);
function copyTree(src, dst, rel = '') {
  for (const e of fs.readdirSync(src, { withFileTypes: true })) {
    const r = rel ? `${rel}/${e.name}` : e.name;
    if (SKIP.has(r) || SKIP.has(e.name)) continue;
    const s = path.join(src, e.name), d = path.join(dst, e.name);
    if (e.isSymbolicLink()) continue;
    if (e.isDirectory()) { fs.mkdirSync(d, { recursive: true }); copyTree(s, d, r); }
    else fs.copyFileSync(s, d);
  }
}
fs.mkdirSync(TREE, { recursive: true });
copyTree(KIT, TREE);
// On the Kit the wrappers exist and are deleted here; on the online tree itself (this suite runs in
// the template's CI too) they were never there, so what is asserted is the RESULT, not the count.
const isWrapper = (f) => /^run-.*\.ps1$/.test(f) || f === 'auth-check.ps1';
let removed = 0;
for (const f of fs.readdirSync(path.join(TREE, 'scripts'))) {
  if (isWrapper(f)) { fs.rmSync(path.join(TREE, 'scripts', f)); removed++; }
}
const left = fs.readdirSync(path.join(TREE, 'scripts')).filter(isWrapper);
ok(left.length === 0, `the copy has no scheduled wrapper (${removed} removed here; ${removed === 0 ? 'this tree never had them, the online shape' : 'the drop set of a laptop checkout'})`);

// ---------------------------------------------------------------- N0: the PREVIOUS validator fails six times on the copy
{
  const oldArg = process.argv.indexOf('--old');
  let oldSrc = null;
  if (oldArg >= 0) oldSrc = fs.readFileSync(process.argv[oldArg + 1], 'utf8');
  else {
    const r = spawnSync('git', ['-C', KIT, 'show', 'HEAD~:scripts/validate-alex.js'], { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 });
    if (r.status === 0 && !/kitManifestDropClaim/.test(r.stdout)) oldSrc = r.stdout;
    else {
      const r2 = spawnSync('git', ['-C', KIT, 'log', '--format=%H', '-S', 'kitManifestDropClaim', '--', 'scripts/validate-alex.js'], { encoding: 'utf8' });
      const sha = String(r2.stdout || '').trim().split(/\r?\n/).pop();
      if (sha) { const r3 = spawnSync('git', ['-C', KIT, 'show', `${sha}~:scripts/validate-alex.js`], { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 }); if (r3.status === 0) oldSrc = r3.stdout; }
    }
  }
  if (oldSrc && /kitManifestDropClaim/.test(oldSrc)) oldSrc = null;
  if (!oldSrc) {
    console.log('      N0: the pre-change validator is not reachable from this checkout (no git history before the change); the negative is carried by N1 and N2 instead');
    ok(true, 'N0 SKIPPED the previous validator is not reachable here');
  } else {
    const OLD = path.join(TMP, 'online-old');
    fs.mkdirSync(OLD, { recursive: true });
    copyTree(TREE, OLD);
    fs.writeFileSync(path.join(OLD, 'scripts', 'validate-alex.js'), oldSrc);
    const res = runValidator(OLD);
    const lines = v13(res);
    show('N0 (old validator)', lines);
    ok(lines.length === pins.length && lines.every((l) => /which does not exist/.test(l)), `N0 NEGATIVE the previous validator prints ${pins.length} FAILED V13 lines on the online-shaped copy`, `${lines.length} line(s), exit ${res.status}`);
  }
}

// ---------------------------------------------------------------- P1: the new validator skips the dropped pins
{
  const res = runValidator(TREE);
  const lines = v13(res);
  show('P1', lines);
  ok(lines.length === 0, 'P1 the new validator prints no FAILED V13 line on the online-shaped copy (six absent pins, all drop rows)', `exit ${res.status}`);
  ok(!/WARNING V13/.test(String(res.stderr || '')), 'P1 and no V13 warning either: a by-design absence is silent');
}

// ---------------------------------------------------------------- N1: an absent pin that NO drop row claims still fails on the copy
{
  const m = JSON.parse(JSON.stringify(manifest));
  m.meta.model_routing.local_wrappers.pins['run-nonexistent.ps1'] = m.meta.model_routing.default;
  const staged = path.join(TMP, 'staged-n1');
  fs.mkdirSync(path.join(staged, 'system'), { recursive: true });
  fs.writeFileSync(path.join(staged, 'system', 'manifest.json'), JSON.stringify(m, null, 2) + '\n');
  const res = runValidator(TREE, [`--staged=${staged}`]);
  const lines = v13(res);
  show('N1', lines);
  ok(lines.length === 1 && /run-nonexistent\.ps1 which does not exist/.test(lines[0]), 'N1 NEGATIVE a pin naming an absent file that is NOT a drop row still FAILS V13 on the online-shaped copy', `exit ${res.status}`);
}

// ---------------------------------------------------------------- N2: the same stale pin on the laptop tree (files present) fails too
{
  const m = JSON.parse(JSON.stringify(manifest));
  m.meta.model_routing.local_wrappers.pins['run-nonexistent.ps1'] = m.meta.model_routing.default;
  const staged = path.join(TMP, 'staged-n2');
  fs.mkdirSync(path.join(staged, 'system'), { recursive: true });
  fs.writeFileSync(path.join(staged, 'system', 'manifest.json'), JSON.stringify(m, null, 2) + '\n');
  const res = runValidator(KIT, [`--staged=${staged}`]);
  const lines = v13(res);
  show('N2', lines);
  ok(lines.length === 1 && /run-nonexistent\.ps1 which does not exist/.test(lines[0]), 'N2 NEGATIVE the same stale pin FAILS V13 on this laptop checkout', `exit ${res.status}`);
}

// ---------------------------------------------------------------- N3: a drop row that stops claiming the wrappers makes the copy fail again
{
  const km = JSON.parse(JSON.stringify(kitManifest));
  const row = km.components.find((r) => r.id === 'local-wrappers');
  row.paths = row.paths.filter((p) => !/^scripts\/(run-.*|auth-check)\.ps1$/.test(p));
  const staged = path.join(TMP, 'staged-n3');
  fs.mkdirSync(path.join(staged, 'system'), { recursive: true });
  fs.writeFileSync(path.join(staged, 'system', 'kit-manifest.json'), JSON.stringify(km, null, 2) + '\n');
  const res = runValidator(TREE, [`--staged=${staged}`]);
  const lines = v13(res);
  show('N3', lines);
  ok(lines.length === pins.length, `N3 NEGATIVE with the wrappers no longer drop-claimed, the copy fails V13 ${pins.length} times again (the skip is the row, not the absence)`, `${lines.length} line(s)`);
}

// ---------------------------------------------------------------- P2: the laptop checkout is unchanged
{
  const res = runValidator(KIT);
  const lines = v13(res);
  show('P2', lines);
  ok(lines.length === 0, 'P2 this laptop checkout (files present) passes V13 exactly as before', `exit ${res.status}`);
}

// ---------------------------------------------------------------- V21: the same rule for the JSON standard
// Review finding F15: V21 warned "enforced but absent" on every validate of every owner repository for
// system/fleet.json, the operator's fleet record, which is a drop row and can never exist online. A
// warning that fires on a healthy system teaches its owner to ignore warnings. The V13 rule applies:
// absent AND drop-claimed is silent; absent and NOT drop-claimed still warns.
{
  fs.rmSync(path.join(TREE, 'system', 'fleet.json'), { force: true });
  fs.rmSync(path.join(TREE, 'system', 'migrations-applied.json'), { force: true });
  const res = runValidator(TREE);
  const absent = String(res.stderr || '').split(/\r?\n/).find((l) => /^WARNING V21: enforced but absent/.test(l)) || '';
  ok(!/system\/fleet\.json/.test(absent), 'V21a NEGATIVE the online-shaped copy is not warned about system/fleet.json, a drop row absent by design',
    absent.slice(0, 160) || 'no "enforced but absent" warning');
  ok(/system\/migrations-applied\.json/.test(absent), 'V21b an enforced path that is absent and NOT a drop row still warns (its writer has not run yet)',
    absent.slice(0, 160) || 'no warning at all');
}

fs.rmSync(TMP, { recursive: true, force: true });
if (fails.length) {
  console.log(`test-validate-v13-drop: ${fails.length} FAILED`);
  for (const f of fails) console.log(`  ${f}`);
  process.exit(1);
}
console.log(`test-validate-v13-drop: ALL PASS (${pass})`);
