// scripts/lib/validate/commit.js - V9, V10, V11 and V12, split from scripts/validate-alex.js.
//
// WHAT. Four legs bound to a project's or a commit's own lifecycle: V9 first-fire aging (a LIVE/EVENT
// project that has never fired, WARNING-only, plus a hard FAIL on a first_fire date in the future), V10
// the protected-file guard (the owner's own NEVER-TOUCH list enforced against the staged changeset), V11 the
// forced-add guard (a tracked-but-gitignored path, the `git add -f` class that publishes a secret on the
// public repo), and V12 the trifecta gate (a project with all three trifecta legs true must declare, and
// echo in its own CLAUDE.md, a mitigation gate from the fixed vocabulary). V10 and V11 are COMMIT-TIME
// ONLY: both are no-ops outside `context: 'pre-commit'` with `--changed`, so THIS FILE's only git
// commands run from those two legs; V21 (skills-json.js) runs `git ls-files` in every context, and V9's
// fallback below runs `git log` under CLAUDE_CODE_REMOTE, so generate-alex.js does read git elsewhere in
// the suite - just never through V10 or V11.
//
// HOW. evaluateProtectedChangeset(changeset, list) is the PURE half of V10, kept exported at the entry
// (scripts/validate-alex.js re-exports it from here) because test-protected-guard.js unit-tests it
// directly against synthetic changesets, with no git and no network. readStagedChangeset() builds that
// changeset from scripts/lib/staged-paths.js's stagedNameStatus() and stagedNumstat() (git.js's git()
// underneath, so a git failure is one clean thrown Error, never git's own stderr echoed to this
// process's stderr as well); called only from the pre-commit leg. V11 lists tracked-but-ignored paths
// the same way, through git() directly. V9's install-age fallback reads `git log --max-parents=0` but
// only under CLAUDE_CODE_REMOTE=true, in any context.
//
// NEVER. Runs a git command outside pre-commit context with --changed (V10, V11). Fails the build for a
// project that has never fired within its 14-day window, or for one with no created: date at all (V9's
// aging half is WARNING-only by rule). Lets git failure abort the run: V10 and V11 SKIP with a WARNING
// when git itself cannot answer.
//
// Usage: module only - const { evaluateProtectedChangeset, v10ProtectedFileGuard, ... } = require('./commit');
'use strict';
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const { REPO, effective, pad, mdSection } = require('./structure');
const { git } = require('../git');
const { stagedNameStatus, stagedNumstat } = require('../staged-paths');

