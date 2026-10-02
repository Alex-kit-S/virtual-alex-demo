// @ts-check
// scripts/tests/test-doctor-honesty.mjs - the real doctor never says PASS for a tool that is not there.
//
// WHAT. On Windows, a missing tool's shell retry can make cmd.exe answer for it ("'x' is not recognized", exit
// 1, no error object), which reads as a PASS unless something checks for that signature - rclone included, on
// machines where a missing rclone means no backup at all. A doctor that says PASS for an absent tool is worse
// than no doctor: it certifies the exact state it exists to catch. This file runs the real doctor black-box
// and asserts the invariant that guards against it, so the pin holds however the probe changes. Deleted, it
// would let a shell retry's false PASS through with every other test green:
//   H1  no [PASS] tool row's detail carries a shell not-found signature
//   H2  every tool row is an honest state: the doctor probed a real tool set (H2a), and each PASS carries its
//       evidence, a version or a path (H2b)
//   H3  the doctor exits 0 or 2 (a verdict), never 1 (a crash)
//
// HOW. The doctor resolves its repository from its own folder, changes into it and writes
// outputs/logs/bootstrap-check.log there, so it runs from a COPY of this checkout in the OS temp folder: what git
// sees in this tree (tracked files, and untracked ones it does not ignore), in a fresh git repository. The rows
// come from the copied schema and this machine's PATH, as they did when the doctor ran in place. Inherited GIT_*
// is stripped and git reads an empty fixture config. The copy is removed on exit. The real doctor is spawned once,
// before any test() runs, and every leg below reads that one run's output.
//
// NEVER. Writes into this checkout. Changes a leg's name or H2a's printed line:
// scripts/tests/test-bootstrap-doctor.mjs runs a copy of this file and expects one of its lines exactly.
// Reaches this machine's Task Scheduler: the copy's schema drops scheduler_rule before the doctor runs, so
// checkScheduler() (bootstrap.mjs) returns before liveJobs() ever asks it; no leg here reads the scheduler
// row, since H2a counts tool rows only.
//
// Usage: node scripts/tests/test-doctor-honesty.mjs
// Exit: 0 every leg passed - 1 a leg failed, or the copy of the checkout could not be made

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, before, describe, test } from 'node:test';
import { fileURLToPath } from 'node:url';

const KIT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const TMP = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'alex-doctor-honesty-')));
after(() => fs.rmSync(TMP, { recursive: true, force: true, maxRetries: 5 }));
const REPO = path.join(TMP, 'checkout');

/** @type {{ status: number | null, lines: string[] }} */
let r;

before(() => {
  fs.writeFileSync(path.join(TMP, 'gitconfig'), '');
  const ENV = Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.startsWith('GIT_')));
  Object.assign(ENV, { GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: path.join(TMP, 'gitconfig') });

  const ls = spawnSync('git', ['ls-files', '-z', '--cached', '--others', '--exclude-standard'], {
    cwd: KIT,
    env: ENV,
    encoding: 'utf8'
  });
  if (ls.status !== 0) throw new Error(`git ls-files failed in ${KIT}: ${ls.stderr}`);
  for (const rel of ls.stdout.split('\0').filter(Boolean)) {
    const src = path.join(KIT, rel);
    const dst = path.join(REPO, rel);
    let st;
    try {
      st = fs.lstatSync(src);
    } catch {
      continue;
    }
    fs.mkdirSync(path.dirname(dst), { recursive: true });
    if (st.isSymbolicLink()) fs.symlinkSync(fs.readlinkSync(src), dst);
    else if (st.isFile()) fs.copyFileSync(src, dst);
  }
  // A repository of its own, so the doctor's git rows read the copy and never a folder above it.
  const init = spawnSync('git', ['init', '-q'], { cwd: REPO, env: ENV, encoding: 'utf8' });
  if (init.status !== 0) throw new Error(`git init failed in the copy: ${init.stderr}`);
  // The copy's schema drops scheduler_rule, so the doctor never asks the real Task Scheduler:
  // bootstrap.mjs's checkScheduler() only calls liveJobs() (schtasks / powershell on Windows) when
  // schema.scheduler_rule is set. No leg here reads the scheduler row: H2a counts tool rows only
  // (`/^\[(PASS|MISS|OPT )\] tool/`), which a scheduler row never matches.
  const schemaPath = path.join(REPO, 'system', 'environment-schema.json');
  const schema = JSON.parse(fs.readFileSync(schemaPath, 'utf8'));
  delete schema.scheduler_rule;
  fs.writeFileSync(schemaPath, `${JSON.stringify(schema, null, 2)}\n`);

  const spawned = spawnSync(process.execPath, [path.join(REPO, 'scripts', 'bootstrap.mjs')], {
    encoding: 'utf8',
    timeout: 300000,
    env: ENV
  });
  const out = `${spawned.stdout || ''}${spawned.stderr || ''}`;
  r = { status: spawned.status, lines: out.split(/\r?\n/) };
});

describe('the real doctor, black-box', () => {
  test('H1 no PASS row carries a not-found signature', () => {
    const NOT_FOUND = /is not recognized|not found|No such file|cannot find/i;
    const badPass = r.lines.filter((l) => l.startsWith('[PASS] tool') && NOT_FOUND.test(l));
    assert.deepEqual(badPass, [], badPass[0] || '');
  });

  test('H2a doctor probed a real tool set', () => {
    const toolRows = r.lines.filter((l) => /^\[(PASS|MISS|OPT )\] tool/.test(l));
    // contract: read as text by scripts/tests/test-bootstrap-doctor.mjs:403-406 (unseen: spawns a copy of
    // this file and compares its child stdout). That test runs a copy of this file and expects the stdout
    // line "FAIL  H2a doctor probed a real tool set - 3 rows", printed here on a failure so the pin still
    // finds it however node:test's own reporter renders the same assertion.
    const pass = toolRows.length >= 5;
    console.log(`${pass ? 'PASS' : 'FAIL'}  H2a doctor probed a real tool set - ${toolRows.length} rows`);
    assert.ok(pass, `${toolRows.length} rows`);
  });

  test('H2b every PASS carries real evidence (version/path)', () => {
    const passRows = r.lines.filter((l) => l.startsWith('[PASS] tool'));
    const emptyDetail = passRows.filter((l) => l.trim().split(/\s{2,}/).length < 3);
    assert.deepEqual(emptyDetail, [], emptyDetail[0] || '');
  });

  test('H3 doctor exits 0/2, never crashes', () => {
    assert.ok(r.status === 0 || r.status === 2, `exit ${r.status}`);
  });
});
