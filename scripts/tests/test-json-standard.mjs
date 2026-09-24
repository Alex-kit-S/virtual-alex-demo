#!/usr/bin/env node
// scripts/tests/test-json-standard.mjs - the JSON standard's two guards, the audit and V21.
//
// WHAT. scripts/json-standard-audit.js (the per-file table, and its --enforced ratchet that CI runs)
// and validate-alex V21 (the same ratchet as a commit-gate leg). Every refusal is shown before the
// pass, because a guard that has never failed is indistinguishable from one that cannot.
//
// HOW. The audit runs against throwaway fixture trees under the OS temp directory, so it never
// reads this checkout's backlog. V21 runs as the REAL validator against this checkout with a
// --staged preview directory carrying one mutated file at a time, so nothing tracked is edited.
// V3, the one leg that needs a tracked file GONE, deletes it in a throwaway clone carrying this
// checkout's current validator (until 2026-09-24 it renamed the real file aside; F43).
//
// E. every enforced path is pinned text eol=lf in .gitattributes (a CRLF checkout otherwise fails V21).
//
// NEVER. It never writes into the checkout.
//
// Run: node scripts/tests/test-json-standard.mjs      (exit 0 = all pass)

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const KIT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const AUDIT = path.join(KIT, 'scripts', 'json-standard-audit.js');
const VALIDATOR = path.join(KIT, 'scripts', 'validate-alex.js');
const require = createRequire(import.meta.url);
const { writeJson, canonicalText } = require(path.join(KIT, 'scripts', 'lib', 'json-writer.js'));
const audit = require(AUDIT);
const { isRemoteDrift } = require(VALIDATOR);

let pass = 0; const fails = [];
function ok(cond, name, detail) {
  if (cond) { pass++; console.log(`PASS  ${name}${detail ? ` - ${detail}` : ''}`); }
  else { fails.push(`${name}${detail ? ` - ${detail}` : ''}`); console.log(`FAIL  ${name}${detail ? ` - ${detail}` : ''}`); }
}
const TMP = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'alex-json-standard-')));
const META = { purpose: 'A fixture file for the JSON standard test.', writer: 'scripts/tests/test-json-standard.mjs', schema: 'json-standard-test@1' };

function runAudit(args) {
  return spawnSync(process.execPath, [AUDIT, ...args], { encoding: 'utf8' });
}
// A fixture tree: one conforming file written by the helper, one hand-written file breaking rules
// 1, 2 and 6, and (optionally) a contract.
function fixture(name, { contract } = {}) {
  const root = path.join(TMP, name);
  fs.mkdirSync(path.join(root, 'system'), { recursive: true });
  fs.mkdirSync(path.join(root, 'scripts', 'tests'), { recursive: true });
  // the _writer claim is checked against the fixture root, so the named script must exist there
  fs.writeFileSync(path.join(root, 'scripts', 'tests', 'test-json-standard.mjs'), '// fixture\n');
  writeJson(path.join(root, 'system', 'good.json'), { alpha: 1, beta: 'two' }, META);
  fs.writeFileSync(path.join(root, 'system', 'bad.json'), '\uFEFF{\r\n  "zeta": 1,\r\n  "alpha": 2\r\n}');
  if (contract) {
    fs.writeFileSync(path.join(root, 'system', 'kit-manifest.json'),
      JSON.stringify({ components: [], json_standard: { doc: 'docs/json-standard.md', enforced: contract } }, null, 2) + '\n');
  }
  return root;
}