// ---------------------------------------------------------------------------------------------
// V9 - first-fire aging: every LIVE/EVENT registry
//      row (numbered + meta.unnumbered) that has NEVER fired (first_fire null) is listed as a
//      WARNING - never a failure (the aging rule blocks nothing; it makes scaffold-masquerade
//      visible). The registry rule (manifest states_doc) allows 14 days from the project's
//      status.md frontmatter `created:` date; rows past that window are marked OVERDUE (check.ps1
//      C13 goes amber on the same condition). ON-DEMAND/DORMANT/PARKED/RETIRED are exempt by
//      rule - they have no promise to fire. A documented drill counts (first_fire_kind=drill).
// ---------------------------------------------------------------------------------------------
function v9FirstFireAging({ stagedDir, manifest }, failures, warnings) {
  const rows = [...manifest.projects, ...(manifest.meta?.unnumbered || [])];

  // (a) FUTURE first_fire = FAILURE. first_fire is the
  //     registry's proof-of-life record: "has this project ever actually produced for real". Both this
  //     check's aging half and check.ps1 C13 branch on first_fire being NULL, so a populated FUTURE date
  //     passes every check while asserting a fire that has not happened - the claim sits inside the
  //     structure but outside what the structure validates. It also permanently disables the 14-day
  //     aging clock, so a project that never fires can never be flagged. The design already makes
  //     honesty easy (first_fire_kind:"drill"
  //     lets a documented test run count AND be marked as such), so a future date is never the right answer.
  const today = new Date().toISOString().slice(0, 10);
  for (const p of rows) {
    if (!p.first_fire || !/^\d{4}-\d{2}-\d{2}$/.test(p.first_fire)) continue;
    if (p.first_fire > today) {
      const label = p.num != null ? `#${pad(p.num)} ${p.name}` : p.name;
      failures.push(
        `FAILED V9: ${label} has first_fire "${p.first_fire}", which is in the FUTURE (today ${today}) - first_fire records a fire that ALREADY happened; set the real date, or null to let the 14-day aging clock run (a documented drill counts, first_fire_kind=drill)`
      );
    }
  }

  // (b) aging half: never-fired LIVE/EVENT rows, WARNING only (the aging rule blocks nothing).
  //
  // THE CLOCK IS THE status.md `created:` DATE, AND AN ABSENT ONE IS NOT EVIDENCE. A row with no
  // created date must never be filed as OVERDUE, which reads as
  // a measurement and is not one: with no start date there is no elapsed time, and the check was
  // asserting a window it had not measured. The cost is not theoretical. /setup is what writes
  // `created:`, so on the FIRST day of any install not one project has a date, and every new owner
  // would open their brand new Alex to a list of projects "PAST the 14-day window" if this were not
  // guarded. A guard that cries on day one is a guard its owner learns to scroll past.
  //
  // So: an unknown date is reported as unknown, never as overdue, and a whole install younger than
  // the window it is measuring says nothing at all. Install age is the OLDEST created date in the
  // tree; a day-one install has none, and one set up last week has none older than 14 days.
  const WINDOW_DAYS = 14;
  const createdAge = (p) => {
    if (!p.status_md) return null;
    const st = effective(stagedDir, p.status_md);
    const m = st?.text.match(/^created:\s*(\d{4}-\d{2}-\d{2})/m);
    if (!m) return null;
    return Math.floor((Date.now() - new Date(`${m[1]}T00:00:00Z`).getTime()) / 86400000);
  };

  const flagged = [];
  let installAge = null;
  for (const p of rows) {
    const age = createdAge(p);
    if (age !== null && (installAge === null || age > installAge)) installAge = age;
    if (p.state !== 'LIVE' && p.state !== 'EVENT') continue;
    if (p.first_fire) continue;
    flagged.push({ label: p.num != null ? `#${pad(p.num)} ${p.name}` : p.name, ageDays: age });
  }
  if (flagged.length === 0) return;

  // No status page carries a created: date, so the pages cannot age the install; without a fallback
  // that leaves an install of ANY age silent forever. Two other clocks, each a
  // LOWER bound on the install's age, so neither can make a day-one install cry again:
  //   the install record's stamp date: the install is at least as old as the day it was last
  //     stamped, whatever the lane;
  //   online only, the repository's first commit: the owner's repository begins at install. On a
  //     laptop the first commit is the Kit's own history, weeks older than any install, so it is
  //     never read there.
  if (installAge === null) installAge = installAgeFallback(stagedDir);

  // A fresh install: nothing here has had time to fire, so there is nothing to say.
  if (installAge === null || installAge <= WINDOW_DAYS) return;

  const fmt = (f) => `${f.label} (${f.ageDays === null ? 'created date unknown' : `${f.ageDays}d since created`})`;
  const overdue = flagged.filter((f) => f.ageDays !== null && f.ageDays > WINDOW_DAYS);
  const within = flagged.filter((f) => f.ageDays !== null && f.ageDays <= WINDOW_DAYS);
  const undated = flagged.filter((f) => f.ageDays === null);
  if (overdue.length)
    warnings.push(
      `WARNING V9: LIVE/EVENT project(s) never fired (first_fire null) PAST the ${WINDOW_DAYS}-day window: ${overdue.map(fmt).join(', ')} - fire it (a documented drill counts, first_fire_kind=drill) or re-state it with a reason`
    );
  if (within.length)
    warnings.push(
      `WARNING V9: LIVE/EVENT project(s) never fired (first_fire null), still inside the ${WINDOW_DAYS}-day window: ${within.map(fmt).join(', ')}`
    );
  if (undated.length)
    warnings.push(
      `WARNING V9: LIVE/EVENT project(s) never fired (first_fire null) and with no created: date to age them against: ${undated.map((f) => f.label).join(', ')} - stamp created: in the status page, or fire it`
    );
}

