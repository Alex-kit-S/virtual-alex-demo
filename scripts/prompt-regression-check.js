#!/usr/bin/env node
// @ts-check
// scripts/prompt-regression-check.js - holds production prompts, and the prompts /prompting delivered, to the
// shapes they must carry.
//
// WHAT. A prompt edit must never be a silent behaviour change. Each case in
// work/26-prompting/regression-cases/cases.json names a target file (a command file or a runbook) and the
// patterns it must and must not match, and the case replay reports every target that lost a required shape
// or gained a forbidden one. A green replay proves only that the instruction survived, so --delivered also
// audits what /prompting actually delivered, the markdown files under outputs/prompting/<date>/, against the
// rules work/26-prompting/CLAUDE.md sets for a delivered prompt. No model is called: every check is a string
// match.
//
// HOW. The case replay reads cases.json and, for each case whose target exists under the root, tests every
// must_contain and must_not_contain pattern against it; a missing target is a finding too. --delivered takes
// the one file --file names, or else the first --n (3) markdown files of the dated folders on or after --since
// (RULES_LIVE_FROM when absent), newest folder first and by name inside a folder, and holds each to the seven
// DELIVERED_RULES, the model consistency cross-check and the word ceiling. No outputs/prompting/ folder, or
// nothing dated on or after the cutover, is exit 0 with its own line: outputs/ is gitignored, so a fresh clone
// has nothing to audit. A clean run prints one PASS line on stdout. Findings print a count line and one
// FAILED line each on stderr; --advisory, the generator's step 3b, prints WARNING instead and exits 0. The
// command line parses through scripts/lib/args.js on the operator edge; a flag is on wherever it stands, a
// repeated value-flag's LAST occurrence wins, and `--flag=value` is read the same as `--flag value`. The root
// is the folder above this script's own.
//
// NEVER. Calls a model or writes a file. Runs past an unknown flag, a stray word on the command line, or a
// value flag given no value: this script has no hook or Routine caller (the generator's step 3b always passes
// fixed, valid arguments), so any of the three is an operator mistake, refused with exit 2, not a warning to
// carry on past. Fixes
// the defects scripts/tests/test-prompt-stale-checks.mjs pins (R8-14) before the defect ledger schedules them:
// the advisory findings go to stderr, so the generator step, which logs stdout, logs an empty line; a Built
// for value carrying a parenthesis skips the model cross-check; --n 0 audits one artifact and --n with a word
// audits every one; and several malformed inputs throw uncaught, under --advisory too: an invalid regex in
// cases.json, a cases.json that is not {cases: [{id, target}]}, or a target, --file or a dated folder that is
// a directory where a file is expected.
//
// Usage: node scripts/prompt-regression-check.js [--advisory]
//        node scripts/prompt-regression-check.js --delivered [--n <count>] [--since <YYYY-MM-DD>] [--file <path>]
//          [--advisory]
// Exit: 0 no finding, nothing to audit, or a finding under --advisory - 1 a finding, a missing target or an
//       unreadable cases.json (each 0 under --advisory), or 1 even under --advisory: any uncaught error (an
//       invalid regex in cases.json, a cases.json that is not {cases: [{id, target}]}, or a folder where a
//       file is expected) - 2 REFUSED: an unknown flag, a stray word, or a value flag with no value, whatever
//       else is on the line and even under --advisory
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { REPO } = require('./lib/repo-root');
const { readJsonHeaderless } = require('./lib/json-writer');
const { parseCommandLine } = require('./lib/args');
const { Refusal } = require('./lib/errors');

const CASES = path.join(REPO, 'work', '26-prompting', 'regression-cases', 'cases.json');
const OUTDIR = path.join(REPO, 'outputs', 'prompting');

