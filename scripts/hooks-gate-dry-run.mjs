#!/usr/bin/env node
// scripts/hooks-gate-dry-run.mjs - answer one question without changing anything:
//
//   "If I switch the commit gate on in this install, will the next save be refused?"
//
// WHAT. It builds a THROWAWAY git index in the system temp directory holding exactly what an
// autosave would stage, then runs the real `scripts/hooks/pre-commit` against that index. It is the
// gate itself deciding, not an imitation of it, so there is nothing here to drift out of date.
//
// WHY. `node scripts/bootstrap.mjs --repair-links` now sets `git config core.hooksPath scripts/hooks`,
// and Install-Alex and Update-Alex both call it. On an install where nobody ever ran that line by
// hand, the pre-commit gate has never run once, and the first update that sets it puts a BLOCKING
// gate in front of every save from then on. The gate refuses on a credential shape, a colleague's
// address at an employer domain, personal data, donor identity left over from a clone, and a red
// validator. Any one of those already sitting in a family install turns the next ordinary save into
// a refusal, on a laptop, for someone who does not read code and did not ask for a new gate.
// So it gets measured first, on a laptop that can afford the answer.
//
// ------------------------------------------------------------------------------------------------
// HOW. Run it, and read what a good result looks like:
//
//   1. On the test laptop, open the Alex folder in a terminal.
//   2. Run:  node scripts/hooks-gate-dry-run.mjs
//   3. Read the last block. It says one of three things.
//
//   GREEN, "the gate would let this save through". Turning the gate on is safe for this install.
//   Nothing else to do.
//
//   RED, "the gate would REFUSE this save". The lines above it name the file and the reason. Do not
//   turn the gate on for that install until the named thing is dealt with, because their next
//   ordinary save would be refused and they would have no idea why.
//
//   GREY, "could not measure". Something needed was missing (git, a shell, the hook file). Nothing
//   was learned and nothing was changed. The line says which piece was absent.
//
// Exit codes: 0 would pass - 2 would be refused - 1 could not measure.
// ------------------------------------------------------------------------------------------------
//
// NEVER. It never sets core.hooksPath, never stages anything in this repository, never commits,
// never pushes, and never edits a file. The repository's own index is read at the start and at the
// end and the two readings are compared, so the claim is checked rather than asserted. What it DOES
// write: `git add` into the throwaway index stores each new file's content as a loose object under
// .git/objects, exactly as a real save would; nothing points at those objects and git's own garbage
// collection removes them. The throwaway directory is removed on every exit, including an early one.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
// Forward slashes on purpose: this string is printed to an owner who may be on a Mac, and git and
// the shell both take it on Windows too.
const HOOK_REL = 'scripts/hooks/pre-commit';

const say = (m = '') => console.log(m);
const git = (args, env = {}) =>
  spawnSync('git', args, { cwd: REPO, encoding: 'utf8', env: { ...process.env, ...env } });

function giveUp(why) {
  say('');
  say('GREY  Could not measure.');
  say(`      ${why}`);
  say('      Nothing was changed, and nothing was learned. Fix the missing piece and run it again.');
  process.exit(1);
}

// A fingerprint of this repository's own index, so "nothing was staged" is checked, not claimed.
function indexFingerprint() {
  const f = path.join(REPO, '.git', 'index');
  if (!fs.existsSync(f)) return 'absent';
  return crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex');
}

// The hook is a POSIX shell script. macOS and Linux have sh; on Windows it comes with Git.
function findShell() {
  const probe = spawnSync('sh', ['-c', 'exit 0'], { encoding: 'utf8' });
  if (!probe.error && probe.status === 0) return 'sh';
  for (const p of ['C:/Program Files/Git/bin/sh.exe', 'C:/Program Files (x86)/Git/bin/sh.exe']) {
    if (fs.existsSync(p)) return p;
  }
  return null;
}

say('Alex commit-gate dry run');
say('Nothing you would see is changed by this: no file, no setting, no save. It reads, it reports,');
say('it stops. (git stores the content it reads as unreferenced objects, which git later cleans up.)');
say('');

// ---------------------------------------------------------------- 1. where are we
const top = git(['rev-parse', '--show-toplevel']);
if (top.error || top.status !== 0) giveUp('git is not available here, or this folder is not a git repository.');
say(`  Folder      ${REPO}`);
say(`  Platform    ${process.platform}`);