// V9's install age when no status page is dated: the older of two lower bounds, or null. Never throws.
function installAgeFallback(stagedDir) {
  const dayAge = (d) => Math.floor((Date.now() - new Date(`${String(d).slice(0, 10)}T00:00:00Z`).getTime()) / 86400000);
  const ages = [];
  const st = effective(stagedDir, 'system/install-state.json');
  if (st) {
    try {
      const j = JSON.parse(st.text);
      const d = j.template_updated_at || j.updatedAt; // the legacy key reads too, as install-state.js does
      if (/^\d{4}-\d{2}-\d{2}/.test(String(d || ''))) ages.push(dayAge(d));
    } catch (_) {
      /* an unreadable record is no clock */
    }
  }
  if (process.env.CLAUDE_CODE_REMOTE === 'true') {
    try {
      const roots = execFileSync('git', ['log', '--max-parents=0', '--format=%cI', 'HEAD'], {
        cwd: REPO,
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'ignore']
      })
        .split(String.fromCharCode(10))
        .map((x) => x.trim())
        .filter((x) => /^\d{4}-\d{2}-\d{2}/.test(x));
      for (const r of roots) ages.push(dayAge(r));
    } catch (_) {
      /* no git here: the record alone decides */
    }
  }
  const valid = ages.filter((a) => Number.isFinite(a) && a >= 0);
  return valid.length ? Math.max(...valid) : null;
}

// ---------------------------------------------------------------------------------------------
// V10 - protected-file guard, enforcing the owner's own NEVER-TOUCH list at COMMIT TIME. A CHANGESET
//       question (git's staged diff), not a content question, so it reads git directly and runs ONLY
//       in pre-commit context with --changed (armed by scripts/hooks/pre-commit); a no-op in the
//       generator context, so generate-alex.js is untouched.
//
//       Rule per protected path (kinds: immutable | append-only | flagged):
//         - delete / rename-away of a protected path -> FAIL (immutable, append), WARNING (flagged)
//         - modify of an immutable path              -> FAIL
//         - modify of an append-only path            -> FAIL unless the staged diff is pure addition
//                                                       (numstat removed-lines == 0)
//         - modify of a flagged path                 -> WARNING
//         - add (new file), incl. under an immutable dir -> allowed
//       Override: git commit --no-verify (no custom flag).
//
//       V10_PROTECTED below is the canonical machine list. An owner may keep a human-readable mirror
//       of it in their own vault; if they do, the two are kept in sync by hand (short, low-churn set).
//
//       HONESTY NOTE: a commit guard can only see git-TRACKED files, and the two trees this product
//       ships disagree on which vault/** paths that is. In the Kit, vault/** as a whole is gitignored
//       (local-only), so a vault/** entry here NEVER appears in a staged diff - the guard cannot
//       enforce it at commit time; it is protected by policy and the owner's own backup instead, and
//       listed here (tracked:false) so the set stays canonical and the guard auto-covers it the day it
//       ever becomes tracked. Online only vault/.obsidian/ is gitignored, so a vault/** entry here IS
//       tracked there and the guard DOES enforce it. The one entry the guard ACTIVELY enforces on
//       BOTH trees today (tracked:true) is brand/config/color-system.md.
// ---------------------------------------------------------------------------------------------
const V10_PROTECTED = [
  { path: 'vault/sources/', kind: 'immutable', dir: true, tracked: false },
  { path: 'vault/log.md', kind: 'append', tracked: false },
  { path: 'vault/projects/self-review/close-out-log.md', kind: 'append', tracked: false },
  { path: 'outputs/ledger.jsonl', kind: 'append', tracked: false },
  { path: 'system/human-actions.jsonl', kind: 'append', tracked: false }, // one of the two queues the owner's list names as append-only
  { path: 'system/pending-writes.jsonl', kind: 'append', tracked: false }, // the other; kept here so the machine set matches the human one
  { path: 'vault/identity.md', kind: 'flagged', tracked: false },
  { path: 'brand/config/color-system.md', kind: 'flagged', tracked: true }
];

function matchProtected(rel, list = V10_PROTECTED) {
  const p = String(rel || '')
    .split(path.sep)
    .join('/');
  for (const entry of list) {
    if (entry.dir) {
      if (p === entry.path.replace(/\/$/, '') || p.startsWith(entry.path)) return entry;
    } else if (p === entry.path) return entry;
  }
  return null;
}