// The cutover. Artifacts dated before it predate the delivered rules and are grandfathered: they are history,
// they are never re-run, and failing on them would keep this check red on a machine whose owner cannot debug it.
const RULES_LIVE_FROM = '2026-08-26';
/** How many artifacts --delivered audits when --n does not say. */
const DEFAULT_AUDITED = 3;
/** A delivered prompt's hard ceiling in words; the spec's band is 400 to 900. */
const WORD_CEILING = 1200;
/** The name of a dated folder under outputs/prompting/. */
const DAY_FOLDER = /^\d{4}-\d{2}-\d{2}$/;

/**
 * @typedef {object} DeliveredRule
 * @property {string} id
 * @property {(text: string) => boolean} test true when the artifact conforms
 * @property {string} msg what a failing artifact lacks or carries
 */

// Every rule here maps to something work/26-prompting/CLAUDE.md requires of a delivered prompt. Add no rule for
// a line the spec does not demand: a checker that asserts more than the spec can only be satisfied by reading
// the checker, which defeats the point of writing specs.
/** @type {DeliveredRule[]} */
const DELIVERED_RULES = [
  {
    id: 'three-headers',
    // Every header style in real use passes: bare (`CONTEXT`), a markdown heading (`# CONTEXT`) and bold
    // (`**CONTEXT**`). A false positive on a perfectly good artifact teaches the owner to ignore the guard.
    test: (t) =>
      /^\s*(?:#{1,6}\s*)?\**\s*CONTEXT\b/m.test(t) &&
      /^\s*(?:#{1,6}\s*)?\**\s*INPUT\b/m.test(t) &&
      /^\s*(?:#{1,6}\s*)?\**\s*OUTPUT\b/m.test(t),
    msg: 'missing one of the three headers (CONTEXT / INPUT / OUTPUT)'
  },
  {
    id: 'skills-sentence',
    test: (t) => /Identify the skills that are needed for the task and use them/.test(t),
    msg: 'missing the verbatim skills sentence that INPUT 2 must open with'
  },
  {
    id: 'soul-gate40',
    test: (t) => !/Re-read\s+`?soul\.md`?\s*\(repo root; mandatory after any compaction\)/.test(t),
    msg: 'carries the retired always-full-file soul demand; INPUT 1 re-reads the loaded soul core and pulls full soul.md only on a register miss'
  },
  {
    id: 'close-out',
    test: (t) => /Close-Out Gate/.test(t),
    msg: 'missing the Close-Out Gate reference, which is always the last OUTPUT step'
  },
  {
    id: 'built-for',
    test: (t) => /Built for:/.test(t),
    msg: 'missing the `Built for: <executor model>` line (it must be written INTO the saved file, not only said in chat)'
  },
  {
    id: 'suggested-effort',
    test: (t) => /Suggested effort:/.test(t),
    msg: 'missing the `Suggested effort:` line'
  },
  {
    id: 'no-blanket-verification',
    test: (t) => !/double-check/i.test(t),
    msg: 'contains a blanket verification instruction (verification hygiene: an external read-back, a render check, or a named gate only)'
  }
];

/** The checks every artifact gets beside DELIVERED_RULES, counted in the PASS line. */
const EXTRA_CHECKS = ['model-consistency', 'length'];

/**
 * @typedef {object} Options
 * @property {boolean} advisory
 * @property {boolean} delivered
 * @property {string | null | undefined} file the --file value
 * @property {string} since the --since value, or RULES_LIVE_FROM
 * @property {number} count the --n value as parseInt reads it, NaN included
 */

/**
 * @typedef {object} RegressionCase
 * @property {string} id
 * @property {string} target a path from the root
 * @property {string[]} [must_contain]
 * @property {string[]} [must_not_contain]
 */

/**
 * The flags this script knows, read through scripts/lib/args.js on the operator edge.
 * @type {import('node:util').ParseArgsOptionsConfig}
 */
const FLAGS = {
  advisory: { type: 'boolean' },
  delivered: { type: 'boolean' },
  file: { type: 'string' },
  since: { type: 'string' },
  n: { type: 'string' }
};

/**
 * The command line, parsed: a flag is on wherever it stands, and a repeated value-flag's last occurrence
 * wins, as node:util's parseArgs reads it.
 * @param {Record<string, string | boolean | undefined>} values parseCommandLine's own values
 * @returns {Options}
 */
function readOptions(values) {
  return {
    advisory: Boolean(values.advisory),
    delivered: Boolean(values.delivered),
    file: typeof values.file === 'string' ? values.file : null,
    since: typeof values.since === 'string' ? values.since : RULES_LIVE_FROM,
    count: parseInt(typeof values.n === 'string' ? values.n : String(DEFAULT_AUDITED), 10)
  };
}

/**
 * The model consistency cross-check: a prompt built for one model that carries the other model's lines still
 * reads perfectly, so nothing else reveals it.
 * @param {string} text the artifact
 * @returns {string | null} the mismatch, or null when there is none or no `Built for:` value it can read
 */
function modelConsistency(text) {
  const m = text.match(/Built for:\s*([A-Za-z0-9.\- ]+?)\s*(?:-|$|\n)/);
  if (!m) return null;
  const model = m[1].trim().toLowerCase();
  const hasOpusOnly = /scope asked|Never a subagent to check work already finished/i.test(text);
  const hasFableOnly =
    /audit each claim against a tool result|Delegate independent subtasks|keep working while they run/i.test(text);
  if (/fable/.test(model) && hasOpusOnly)
    return 'Built for Fable 5 but carries Opus-5-only lines (the delegation cap / scope-asked line)';
  if (/opus/.test(model) && hasFableOnly)
    return 'Built for Opus 5 but carries Fable-5-only lines (grounded-progress / delegate-and-keep-working)';
  return null;
}

/**
 * @param {string} text
 * @returns {number} the runs of non-space characters
 */
function wordCount(text) {
  return (text.match(/\S+/g) || []).length;
}

/**
 * The artifacts --delivered audits, as absolute paths.
 * @param {Options} options
 * @returns {string[]} the --file path alone, or the first `count` markdown files of the dated folders on or after
 *   `since`, newest folder first and by name inside a folder
 */
function listDelivered({ file, since, count }) {
  if (file) return [path.resolve(file)];
  if (!fs.existsSync(OUTDIR)) return [];
  const days = fs
    .readdirSync(OUTDIR)
    .filter((d) => DAY_FOLDER.test(d) && d >= since)
    .sort()
    .reverse();
  /** @type {string[]} */
  const files = [];
  for (const day of days) {
    const dir = path.join(OUTDIR, day);
    for (const name of fs
      .readdirSync(dir)
      .filter((f) => f.endsWith('.md'))
      .sort()) {
      files.push(path.join(dir, name));
      // Compared after the push: --n 0 still audits one artifact, and a count that is not a number audits all.
      if (files.length >= count) return files;
    }
  }
  return files;
}

/**
 * Every finding one delivered artifact earns, in rule order.
 * @param {string} file an absolute path that exists
 * @returns {string[]} each `[<path from the root>] <check>: <message>`
 */
function auditArtifact(file) {
  const text = fs.readFileSync(file, 'utf8');
  const rel = path.relative(REPO, file).replace(/\\/g, '/');
  const findings = DELIVERED_RULES.filter((rule) => !rule.test(text)).map((rule) => `[${rel}] ${rule.id}: ${rule.msg}`);
  const mismatch = modelConsistency(text);
  if (mismatch) findings.push(`[${rel}] model-consistency: ${mismatch}`);
  const words = wordCount(text);
  if (words > WORD_CEILING)
    findings.push(
      `[${rel}] length: ${words} words, over the 400-900 band (hard ceiling ${WORD_CEILING}). Point at a pattern instead of inlining it, or say in one line why this relay needs the size.`
    );
  return findings;
}

/**
 * Prints a run's result and returns its exit code: the PASS line on stdout, or a count line and one line per
 * finding on stderr, tagged WARNING and exit 0 under --advisory, FAILED and exit 1 otherwise.
 * @param {{ prefix: string, pass: string, scope: string, failures: string[], advisory: boolean }} result
 * @returns {number}
 */
function report({ prefix, pass, scope, failures, advisory }) {
  if (!failures.length) {
    console.log(`${prefix}: ${pass}`);
    return 0;
  }
  const tag = advisory ? 'WARNING' : 'FAILED';
  console.error(`${prefix}: ${failures.length} ${tag}(s) across ${scope}:`);
  for (const f of failures) console.error(`  ${tag}: ${f}`);
  return advisory ? 0 : 1;
}

/**
 * --delivered: the audit of the artifacts /prompting saved.
 * @param {Options} options
 * @returns {number} the exit code
 */
function runDelivered(options) {
  const files = listDelivered(options);
  if (!files.length) {
    console.log(
      `prompt-regression --delivered: no artifacts dated on/after ${options.since} to audit (nothing to do).`
    );
    return 0;
  }
  /** @type {string[]} */
  const failures = [];
  for (const f of files) {
    if (fs.existsSync(f)) failures.push(...auditArtifact(f));
    else failures.push(`[${path.basename(f)}] target missing: ${f}`);
  }
  return report({
    prefix: 'prompt-regression --delivered',
    pass: `PASS (${files.length} artifact(s), ${DELIVERED_RULES.length + EXTRA_CHECKS.length} rules each).`,
    scope: `${files.length} artifact(s)`,
    failures,
    advisory: options.advisory
  });
}

/**
 * The case replay over cases.json. An invalid regex in a case throws out of here.
 * @param {boolean} advisory
 * @returns {number} the exit code
 */
function runCases(advisory) {
  /** @type {{ cases?: RegressionCase[] }} */
  let spec;
  try {
    spec = readJsonHeaderless(CASES);
  } catch (/** @type {any} */ e) {
    console.error(`prompt-regression: cannot read cases.json - ${e.message}`);
    return advisory ? 0 : 1;
  }
  /** @type {string[]} */
  const failures = [];
  let checked = 0;
  let assertions = 0;
  for (const c of spec.cases || []) {
    const target = path.join(REPO, c.target);
    if (!fs.existsSync(target)) {
      failures.push(`[${c.id}] target missing: ${c.target}`);
      continue;
    }
    const text = fs.readFileSync(target, 'utf8');
    checked++;
    for (const re of c.must_contain || []) {
      assertions++;
      if (!new RegExp(re).test(text)) failures.push(`[${c.id}] MISSING required shape /${re}/ in ${c.target}`);
    }
    for (const re of c.must_not_contain || []) {
      assertions++;
      if (new RegExp(re).test(text)) failures.push(`[${c.id}] FORBIDDEN shape /${re}/ present in ${c.target}`);
    }
  }
  return report({
    prefix: 'prompt-regression',
    pass: `PASS (${checked} cases, ${assertions} assertions).`,
    scope: `${checked} cases`,
    failures,
    advisory
  });
}

/**
 * @param {string[]} argv the arguments after the script's path
 * @returns {number} the exit code
 */
function main(argv) {
  /** @type {Record<string, string | boolean | undefined>} */
  let values;
  try {
    ({ values } = /** @type {{ values: Record<string, string | boolean | undefined> }} */ (
      parseCommandLine({ name: 'prompt-regression', edge: 'operator', options: FLAGS, argv })
    ));
  } catch (e) {
    if (!(e instanceof Refusal)) throw e;
    console.error(`prompt-regression: REFUSED, ${/** @type {Error} */ (e).message}`);
    return 2;
  }
  const options = readOptions(values);
  return options.delivered ? runDelivered(options) : runCases(options.advisory);
}

process.exit(main(process.argv.slice(2)));
