// scripts/lib/validate/skills-json.js - V16, V17 and V21, split from scripts/validate-alex.js.
//
// WHAT. Three legs adjacent in the pre-split file and adjacent in what they guard: V16 the
// constitution's byte budget (CLAUDE.md must stay under meta.constitution.byte_budget, armed only when
// the manifest declares it), V17 that every MANDATORY skill binding in the constitution's table resolves
// to a live `.claude/skills/<name>` junction, and V21 that every file system/kit-manifest.json
// json_standard.enforced[] names still holds the JSON standard, a RATCHET that can never regress what has
// been migrated and never blocks what has not.
//
// HOW. V21 loads scripts/json-standard-audit.js by absolute path (the rule engine both this leg and the
// CI step `--enforced` share, so they cannot disagree about a file) and reuses kitManifestDropClaim from
// scripts/lib/validate/shipped.js, so an enforced path absent only because it is an online drop row stays
// silent - the exact rule V13 already applies to the wrapper pins. isTracked(rel) fails CLOSED: with no
// git, or on any error, a path reads as tracked, so an unknowable answer produces the louder verdict.
// The actual `require(...)` of the audit module is a callback the entry passes in (loadAudit), not a
// call written here: a require's failure text carries a "Require stack" naming every file between the
// caller and the module system, and that stack must still read exactly as it did before the split, one
// entry, the entry's own path - not this file's, which a require written here would add to it.
//
// NEVER. Asserts anything when `.claude/skills` has not been built yet (a fresh clone, a CI checkout: V17
// WARNS, never FAILS, on that). Treats a tracked in-scope JSON file nobody has migrated yet as a failure
// (V21's backlog line is a WARNING with a live count, never a block).
//
// Usage: module only - const { v16ConstitutionBudget, v17MandatorySkillBindings, v21JsonStandard,
//   mandatorySkillTokens } = require('./skills-json');
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const { REPO, effective } = require('./structure');
const { kitManifestDropClaim } = require('./shipped');

// ---------------------------------------------------------------------------------------------
// V16 - constitution byte budget.
//       CLAUDE.md must stay within manifest meta.constitution.byte_budget (set at a landing size plus
//       headroom, so it catches REGROWTH, never the starting size itself). Standing narrative and
//       history belong in docs/constitution-annex/*, not the constitution itself; without a hard
//       ceiling the constitution regrows one well-meant paragraph at a time. New standing content
//       belongs as an operative sentence here + history in the annex. ARMED only when the manifest
//       declares the budget; absent key = silent pass (the V12 declared-contract pattern). ERROR
//       tier: a build that ships an over-budget constitution is the regrowth this exists to stop.
// ---------------------------------------------------------------------------------------------
function v16ConstitutionBudget({ stagedDir, manifest }, failures) {
  const budget = manifest?.meta?.constitution?.byte_budget;
  if (!budget) return; // not armed until the contract exists
  const claude = effective(stagedDir, 'CLAUDE.md');
  if (!claude) return; // G2 already fails a missing CLAUDE.md
  const bytes = Buffer.byteLength(claude.text);
  if (bytes > budget) {
    failures.push(
      `FAILED V16: CLAUDE.md is ${bytes} B against meta.constitution.byte_budget ${budget} B - ` +
        `the constitution is regrowing. Keep the operative sentence here and move the narrative to ` +
        `docs/constitution-annex/ (the 2026-08-16 diet pattern); raise the budget only as a deliberate manifest edit.`
    );
  }
}

// A Skill Bindings row whose Strength cell, any cell after the first, reads MANDATORY - the same shape
// scripts/lib/skill-state.js's parseMandatory tests as MANDATORY_ROW.
const MANDATORY_ROW = /^\|.*\|\s*MANDATORY\s*\|/;
// A candidate skill name inside the Skill(s) cell: lowercase words joined by hyphens - the same shape
// skill-state.js tests as NAME_TOKEN.
const NAME_TOKEN = /[a-z0-9]+(?:-[a-z0-9]+)*/g;
// The Skill(s) cell of a row split on '|': the text before the first pipe is cell 0.
const SKILLS_CELL = 2;

/**
 * Every MANDATORY-row skill token in constitution text: known-name OR hyphenated-shape, a union on
 * purpose (known-names-only would let a MANDATORY row naming an un-vendored hyphenated skill silently
 * drop out of the guarded set - the exact dead-end V17 exists to fail on). Exported, not only for
 * v17MandatorySkillBindings below, so a parity test can hold this parse and skill-state.js's
 * parseMandatory to one answer over the same constitution text: this file reads the staged preview a
 * run is about to ship, skill-state.js only ever the file on disk, and that is a sanctioned difference,
 * not a reason the two parses may silently disagree about what MANDATORY means.
 * @param {string} text
 * @param {Set<string> | null} knownSkills
 * @returns {Set<string>}
 */
