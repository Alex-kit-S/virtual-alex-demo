#!/usr/bin/env node
// scripts/tests/test-validate-routines.mjs - validate-alex V19: every scheduler/routines/*.md file
// has a system/manifest.json routines[] row, every row names a file that exists, and every row has
// the shape gen-routines.js renders (Virtual Alex plan Phase 4, seat 5, 2026-09-23).
//
// Runs the REAL validator against this checkout with a --staged preview dir carrying one mutated
// manifest at a time, so nothing in the working tree is touched. Every refusal shown before the pass.
//
// Run: node scripts/tests/test-validate-routines.mjs      (exit 0 = all pass)

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const KIT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const VALIDATOR = path.join(KIT, 'scripts', 'validate-alex.js');
const require = createRequire(import.meta.url);
const { routineRows, ROUTINES_DIR } = require(path.join(KIT, 'scripts', 'lib', 'gen-routines.js'));
const { REMOTE_DRIFT_LEGS } = require(VALIDATOR);

let pass = 0; const fails = [];
function ok(cond, name, detail) {
  if (cond) { pass++; console.log(`PASS  ${name}${detail ? ` - ${detail}` : ''}`); }
  else fails.push(`${name}${detail ? ` - ${detail}` : ''}`);
}
function v19Lines(res) {
  return String(res.stderr || '').split(/\r?\n/).filter((l) => /^FAILED V19:/.test(l));
}
function show(label, lines) { if (lines.length) console.log(`      ${label}: ${lines.join('\n      ')}`); }
function run(stagedDir) {
  return spawnSync(process.execPath, [VALIDATOR, '--context=pre-commit', `--staged=${stagedDir}`], {
    cwd: KIT, encoding: 'utf8', env: { ...process.env, CLAUDE_CODE_REMOTE: '' },
  });
}
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'alex-validate-routines-'));
const manifest = JSON.parse(fs.readFileSync(path.join(KIT, 'system', 'manifest.json'), 'utf8'));
function stagedManifest(mutate) {
  const dir = fs.mkdtempSync(path.join(TMP, 'staged-'));
  const m = JSON.parse(JSON.stringify(manifest));
  mutate(m);
  const dst = path.join(dir, 'system', 'manifest.json');
  fs.mkdirSync(path.dirname(dst), { recursive: true });
  fs.writeFileSync(dst, JSON.stringify(m, null, 2) + '\n');
  return dir;
}

const rows = routineRows(manifest);
ok(rows.length >= 5, 'the real registry carries the five Routine rows', `${rows.length} row(s): ${rows.map((r) => r.name).join(', ')}`);
const onDisk = fs.readdirSync(path.join(KIT, ROUTINES_DIR)).filter((f) => f.endsWith('.md'));
ok(onDisk.length === rows.length, 'one prompt file per row on disk', `${onDisk.length} file(s)`);
ok(REMOTE_DRIFT_LEGS.has('V19'), 'V19 is a drift leg (warns under CLAUDE_CODE_REMOTE, so an autosave never dies on it)');

// ---------------------------------------------------------------- N1: a row names a missing file
{
  const dir = stagedManifest((m) => { m.routines.push({ ...m.routines[0], name: 'ghost', prompt_file: `${ROUTINES_DIR}/ghost.md` }); });
  const res = run(dir);
  const lines = v19Lines(res);
  show('N1', lines);
  ok(res.status !== 0 && lines.some((l) => /ghost\.md/.test(l) && /does not exist/.test(l)), 'N1 NEGATIVE a routines row naming a missing prompt file FAILS V19', `exit ${res.status}`);
}

