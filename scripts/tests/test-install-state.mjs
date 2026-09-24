#!/usr/bin/env node
// scripts/tests/test-install-state.mjs - one writer and one schema for system/install-state.json.
// (2026-09-23, Virtual Alex fleet seat 1.)
//
// WHY. Four places wrote this record with `head` / `previousHead` / `updatedAt`, the online
// /update wrote `template_commit`, and on 2026-09-23 a real install ran both in one session and
// ended with a file carrying both key sets. Half of it described the owner's own autosave commit
// as if it were a template version.
//
// WHAT. scripts/lib/install-state.js is the one writer, with one key set, proven by these legs:
//   I1  NEGATIVE the legacy camelCase key set cannot be written through this Kit's JSON standard
//       at all (writeJson throws on `previousHead`), which is why it is the one that lost
//   I2  a legacy-only file reads as a current one, so an installed copy keeps its record
//   I3  stamp writes ONLY the surviving keys and drops the legacy ones
//   I4  stamp moves the current commit to previous_template_commit
//   I5  NEGATIVE stamp refuses anything that is not a commit sha, and writes nothing
//   I6  DRIFT no tracked file outside the library names a legacy key, so there is one schema
//   I7  DRIFT no tracked file outside the library writes the record, so there is one writer
//   I8  migration 002 DECLINES online, where git HEAD is the owner's commit and not a version
//   D1-D4 `install-state.js line` names the template build, its date and age, and when this copy
//       took it, from VERSION or else the changelog, and says "unknown" rather than guess
//   D5  NEGATIVE /alex-status and the brief's monthly line print it, with no ls-remote anywhere
//
// HOW. I1 to I5 and I8 write fixture records under the OS temp directory; I6 and I7 read the
// tracked files of this checkout with git ls-files.
//   node scripts/tests/test-install-state.mjs      (exit 0 = all pass, 1 = any failure)
//
// NEVER. Never writes inside this repository.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const installState = require('../lib/install-state.js');
const { writeJson } = require('../lib/json-writer.js');

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '..', '..');

