#!/usr/bin/env node
/*
 * prompt-regression-check.js - zero-token prompt regression checker (#26 Phase 1, 2026-07-25).
 *
 * Prompt edits stop being silent behavior changes. Each case in
 * work/26-prompting/regression-cases/cases.json pins the load-bearing SHAPE of a production prompt/runbook
 * (must_contain / must_not_contain regexes). This replays them - STRING-SHAPE ASSERTIONS ONLY, no Claude
 * calls, no LLM judging in v1 - and reports any case whose target no longer carries its required shape.
 * The V6 lesson (expectations live as data) extended to the prompt layer.
 *
 * --delivered MODE (added 2026-08-26). Every case above asserts against an INSTRUCTION file
 * (.claude/commands/*.md), so a green run proves the instruction survived and NEVER that a prompt actually
 * delivered by /prompting carried it. That is a structural hole, not a theoretical one: measured upstream on
 * the system this Kit derives from, four separate assembly rules drifted for weeks underneath a green
 * checker, including one that shipped a soul-reading instruction the owner had already retired. This mode
 * asserts against the ARTIFACTS in outputs/prompting/ instead, which is where behavior actually lives.
 *
 * `outputs/` is gitignored, so a fresh clone has no artifacts to audit. That is not a failure: with nothing
 * dated on or after the cutover the mode says so and exits 0, so it can never paint a new install red.
 *
 * Exit: 0 = all pass. 1 = a failure (a required string vanished or a forbidden one appeared) OR a missing
 * target. In ADVISORY mode (--advisory, the generator's use) it prints WARNINGs and still exits 0.
 *
 * Usage:  node scripts/prompt-regression-check.js              # strict case replay (exit 1 on any failure)
 *         node scripts/prompt-regression-check.js --advisory   # warn only, exit 0 (generator validation pass)
 *         node scripts/prompt-regression-check.js --delivered  # audit the newest delivered prompts
 *         node scripts/prompt-regression-check.js --delivered --n 5        # how many to audit (default 3)
 *         node scripts/prompt-regression-check.js --delivered --file <p>   # audit one specific artifact
 *         node scripts/prompt-regression-check.js --delivered --since 2026-08-26   # only on/after a date
 */
'use strict';
const fs = require('fs');
const path = require('path');

const REPO = path.resolve(__dirname, '..');
const CASES = path.join(REPO, 'work', '26-prompting', 'regression-cases', 'cases.json');
const OUTDIR = path.join(REPO, 'outputs', 'prompting');
const argv = process.argv.slice(2);
const advisory = argv.includes('--advisory');
const delivered = argv.includes('--delivered');
const argOf = (flag) => { const i = argv.indexOf(flag); return i >= 0 ? argv[i + 1] : null; };

/* ------------------------------------------------------------------ *
 * DELIVERED MODE - assert on the artifact, not the instruction file.
 * ------------------------------------------------------------------ */

// The cutover. Artifacts dated before this predate the rules below and are grandfathered: they are
// history, they are never re-run, and failing on them would paint this check permanently red on a
// machine whose owner cannot debug it.
const RULES_LIVE_FROM = '2026-08-26';