// PURE evaluator (unit-tested directly): changeset = [{status, path, oldPath?, removed}], status a
// single git letter (A/M/D/R/T/C); removed is the numstat removed-line count, read only for M - a type
// change (T, e.g. a protected file replaced by a symlink in the index) carries no such count and is
// judged exactly as a modify whose removed count is UNKNOWN, the same fail-closed branch a binary diff
// already takes.
function evaluateProtectedChangeset(changeset, list = V10_PROTECTED) {
  const failures = [],
    warnings = [];
  for (const ch of changeset) {
    const st = String(ch.status || '').toUpperCase();
    if (st === 'D' || st.startsWith('R')) {
      // judged on the path that LEAVES its protected home (old path for a rename)
      const gone = st.startsWith('R') ? ch.oldPath || ch.path : ch.path;
      const hit = matchProtected(gone, list);
      if (hit) {
        const verb = st === 'D' ? 'deletes' : 'renames away';
        const msg = `commit ${verb} protected ${hit.kind} path ${gone} (NEVER-TOUCH.md)`;
        if (hit.kind === 'flagged') warnings.push(`WARNING V10: ${msg} - surfaced, not blocked`);
        else failures.push(`FAILED V10: ${msg} - use 'git commit --no-verify' to override deliberately`);
      }
      continue;
    }
    if (st === 'M' || st === 'T') {
      const hit = matchProtected(ch.path, list);
      if (!hit) continue;
      if (hit.kind === 'immutable')
        failures.push(
          `FAILED V10: commit modifies immutable ${ch.path} (NEVER-TOUCH.md) - content is read-only; --no-verify to override`
        );
      else if (hit.kind === 'flagged')
        warnings.push(`WARNING V10: commit modifies flagged ${ch.path} (NEVER-TOUCH.md) - surfaced, not blocked`);
      else if (hit.kind === 'append') {
        const removed = st === 'T' ? NaN : Number(ch.removed);
        if (!Number.isFinite(removed) || removed > 0)
          failures.push(
            `FAILED V10: commit modifies append-only ${ch.path} with ${Number.isFinite(removed) ? removed : 'non-text/unknown'} removed line(s) (NEVER-TOUCH.md) - append-only files may only grow; --no-verify to override`
          );
      }
    }
    // A (add) and any other status: allowed
  }
  return { failures, warnings };
}

// Reads git's staged changeset (name-status + numstat, both through staged-paths.js's git()). Only
// called in pre-commit context, so git shelling never happens on the generator path.
function readStagedChangeset() {
  const changeset = stagedNameStatus({ cwd: REPO });
  const removedByPath = stagedNumstat({ cwd: REPO }); // modified files only; rename records skipped (those FAIL via name-status)
  for (const ch of changeset)
    if (ch.status === 'M') ch.removed = removedByPath.has(ch.path) ? removedByPath.get(ch.path) : '0';
  return changeset;
}

function v10ProtectedFileGuard({ context, changed }, failures, warnings) {
  if (context !== 'pre-commit' || !changed) return; // armed only by the commit hook
  let changeset;
  try {
    changeset = readStagedChangeset();
  } catch (e) {
    warnings.push(`WARNING V10 SKIPPED: could not read the staged changeset via git - ${e.message}`);
    return;
  }
  const res = evaluateProtectedChangeset(changeset);
  for (const f of res.failures) failures.push(f);
  for (const w of res.warnings) warnings.push(w);
}

// V11 - the forced-add guard. COMMIT-TIME ONLY.
// Lists every tracked-but-ignored path: a `git add -f` of a .gitignore'd file. On the PUBLIC repo where
// .gitignore is the SOLE privacy barrier, one forced-added secret pushed at 21:30 is world-visible and
// permanently cacheable even after deletion. This is the machine behind .gitignore's own "rotate it
// immediately" line, fired at the only cadence that beats the nightly push: commit time. It lists ALL
// such paths (not just this commit's), so a historical forced add surfaces on the next commit too.
// The hook wrapper (scripts/hooks/pre-commit) fires this on interactive AND nightly-backup commits.
function v11IgnoredStagedGuard({ context, changed }, failures, warnings) {
  if (context !== 'pre-commit' || !changed) return; // armed only by the commit hook
  let out;
  try {
    out = git(['ls-files', '--cached', '--ignored', '--exclude-standard'], { cwd: REPO, encoding: 'utf8' });
  } catch (e) {
    warnings.push(`WARNING V11 SKIPPED: could not list tracked-vs-ignored paths via git - ${e.message}`);
    return;
  }
  const paths = out
    .split('\n')
    .map((s) => s.trim())
    .filter(Boolean);
  if (paths.length) {
    failures.push(
      `FAILED V11: ${paths.length} gitignored path(s) are TRACKED (a forced 'git add -f' of an ignored file). ` +
        `On the PUBLIC repo this PUBLISHES them at the next push: ${paths.join(', ')}. ` +
        `Fix: 'git rm --cached <path>' (keeps the local file) or correct .gitignore. ` +
        `Deliberate override: 'git commit --no-verify'.`
    );
  }
}

