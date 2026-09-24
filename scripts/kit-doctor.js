#!/usr/bin/env node
'use strict';
/*
 * scripts/kit-doctor.js - is this Alex install healthy, and can it fix itself? (P6.1/P6.2.)
 *
 * WHO THIS IS FOR. Two people who are not developers run their own copies of Alex on their own
 * machines. When something drifts there is currently no way for them to find out, and no way for
 * anyone to help them except over the phone. The constitution names the trap directly: soul.md is
 * gitignored, so `git pull` delivers tracked files only, and any identity or voice improvement
 * arrives ONLY through a migration - which means a migration that silently fails to run leaves an
 * install quietly behind forever, looking completely normal.
 *
 * WHAT IT CHECKS. Only things that are actually true or false, never opinions:
 *   - the identity file exists and is not the empty template
 *   - the skill links match this machine's setup (template lock + install profile, one resolver)
 *   - every migration that shipped has actually run here
 *   - the update record (system/install-state.json) exists and matches the commit
 *   - core files are present (per-platform launcher pair)
 *
 * WHAT REPAIR TOUCHES. Only what install-state recorded: rebuild dropped skill links, re-run
 * migrations that never ran. It never edits soul.md and never overwrites anything personal -
 * a repair that could damage the thing it protects is not a repair.
 *
 * Zero dependencies, read-only unless --repair, and it prints plain English on purpose.
 *
 *   node scripts/kit-doctor.js            check and report
 *   node scripts/kit-doctor.js --repair   fix what is safely fixable (dry-run first)
 *   node scripts/kit-doctor.js --json     machine-readable
 */
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');

// Launchers are per-platform: .cmd on Windows, .command on macOS. ONE source for the whole file
// (hoisted 2026-09-20). checkCoreFiles already derived this correctly and carried the comment
// explaining why; checkIdentity did not, and told a Mac owner to run Install-Alex.cmd, a file that
// does not exist on their machine, on every check until /setup runs. Two private derivations of the
// same fact is how one of them goes stale, so there is now one.
const LAUNCHER_EXT = process.platform === 'darwin' ? '.command' : '.cmd';
const MIGRATIONS = path.join(ROOT, 'scripts', 'migrations');
// The version record has ONE reader and ONE writer: scripts/lib/install-state.js. Before that
// library existed four places wrote it in two key sets, and an online install ended up carrying
// both of them at once (2026-09-23).
const installState = require('./lib/install-state.js');

const REPAIR = process.argv.includes('--repair');
const JSON_OUT = process.argv.includes('--json');
const APPLY = process.argv.includes('--apply');

const findings = [];
const add = (level, what, detail, fixable = false) => findings.push({ level, what, detail, fixable });

function sh(cmd, args) {
  try { return execFileSync(cmd, args, { cwd: ROOT, encoding: 'utf8' }).trim(); } catch (_) { return null; }
}

function readState() {
  return installState.read(ROOT);
}

// ---- checks -------------------------------------------------------------------------------------

function checkIdentity() {
  const soul = path.join(ROOT, 'soul.md');
  if (!fs.existsSync(soul)) {
    add('ERROR', 'Your identity file is missing', `soul.md is not here. Alex will not sound like you. Run Install-Alex${LAUNCHER_EXT}, or restore soul.md from your own backup.`);
    return;
  }
  const bytes = fs.statSync(soul).size;
  if (bytes < 2000) {
    add('WARN', 'Your identity file looks like the blank template', `soul.md is only ${bytes} bytes. That usually means the setup never finished. Open Alex and run /setup.`);
  } else {
    add('OK', 'Identity file present', `soul.md, ${(bytes / 1024).toFixed(1)} KB`);
  }
}