let failures = 0;
const ok = (cond, name, detail = '') => {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${detail ? ` - ${detail}` : ''}`);
  if (!cond) failures++;
};

const root = () => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'alex-instate-'));
  fs.mkdirSync(path.join(d, 'system'), { recursive: true });
  return d;
};
const readRaw = (d) => JSON.parse(fs.readFileSync(path.join(d, 'system', 'install-state.json'), 'utf8'));

// --- I1 NEGATIVE: the loser cannot be written through the house standard ----------------------
{
  const d = root();
  let threw = '';
  try {
    writeJson(path.join(d, 'system', 'legacy.json'),
      { head: 'abc1234', previousHead: null, updatedAt: '2026-09-23' },
      { purpose: 'the legacy shape', writer: 'test', schema: 'legacy@1' });
  } catch (e) {
    threw = e.message;
  }
  ok(/previousHead/.test(threw),
    'I1 NEGATIVE writeJson REFUSES the legacy camelCase key set',
    threw ? threw.split('\n')[0] : 'it was accepted, which it must not be');
}

// --- I2 a legacy-only file reads as a current one ---------------------------------------------
{
  const d = root();
  fs.writeFileSync(path.join(d, 'system', 'install-state.json'), JSON.stringify({
    head: 'aaaaaaabbbbbbbccccccc1111111222222233333334',
    previousHead: 'dddddddeeeeeeefffffff4444444555555566666667',
    updatedAt: '2026-08-31',
    seededBy: '002-install-state-seed',
  }, null, 2) + '\n');
  const s = installState.read(d);
  ok(s && s.template_commit === 'aaaaaaabbbbbbbccccccc1111111222222233333334',
    'I2 a legacy `head` reads as template_commit', s && s.template_commit);
  ok(s && s.previous_template_commit === 'dddddddeeeeeeefffffff4444444555555566666667',
    'I2 a legacy `previousHead` reads as previous_template_commit');
  ok(s && s.template_updated_at === '2026-08-31', 'I2 a legacy `updatedAt` reads as template_updated_at');
  ok(s && s.stamped_by === '002-install-state-seed', 'I2 a legacy `seededBy` reads as stamped_by');
}

// --- I3 + I4 the stamp ------------------------------------------------------------------------
{
  const d = root();
  fs.writeFileSync(path.join(d, 'system', 'install-state.json'), JSON.stringify({
    head: '1111111111111111111111111111111111111111',
    previousHead: null,
    updatedAt: '2026-08-31',
  }, null, 2) + '\n');
  const out = installState.stamp(d, '2222222222222222222222222222222222222222', { by: 'test', at: '2026-09-23' });
  const raw = readRaw(d);
  const legacyLeft = Object.keys(raw).filter((k) => ['head', 'previousHead', 'updatedAt', 'seededBy'].includes(k));
  ok(legacyLeft.length === 0, 'I3 the stamp drops every legacy key',
    legacyLeft.length ? `still there: ${legacyLeft.join(', ')}` : 'none left');
  ok(raw.template_commit === '2222222222222222222222222222222222222222', 'I3 template_commit written');
  ok(out.template_commit === raw.template_commit, 'I3 the stamp read the record back before returning');
  ok(raw.previous_template_commit === '1111111111111111111111111111111111111111',
    'I4 the legacy head became previous_template_commit', raw.previous_template_commit);
  ok(raw.template_updated_at === '2026-09-23', 'I4 the date is the one given');
  ok(typeof raw._schema === 'string' && raw._schema === installState.SCHEMA,
    'I4 the record carries the JSON standard header', raw._schema);
}

// --- I5 NEGATIVE: a non-sha writes nothing ----------------------------------------------------
{
  const d = root();
  let threw = '';
  try { installState.stamp(d, 'not-a-sha', { by: 'test' }); } catch (e) { threw = e.message; }
  ok(/not a commit sha/.test(threw), 'I5 NEGATIVE stamp refuses a non-sha', threw || 'it was accepted');
  ok(!fs.existsSync(path.join(d, 'system', 'install-state.json')),
    'I5 NEGATIVE nothing was written on the refusal');
}

// --- I6 + I7 DRIFT: one schema, one writer ----------------------------------------------------
{
  const tracked = execFileSync('git', ['ls-files'], { cwd: REPO, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 })
    .split(/\r?\n/).filter(Boolean)
    .filter((f) => /\.(js|mjs|cjs|md|cmd|command|sh|json|yml)$/.test(f))
    .filter((f) => !f.startsWith('.agents/skills/'))
    .filter((f) => f !== 'scripts/lib/install-state.js' && f !== 'scripts/tests/test-install-state.mjs');

  const legacyNamers = [];
  const foreignWriters = [];
  for (const rel of tracked) {
    let text;
    try { text = fs.readFileSync(path.join(REPO, rel), 'utf8'); } catch { continue; }
    if (!/install-state/.test(text)) continue;
    for (const line of text.split(/\r?\n/)) {
      if (!/install-state|previousHead|seededBy/.test(line) && !/\bhead\b.*install-state/.test(line)) continue;
      if (/previousHead|seededBy/.test(line)) legacyNamers.push(`${rel}: ${line.trim().slice(0, 100)}`);
      if (/install-state\.json/.test(line) && /writeFileSync|>\s*system|Set-Content|Out-File/.test(line)) {
        foreignWriters.push(`${rel}: ${line.trim().slice(0, 100)}`);
      }
    }
  }
  ok(legacyNamers.length === 0, 'I6 no tracked file outside the library names a legacy key',
    legacyNamers.length ? legacyNamers.join(' || ') : 'one schema');
  ok(foreignWriters.length === 0, 'I7 no tracked file outside the library writes the record',
    foreignWriters.length ? foreignWriters.join(' || ') : 'one writer');
}

// --- I8 migration 002 declines online ---------------------------------------------------------
{
  const mig = require('../migrations/002-install-state-seed.js');
  const d = root();
  execFileSync('git', ['init', '-q'], { cwd: d });
  execFileSync('git', ['-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-q', '--allow-empty', '-m', 'seed'], { cwd: d });

  const before = process.env.CLAUDE_CODE_REMOTE;
  process.env.CLAUDE_CODE_REMOTE = 'true';
  const online = mig.run({ root: d, log: () => {} });
  if (before === undefined) delete process.env.CLAUDE_CODE_REMOTE; else process.env.CLAUDE_CODE_REMOTE = before;
  ok(online.status === 'declined', 'I8 migration 002 DECLINES in a cloud session', online.message);
  ok(!fs.existsSync(path.join(d, 'system', 'install-state.json')),
    'I8 it wrote no version record online, where git HEAD is the owner\'s own commit');

  const laptop = mig.run({ root: d, log: () => {} });
  ok(laptop.status === 'applied', 'I8 it still seeds on a laptop', laptop.message);
  const raw = readRaw(d);
  ok(typeof raw.template_commit === 'string' && raw.head === undefined,
    'I8 and it seeds the SURVIVING key set', Object.keys(raw).filter((k) => !k.startsWith('_')).join(', '));
}

// --- D: how old is this copy, from local files only (review finding F08, runtime half) ----------
// The "template moved" leg was removed (a Routine cannot read the template), and nothing replaced
// it, so an owner could not see how old their Alex was. `install-state.js line` answers from the
// tree's own VERSION, changelog and stamp: no fetch, no ls-remote, no network.
{
  const lib = path.join(REPO, 'scripts', 'lib', 'install-state.js');
  const lineOf = (d, today = '2026-10-24') => execFileSync(process.execPath, [lib, 'line', '--root', d], {
    encoding: 'utf8', env: { ...process.env, ALEX_TODAY: today },
  }).trim();
  const tryLine = (d) => { try { return { out: lineOf(d), err: '' }; } catch (e) { return { out: '', err: String(e.stdout || e.message).trim().slice(0, 120) }; } };

  const d1 = root();
  fs.writeFileSync(path.join(d1, 'VERSION'), 'Virtual Alex template build 35, 2026-09-24, from Kit commit 9213584a0e3b\n');
  installState.stamp(d1, '24bd6cb505735876eff0902ab6953d656e3bc8fa', { by: '/update', at: '2026-09-24' });
  const r1 = tryLine(d1);
  ok(/template build 35, built 2026-09-24 \(30 days ago\)/.test(r1.out) && /updated to it on 2026-09-24 by \/update, template commit 24bd6cb/.test(r1.out),
    'D1 NEGATIVE `line` names the build, its date and age, and when this copy took it', r1.out || r1.err);

  const d2 = root();
  fs.writeFileSync(path.join(d2, 'VERSION'), 'Virtual Alex template build 26, 2026-09-24, from Kit commit d55b80ffda21\n');
  const r2 = tryLine(d2);
  ok(/template build 26, built 2026-09-24/.test(r2.out) && /has not run \/update yet/.test(r2.out),
    'D2 a copy that never ran /update says so, and still names its build', r2.out || r2.err);

  const d3 = root();
  fs.writeFileSync(path.join(d3, 'system', 'template-changelog.jsonl'),
    '{"at":"2026-09-20T10:00:00Z","previous_template_commit":null}\n{"at":"2026-09-22T09:00:00Z","build":24,"previous_template_commit":"abc"}\n');
  const r3 = tryLine(d3);
  ok(/template build 24, built 2026-09-22/.test(r3.out), 'D3 an older tree with no VERSION falls back to its changelog', r3.out || r3.err);

  const d4 = root();
  const r4 = tryLine(d4);
  ok(/template build unknown/.test(r4.out) && !r4.err, 'D4 a tree with neither says "unknown" and exits 0', r4.out || r4.err);

  const tree = fs.existsSync(path.join(REPO, 'variants', 'online')) ? path.join(REPO, 'variants', 'online') : REPO;
  const status = fs.readFileSync(path.join(tree, '.claude', 'commands', 'alex-status.md'), 'utf8');
  const brief = fs.readFileSync(path.join(REPO, 'scheduler', 'routines', 'brief.md'), 'utf8');
  const calls = (t) => t.includes('node scripts/lib/install-state.js line');
  ok(calls(status) && calls(brief) && !/ls-remote/.test(status) && !/ls-remote/.test(brief),
    'D5 NEGATIVE /alex-status and the brief\'s monthly line print it, and neither reaches the network for it',
    `alex-status: ${calls(status)}, brief: ${calls(brief)}, ls-remote: ${/ls-remote/.test(status + brief)}`);
}

console.log(failures === 0 ? '\nALL PASS' : `\n${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
