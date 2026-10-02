#!/usr/bin/env node
// scripts/generate-alex.js - THE unified generator: one entry point produces every human-facing document
// and system integration from the hand-authored sources.
//
// WHAT. Renders CLAUDE.md's routing region, the docs (GETTING-STARTED, ARCHITECTURE, README,
// projects/README), the brand tokens, the command-file state/trigger headers, the online schedule's
// ROUTINES region and docs/ROUTINES-FORMS.md, and the platform's scheduled jobs (Windows Task
// Scheduler or launchd), from system/manifest.json, scheduler/schedule.md, CLAUDE.md, soul.md,
// brand/config/* and templates/*.template.md. Everything renders into .staging/ first and is validated there before it
// swaps over the real paths, so a run that fails after staging touches no tracked file - except the
// soul-core rebuild and the scheduler apply, which run after validation but before the swap, outside
// staging, and do not roll back if a later step fails (see NEVER). In a tree with no variants/online (an
// online, Virtual Alex tree) only the surfaces valid there render; see THE ONLINE TREE section below.
//
// HOW. Arguments are parsed and refused FIRST, before any module beyond this file's own top-level
// requires loads: an argument outside `--dry-run`, one `--only=<list>` (VALID_ONLY, comma-separated) and
// `--help`/`-h` is refused with exit 2 before the write lock, the staging area, the log file or the
// scheduler module exist in this process. Past the gate, the run takes the shared repo-surface write
// lock (scripts/lib/write-lock.js) and holds it across staging, validation and the swap, then in order:
// [1/5] reads every source into one model; [2/5] renders each selected surface into .staging/; [3/5] runs
// the FULL validator (never narrowed by --only) against the staged set plus the live repo, then the
// prompt-regression and stale-status advisories (WARN only, never fail the run) and, when selected,
// rebuilds the soul-core card; [4/5] applies the scheduler (create-missing-only); [5/5] swaps every
// staged file into place, or reports why nothing swapped. `--only` limits what is staged and applied,
// never what is validated. See THE ONLINE TREE section below for what a tree with no variants/online
// renders instead.
//
// NEVER. Swaps a file before validation passes: a failed swap restores every file it had already
// replaced. Registers, changes or deletes a scheduled task except through the scheduler step, and never
// under `--dry-run`. Rolls back the soul-core rebuild or a scheduler apply because a LATER step failed:
// both run before the swap and outside it, so a crash between one of them and the swap can leave a
// rebuilt card, or newly registered jobs, beside docs that never swapped.
//
// Usage: node scripts/generate-alex.js [--dry-run] [--only=<list>] [--help|-h]
// Exit: 0 success, or --help/-h anywhere in argv - 1 any failure past the gate (lock held, a source
//   missing or invalid, a render refusal, validation failed, a scheduler error, a swap failure, a
//   soul-core throw) - 2 refused at the gate (unknown argument, bare --only, --only given twice, an
//   unknown or empty --only value)
'use strict';

// THE ONLINE TREE. A checkout without variants/online is a generated Virtual Alex tree:
// system/kit-manifest.json drops variants/ there, and validate-alex.js tells the Kit from a template by
// the same path. Owners run this generator online from /new and /setup. Rendering every surface there
// would fail on the missing variants/ path for docs and routines, and would write the registry's LAPTOP
// routing rows into the online CLAUDE.md. So online the run renders only the surfaces valid there and
// names the rest on its step line: rendered are docs/GETTING-STARTED.md, docs/README.md,
// docs/projects/README.md, the command headers, the brand tokens, and the routines (the ROUTINES region
// of the schedule - online that is scheduler/schedule.md itself - and docs/ROUTINES-FORMS.md); skipped
// are the CLAUDE.md routing region and docs/ARCHITECTURE.md, which embeds it, because the Kit owns the
// online constitution, and the scheduler, because online the Routines are the schedule and nothing
// registers on a machine. In the Kit none of this applies and every line runs as it always has.

// ---- 0. the command line, first. Nothing above this point may load a module or touch a file. ----
// contract: read as text by scripts/tests/test-generate-cli.mjs:168. One array literal of single-quoted surface names.
// biome-ignore format: the reader lifts the array's body with one regex and each name with another
const VALID_ONLY = ['docs', 'claude', 'tokens', 'scheduler', 'commands', 'soulcore', 'routines'];