// ---------------------------------------------------------------- N2: an orphan prompt file (its row removed)
{
  const victim = rows[0].name;
  const dir = stagedManifest((m) => { m.routines = m.routines.filter((r) => r.name !== victim); });
  const res = run(dir);
  const lines = v19Lines(res);
  show('N2', lines);
  ok(res.status !== 0 && lines.some((l) => l.includes(`${ROUTINES_DIR}/${victim}.md`) && /no routines\[\] row/.test(l)), `N2 NEGATIVE ${ROUTINES_DIR}/${victim}.md with its row removed is an orphan and FAILS V19`, `exit ${res.status}`);
}

// ---------------------------------------------------------------- N3: a synthetic orphan file on disk
// A real file the registry has never heard of, written into a COPY of the routines directory? The
// validator reads the directory from the checkout it lives in, so the orphan must sit in the real
// directory for a moment. It is written, the validator runs, it is deleted in a finally, and the
// name cannot collide with a shipped prompt.
{
  const orphan = path.join(KIT, ROUTINES_DIR, 'zz-synthetic-orphan-v19.md');
  let res;
  try {
    fs.writeFileSync(orphan, '# synthetic orphan for the V19 negative test; deleted by the test\n');
    res = run(stagedManifest(() => {}));
  } finally { fs.rmSync(orphan, { force: true }); }
  const lines = v19Lines(res);
  show('N3', lines);
  ok(res.status !== 0 && lines.some((l) => l.includes('zz-synthetic-orphan-v19.md')), 'N3 NEGATIVE a synthetic orphan prompt file on disk FAILS V19', `exit ${res.status}`);
  ok(!fs.existsSync(orphan), 'N3 the synthetic orphan was removed again');
}

// ---------------------------------------------------------------- N4: a malformed row
{
  const dir = stagedManifest((m) => { m.routines[0].preset = 'monthly'; });
  const res = run(dir);
  const lines = v19Lines(res);
  show('N4', lines);
  ok(res.status !== 0 && lines.some((l) => /preset must be one of/.test(l)), 'N4 NEGATIVE a row with preset "monthly" (no such form preset) FAILS V19', `exit ${res.status}`);
}

// ---------------------------------------------------------------- N5: a weekly row without its weekday
{
  const dir = stagedManifest((m) => { const r = m.routines.find((x) => x.preset === 'weekly'); r.time_local = '04:15'; });
  const res = run(dir);
  const lines = v19Lines(res);
  show('N5', lines);
  ok(res.status !== 0 && lines.some((l) => /names its weekday/.test(l)), 'N5 NEGATIVE a weekly row whose time_local has no weekday FAILS V19', `exit ${res.status}`);
}

// ---------------------------------------------------------------- N6: under CLAUDE_CODE_REMOTE the orphan warns instead of blocking
{
  const victim = rows[0].name;
  const dir = stagedManifest((m) => { m.routines = m.routines.filter((r) => r.name !== victim); });
  const res = spawnSync(process.execPath, [VALIDATOR, '--context=pre-commit', `--staged=${dir}`], {
    cwd: KIT, encoding: 'utf8', env: { ...process.env, CLAUDE_CODE_REMOTE: 'true' },
  });
  const warned = String(res.stderr || '').split(/\r?\n/).filter((l) => /WARNING \(drift, degraded.*V19:/.test(l));
  show('N6', warned);
  ok(v19Lines(res).length === 0 && warned.length === 1, 'N6 with CLAUDE_CODE_REMOTE=true the same orphan is a degraded WARNING and no FAILED V19 line remains');
}

// ---------------------------------------------------------------- P: the real registry passes V19
{
  const res = run(stagedManifest(() => {}));
  const lines = v19Lines(res);
  show('P', lines);
  ok(lines.length === 0, 'P the real routines[] rows and the real prompt files pass V19 (no V19 line)', `validator exit ${res.status}`);
}

fs.rmSync(TMP, { recursive: true, force: true });
if (fails.length) {
  console.log(`test-validate-routines: ${fails.length} FAILED`);
  for (const f of fails) console.log(`  ${f}`);
  process.exit(1);
}
console.log(`test-validate-routines: ALL PASS (${pass})`);