if (!fs.existsSync(path.join(REPO, HOOK_REL))) {
  giveUp(`${HOOK_REL} is not in this folder, so there is no gate to test. This install is older than the gate.`);
}

// ---------------------------------------------------------------- 2. is the gate on already
const hpRaw = git(['config', '--get', 'core.hooksPath']);
const hp = (hpRaw.stdout || '').trim();
const gateLive = hp === 'scripts/hooks';
say(`  Gate now    ${gateLive ? 'ON (core.hooksPath is scripts/hooks)' : hp ? `pointing elsewhere: ${hp}` : 'OFF (core.hooksPath is not set)'}`);
if (gateLive) {
  say('');
  say('  Note: the gate is already on in this install, so nothing would change by switching it on.');
  say('  The run below still tells you whether the next save would pass.');
}

// ---------------------------------------------------------------- 3. what a save would stage
const shell = findShell();
if (!shell) giveUp('no POSIX shell was found. On Windows, run this from Git Bash. On a Mac this should not happen.');

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'alex-gate-dryrun-'));
// On EVERY exit, including giveUp() below: process.exit() skips a finally block, and the two early
// exits between here and the end used to leave this directory behind (fleet Fix C, review F33).
process.on('exit', () => { try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch { /* best effort */ } });
const tmpIndex = path.join(tmpDir, 'index');
const withTmp = { GIT_INDEX_FILE: tmpIndex };

const before = indexFingerprint();

const seed = git(['read-tree', 'HEAD'], withTmp);
if (seed.status !== 0) giveUp(`could not read this repository's last commit: ${(seed.stderr || '').trim()}`);
// Exactly what an autosave stages: everything git is willing to track. Ignored files stay out,
// because .gitignore is what keeps them out at commit time too.
const stage = git(['add', '-A'], withTmp);
if (stage.status !== 0) giveUp(`could not build the test list: ${(stage.stderr || '').trim()}`);

const names = git(['diff', '--cached', '--name-only'], withTmp);
const staged = (names.stdout || '').split('\n').map((s) => s.trim()).filter(Boolean);
say(`  Would save  ${staged.length} file(s)`);
say('');

// ---------------------------------------------------------------- 4. let the real gate decide
say('  Running the real gate against that list...');
say('');
const run = spawnSync(shell, [HOOK_REL], {
  cwd: REPO,
  encoding: 'utf8',
  env: { ...process.env, ...withTmp },
});
const out = `${run.stdout || ''}${run.stderr || ''}`.trimEnd();
for (const line of out.split('\n')) say(`    ${line}`);

// ---------------------------------------------------------------- 5. prove we changed nothing
const after = indexFingerprint();
fs.rmSync(tmpDir, { recursive: true, force: true });

const hpAfter = (git(['config', '--get', 'core.hooksPath']).stdout || '').trim();
const untouched = before === after && hpAfter === hp;

say('');
say('  ----------------------------------------------------------------');
say(`  Checked afterwards: this repository's staged list ${before === after ? 'is unchanged' : 'CHANGED, which should not happen'}, ` +
  `and the gate setting ${hpAfter === hp ? 'is unchanged' : 'CHANGED, which should not happen'}.`);
if (!untouched) {
  say('  Send this whole screen to whoever set this up before doing anything else.');
}

say('');
if (run.error) {
  giveUp(`the gate could not be started: ${run.error.message}`);
} else if (run.status === 0) {
  if (staged.length === 0) {
    // Nothing was staged, so no content was scanned: the gate only proved it can start. That is a
    // weaker answer than a GREEN over real files, and it is said as one.
    say('  GREEN  The gate would let this save through, but there was nothing to save:');
    say('         0 files were measured, so this proves the gate starts, not that your files pass.');
    say('         Run it again after the next change, and read that result.');
  } else {
    say('  GREEN  The gate would let this save through.');
    say('         Switching it on is safe for this install. Nothing else to do.');
  }
  process.exit(untouched ? 0 : 1);
} else {
  say('  RED    The gate would REFUSE this save.');
  say('         The lines above name the file and the reason. Do not switch the gate on for this');
  say('         install until that is dealt with: the next ordinary save would be refused, on');
  say('         their laptop, with no explanation they can act on.');
  process.exit(2);
}