const USAGE =
  'usage: node scripts/generate-alex.js [--dry-run] [--only=<list>] [--help]\n' +
  `  <list> is comma-separated, any of: ${VALID_ONLY.join(', ')}\n` +
  '  no flags = FULL RUN: swaps the generated files AND registers missing scheduled jobs on this machine;\n' +
  '  in an online (Virtual Alex) tree, one without variants/online, it registers nothing';

/**
 * The command line. `--dry-run` is repeatable and does not error twice. `--only=` may be given once,
 * its value a comma-separated list drawn from VALID_ONLY (an empty value, including a trailing comma,
 * refuses, since the split then yields ['']). Anything else refuses.
 * @param {string[]} argv
 * @returns {{ dry: boolean, only: string[] | null, error?: string }}
 */
function parseArgs(argv) {
  const out = { dry: false, only: null };
  for (const a of argv) {
    if (a === '--dry-run') {
      out.dry = true;
      continue;
    }
    if (a.startsWith('--only=')) {
      if (out.only) return { error: '--only was given twice; name every surface in one comma-separated list' };
      const vals = a
        .slice('--only='.length)
        .split(',')
        .map((s) => s.trim());
      const bad = vals.filter((v) => !VALID_ONLY.includes(v));
      if (bad.length) return { error: `unknown --only value ${bad.map((v) => `'${v}'`).join(', ')}` };
      out.only = vals;
      continue;
    }
    if (a === '--only')
      return {
        error: "'--only' needs '=' and a list, as in --only=docs (with a space the list is a separate argument)"
      };
    return { error: `unknown argument '${a}'` };
  }
  return out;
}

/**
 * Checked before any module beyond this file's own top-level requires loads, so a typo can never reach
 * the write lock, the staging area or the scheduler. `--help`/`-h` anywhere in argv wins over a parse
 * error (prints USAGE on stdout, exit 0, touches nothing); a parse error prints REFUSED and USAGE on
 * stderr and exits 2. Returns the parsed arguments once refusal is ruled out.
 * @param {string[]} argv
 * @returns {{ dry: boolean, only: string[] | null }}
 */
function gateArgs(argv) {
  if (argv.includes('--help') || argv.includes('-h')) {
    console.log(USAGE);
    process.exit(0);
  }
  const parsed = parseArgs(argv);
  if (parsed.error) {
    console.error(`generate-alex: REFUSED, ${parsed.error}. Nothing was run and nothing on this machine was touched.`);
    console.error(USAGE);
    process.exit(2);
  }
  return parsed;
}

const { dry: DRY, only: ONLY } = gateArgs(process.argv.slice(2));

// ---- 1. past the gate: every module this run can need. ----
const fs = require('node:fs');
const path = require('node:path');
const cp = require('node:child_process');

const log = require('./lib/log');
const aw = require('./lib/atomic-write');
const writeLock = require('./lib/write-lock');
const { loadModel } = require('./lib/read-sources');
const { claudeRegionBlock } = require('./lib/gen-routing-table');
const genClaudeRegion = require('./lib/gen-claude-region');
const genDocs = require('./lib/gen-docs');
const genTokens = require('./lib/gen-tokens');
const genCmdHeaders = require('./lib/gen-command-headers');
const scheduler = require('./lib/gen-scheduler');
const genRoutines = require('./lib/gen-routines');
const { runAll: validate, SUITE_RANGE } = require('./validate-alex');
const { REPO } = require('./lib/repo-root');

/** True when ONLY names no surfaces (want everything) or names this one. @param {string} name */
const want = (name) => !ONLY || ONLY.includes(name);

// A tree with no variants/online is a generated Virtual Alex tree (see THE ONLINE TREE above).
const ONLINE = !fs.existsSync(path.join(REPO, 'variants', 'online'));
/** Online, the schedule the model read IS this file: its ROUTINES region renders in place. */
const ONLINE_TREE_SCHEDULE_REL = 'scheduler/schedule.md';
/** @param {string[]} xs @returns {string} "a", "a and b", or "a, b and c" */
const joinAnd = (xs) => (xs.length > 1 ? `${xs.slice(0, -1).join(', ')} and ${xs[xs.length - 1]}` : xs.join(''));

