'use strict';
/*
 * scripts/skills-park.js - S1 Compiled Surfaces P4 (2026-08-16): park/wake skills by JUNCTION.
 *
 * Parking removes ONLY the `.claude/skills/<name>` link; the content in `.agents/skills/`
 * is never touched, stays git-tracked, and the skills-lock.json row is marked `parked: true`
 * (+ parkedAt) so S7's hash sweep and the #25 installer know the state is deliberate.
 * Waking re-links through scripts/lib/skill-state.js linkSkill(), the ONE link writer this Kit
 * has - a junction on Windows (no elevation), a RELATIVE symlink everywhere else so a moved or
 * re-cloned tree keeps working links (2026-08-31, macOS port: the old `cmd /c mklink /J`
 * shell-out and `rmdirSync` both died on a Mac - no cmd.exe, and rmdir on a symlink throws
 * ENOTDIR; 2026-09-23: the absolute target died with the first online install).
 * V17 fails the build if a MANDATORY-bound skill is ever parked - built BEFORE this script
 * so parking can never break a binding.
 *
 * TWO WRITE TARGETS since 2026-08-31 (Phase 2, the per-install profile layer):
 *   default        park/wake edits system/install-profile.json (gitignored, machine-local) and
 *                  fixes the links to match. This is what an INSTALLED copy uses: the tracked
 *                  lock never changes, so Update-Alex can never conflict on a personal choice.
 *   --lock         park/wake edits skills-lock.json (tracked) - TEMPLATE DEVELOPMENT ONLY,
 *                  changing the shipped default for every install.
 * The effective awake/parked answer always comes from scripts/lib/skill-state.js (lock +
 * profile + the MANDATORY floor); parking a MANDATORY-bound skill is refused up front.
 *
 * Usage:
 *   node scripts/skills-park.js --park name1,name2,...   park (link rm + profile/lock flag)
 *   node scripts/skills-park.js --wake name1,name2,...   wake (re-link + profile/lock flag)
 *   node scripts/skills-park.js --list                   show effective counts + parked names
 *   add --lock to write the template default instead of this machine's profile
 * Every mutation runs under the shared repo-surface write-lock (skills-lock.json is a shared
 * surface with the installer) and is read-back verified.
 */
const fs = require('fs');
const path = require('path');

const REPO = path.join(__dirname, '..');
const LOCK = path.join(REPO, 'skills-lock.json');
const LINKS = path.join(REPO, '.claude', 'skills');
const STORE = path.join(REPO, '.agents', 'skills');
const skillState = require('./lib/skill-state');
const installProfile = require('./lib/install-profile');
const PROFILE = path.join(REPO, skillState.PROFILE_REL);

function readLock() { return JSON.parse(fs.readFileSync(LOCK, 'utf8')); }
function readProfileFile() {
  try { return JSON.parse(fs.readFileSync(PROFILE, 'utf8')); }
  catch { return { wake: [], park: [], lanes: {}, locale: 'en' }; }
}
// Through the profile's one writer (scripts/lib/install-profile.js), so the file comes out in the
// JSON standard's shape with its header, and an old headerless profile keeps every note it carried
// (fleet Fix D, F11). It used to be a raw JSON.stringify here.
function writeProfileFile(p) {
  installProfile.writeProfile(REPO, p);
}
// Remove a skill LINK without ever touching the target content. lstat sees the link itself:
// a symlink (POSIX or Windows) unlinks; a Windows junction registers as a directory to lstat,
// where rmdir removes only the reparse point. A real directory full of content is refused -
// rmdir fails non-empty, and that failure is correct (something replaced the link; investigate).
function removeLink(link) {
  let st;
  try { st = fs.lstatSync(link); } catch { return; } // absent = nothing to remove
  if (st.isSymbolicLink()) fs.unlinkSync(link);
  else fs.rmdirSync(link);
}
function writeLock(l) { fs.writeFileSync(LOCK, JSON.stringify(l, null, 2) + '\n', 'utf8'); }
function linkPath(n) { return path.join(LINKS, n); }
function isLive(n) { try { fs.readFileSync(path.join(linkPath(n), 'SKILL.md')); return true; } catch { return false; } }