function mandatorySkillTokens(text, knownSkills) {
  const skills = new Set();
  const rows = text.split(/\r?\n/).filter((l) => MANDATORY_ROW.test(l));
  for (const row of rows) {
    const cells = row.split('|').map((c) => c.trim());
    if (cells.length < 4) continue;
    for (const tok of cells[SKILLS_CELL].match(NAME_TOKEN) || []) {
      if (knownSkills?.has(tok) || /-/.test(tok)) skills.add(tok);
    }
  }
  return skills;
}

// V17 - MANDATORY skill bindings resolve: every skill named in a MANDATORY row of the
//       constitution's Skill Bindings table must resolve to a LIVE `.claude/skills/<name>`
//       junction (readable dir with a SKILL.md). Built BEFORE the
//       first skills parking on purpose: parking removes junctions, and this check makes
//       "parking broke a MANDATORY binding" a build failure instead of a silent capability loss.
//       Compute-and-compare: skill tokens parsed from the Skill(s) CELL of MANDATORY rows only
//       (kebab-case tokens), each asserted resolvable. ERROR tier.
// ---------------------------------------------------------------------------------------------
function v17MandatorySkillBindings({ stagedDir }, failures, warnings) {
  // NOT INSTALLED versus MISSING, and they are not the same fact. `.claude/skills` holds gitignored
  // junction links, so a fresh clone, a CI checkout and any restore all legitimately have none.
  // Failing the suite for that would mean the validator could only ever pass on a machine where
  // somebody had already run bootstrap, which makes it useless as a pre-flight on a new install.
  // A MISSING skill inside an EXISTING junction directory is the real thing this guards: that skill
  // silently does not load, and the MANDATORY rule pointing at it becomes a dead end nobody notices.
  if (!fs.existsSync(path.join(REPO, '.claude', 'skills'))) {
    warnings.push(
      'WARNING V17: the skill junctions have not been built yet (.claude/skills does not exist), so the MANDATORY bindings could not be verified. Expected on a fresh clone. Fix: node scripts/bootstrap.mjs --repair-links'
    );
    return;
  }

  const claude = effective(stagedDir, 'CLAUDE.md');
  if (!claude) return; // G2 owns a missing CLAUDE.md
  // Candidate tokens are validated against the lock's known names, not required to carry a
  // hyphen: a hyphen-only regex would silently drop a skill like `pptx` or `pdf` from the guarded set
  // while the constitution claimed it was covered. Known-name filtering is what keeps prose words in the cell
  // ("then", "and") from being read as skills; with no lock, fall back to hyphenated-only.
  let knownSkills = null;
  try {
    knownSkills = new Set(
      Object.keys(JSON.parse(fs.readFileSync(path.join(REPO, 'skills-lock.json'), 'utf8')).skills || {})
    );
  } catch {
    /* fall back below */
  }
  const skills = mandatorySkillTokens(claude.text, knownSkills);
  if (skills.size === 0) return; // no MANDATORY rows = nothing to assert (not an error shape)
  const dead = [];
  for (const s of skills) {
    const p = path.join(REPO, '.claude', 'skills', s, 'SKILL.md');
    try {
      fs.readFileSync(p);
    } catch {
      dead.push(s);
    }
  }
  if (dead.length) {
    failures.push(
      `FAILED V17: MANDATORY skill binding(s) do not resolve to a live .claude/skills link: ` +
        `${dead.join(', ')}. Rebuild with: node scripts/bootstrap.mjs --repair-links (every platform - ` +
        `junctions on Windows, symlinks on macOS); a MANDATORY row must never point at a parked or missing skill.`
    );
  }
}

/*
 * V21 - the JSON standard holds on the files it is enforced for.
 *
 * WHY A VALIDATOR LEG AT ALL, AND NOT ONLY THE CI AUDIT STEP. A validator run BEFORE a file's writer
 * has moved to scripts/lib/json-writer.js blocks every commit against files nobody has touched yet;
 * a validator run with no helper to name has nothing to tell an author to do about a failure. Both
 * the migration helper and the per-file writers exist now, so this leg runs today as the ratchet
 * docs/json-standard.md describes.
 *
 * WHY IT IS SCOPED BY A LIST AND NOT BY A GLOB. Every tracked in-scope JSON file in this Kit is
 * hand-edited today and almost none conforms, so a check that audited its own scope would refuse
 * every commit from the moment it shipped. The list therefore holds only files whose writer goes
 * through scripts/lib/json-writer.js, and a path joins it in the same commit that moves its writer,
 * never before. That makes the check a RATCHET: it cannot regress what has been fixed, and it never
 * blocks what has not.
 *
 * WHERE THE LIST LIVES. system/kit-manifest.json json_standard.enforced[], not the project registry
 * (system/manifest.json). The reason is in that file's json_standard.note: the registry is edited by
 * /new on every install, and the list belongs to the Kit's code, not to the owner's projects.
 *
 * WHAT STOPS IT BEING SILENT. It FAILS if the contract or the audit module goes missing, so the
 * plumbing is proven on every run, and it WARNS with a live count of tracked in-scope files that are
 * not yet enforced and how many of them break the standard today. The rule engine is the audit's own
 * auditText(), and the contract is read by the audit's own parseContract(), so V21 and the CI step
 * (json-standard-audit.js --enforced) cannot disagree about a file or about the list.
 *
 * A CONTENT leg, not a drift leg: an enforced file broken by a hand edit is wrong content, so it
 * blocks under CLAUDE_CODE_REMOTE=true as well. The fix it names is always the same, and always
 * available: write the file through the script its own _writer field names.
 */