/** 3b's advisory command. Ships in every tree, so no portability waiver is needed. */
const PROMPT_REGRESSION_CMD = 'node scripts/prompt-regression-check.js --advisory';
/** 3c's advisory command. Absent online: stale-status-check.js is laptop-only. */
const STALE_STATUS_CMD = 'node scripts/stale-status-check.js --advisory'; // portability-ok: laptop-only advisory, absent online

/**
 * Takes the shared repo-surface write lock, held for the whole run so staging, validation and the swap
 * are one indivisible window against another mutator (a parallel generator or a skills install). Fails
 * loud, never defers: the caller asked for surfaces to be regenerated, and doing nothing silently would
 * read as done.
 * @returns {{ ok: true, release: () => void }}
 */
function acquireLock() {
  const held = writeLock.acquire({ label: `generate-alex${DRY ? ' (dry-run)' : ''}`, log: log.step });
  if (!held.ok) {
    throw new Error(
      `another repo-surface mutator holds the write lock (${held.reason}). ` +
        `Wait for it to finish, or - if you are sure that process is dead - remove ${writeLock.lockPath(writeLock.DEFAULT_NAME)}`
    );
  }
  return held;
}

/**
 * [1/5]. Reads every source into one model. Any read or parse failure aborts before anything is staged.
 * @returns {*} the source model read-sources.js builds
 */
function readSources() {
  log.step('[1/5] read sources');
  const model = loadModel();
  log.step(
    `  sources OK: ${model.manifest.projects.length} projects (+${model.counts.unnumberedCount} unnumbered), ` +
      `${model.schedule.allJobNames.length} documented jobs, ${model.mcpList.length} MCP surfaces, ` +
      `${model.colorTokens.tokens.size} color tokens`
  );
  return model;
}

/**
 * [2/5]. Renders every selected output into .staging/, never in place.
 * @param {*} model the source model readSources() returned
 */