// ------------------------------------------------------------------ A. the audit, whole picture
{
  const root = fixture('a-whole');
  const r = runAudit(['--root', root, '--json']);
  let j = null; try { j = JSON.parse(r.stdout); } catch { /* reported below */ }
  const good = j && j.files.find(f => f.path === 'system/good.json');
  const bad = j && j.files.find(f => f.path === 'system/bad.json');
  ok(r.status === 2, 'A1 NEGATIVE a tree with a broken file exits 2 in whole-picture mode', `exit ${r.status}`);
  ok(bad && bad.findings.some(f => f === 'rule 1: BOM') && bad.findings.some(f => /CRLF/.test(f)) &&
     bad.findings.some(f => /header missing/.test(f)) && bad.findings.some(f => /rule 6/.test(f)),
     'A1 NEGATIVE the broken file is named with rules 1, 2 and 6', bad ? bad.findings.join(' | ') : 'no row');
  ok(good && good.findings.length === 0 && good.canonical === true, 'A2 a file the helper wrote is canonical with no findings');
}
{
  const r = runAudit(['--root', path.join(TMP, 'does-not-exist')]);
  ok(r.status === 1 && /no in-scope JSON/.test(r.stderr), 'A3 NEGATIVE a root that does not exist is exit 1, never a clean 0', `exit ${r.status}`);
  const empty = path.join(TMP, 'empty'); fs.mkdirSync(empty);
  const r2 = runAudit(['--root', empty]);
  ok(r2.status === 1, 'A3 NEGATIVE an empty tree is exit 1, never a clean 0', `exit ${r2.status}`);
}