// Is this path tracked by git? Tells a vanished TRACKED file (a regression) from an absent
// GITIGNORED state file (the normal state of a machine whose writer has not run yet). Fails CLOSED:
// with no git, or on any error, the path is treated as tracked, so an unknowable answer produces the
// louder verdict rather than a silent pass.
function isTracked(rel) {
  try {
    execFileSync('git', ['ls-files', '--error-unmatch', '--', rel], {
      cwd: REPO,
      stdio: ['ignore', 'ignore', 'ignore']
    });
    return true;
  } catch (e) {
    return !(e && typeof e.status === 'number'); // a real exit code means "not tracked"; anything else means unknown -> loud
  }
}

function v21JsonStandard({ stagedDir, loadAudit }, failures, warnings) {
  let audit;
  try {
    audit = loadAudit();
  } catch (e) {
    failures.push(
      `FAILED V21: scripts/json-standard-audit.js could not be loaded (${e.message}). The audit is the rule engine; V21 without it would pass every file by default.`
    );
    return;
  }
  let enforced;
  try {
    const c = effective(stagedDir, audit.CONTRACT_REL);
    enforced = audit.parseContract(c ? c.text : null);
  } catch (e) {
    failures.push(
      `FAILED V21: ${e.message}. That list IS the contract this check reads; without it the check has no scope and silently asserts nothing, which is worse than no check. Restore it (doc: docs/json-standard.md).`
    );
    return;
  }

  const absentUntracked = [];
  // Absent AND claimed by a `drop` row in system/kit-manifest.json is silent, V13's rule: the online
  // tree never holds a dropped path (the operator's system/fleet.json), so warning about it on every
  // validate of every owner repository was a signal that fires on a healthy system.
  const dropped = kitManifestDropClaim(stagedDir);
  for (const rel of enforced) {
    const eff = effective(stagedDir, rel);
    if (!eff && dropped(rel)) continue;
    if (!eff) {
      // ABSENT is two different facts and they must not share a verdict. A TRACKED file that
      // vanished is a real regression. A GITIGNORED state file that is absent is the ordinary
      // condition of any machine whose writer has not run yet, a fresh clone above all, and failing
      // there would refuse every commit until the writer happened to run.
      if (isTracked(rel)) {
        failures.push(
          `FAILED V21: ${rel} is listed in json_standard.enforced[] but is not on disk, and git tracks it. A tracked file leaves the enforced list deliberately, in the commit that removes it, never by going missing.`
        );
      } else {
        absentUntracked.push(rel);
      }
      continue;
    }
    const r = audit.auditText(rel, eff.text, { root: REPO });
    if (r.findings.length) {
      failures.push(
        `FAILED V21: ${rel} (${eff.from}) breaks the JSON standard: ${r.findings.join('; ')}. It is migrated and enforced, so this is a regression: write it through the script its _writer field names (scripts/lib/json-writer.js underneath), never by editing the bytes.`
      );
    }
  }
  if (absentUntracked.length) {
    warnings.push(
      `WARNING V21: enforced but absent, and not tracked by git here, so nothing is asserted about them on this machine: ${absentUntracked.join(', ')}. Expected before their writer has run (a fresh clone, a template); if the writer HAS run here, that absence is the finding.`
    );
  }

  // The visible half. A tracked in-scope file nobody has migrated is not a failure, but it is not
  // nothing either: an unmeasured backlog is how a standard quietly stops being enforced.
  let tracked = [];
  try {
    tracked = execFileSync('git', ['ls-files', '--', ...audit.IN_SCOPE_GLOBS], {
      cwd: REPO,
      encoding: 'utf8',
      maxBuffer: 8 * 1024 * 1024
    })
      .split(String.fromCharCode(10))
      .map((x) => x.trim())
      .filter(Boolean);
  } catch {
    return;
  } // no git = no backlog line, not a failure
  const pending = tracked.filter((rel) => !enforced.includes(rel) && audit.matchesScope(rel));
  if (!pending.length) return;
  let breaking = 0;
  for (const rel of pending) {
    const eff = effective(stagedDir, rel);
    if (!eff) continue;
    try {
      if (audit.auditText(rel, eff.text, { root: REPO }).findings.length) breaking++;
    } catch {
      /* counted as unknown */
    }
  }
  warnings.push(
    `WARNING V21: ${enforced.length} path(s) enforced; ${pending.length} tracked in-scope JSON file(s) are not, and ${breaking} of those break the standard today (${pending.join(', ')}). Each joins json_standard.enforced[] in the commit that moves its writer onto scripts/lib/json-writer.js. Full picture including gitignored state: node scripts/json-standard-audit.js`
  );
}

module.exports = { v16ConstitutionBudget, v17MandatorySkillBindings, v21JsonStandard, isTracked, mandatorySkillTokens };