function renderStaging(model) {
  const onlineSkips = ONLINE
    ? [
        (want('claude') || want('docs')) && 'the CLAUDE.md routing region',
        want('docs') && 'docs/ARCHITECTURE.md'
      ].filter(Boolean)
    : [];
  log.step(
    ONLINE
      ? `[2/5] render to .staging/ (online tree, no variants/online: ${
          onlineSkips.length
            ? `skipped ${joinAnd(onlineSkips)}, which the Kit ships here`
            : 'nothing selected is skipped'
        })`
      : '[2/5] render to .staging/'
  );
  aw.reset();

  let stagedClaude = null;
  if (!ONLINE && (want('claude') || want('docs'))) {
    stagedClaude = genClaudeRegion.regenerate(model.claudeMd, claudeRegionBlock(model.manifest));
    aw.stage('CLAUDE.md', stagedClaude);
    log.step('  staged CLAUDE.md (routing region regenerated, constitution untouched)');
  }
  if (want('docs')) {
    const outputs = [genDocs.genGettingStarted(model)];
    if (!ONLINE) outputs.push(genDocs.genArchitecture(model, stagedClaude));
    outputs.push(genDocs.genReadme(model), genDocs.genProjectsReadme(model));
    for (const o of outputs) {
      aw.stage(o.rel, o.content);
      log.step(`  staged ${o.rel}`);
    }
  } else if (!ONLINE && want('scheduler')) {
    // Every place that tells an owner how to add a job (CLAUDE.md, docs/ARCHITECTURE.md,
    // scheduler/README.md, scheduler/schedule.md, .claude/commands/cron-setup.md) prescribes
    // exactly `node scripts/generate-alex.js --only=scheduler`, but that command alone never
    // re-staged docs/GETTING-STARTED.md, so the documented flow still failed the validator's
    // table-drift check on an installed machine. Stage ONLY docs/GETTING-STARTED.md here, with
    // the SAME renderer the docs branch above uses, so the two paths can never disagree about
    // its content. The online tree is unaffected: its own schedule is the ROUTINES region
    // rendered below, never Task Scheduler, and this branch never runs there (ONLINE is checked
    // first). stamp() always writes today's date, so staging unconditionally rewrote the tracked
    // file on every run but the one on its own stamp day, with nothing else in it changed.
    // needsStaging discounts a bare stamp rollover, so a no-op --only=scheduler leaves the file alone.
    const o = genDocs.genGettingStarted(model);
    if (genDocs.needsStaging(o.rel, o.content)) {
      aw.stage(o.rel, o.content);
      log.step(
        `  staged ${o.rel} (--only=scheduler also regenerates the jobs table so the documented add-a-job command works alone)`
      );
    } else {
      log.step(`  ${o.rel} unchanged but for its "Generated" date - left alone`);
    }
  }
  if (want('docs') || want('routines')) {
    // The Virtual Alex scheduling surfaces: the online schedule's ROUTINES region and the forms page,
    // both from system/manifest.json routines[]. Rendered with the docs because they are docs;
    // --only=routines renders just these two.
    const rows = genRoutines.routineRows(model.manifest);
    const schedule = ONLINE
      ? {
          rel: ONLINE_TREE_SCHEDULE_REL,
          content: genRoutines.regenerateRegion(
            model.scheduleMd,
            genRoutines.scheduleSection(rows),
            ONLINE_TREE_SCHEDULE_REL
          )
        }
      : genRoutines.genOnlineSchedule(model);
    for (const o of [schedule, genRoutines.genRoutinesForms(model)]) {
      aw.stage(o.rel, o.content);
      log.step(`  staged ${o.rel} (${rows.length} Routine row(s): ${rows.map((r) => r.name).join(', ') || 'none'})`);
    }
  }
  if (want('commands')) {
    // Command-file state/trigger headers: generated from the registry so that class of drift cannot
    // happen. Reads from process.cwd(), not REPO - a run from another folder stages nothing here (the
    // validator's own path check still catches a missing header from the repo root).
    let n = 0;
    const targets = genCmdHeaders.targets(model.manifest);
    for (const t of targets) {
      const abs = path.join(process.cwd(), t.rel);
      if (!fs.existsSync(abs)) continue; // a missing declared command file is a validator finding
      const before = fs.readFileSync(abs, 'utf8');
      const after = genCmdHeaders.apply(before, t);
      if (after !== before) {
        aw.stage(t.rel, after);
        n++;
      }
    }
    log.step(`  staged command headers: ${n} file(s) changed of ${targets.length} LIVE/EVENT command(s)`);
  }
  if (want('tokens')) {
    aw.stage(genTokens.CSS_REL, genTokens.tokensCss(model.colorTokens));
    aw.stage(genTokens.JSON_REL, genTokens.tokensJson(model.colorTokens));
    log.step(
      `  staged brand tokens: ${genTokens.CSS_REL} + ${genTokens.JSON_REL} (${model.colorTokens.tokens.size} tokens from the color law)`
    );
  }
}

/**
 * [3/5]. Validates the staged set plus the live repo with the FULL suite, whatever --only says: --only
 * limits what is staged and applied, never what is checked.
 */
async function runValidation() {
  log.step(`[3/5] validate (${SUITE_RANGE}, full suite - never narrowed by --only, context=generator)`);
  const result = await validate({ stagedDir: aw.STAGING });
  if (!result.ok) throw new Error(`validation failed:\n${result.failures.join('\n')}`);
}

/**
 * 3b, advisory: production prompts and runbooks still carry their load-bearing shape. WARN only - a
 * shape change may be intentional, and this never fails the run.
 */
function runPromptRegressionAdvisory() {
  try {
    const out = cp.execSync(PROMPT_REGRESSION_CMD, { cwd: REPO }).toString().trim();
    log.step(`  prompt-regression (advisory): ${out}`);
  } catch (e) {
    log.step(`  prompt-regression advisory skipped (non-fatal): ${e.message}`);
  }
}

/**
 * 3c, advisory: the spec-vs-status propagation-debt check, surfaced on every run instead of only on the
 * weekly sweep. A laptop organ: the online tree does not ship it, so there it is named absent and never
 * started. WARN only - a failure of it logs the error's first line, and the run goes on.
 */
