#!/usr/bin/env node
// scripts/validate-alex.js - the validation layer: the full suite that checks generated docs and code
// against their sources, run at the end of every generate-alex.js run, standalone on the CLI, and
// from the git pre-commit hook.
//
// WHAT. Runs the full suite (SUITE_RANGE below, derived from V_MAX - never restate the number here)
// on EVERY invocation: the structural guards G1-G4, then every V-leg through the declared suite max
// (V6, V8, V20 retired) - generated docs against the manifest and schedule, retired-as-live, the MCP
// list, colour tokens, lifecycle-state prose, first-fire aging, two commit-time-only guards (V10
// NEVER-TOUCH, V11 forced-add), the trifecta gate, local wrapper model pins, Alex's gender
// neutrality, command headers, the constitution byte budget, MANDATORY skill bindings, the shipped
// executables, the Routine prompt files, and the JSON standard. Any failure exits 1 and names exactly
// what drifted and where; generate-alex.js's `--only=X` limits what is STAGED, never what this checks.
//
// HOW. One LIVE-reality check exists (the scheduler query, V2's live half) and two contexts treat it
// differently: context: 'generator' (default) - a scheduler that cannot be queried is a hard FAIL.
// context: 'pre-commit' - the same check degrades to a LOUD WARNING SKIP instead, so an offline
// machine or the nightly headless commit is never blocked by it. Under CLAUDE_CODE_REMOTE=true in
// pre-commit context a further set of DRIFT legs (REMOTE_DRIFT_LEGS, lib/validate/remote.js) also
// degrade to warnings, because an autosave that cannot commit is a vault page that dies with the VM;
// content legs never do. ONE EXCEPTION either way: V2's PARTIAL-registration job drift also warns in
// the generator context, because its own documented fix (generate-alex.js --only=scheduler) runs this
// validator first, and a hard FAIL there wedged the machine on the exact gap it was invoked to close.
// Called as `const { runAll } = require('./validate-alex'); const result = await runAll({ stagedDir
// })` - ASYNC for the caller's contract only (every leg is synchronous today; it stays async so a
// future leg can await without changing the generator). A file present in stagedDir validates as the
// ABOUT-TO-SHIP version, else the current repo copy. Parse contracts are REUSED from
// lib/read-sources.js and lib/gen-docs.js / gen-scheduler.js, so the generator and this validator can
// never disagree about how a source or a surface is read.
//
// NEVER. Swallows a failure: every FAILED line reaches the caller, who deletes staging and touches
// nothing real. Restates V_MAX or SUITE_RANGE as a separate literal - every consumer derives from
// the one declaration below.
//
// The first guard range in this file is in the paragraph above (WHAT) and is the harvester's g_count; keep it the real count.
// contract: read as text by system/recall/harvesters/h-validators.js:23.
// contract: read as text by scripts/tests/test-validate-cli-contract.mjs:56.
//
// Usage: node scripts/validate-alex.js [--staged=DIR] [--context=generator|pre-commit] [--changed]
// Exit: 0 pass (warnings allowed) - 1 fail
'use strict';
const fs = require('node:fs');
const path = require('node:path');

const { parseScheduleJobs, parseColorTokens } = require('./lib/read-sources');
const { REPO, effective, structuralGuards } = require('./lib/validate/structure');
const {
  LAW_FILE,
  v1AutomationCount,
  v2ScheduledJobs,
  v3NoRetiredAsLive,
  v4McpConsistency,
  v5HexTokens
} = require('./lib/validate/manifest-docs');
const { v7StateDriftLint } = require('./lib/validate/state-words');
const {
  V10_PROTECTED,
  evaluateProtectedChangeset,
  readStagedChangeset,
  v9FirstFireAging,
  v10ProtectedFileGuard,
  v11IgnoredStagedGuard,
  v12TrifectaGate
} = require('./lib/validate/commit');
const {
  v13LocalWrapperPins,
  v14AlexGenderNeutrality,
  v15CommandHeaders,
  v18ShippedExecutables,
  v19RoutinePrompts
} = require('./lib/validate/shipped');
const { v16ConstitutionBudget, v17MandatorySkillBindings, v21JsonStandard } = require('./lib/validate/skills-json');
// V21's audit engine is require()'d HERE, not inside skills-json.js: a require's failure carries a
// "Require stack" naming every file between the caller and Node's module loader, and that text is
// asserted byte-for-byte by the scenario harness. Keeping the call site in the entry keeps that stack
// exactly one entry, this file's own path, as it was before the split.
function loadJsonStandardAudit() {
  return require(path.join(REPO, 'scripts', 'json-standard-audit.js'));
}
const { REMOTE_DRIFT_LEGS, isRemoteDrift } = require('./lib/validate/remote');

