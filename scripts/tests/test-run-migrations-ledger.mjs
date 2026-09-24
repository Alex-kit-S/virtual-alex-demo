#!/usr/bin/env node
// scripts/tests/test-run-migrations-ledger.mjs - system/migrations-applied.json goes through the
// JSON standard, and its one writer heals a pre-standard ledger without losing a record.
// (2026-09-23, Virtual Alex fleet seat 3: the first file migrated by the ported standard.)
//
// WHAT. What is proven, negative legs first:
//   L1  NEGATIVE a pre-standard ledger (no header) is healed on the next ordinary run, even with
//       nothing pending, and keeps every id it had. Before the change it stayed legacy forever, and
//       with the file on the enforced list that would have failed V21 on the next commit.
//   L2  NEGATIVE a ledger stamped with a schema this runner does not know (a newer Kit wrote it):
//       NOTHING runs, the file is left byte-identical, and the run still exits 0.
//   L3  a pending migration is recorded through the helper: header, _writer, canonical bytes
//   L4  a second run writes nothing (determinism: byte-identical, same _generated_at)
//   L5  --dry-run writes nothing, not even the heal
//   L6  the shape every reader uses (applied[].id) is intact after the move (kit-doctor reads it)
//   L7  the source holds no raw JSON.stringify write of the ledger (a second writer would be a bypass)
//   L8  NEGATIVE online a declined step names /support-bundle; on a laptop it still names update-log.txt
//
// HOW. Each case runs the REAL runner copied into a throwaway tree under the OS temp directory,
// with one fixture migration.
//   node scripts/tests/test-run-migrations-ledger.mjs      (exit 0 = all pass)
//
// NEVER. Nothing in this checkout is touched.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const KIT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const require = createRequire(import.meta.url);
const { auditText } = require(path.join(KIT, 'scripts', 'json-standard-audit.js'));

let pass = 0; const fails = [];
function ok(cond, name, detail) {
  if (cond) { pass++; console.log(`PASS  ${name}${detail ? ` - ${detail}` : ''}`); }
  else { fails.push(`${name}${detail ? ` - ${detail}` : ''}`); console.log(`FAIL  ${name}${detail ? ` - ${detail}` : ''}`); }
}
const TMP = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'alex-migrations-ledger-')));
const REL = 'system/migrations-applied.json';

function tree(name, { ledger, pending = false } = {}) {
  const root = path.join(TMP, name);
  for (const rel of ['scripts/run-migrations.js', 'scripts/lib/json-writer.js']) {
    fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
    fs.copyFileSync(path.join(KIT, rel), path.join(root, rel));
  }
  const mig = path.join(root, 'scripts', 'migrations');
  fs.mkdirSync(mig, { recursive: true });
  fs.writeFileSync(path.join(mig, '001-already.js'), "module.exports = { run: () => ({ status: 'applied' }) };\n");
  if (pending) {
    fs.writeFileSync(path.join(mig, '002-fixture.js'),
      "const fs = require('fs'); const path = require('path');\n" +
      "module.exports = { run: ({ root }) => { fs.writeFileSync(path.join(root, 'ran-002.txt'), 'x'); return { status: 'applied', message: 'fixture applied' }; } };\n");
  }
  if (ledger !== undefined) {
    fs.mkdirSync(path.join(root, 'system'), { recursive: true });
    fs.writeFileSync(path.join(root, REL), ledger);
  }
  return root;
}
const run = (root, ...args) => spawnSync(process.execPath, [path.join(root, 'scripts', 'run-migrations.js'), ...args], { encoding: 'utf8' });
const read = (root) => fs.readFileSync(path.join(root, REL), 'utf8');
const LEGACY = JSON.stringify({ applied: [{ id: '001-already', status: 'applied', date: '2026-08-31' }] }, null, 2) + '\n';

// ------------------------------------------------------------------ L1 legacy is healed
{
  const root = tree('l1', { ledger: LEGACY });
  const before = auditText(REL, read(root));
  ok(before.findings.some(f => /header missing/.test(f)), 'L1 the fixture really is a pre-standard ledger', before.findings[0]);
  const r = run(root);
  const after = auditText(REL, read(root), { root });
  const j = JSON.parse(read(root));
  ok(r.status === 0 && after.findings.length === 0, 'L1 NEGATIVE a legacy ledger with nothing pending is healed onto the standard', after.findings.join(' | ') || `exit ${r.status}`);
  ok(j.applied.length === 1 && j.applied[0].id === '001-already' && j.applied[0].date === '2026-08-31', 'L1 every record survived the heal, unchanged');
}