function runStaleStatusAdvisory() {
  if (!fs.existsSync(path.join(__dirname, 'stale-status-check.js'))) {
    log.step('  stale-status (advisory): skipped, a laptop organ absent from this tree');
    return;
  }
  try {
    const out = cp.execSync(STALE_STATUS_CMD, { cwd: REPO }).toString().trim();
    for (const line of out.split('\n')) log.step(`  stale-status (advisory): ${line}`);
  } catch (e) {
    log.step(`  stale-status advisory skipped (non-fatal): ${String(e.message).split(/\r?\n/)[0]}`);
  }
}

/**
 * 3d, soul-core rebuild: the injection card derived from soul.md + system/soul-pins.json. Runs inside
 * the held write lock, after validation and before the swap (see NEVER); an unchanged source pair is a
 * verified no-op, and a skip (no soul.md yet) is reported by the builder itself, not restated here. A
 * build that refuses below the floor (soulCore.build's own guard) throws before writing anything, so
 * the existing card is left untouched; the throw surfaces as this run's own FAILED, the same as any
 * other step here, never a silent partial rebuild.
 */
function rebuildSoulCore() {
  if (!want('soulcore')) {
    log.step('  soul-core: skipped (--only)');
    return;
  }
  if (DRY) {
    log.step('  soul-core: dry-run - skipped (the builder writes via its own atomic swap, not staging)');
    return;
  }
  const soulCore = require('./lib/build-soul-core');
  const r = soulCore.build({ log: log.step });
  if (!r.skipped) {
    log.step(
      `  soul-core: ${r.noop ? 'unchanged (verified no-op)' : `rebuilt (${r.bytes} B, ${r.entries} newest + ${r.pinned} pinned)`}`
    );
  }
}

/**
 * [4/5]. Dry-run reports; a full run applies. Only ever CREATES missing jobs and never touches an
 * existing one, so hand-applied hardening survives. Outside --dry-run this really does register tasks on
 * THIS machine: only ever run it in the checkout the jobs are supposed to belong to.
 * @param {*} model the source model readSources() returned
 */
async function runScheduler(model) {
  if (!want('scheduler')) {
    log.step('[4/5] scheduler skipped (--only)');
    return;
  }
  if (ONLINE) {
    log.step(
      '[4/5] scheduler skipped (online tree: the Routines are the schedule, and nothing registers on this machine)'
    );
    return;
  }
  log.step(`[4/5] scheduler (${DRY ? 'dry-run' : 'apply'})`);
  await scheduler.run({ schedule: model.schedule, apply: !DRY, log: log.step });
}

/** [5/5]. Swaps every staged file into place, or reports why nothing swapped. */
function swapOrReport() {
  if (DRY) {
    log.step(
      `[5/5] DRY-RUN complete - staged output left in .staging/ for review (${aw.stagedFiles().length} file(s)), nothing real touched`
    );
    return;
  }
  if (aw.stagedFiles().length === 0) {
    // An --only selection without file outputs (e.g. an advisory or the scheduler alone) stages
    // nothing; that is not an error, since the external step already ran above.
    log.step('[5/5] nothing staged to swap (the --only selection produced no file outputs)');
    return;
  }
  const swapped = aw.swapAll();
  log.step(`[5/5] swapped ${swapped.length} file(s): ${swapped.join(', ')}`);
}

(async () => {
  let held = null;
  try {
    log.step(`generate-alex: ${DRY ? 'DRY-RUN' : 'FULL RUN'}${ONLY ? ` (only: ${ONLY.join(', ')})` : ''}`);
    held = acquireLock();

    const model = readSources();
    renderStaging(model);
    await runValidation();
    runPromptRegressionAdvisory();
    runStaleStatusAdvisory();
    rebuildSoulCore();
    await runScheduler(model);
    swapOrReport();

    log.flush();
    process.exitCode = 0; // not process.exit(): that would skip the finally below and leak the write lock
  } catch (e) {
    // Any failure: delete staging, touch nothing real, name the reason, exit 1.
    try {
      aw.reset();
    } catch {
      /* staging cleanup is best-effort */
    }
    log.step(`FAILED: ${e.message}`);
    log.flush();
    process.exitCode = 1;
  } finally {
    // Release the write lock on every path (success, validation failure, crash) so a failed run can
    // never wedge the next one. release() only removes a lock this process still owns.
    if (held?.ok) held.release();
  }
})();