function checkSkillLinks() {
  const agents = path.join(ROOT, '.agents', 'skills');
  const links = path.join(ROOT, '.claude', 'skills');
  if (!fs.existsSync(agents)) { add('OK', 'No skills to link', 'This copy ships no bundled skills.'); return; }
  // The awake/parked answer comes from the ONE shared resolver (lock + this machine's profile +
  // the MANDATORY floor) - a doctor reading the lock directly would call a profile-parked skill
  // "not connected" and teach the owner to ignore it (2026-08-31, Phase 2).
  let state;
  try {
    state = require('./lib/skill-state').resolve({ root: ROOT });
  } catch (e) {
    add('ERROR', 'Skill configuration is inconsistent', e.message, false);
    return;
  }
  const have = fs.readdirSync(agents, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name);
  const realMissing = have.filter((n) => !state.parked.has(n) && !fs.existsSync(path.join(links, n)));
  const surplus = have.filter((n) => state.parked.has(n) && fs.existsSync(path.join(links, n)));
  if (realMissing.length || surplus.length) {
    const bits = [];
    if (realMissing.length) bits.push(`${realMissing.length} not connected (Alex will not find: ${realMissing.slice(0, 5).join(', ')}${realMissing.length > 5 ? ', ...' : ''})`);
    if (surplus.length) bits.push(`${surplus.length} connected that should be parked`);
    add('ERROR', 'Skill links do not match this machine\'s setup', bits.join('; '), true);
  } else {
    add('OK', 'Skills connected', `${state.awake.size} active, ${state.parked.size} deliberately parked`);
  }
}

function checkMigrations() {
  if (!fs.existsSync(MIGRATIONS)) { add('OK', 'No setup steps to run', ''); return; }
  const shipped = fs.readdirSync(MIGRATIONS).filter((f) => /^\d+.*\.js$/.test(f)).sort();
  // THE LEDGER IS run-migrations.js's OWN FILE, deliberately: system/migrations-applied.json,
  // shape {applied:[{id,...}]}. A doctor that invents its own bookkeeping would eventually disagree
  // with the runner and report a false problem, which on a non-developer's machine is worse than no
  // doctor at all. Read the same file the runner writes, and only that file.
  let ran = new Set();
  try {
    const led = path.join(ROOT, 'system', 'migrations-applied.json');
    if (fs.existsSync(led)) {
      const j = JSON.parse(fs.readFileSync(led, 'utf8'));
      ran = new Set((j.applied || []).map((a) => (typeof a === 'string' ? a : a.id)));
    }
  } catch (_) { /* unreadable ledger = treat as nothing applied, which errs toward telling them */ }
  // Ids in the ledger are the migration id; shipped files are `001-name.js`. Match on either shape.
  const pending = shipped.filter((m) => !ran.has(m) && !ran.has(m.replace(/\.js$/, '')));
  if (pending.length) {
    add('ERROR', `${pending.length} improvement(s) never arrived`, `These change files git cannot deliver (your identity file is deliberately private). Not yet applied: ${pending.join(', ')}`, true);
  } else {
    add('OK', 'All improvements applied', `${shipped.length} setup step(s) have run here`);
  }
}

function checkVersion() {
  // Since 2026-08-31 the machine-local record is system/install-state.json (gitignored), written
  // by Update-Alex on every run. The tracked VERSION file is upstream's RELEASE marker only and
  // is never compared against the live head here - it was locally stamped before, which kept the
  // tree permanently dirty and armed a stash-pop dead end (the VERSION bug, fixed in the same
  // release that shipped this line).
  const head = sh('git', ['rev-parse', 'HEAD']);
  const state = readState();
  if (!state || !state.template_commit) {
    add('WARN', 'No update record yet', 'This copy cannot say when it last updated. Run the updater once to write the record.', true);
    return;
  }
  // On a laptop the checkout IS the template clone, so its HEAD is the version it carries and this
  // comparison means something. This doctor never runs online, where the repository HEAD is the
  // owner's own autosave: the launchers that call it are drop rows in the online tree.
  if (head && state.template_commit !== head) {
    add('WARN', 'Update record is out of date', `Recorded ${String(state.template_commit).slice(0, 12)} on ${state.template_updated_at || '?'}, actually on ${head.slice(0, 12)}. Harmless; the next update re-stamps it.`, true);
  } else {
    add('OK', 'Version', `${state.template_updated_at || '?'} ${String(state.template_commit).slice(0, 12)}`);
  }
}