// ------------------------------------------------------------------ L2 a foreign schema runs nothing
{
  const foreign = JSON.stringify({ _generated_at: '2026-09-23T00:00:00Z', _purpose: 'p', _schema: 'migrations-applied@9', _writer: 'scripts/run-migrations.js', applied: [] }, null, 2) + '\n';
  const root = tree('l2', { ledger: foreign, pending: true });
  const r = run(root);
  ok(r.status === 0, 'L2 the run still exits 0 (an update is never failed by this runner)', `exit ${r.status}`);
  ok(!fs.existsSync(path.join(root, 'ran-002.txt')) && !fs.existsSync(path.join(root, 'ran-001.txt')), 'L2 NEGATIVE nothing ran against a ledger of an unknown schema');
  ok(read(root) === foreign, 'L2 NEGATIVE the foreign ledger is left byte-identical');
  ok(/newer version of Alex/.test(r.stdout) && /migrations-applied@9/.test(r.stdout), 'L2 it says so in plain words, naming both schemas', r.stdout.trim().split('\n')[0]);
}

// ------------------------------------------------------------------ L3, L4 a pending run, then a repeat
{
  const root = tree('l3', { ledger: LEGACY, pending: true });
  const r = run(root);
  const text = read(root);
  const j = JSON.parse(text);
  ok(r.status === 0 && fs.existsSync(path.join(root, 'ran-002.txt')), 'L3 the pending migration ran');
  ok(j._schema === 'migrations-applied@1' && j._writer === 'scripts/run-migrations.js' && /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ$/.test(j._generated_at),
     'L3 the ledger carries the four-field header', `${j._schema} by ${j._writer}`);
  ok(auditText(REL, text, { root }).findings.length === 0, 'L3 the ledger is canonical, byte for byte');
  ok(j.applied.map(a => a.id).join(',') === '001-already,002-fixture', 'L3 both ids recorded, in order');
  const r2 = run(root);
  ok(r2.status === 0 && read(root) === text, 'L4 a second run writes nothing (byte-identical, same _generated_at)');
}

// ------------------------------------------------------------------ L5 dry run
{
  const root = tree('l5', { ledger: LEGACY, pending: true });
  run(root, '--dry-run');
  ok(read(root) === LEGACY && !fs.existsSync(path.join(root, 'ran-002.txt')), 'L5 --dry-run writes nothing, not even the heal');
}

// ------------------------------------------------------------------ L6 the reader shape
{
  const root = tree('l6', { pending: true });
  run(root);
  const j = JSON.parse(read(root));
  const ran = new Set((j.applied || []).map((a) => (typeof a === 'string' ? a : a.id)));   // kit-doctor's own read, verbatim
  ok(ran.has('001-already') && ran.has('002-fixture'), 'L6 kit-doctor\'s read of applied[].id still sees both ids');
}

// ------------------------------------------------------------------ L7 one writer
{
  const src = fs.readFileSync(path.join(KIT, 'scripts', 'run-migrations.js'), 'utf8');
  ok(!/writeFileSync\s*\(\s*LEDGER/.test(src) && /writeJson\(LEDGER/.test(src), 'L7 the runner writes the ledger only through writeJson');
}

// ------------------------------------------------------------------ L8 the owner is told what to send, in their world
// Review finding F40: a declined step told every owner to "Send update-log.txt from your Desktop". A
// cloud session has no Desktop and no update-log.txt; its support path is /support-bundle.
{
  const root = tree('l8', { ledger: LEGACY });
  fs.writeFileSync(path.join(root, 'scripts', 'migrations', '003-declines.js'), "module.exports = { run: () => ({ status: 'declined', message: 'a fixture that declines' }) };\n");
  const online = spawnSync(process.execPath, [path.join(root, 'scripts', 'run-migrations.js')], { encoding: 'utf8', env: { ...process.env, CLAUDE_CODE_REMOTE: 'true' } });
  const laptop = spawnSync(process.execPath, [path.join(root, 'scripts', 'run-migrations.js')], { encoding: 'utf8', env: { ...process.env, CLAUDE_CODE_REMOTE: '' } });
  ok(online.status === 0 && /\/support-bundle/.test(online.stdout) && !/Desktop/.test(online.stdout),
    'L8 NEGATIVE online a declined step names /support-bundle, never a Desktop file', online.stdout.trim().split('\n').pop());
  ok(laptop.status === 0 && /update-log\.txt from your Desktop/.test(laptop.stdout), 'L8 on a laptop it still names update-log.txt', laptop.stdout.trim().split('\n').pop());
}

fs.rmSync(TMP, { recursive: true, force: true });
console.log('');
if (fails.length) { console.log(`${fails.length} FAILURE(S)`); for (const f of fails) console.log(`  - ${f}`); process.exit(1); }
console.log(`ALL PASS (${pass})`);