// --- suite range: ONE declared number, every consumer derives ---
// A label that restates the suite range independently of this declaration can drift from it: the same
// class of defect as a validator deriving its expectation from prose rather than from structured data.
// So V_MAX is declared HERE, once, and generate-alex.js + the recall h-validators harvester both read
// THIS declaration (a structured `const V_MAX = <n>`), never a printed string or a prose claim.
// One line at column 0: the name, one number and the semicolon.
// contract: read as text by system/recall/harvesters/h-validators.js:17.
// contract: read as text by scripts/tests/test-validate-cli-contract.mjs:56.
// biome-ignore format: the harvester parses this declaration with a line-anchored regular expression
const V_MAX = 21;
// V6 (live n8n model routing) and V8 (the Alex HQ app hex scan) are RETIRED in this system:
// there is no n8n instance and no HQ app, so both checked a subject this Kit does not have. The
// numbers are NOT reused - V13 means the local wrapper pins here exactly as it does anywhere,
// and renumbering a suite silently changes what every existing reference points at.
// V20 joins them for the same reason: upstream it is a parity check between two job
// search lanes, a subject this Kit does not have. V21, the JSON standard, keeps its upstream number
// so docs/json-standard.md means the same check in both places.
const V_RETIRED = [6, 8, 20];

const SUITE_RANGE = `G1-G4 + V1-V${V_MAX} (V${V_RETIRED.join(', V')} retired)`;

// runAll - the single entry point.
// ---------------------------------------------------------------------------------------------
async function runAll({ stagedDir, context = 'generator', changed = false } = {}) {
  const failures = [];
  const warnings = [];

  structuralGuards({ stagedDir }, failures);

  // Shared sources for V1-V6 (staged copy wins; sources are never staged today but effective()
  // keeps that true by construction if they ever are).
  let manifest = null,
    schedule = null,
    colorTokens = null;
  const mfRaw = effective(stagedDir, 'system/manifest.json');
  if (!mfRaw) failures.push('FAILED V1: system/manifest.json not found - the registry is required');
  else {
    try {
      manifest = JSON.parse(mfRaw.text);
    } catch (e) {
      failures.push(`FAILED V1: system/manifest.json is not valid JSON: ${e.message}`);
    }
  }
  const schedRaw = effective(stagedDir, 'scheduler/schedule.md');
  if (!schedRaw) failures.push('FAILED V2: scheduler/schedule.md not found');
  else {
    try {
      schedule = parseScheduleJobs(schedRaw.text);
    } catch (e) {
      failures.push(`FAILED V2: cannot parse scheduler/schedule.md: ${e.message}`);
    }
  }
  const lawRaw = effective(stagedDir, LAW_FILE);
  if (!lawRaw) failures.push(`FAILED V5: ${LAW_FILE} not found - the color law file is required`);
  else {
    try {
      colorTokens = parseColorTokens(lawRaw.text);
    } catch (e) {
      failures.push(`FAILED V5: cannot parse the token table of ${LAW_FILE}: ${e.message}`);
    }
  }

  // The FULL suite runs on every invocation - generate-alex's --only limits what is staged,
  // never what is checked.
  if (manifest) v1AutomationCount({ stagedDir, manifest }, failures);
  if (schedule) v2ScheduledJobs({ stagedDir, schedule, context }, failures, warnings);
  if (manifest) v3NoRetiredAsLive({ stagedDir, manifest }, failures);
  v4McpConsistency({ stagedDir }, failures);
  if (colorTokens) v5HexTokens({ stagedDir, allHexes: colorTokens.allHexes }, failures);
  if (manifest) v7StateDriftLint({ stagedDir, manifest }, failures, warnings);
  if (manifest) v9FirstFireAging({ stagedDir, manifest }, failures, warnings);
  v10ProtectedFileGuard({ context, changed }, failures, warnings); // commit-time only (no-op otherwise)
  v11IgnoredStagedGuard({ context, changed }, failures, warnings); // commit-time only (no-op otherwise)
  if (manifest) v12TrifectaGate({ stagedDir, manifest }, failures, warnings); // trifecta gate (every run)
  if (manifest) v13LocalWrapperPins({ stagedDir, manifest }, failures, warnings); // local wrapper model-pin contract (every run)
  v14AlexGenderNeutrality({ stagedDir }, failures, warnings); // Alex has no gender (every run; no manifest needed)
  if (manifest) v15CommandHeaders({ stagedDir, manifest }, failures, warnings); // command-file state/trigger headers (WARN-tier for now)
  if (manifest) v16ConstitutionBudget({ stagedDir, manifest }, failures); // constitution byte budget (armed by meta.constitution)
  v17MandatorySkillBindings({ stagedDir }, failures, warnings); // MANDATORY skill rows resolve to live junctions (every run)
  if (manifest) v18ShippedExecutables({ stagedDir, manifest }, failures, warnings); // .cmd sanity + dangling commands + cut-project pointers
  if (manifest) v19RoutinePrompts({ manifest }, failures, warnings); // Routine prompt files bound to routines[] (every run)
  v21JsonStandard({ stagedDir, loadAudit: loadJsonStandardAudit }, failures, warnings); // JSON standard on kit-manifest json_standard.enforced[] (every run, content leg)

  // Under CLAUDE_CODE_REMOTE=true in the pre-commit context the drift legs WARN (REMOTE_DRIFT_LEGS).
  // Done here, after every leg has run, so the check itself is unchanged and the degradation is one
  // visible step that names what it degraded; a generator run never takes it.
  const remote = context === 'pre-commit' && process.env.CLAUDE_CODE_REMOTE === 'true';
  if (remote) {
    const keep = [];
    let degraded = 0;
    for (const f of failures) {
      if (isRemoteDrift(f)) {
        degraded++;
        warnings.push(
          `WARNING (drift, degraded under CLAUDE_CODE_REMOTE=true, context=pre-commit) ${f.replace(/^FAILED /, '')}`
        );
      } else keep.push(f);
    }
    if (degraded) {
      failures.length = 0;
      failures.push(...keep);
      warnings.push(
        `WARNING validate-alex: ${degraded} drift failure(s) degraded to warnings because CLAUDE_CODE_REMOTE=true (an autosave that cannot commit is a page that dies with the VM); the content legs still block, and the weekly check turns a persisting drift red`
      );
    }
  }

  for (const w of warnings) console.error(w);
  for (const f of failures) console.error(f);
  if (failures.length === 0)
    console.log(
      `validate-alex: ${SUITE_RANGE} PASS (context=${context}${warnings.length ? `, ${warnings.length} warning(s) - see above` : ''})`
    );
  return { ok: failures.length === 0, failures, warnings, range: SUITE_RANGE };
}