function checkCoreFiles() {
  // Launchers are per-platform: .cmd on Windows, .command on macOS. Requiring the Windows pair
  // on a Mac made the doctor call a healthy install broken and point at a file that does not
  // exist there ("Re-download with Update-Alex.cmd") - the exact way a doctor teaches its owner
  // to ignore it (2026-08-31, Phase 2).
  const launcherExt = LAUNCHER_EXT;
  const updater = `Update-Alex${launcherExt}`;
  const need = ['CLAUDE.md', `Start-Here${launcherExt}`, updater, 'scripts/run-migrations.js'];
  const missing = need.filter((f) => !fs.existsSync(path.join(ROOT, f)));
  if (missing.length) add('ERROR', 'Core files missing', `Alex cannot run without: ${missing.join(', ')}. Re-download with ${updater}.`);
  else add('OK', 'Core files present', `${need.length} checked`);
}

// ---- repair -------------------------------------------------------------------------------------

function repair() {
  const fixable = findings.filter((f) => f.fixable && f.level !== 'OK');
  if (!fixable.length) { console.log('\nNothing to repair.'); return 0; }
  if (!APPLY) {
    console.log('\nWhat repair WOULD do (dry run - add --apply to actually do it):');
    for (const f of fixable) console.log(`  - ${f.what}`);
    return 0;
  }
  console.log('\nRepairing:');
  for (const f of fixable) {
    if (/Skill links/.test(f.what)) {
      // One repair path on every platform: the node doctor (2026-08-31; was a powershell
      // shell-out, which no Mac has).
      const r = sh(process.execPath, [path.join(ROOT, 'scripts', 'bootstrap.mjs'), '--repair-links']);
      console.log(`  - reconnecting skills: ${r === null ? 'FAILED (tell whoever set this up for you)' : 'done'}`);
    } else if (/never arrived/.test(f.what)) {
      const r = sh(process.execPath, [path.join(ROOT, 'scripts', 'run-migrations.js')]);
      console.log(`  - applying improvements: ${r === null ? 'FAILED (tell whoever set this up for you)' : 'done'}`);
    } else if (/update record/i.test(f.what)) {
      stampState();
      console.log('  - update record written');
    }
  }
  console.log('\nRe-run `node scripts/kit-doctor.js` to confirm.');
  return 0;
}

function stampState() {
  const head = sh('git', ['rev-parse', 'HEAD']);
  if (!head) return;   // no answer from git, no record: a made-up version is worse than none
  installState.stamp(ROOT, head, { by: 'kit-doctor --repair' });
}

// ---- main ---------------------------------------------------------------------------------------

checkCoreFiles();
checkIdentity();
checkSkillLinks();
checkMigrations();
checkVersion();

const errors = findings.filter((f) => f.level === 'ERROR');
const warns = findings.filter((f) => f.level === 'WARN');

if (JSON_OUT) {
  console.log(JSON.stringify({ ok: errors.length === 0, errors: errors.length, warnings: warns.length, findings }, null, 2));
} else {
  console.log('\n  Alex health check\n  ' + '-'.repeat(50));
  for (const f of findings) {
    const mark = f.level === 'OK' ? '  ok  ' : f.level === 'WARN' ? ' warn ' : ' PROBLEM ';
    console.log(`  [${mark}] ${f.what}`);
    if (f.detail) console.log(`           ${f.detail}`);
  }
  console.log('  ' + '-'.repeat(50));
  if (!errors.length && !warns.length) console.log('  Everything looks right.');
  else console.log(`  ${errors.length} problem(s), ${warns.length} warning(s).` + (findings.some((f) => f.fixable) ? ' Most of this fixes itself: run\n  node scripts/kit-doctor.js --repair --apply' : ' Send this screen to whoever set this up for you.'));
}

if (REPAIR) repair();
process.exit(errors.length ? 2 : 0);