function park(names, lockMode) {
  const lock = readLock();
  const mandatory = skillState.parseMandatory(REPO);
  const done = [], skipped = [];
  const profile = lockMode ? null : readProfileFile();
  for (const n of names) {
    if (!lock.skills[n]) { skipped.push(`${n} (not in lock)`); continue; }
    if (!fs.existsSync(path.join(STORE, n))) { skipped.push(`${n} (no .agents/skills content - refusing)`); continue; }
    if (mandatory.has(n)) { skipped.push(`${n} (MANDATORY-bound, refusing to park)`); continue; }
    removeLink(linkPath(n)); // removes the LINK only, target untouched, both platforms
    if (lockMode) {
      lock.skills[n].parked = true;
      lock.skills[n].parkedAt = new Date().toISOString();
    } else {
      profile.park = Array.from(new Set([...(profile.park || []), n]));
      profile.wake = (profile.wake || []).filter(x => x !== n);
    }
    done.push(n);
  }
  if (lockMode) writeLock(lock); else writeProfileFile(profile);
  // read-back verify: link gone + content intact + effective state parked (via the resolver)
  const eff = skillState.resolve({ root: REPO });
  const bad = done.filter(n => fs.existsSync(linkPath(n)) || !fs.existsSync(path.join(STORE, n, 'SKILL.md')) || !eff.parked.has(n));
  if (bad.length) throw new Error(`park verify FAILED for: ${bad.join(', ')}`);
  console.log(`parked ${done.length} in ${lockMode ? 'the template LOCK' : 'this machine\'s profile'} (link removed, content untouched)${skipped.length ? `; skipped: ${skipped.join('; ')}` : ''}`);
}

function wake(names, lockMode) {
  const lock = readLock();
  const done = [], skipped = [];
  const profile = lockMode ? null : readProfileFile();
  for (const n of names) {
    if (!fs.existsSync(path.join(STORE, n))) { skipped.push(`${n} (no content)`); continue; }
    if (!fs.existsSync(linkPath(n))) {
      fs.mkdirSync(LINKS, { recursive: true }); // fresh clone: the gitignored link dir may not exist
      skillState.linkSkill(LINKS, STORE, n);    // the ONE link writer; relative target off Windows
    }
    if (lockMode) {
      if (lock.skills[n]) { delete lock.skills[n].parked; delete lock.skills[n].parkedAt; }
    } else {
      profile.wake = Array.from(new Set([...(profile.wake || []), n]));
      profile.park = (profile.park || []).filter(x => x !== n);
    }
    done.push(n);
  }
  if (lockMode) writeLock(lock); else writeProfileFile(profile);
  const eff = skillState.resolve({ root: REPO });
  const bad = done.filter(n => !isLive(n) || eff.parked.has(n));
  if (bad.length) throw new Error(`wake verify FAILED for: ${bad.join(', ')}`);
  console.log(`woke ${done.length} in ${lockMode ? 'the template LOCK' : 'this machine\'s profile'} (link verified live)${skipped.length ? `; skipped: ${skipped.join('; ')}` : ''}`);
}

function list() {
  const eff = skillState.resolve({ root: REPO });
  const total = eff.awake.size + eff.parked.size;
  const profile = skillState.readProfile(REPO);
  console.log(`skills: ${total} total, ${eff.awake.size} awake, ${eff.parked.size} parked (effective = lock${profile ? ' + this machine\'s profile' : ', no profile'})`);
  if (eff.parked.size) console.log('parked: ' + Array.from(eff.parked).sort().join(', '));
  for (const w of eff.warnings) console.log('WARN ' + w);
  const orphans = Array.from(eff.awake).filter(n => !isLive(n));
  if (orphans.length) console.log('WARN awake-but-dead links (run: node scripts/bootstrap.mjs --repair-links): ' + orphans.join(', '));
}

const argv = process.argv.slice(2);
const get = flag => { const a = argv.find(x => x.startsWith(flag + '=')) || (argv.includes(flag) ? argv[argv.indexOf(flag) + 1] : null); return a && a.startsWith(flag) ? a.split('=')[1] : a; };

const writeLockLib = require('./lib/write-lock');
(async () => {
  if (argv.includes('--list') || argv.length === 0) return list();
  const names = (get('--park') || get('--wake') || '').split(',').map(s => s.trim()).filter(Boolean);
  if (!names.length) { console.error('usage: skills-park --park a,b | --wake a,b | --list'); process.exitCode = 1; return; }
  const held = writeLockLib.acquire({ label: 'skills-park' });
  if (!held.ok) { console.error(`skills-park: write lock busy (${held.reason})`); process.exitCode = 2; return; }
  const lockMode = argv.includes('--lock');
  try {
    if (argv.some(a => a.startsWith('--park'))) park(names, lockMode); else wake(names, lockMode);
    process.exitCode = 0;
  } catch (e) { console.error(`skills-park FAILED: ${e.message}`); process.exitCode = 1; }
  finally { held.release(); }
})();