// The CLI shell. A separate function (never inlined in the require.main guard) so a Refusal from
// either the argument parser or the --staged existence check below can `return` out early without
// skipping the module.exports a required (never run) copy of this file still needs.
function cli() {
  const { parseCommandLine } = require('./lib/args');
  const { Refusal } = require('./lib/errors');
  const { EXIT } = require('./lib/exit-codes');
  let values;
  try {
    ({ values } = parseCommandLine({
      name: 'validate-alex',
      edge: 'operator',
      options: { staged: { type: 'string' }, context: { type: 'string' }, changed: { type: 'boolean' } }
    }));
    // A value check args.js cannot see on its own: the flag is known, the folder it names is not
    // there. Refused the same way an unknown flag is (exit 1, section 4), so both land on the one
    // stderr line below.
    if (values.staged !== undefined && !fs.existsSync(path.resolve(values.staged))) {
      throw new Refusal(`--staged '${values.staged}' does not exist`, { exitCode: EXIT.FAILURE });
    }
  } catch (e) {
    if (!(e instanceof Refusal)) throw e;
    console.error(`validate-alex: ${e.message}`);
    process.exitCode = e.exitCode;
    return;
  }
  const context = values.context ?? 'generator';
  if (!['generator', 'pre-commit'].includes(context)) {
    console.error(`validate-alex: unknown --context '${context}' (valid: generator, pre-commit)`);
    process.exitCode = 1;
    return;
  }
  // .staging/ is the GENERATOR's preview tree, never the thing a commit ships. Arming it by mere
  // existence let a CLEAN ghost shadow a BROKEN tree at commit time: effective() prefers the staged
  // copy, so a poisoned CLAUDE.md in the working tree produced no G2 line at all and the commit
  // passed. A successful `generate-alex.js --dry-run` leaves .staging behind by design, so that
  // ghost is the normal state after any dry-run. The preview is only authoritative for the context
  // that produced it, or when a caller names it outright.
  const explicitStaged = values.staged !== undefined;
  let stagedDir = explicitStaged ? path.resolve(values.staged) : path.join(REPO, '.staging');
  if (!explicitStaged && context !== 'generator') {
    if (fs.existsSync(stagedDir)) {
      console.error(
        `validate-alex: NOTE .staging/ exists and is IGNORED in context=${context} - the working tree is what a commit ships (pass --staged=<dir> to validate a preview tree deliberately)`
      );
    }
    stagedDir = undefined;
  }
  const changed = Boolean(values.changed); // arms V10 (pre-commit hook passes it)
  // process.exitCode (not process.exit()): a hard exit right after an async leg can trip a libuv
  // teardown assertion on Windows while a handle is still closing. Letting the loop drain is safe
  // and the exit code is identical for the caller.
  runAll({ stagedDir: stagedDir && fs.existsSync(stagedDir) ? stagedDir : undefined, context, changed })
    .then(({ ok }) => {
      process.exitCode = ok ? 0 : 1;
    })
    .catch((e) => {
      console.error(`validate-alex: internal error: ${e.message}`);
      process.exitCode = 1;
    });
}

if (require.main === module) cli();

module.exports = {
  runAll,
  evaluateProtectedChangeset,
  V10_PROTECTED,
  readStagedChangeset,
  SUITE_RANGE,
  V_MAX,
  V_RETIRED,
  REMOTE_DRIFT_LEGS,
  isRemoteDrift
};