// V12 - the trifecta gate. Pure file checks, no network.
// The agent-security Rule-of-Two made a validated invariant. Each manifest project carries a
// `trifecta` block {private_data, untrusted_content, external_comm} (raw capability/exposure) + a
// `gate` (the mitigation). Rule: any project with ALL THREE legs true MUST declare a non-null gate
// from the vocab, and that gate string MUST appear on a `## Trifecta` line in its work/NN/CLAUDE.md.
// Any declared gate (even without all three) must be in the vocab and echoed in its CLAUDE.md.
// This drops the read-only-vs-write integrations assertion (the manifest carries no
// integrations data). meta.trifecta_doc holds the vocab + rules; vault/research/trifecta-map.md the map.
const TRIFECTA_GATES = new Set(['draft-only', 'human-posts', 'queue-only', 'read-only']);
function v12TrifectaGate({ stagedDir, manifest }, failures, warnings) {
  for (const p of manifest.projects) {
    const t = p.trifecta;
    if (!t) {
      warnings.push(
        `WARNING V12: project ${pad(p.num)} ${p.title} has no trifecta block - classify it in system/manifest.json`
      );
      continue;
    }
    const allThree = t.private_data && t.untrusted_content && t.external_comm;
    const hasGate = t.gate != null && t.gate !== '';
    // (a) all three legs true => a non-null gate is mandatory
    if (allThree && !hasGate) {
      failures.push(
        `FAILED V12: project ${pad(p.num)} ${p.title} has all three trifecta legs true but no gate - it MUST declare one of {${[...TRIFECTA_GATES].join(', ')}}`
      );
      continue;
    }
    // (b) any declared gate must be in the vocab
    if (hasGate && !TRIFECTA_GATES.has(t.gate)) {
      failures.push(
        `FAILED V12: project ${pad(p.num)} ${p.title} declares gate "${t.gate}" not in the vocab {${[...TRIFECTA_GATES].join(', ')}}`
      );
      continue;
    }
    // (c) a declared gate must appear in a `## Trifecta` section of the project's work/NN/CLAUDE.md
    if (hasGate) {
      if (!p.work_dir) {
        failures.push(
          `FAILED V12: project ${pad(p.num)} ${p.title} declares gate "${t.gate}" but has no work_dir to hold its ## Trifecta line`
        );
        continue;
      }
      const rel = `${p.work_dir.replace(/\\/g, '/')}/CLAUDE.md`;
      const cm = effective(stagedDir, rel);
      if (!cm) {
        failures.push(
          `FAILED V12: project ${pad(p.num)} ${p.title} declares gate "${t.gate}" but ${rel} was not found`
        );
        continue;
      }
      const sec = mdSection(cm.text, /^##\s+Trifecta\b/m);
      if (sec === null) {
        failures.push(
          `FAILED V12: ${rel} is missing a "## Trifecta" section (project ${pad(p.num)} declares gate "${t.gate}")`
        );
        continue;
      }
      // The gate must appear on a `Gate:` DECLARATION line, not merely somewhere in the section: a
      // substring match over the whole section cannot tell a declaration from a prose mention or an
      // explanation of a DIFFERENT project's gate. Every spec already writes `Gate: **<gate>**` or
      // unbolded, so requiring the declaration line costs nothing and closes the hole. The failure
      // text below is pinned by test-validate-known-bad-shipped.mjs; its wording is a pin, not a
      // free choice.
      const gateLine = sec
        .split(/\r?\n/)
        .some((l) =>
          new RegExp(`\\bGate:\\s*\\**\\s*${t.gate.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i').test(l)
        );
      if (!gateLine)
        failures.push(
          `FAILED V12: the "## Trifecta" section of ${rel} has no "Gate: ${t.gate}" declaration line (a passing mention elsewhere in the section does not count, tightened 2026-07-29)`
        );
    }
  }
}

module.exports = {
  V10_PROTECTED,
  matchProtected,
  evaluateProtectedChangeset,
  readStagedChangeset,
  v9FirstFireAging,
  v10ProtectedFileGuard,
  v11IgnoredStagedGuard,
  v12TrifectaGate
};