// ------------------------------------------------------------------ B. the --enforced ratchet
{
  const root = fixture('b-no-contract');
  const r = runAudit(['--root', root, '--enforced']);
  ok(r.status === 1 && /kit-manifest\.json is not on disk/.test(r.stderr), 'B1 NEGATIVE --enforced with no contract file is exit 1', `exit ${r.status}: ${r.stderr.trim().split('\n')[0]}`);
  fs.writeFileSync(path.join(root, 'system', 'kit-manifest.json'), JSON.stringify({ components: [] }, null, 2) + '\n');
  const r2 = runAudit(['--root', root, '--enforced']);
  ok(r2.status === 1 && /no json_standard\.enforced\[\] array/.test(r2.stderr), 'B1 NEGATIVE --enforced with a contract file that lacks the list is exit 1', `exit ${r2.status}`);
}
{
  const root = fixture('b-backlog', { contract: ['system/good.json'] });
  const r = runAudit(['--root', root, '--enforced']);
  ok(r.status === 0 && /Enforced \(1 path/.test(r.stdout), 'B2 the unmigrated backlog (bad.json, not enforced) is reported and never blocks', `exit ${r.status}`);
  ok(/system\/bad\.json/.test(r.stdout), 'B2 the backlog file is still in the table');
}
{
  const root = fixture('b-hand-edit', { contract: ['system/good.json'] });
  const f = path.join(root, 'system', 'good.json');
  const before = fs.readFileSync(f, 'utf8');
  fs.writeFileSync(f, before.replace('"alpha": 1', '"alpha":  1'));   // ONE byte: a second space
  const r = runAudit(['--root', root, '--enforced']);
  ok(r.status === 2 && /REGRESSION/.test(r.stdout) && /system\/good\.json: /.test(r.stdout), 'B3 NEGATIVE one hand-edited byte in an enforced file is exit 2, naming it', `exit ${r.status}`);
}
{
  const root = fixture('b-raw-writer', { contract: ['system/good.json', 'system/fresh.json'] });
  fs.writeFileSync(path.join(root, 'scripts', 'raw.js'),
    "const fs = require('fs');\nconst path = require('path');\nconst F = path.join(__dirname, '..', 'system', 'good.json');\n" +
    'fs.writeFileSync(F, JSON.stringify({ alpha: 1 }, null, 2));\n');
  const r = runAudit(['--root', root, '--enforced']);
  ok(r.status === 2 && /scripts\/raw\.js:4 writes system\/good\.json with a raw JSON\.stringify/.test(r.stdout),
     'B4 NEGATIVE a raw JSON.stringify writer of an enforced file is exit 2, naming the site', `exit ${r.status}`);
  // The same, for an enforced file that is NOT on disk yet (a gitignored state file on a fresh clone)
  fs.unlinkSync(path.join(root, 'scripts', 'raw.js'));
  fs.writeFileSync(path.join(root, 'scripts', 'raw2.mjs'),
    "import fs from 'node:fs';\nimport path from 'node:path';\nimport { fileURLToPath } from 'node:url';\n" +
    'const HERE = path.dirname(fileURLToPath(import.meta.url));\nconst REPO = path.resolve(HERE, \'..\');\n' +
    "fs.writeFileSync(path.join(REPO, 'system', 'fresh.json'), JSON.stringify({ a: 1 }));\n");
  const r2 = runAudit(['--root', root, '--enforced']);
  ok(r2.status === 2 && /raw2\.mjs:6 writes system\/fresh\.json/.test(r2.stdout),
     'B5 NEGATIVE a raw writer of an enforced file that is not on disk yet is still caught (ESM path idiom)', `exit ${r2.status}`);
}
// F05 (fleet seat 8): the scan once flagged a raw writer only when JSON.stringify sat INSIDE the
// writeFileSync argument list. Serializing on one line and writing on the next, or writing through
// fs.promises / a stream, walked straight past it while the doc said any raw writer fails.
{
  const root = fixture('b-two-line', { contract: ['system/good.json'] });
  fs.writeFileSync(path.join(root, 'scripts', 'two.js'),
    "const fs = require('fs');\nconst path = require('path');\nconst F = path.join(__dirname, '..', 'system', 'good.json');\n" +
    'const text = JSON.stringify({ alpha: 1 }, null, 2);\nfs.writeFileSync(F, text);\n');
  const r = runAudit(['--root', root, '--enforced']);
  ok(r.status === 2 && /scripts\/two\.js:5 writes system\/good\.json with a raw JSON\.stringify/.test(r.stdout),
     'B6 NEGATIVE a two-line raw writer (serialize into a const, write the const) of an enforced file is exit 2, naming the site', `exit ${r.status}`);
  fs.writeFileSync(path.join(root, 'scripts', 'two.js'),
    "const fs = require('fs');\nconst path = require('path');\nconst F = path.join(__dirname, '..', 'system', 'good.json');\n" +
    'let body;\nbody = JSON.stringify({ alpha: 1 });\nconst out = body + "\\n";\nfs.writeFileSync(F, out);\n');
  const r2 = runAudit(['--root', root, '--enforced']);
  ok(r2.status === 2 && /scripts\/two\.js:7 writes system\/good\.json/.test(r2.stdout),
     'B6 NEGATIVE the same through a reassigned let and a second const is still caught', `exit ${r2.status}`);
}
{
  const root = fixture('b-async', { contract: ['system/good.json'] });
  fs.writeFileSync(path.join(root, 'scripts', 'async.mjs'),
    "import fs from 'node:fs';\nimport path from 'node:path';\nimport { fileURLToPath } from 'node:url';\n" +
    "const F = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'system', 'good.json');\n" +
    'await fs.promises.writeFile(F, JSON.stringify({ alpha: 1 }));\n');
  const r = runAudit(['--root', root, '--enforced']);
  ok(r.status === 2 && /scripts\/async\.mjs:5 writes system\/good\.json/.test(r.stdout),
     'B7 NEGATIVE fs.promises.writeFile of an enforced file is exit 2, naming the site', `exit ${r.status}`);
  fs.writeFileSync(path.join(root, 'scripts', 'async.mjs'),
    "import fs from 'node:fs';\nimport path from 'node:path';\nimport { fileURLToPath } from 'node:url';\n" +
    "const F = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'system', 'good.json');\n" +
    'const s = fs.createWriteStream(F);\ns.end(JSON.stringify({ alpha: 1 }));\n');
  const r2 = runAudit(['--root', root, '--enforced']);
  ok(r2.status === 2 && /scripts\/async\.mjs:5 writes system\/good\.json/.test(r2.stdout),
     'B7 NEGATIVE a createWriteStream onto an enforced file is exit 2, naming the site', `exit ${r2.status}`);
  fs.writeFileSync(path.join(root, 'scripts', 'async.mjs'),
    "import { writeFile } from 'node:fs/promises';\nimport path from 'node:path';\nimport { fileURLToPath } from 'node:url';\n" +
    "const F = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'system', 'good.json');\n" +
    'await writeFile(F, JSON.stringify({ alpha: 1 }));\n');
  const r3 = runAudit(['--root', root, '--enforced']);
  ok(r3.status === 2 && /scripts\/async\.mjs:5 writes system\/good\.json/.test(r3.stdout),
     'B7 NEGATIVE a bare writeFile imported from fs/promises is exit 2, naming the site', `exit ${r3.status}`);
}
{
  // The positive control for B6 and B7: a two-line writer of a file that is NOT enforced stays a
  // backlog row, never a regression, so the wider scan cannot turn the backlog into a CI failure.
  const root = fixture('b-two-line-backlog', { contract: ['system/good.json'] });
  fs.writeFileSync(path.join(root, 'scripts', 'two.js'),
    "const fs = require('fs');\nconst path = require('path');\nconst F = path.join(__dirname, '..', 'system', 'bad.json');\n" +
    'const text = JSON.stringify({ alpha: 1 }, null, 2);\nfs.writeFileSync(F, text);\n');
  const r = runAudit(['--root', root, '--enforced']);
  ok(r.status === 0 && /scripts\/two\.js:5\s+production\s+-> system\/bad\.json/.test(r.stdout),
     'B6/B7 control: a two-line writer of an unenforced file is listed and does not block', `exit ${r.status}`);
}
// ------------------------------------------------------------------ K. the declared identifier map (F11)
// The audit must read the SAME declaration the writer does (json-writer.js ID_MAPS, by `_schema`), or
// a file the helper wrote would be reported as broken, and a hand-typed exception could pass.
{
  const root = fixture('k-idmap');
  const PMETA = { purpose: 'A fixture profile.', writer: 'scripts/tests/test-json-standard.mjs', schema: 'install-profile@1' };
  const lanes = { 'business-validation': false, website: true };
  let wrote = true;
  try { writeJson(path.join(root, 'system', 'profile.json'), { lanes, locale: 'en' }, PMETA); } catch (e) { wrote = false; }
  const handTyped = (payload, schema) => canonicalText({ ...payload, _generated_at: '2026-09-24T00:00:00Z',
    _purpose: 'A fixture profile.', _schema: schema, _writer: 'scripts/tests/test-json-standard.mjs' }, { validate: false }) + '\n';
  fs.writeFileSync(path.join(root, 'system', 'undeclared.json'), handTyped({ lanes, locale: 'en' }, 'json-standard-test@1'));
  fs.writeFileSync(path.join(root, 'system', 'outside.json'), handTyped({ lanes, 'radar-feeds': [] }, 'install-profile@1'));
  const r = runAudit(['--root', root, '--json']);
  let j = null; try { j = JSON.parse(r.stdout); } catch { /* reported below */ }
  const row = n => j && j.files.find(f => f.path === `system/${n}.json`);
  ok(wrote && row('profile') && row('profile').findings.length === 0 && row('profile').canonical,
     'K1 a profile the helper wrote with a kebab lane id (declared map) has no findings', wrote ? (row('profile') || { findings: ['no row'] }).findings.join(' | ') || 'none' : 'writeJson refused it');
  ok(row('undeclared') && row('undeclared').findings.some(f => /rule 5: not snake_case: business-validation/.test(f)),
     'K2 NEGATIVE the same kebab key in a file whose schema declares no map is reported under rule 5',
     row('undeclared') ? row('undeclared').findings.join(' | ') : 'no row');
  ok(row('outside') && row('outside').findings.some(f => /rule 5: not snake_case: radar-feeds/.test(f)) &&
     !row('outside').findings.some(f => /business-validation/.test(f)),
     'K3 NEGATIVE in a declaring file, a kebab key OUTSIDE the declared map is reported and the declared one is not',
     row('outside') ? row('outside').findings.join(' | ') : 'no row');
}
{
  const root = fixture('b-powershell', { contract: ['system/good.json'] });
  fs.writeFileSync(path.join(root, 'scripts', 'w.ps1'), '$state | ConvertTo-Json -Depth 3 | Set-Content -Encoding utf8 $file\n');
  const r = runAudit(['--root', root]);
  ok(/POWERSHELL WRITER SITES/.test(r.stdout) && /scripts\/w\.ps1:1/.test(r.stdout), 'B8 a PowerShell JSON writer is listed by file and line');
}

// ------------------------------------------------------------------ V. validate-alex V21, the real validator
function v21Lines(res) {
  return String(res.stderr || '').split(/\r?\n/).filter(l => /^(FAILED|WARNING) V21:/.test(l));
}
function runValidator(stagedDir) {
  const args = [VALIDATOR, '--context=pre-commit'];
  if (stagedDir) args.push(`--staged=${stagedDir}`);
  return spawnSync(process.execPath, args, { cwd: KIT, encoding: 'utf8', env: { ...process.env, CLAUDE_CODE_REMOTE: '' } });
}
const kitManifest = JSON.parse(fs.readFileSync(path.join(KIT, 'system', 'kit-manifest.json'), 'utf8'));
function staged(files) {
  const dir = fs.mkdtempSync(path.join(TMP, 'staged-'));
  for (const [rel, text] of Object.entries(files)) {
    const dst = path.join(dir, rel);
    fs.mkdirSync(path.dirname(dst), { recursive: true });
    fs.writeFileSync(dst, text);
  }
  return dir;
}
function manifestWith(mutate) {
  const m = JSON.parse(JSON.stringify(kitManifest));
  mutate(m);
  return JSON.stringify(m, null, 2) + '\n';
}
const TRACKED_ENFORCED = 'system/employer-data-allowlist.json';   // tracked, shipped, written only through the helper

{
  const dir = staged({ 'system/kit-manifest.json': manifestWith(m => { delete m.json_standard; }) });
  const res = runValidator(dir);
  const lines = v21Lines(res);
  ok(res.status !== 0 && lines.some(l => /^FAILED V21: .*no json_standard\.enforced\[\] array/.test(l)),
     'V1 NEGATIVE a contract with the list removed FAILS V21 (a check with no scope asserts nothing)', `exit ${res.status}`);
}
{
  const real = fs.readFileSync(path.join(KIT, TRACKED_ENFORCED), 'utf8');
  const oneByte = real.replace('"_purpose": ', '"_purpose":  ');   // one extra space, content unchanged
  ok(oneByte !== real, 'V2 the fixture really does change one byte');
  const dir = staged({
    'system/kit-manifest.json': manifestWith(m => { m.json_standard.enforced = [TRACKED_ENFORCED]; }),
    [TRACKED_ENFORCED]: oneByte,
  });
  const res = runValidator(dir);
  const lines = v21Lines(res);
  ok(res.status !== 0 && lines.some(l => l.startsWith(`FAILED V21: ${TRACKED_ENFORCED} (staged) breaks the JSON standard`)),
     'V2 NEGATIVE one hand-edited byte in an enforced file FAILS V21, naming the file', `exit ${res.status}`);
  if (lines.length) console.log(`      ${lines.find(l => l.startsWith('FAILED')) || ''}`);
}
{
  // A TRACKED enforced file that went missing, deleted in a throwaway CLONE and never in this checkout.
  // Until 2026-09-24 this leg renamed the real file aside and relied on a finally to put it back, so a
  // run killed between the two left the checkout missing a tracked file (fleet review F43). The
  // validator judges the tree it sits in (REPO is its own parent), so the clone gets this checkout's
  // CURRENT validator, audit and helper copied over it: V3 still tests the code under test.
  const real = path.join(KIT, TRACKED_ENFORCED);
  const bytes = fs.readFileSync(real);
  const clone = path.join(TMP, 'v3-clone');
  const c = spawnSync('git', ['clone', '-q', '-c', 'core.autocrlf=false', '-c', 'core.eol=lf', '-c', 'core.symlinks=false', KIT, clone], { encoding: 'utf8' });
  let res = { status: null, stderr: `git clone failed: ${c.stderr}` };
  if (c.status === 0) {
    for (const rel of ['scripts/validate-alex.js', 'scripts/json-standard-audit.js', 'scripts/lib/json-writer.js']) {
      fs.copyFileSync(path.join(KIT, rel), path.join(clone, rel));
    }
    fs.rmSync(path.join(clone, TRACKED_ENFORCED));
    const dir = staged({ 'system/kit-manifest.json': manifestWith(m => { m.json_standard.enforced = [TRACKED_ENFORCED]; }) });
    res = spawnSync(process.execPath, [path.join(clone, 'scripts', 'validate-alex.js'), '--context=pre-commit', `--staged=${dir}`],
      { cwd: clone, encoding: 'utf8', env: { ...process.env, CLAUDE_CODE_REMOTE: '' } });
  }
  ok(Buffer.compare(bytes, fs.readFileSync(real)) === 0 && !fs.readdirSync(path.dirname(real)).some(f => f.includes('v21-test-aside')),
     'V3 this checkout was never touched: the tracked file is byte-identical and nothing was set aside beside it');
  const lines = v21Lines(res);
  ok(res.status !== 0 && lines.some(l => l.startsWith(`FAILED V21: ${TRACKED_ENFORCED} is listed in json_standard.enforced[] but is not on disk, and git tracks it`)),
     'V3 NEGATIVE a TRACKED enforced file that vanished FAILS V21', `exit ${res.status}${res.status === null ? `: ${res.stderr}` : ''}`);
}
{
  const dir = staged({ 'system/kit-manifest.json': manifestWith(m => { m.json_standard.enforced = ['system/never-written-state.json']; }) });
  const res = runValidator(dir);
  const lines = v21Lines(res);
  ok(!lines.some(l => l.startsWith('FAILED V21')) && lines.some(l => /^WARNING V21: enforced but absent, and not tracked.*system\/never-written-state\.json/.test(l)),
     'V4 an enforced GITIGNORED file that is absent (writer not run yet) WARNS and never fails');
}
{
  const res = runValidator(null);
  const lines = v21Lines(res);
  ok(!lines.some(l => l.startsWith('FAILED V21')), 'V5 the committed contract against this checkout: no V21 failure',
     lines.filter(l => l.startsWith('FAILED')).join(' | ') || `${kitManifest.json_standard.enforced.length} path(s) enforced`);
}
ok(isRemoteDrift('FAILED V21: system/x.json (repo) breaks the JSON standard: rule 1: BOM') === false,
   'V6 V21 is a CONTENT leg: it still blocks under CLAUDE_CODE_REMOTE=true');
{
  // The two readers share one parser; prove the audit and V21 read the same list from the same file.
  const list = audit.readContract(KIT);
  ok(JSON.stringify(list) === JSON.stringify(kitManifest.json_standard.enforced), 'V7 the audit and the validator read the same enforced list', `${list.length} path(s)`);
}

// ------------------------------------------------------------------ E. every enforced path is pinned LF
// A clone made with core.autocrlf=true (the Git for Windows default, and GitHub's Windows runner)
// writes CRLF into the working copy of any text file .gitattributes does not pin, and V21 then
// refuses a commit that did nothing wrong. Measured, not assumed: see the seat 3 report.
// Since 2026-09-24 (fleet Fix A) `* text=auto eol=lf` gives EVERY path eol=lf, so reading eol alone made
// E1 unfalsifiable: the synthetic unpinned path read as pinned. A per-path pin is `text eol=lf`, which
// check-attr reports as text: set, where the class rule reports text: auto. Both must hold.
function unpinned(paths) {
  const r = spawnSync('git', ['check-attr', 'text', 'eol', '--', ...paths], { cwd: KIT, encoding: 'utf8' });
  if (r.status !== 0) return paths.map(p => `${p} (git check-attr failed: ${r.stderr.trim()})`);
  const lines = r.stdout.split(/\r?\n/).filter(Boolean);
  return paths.filter(p => !(lines.includes(`${p}: text: set`) && lines.includes(`${p}: eol: lf`)));
}
{
  const synthetic = unpinned(['system/not-pinned-anywhere.json']);
  ok(synthetic.length === 1, 'E1 NEGATIVE a path with no eol=lf line in .gitattributes is caught', synthetic.join(', '));
  const real = unpinned(kitManifest.json_standard.enforced);
  ok(real.length === 0, 'E2 every path in json_standard.enforced[] is pinned text eol=lf in .gitattributes',
     real.length ? `unpinned: ${real.join(', ')}` : `${kitManifest.json_standard.enforced.length} pinned`);
}

fs.rmSync(TMP, { recursive: true, force: true });
console.log('');
if (fails.length) { console.log(`${fails.length} FAILURE(S)`); for (const f of fails) console.log(`  - ${f}`); process.exit(1); }
console.log(`ALL PASS (${pass})`);