// Every rule here maps to something work/26-prompting/CLAUDE.md actually requires of a delivered prompt.
// Do not add a rule for a line the spec does not demand: a checker that asserts more than the spec is a
// checker nobody can satisfy without reading the checker, which defeats the point of writing specs.
const DELIVERED_RULES = [
  { id: 'three-headers',
    // Accept every header style in real use: bare (`CONTEXT`), markdown heading (`# CONTEXT`), and bold
    // (`**CONTEXT**`). A rule matching only the bare form reports a false positive on a perfectly good
    // artifact, and a false positive on a guard is worse than no guard: it teaches the owner to ignore it.
    test: (t) => /^\s*(?:#{1,6}\s*)?\**\s*CONTEXT\b/m.test(t)
              && /^\s*(?:#{1,6}\s*)?\**\s*INPUT\b/m.test(t)
              && /^\s*(?:#{1,6}\s*)?\**\s*OUTPUT\b/m.test(t),
    msg: 'missing one of the three headers (CONTEXT / INPUT / OUTPUT)' },
  { id: 'skills-sentence',
    test: (t) => /Identify the skills that are needed for the task and use them/.test(t),
    msg: 'missing the verbatim skills sentence that INPUT 2 must open with' },
  { id: 'soul-gate40',
    test: (t) => !/Re-read\s+`?soul\.md`?\s*\(repo root; mandatory after any compaction\)/.test(t),
    msg: 'carries the retired always-full-file soul demand; INPUT 1 re-reads the loaded soul core and pulls full soul.md only on a register miss' },
  { id: 'close-out',
    test: (t) => /Close-Out Gate/.test(t),
    msg: 'missing the Close-Out Gate reference, which is always the last OUTPUT step' },
  { id: 'built-for',
    test: (t) => /Built for:/.test(t),
    msg: 'missing the `Built for: <executor model>` line (it must be written INTO the saved file, not only said in chat)' },
  { id: 'suggested-effort',
    test: (t) => /Suggested effort:/.test(t),
    msg: 'missing the `Suggested effort:` line' },
  { id: 'no-blanket-verification',
    test: (t) => !/double-check/i.test(t),
    msg: 'contains a blanket verification instruction (verification hygiene: an external read-back, a render check, or a named gate only)' },
];

// The model-consistency cross-check. This is the one rule that could not exist before the model layer:
// a prompt built for Fable 5 that carries Opus 5 lines still reads perfectly, so nothing else reveals it.
function modelConsistency(txt) {
  const m = txt.match(/Built for:\s*([A-Za-z0-9.\- ]+?)\s*(?:-|$|\n)/);
  if (!m) return null;
  const model = m[1].trim().toLowerCase();
  const hasOpusOnly = /scope asked|Never a subagent to check work already finished/i.test(txt);
  const hasFableOnly = /audit each claim against a tool result|Delegate independent subtasks|keep working while they run/i.test(txt);
  if (/fable/.test(model) && hasOpusOnly) return 'Built for Fable 5 but carries Opus-5-only lines (the delegation cap / scope-asked line)';
  if (/opus/.test(model) && hasFableOnly) return 'Built for Opus 5 but carries Fable-5-only lines (grounded-progress / delegate-and-keep-working)';
  return null;
}

function wordCount(t) { return (t.match(/\S+/g) || []).length; }

function listDelivered() {
  const one = argOf('--file');
  if (one) return [path.resolve(one)];
  if (!fs.existsSync(OUTDIR)) return [];
  const since = argOf('--since') || RULES_LIVE_FROM;
  const n = parseInt(argOf('--n') || '3', 10);
  const days = fs.readdirSync(OUTDIR).filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d) && d >= since).sort().reverse();
  const files = [];
  for (const d of days) {
    const dir = path.join(OUTDIR, d);
    for (const f of fs.readdirSync(dir).filter((f) => f.endsWith('.md')).sort()) {
      files.push(path.join(dir, f));
      if (files.length >= n) return files;
    }
  }
  return files;
}

function runDelivered() {
  const files = listDelivered();
  const failures = [];
  if (!files.length) {
    console.log(`prompt-regression --delivered: no artifacts dated on/after ${argOf('--since') || RULES_LIVE_FROM} to audit (nothing to do).`);
    return 0;
  }
  for (const f of files) {
    if (!fs.existsSync(f)) { failures.push(`[${path.basename(f)}] target missing: ${f}`); continue; }
    const txt = fs.readFileSync(f, 'utf8');
    const rel = path.relative(REPO, f).replace(/\\/g, '/');
    for (const r of DELIVERED_RULES) if (!r.test(txt)) failures.push(`[${rel}] ${r.id}: ${r.msg}`);
    const mc = modelConsistency(txt);
    if (mc) failures.push(`[${rel}] model-consistency: ${mc}`);
    const w = wordCount(txt);
    if (w > 1200) failures.push(`[${rel}] length: ${w} words, over the 400-900 band (hard ceiling 1200). Point at a pattern instead of inlining it, or say in one line why this relay needs the size.`);
  }
  const tag = advisory ? 'WARNING' : 'FAILED';
  if (!failures.length) {
    console.log(`prompt-regression --delivered: PASS (${files.length} artifact(s), ${DELIVERED_RULES.length + 2} rules each).`);
    return 0;
  }
  console.error(`prompt-regression --delivered: ${failures.length} ${tag}(s) across ${files.length} artifact(s):`);
  for (const f of failures) console.error(`  ${tag}: ${f}`);
  return advisory ? 0 : 1;
}

/* ------------------------------------------------------------------ *
 * CASE MODE - the original instruction-file replay.
 * ------------------------------------------------------------------ */

function runCases() {
  let spec;
  try { spec = JSON.parse(fs.readFileSync(CASES, 'utf8')); }
  catch (e) { console.error(`prompt-regression: cannot read cases.json - ${e.message}`); return advisory ? 0 : 1; }

  const failures = [];
  let checked = 0, assertions = 0;
  for (const c of spec.cases || []) {
    const target = path.join(REPO, c.target);
    if (!fs.existsSync(target)) { failures.push(`[${c.id}] target missing: ${c.target}`); continue; }
    const txt = fs.readFileSync(target, 'utf8');
    checked++;
    for (const re of c.must_contain || []) {
      assertions++;
      if (!new RegExp(re).test(txt)) failures.push(`[${c.id}] MISSING required shape /${re}/ in ${c.target}`);
    }
    for (const re of c.must_not_contain || []) {
      assertions++;
      if (new RegExp(re).test(txt)) failures.push(`[${c.id}] FORBIDDEN shape /${re}/ present in ${c.target}`);
    }
  }

  if (!failures.length) {
    console.log(`prompt-regression: PASS (${checked} cases, ${assertions} assertions).`);
    return 0;
  }
  const tag = advisory ? 'WARNING' : 'FAILED';
  console.error(`prompt-regression: ${failures.length} ${tag}(s) across ${checked} cases:`);
  for (const f of failures) console.error(`  ${tag}: ${f}`);
  return advisory ? 0 : 1;
}

process.exit(delivered ? runDelivered() : runCases());
