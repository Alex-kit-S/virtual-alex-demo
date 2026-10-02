#!/usr/bin/env node
// @ts-check
// work/23-self-review/diagnose/diagnose.js - names the instruction behind a correction, behind a confidence gate.
//
// WHAT. The weekly self-review clusters the owner's corrections; this file asks which instruction caused one,
// so a fix lands on the cause and the same class of mistake does not come back in new clothes. It bounds the
// files a culprit may be cited from, records the reasoning step's answer behind a confidence gate, queues the
// proposed fix for the owner, and 60 days on asks the world whether the same class of correction came back.
// A diagnosis below the gate is still recorded, as no-attribution: most corrections trace to no single line,
// and seeing that is part of the point.
//
// HOW. This is the deterministic half of a split; the /self-review run does the reasoning. corpus prints the bounded
// set: CLAUDE.md, soul.md and, with --project, that project's CLAUDE.md under the manifest's work_dir, read through
// json-writer.js's readJsonHeaderless. The run names the culprit from that set with a quoted span, file:line and a
// confidence from 0 to 100, and record stores it. A diagnosis's id is diag-<the date without dashes>-<the first 8 hex
// of sha1(date|correction)>. At 80 or more it needs --file and --span, is open with a resolve-by date 60 days on, and
// queues one proposal through `node scripts/human-actions.js add` (severity low), which --dry-run skips; below 80 it
// proposes nothing. A queued proposal is read back, against the queue's own listing, before "+ queued gated proposal"
// prints; a failed, timed-out or unconfirmed read-back prints what happened instead, and the diagnosis stands either
// way. resolve takes every open diagnosis on or past its resolve-by date, looks in the corrections log for a later
// heading `## [YYYY-MM-DD ...] type=<class>` of the same class, reads the proposal as applied when the queue's
// listing no longer carries its id, appends a resolve event and prints stats. stats counts the rows and, among
// resolved diagnoses whose fix was applied, those whose class did not recur. The log, vault/projects/self-review/
// diagnoses.jsonl, is append-only: the latest row per id wins, a resolve event updates its diagnosis, and every
// append is read back. ALEX_DIAGNOSES_LOG, ALEX_CORRECTIONS_LOG and ALEX_DIAGNOSE_CHILD_TIMEOUT_MS override
// those paths and the child timeout; an unknown flag on this Routine edge just warns and carries on.
//
// NEVER. Edits CLAUDE.md, soul.md or any instruction: it writes the diagnoses log and, through human-actions, the
// owner's queue, and nothing else, because the constitution changes only by the owner's hand. Calls a model. Prints "+
// queued gated proposal" over a queue write that failed or did not read back (DG-1, fixed): the diagnosis is recorded
// either way, but the line now says which. Fixes in passing a defect test-waiting-diagnose.mjs pins: recurrence reads
// a heading shape no writer is told to use, so `type: format` reads as "did not recur" (R8-9), and --dry-run writes
// the diagnosis and skips only the queueing, after which resolve reads the absent proposal as applied (R8-10).
//
// contract: read as text by scripts/tests/test-waiting-diagnose.mjs:994 (Usage vs CORPUS_FLAGS/RECORD_FLAGS).
// Usage: node work/23-self-review/diagnose/diagnose.js corpus [--project <name>]
//        node work/23-self-review/diagnose/diagnose.js record --correction <ref> --class <type> --confidence <0-100>
//          [--file <path> --line <n> --span <quote>] [--proposal <fix>] [--date YYYY-MM-DD] [--dry-run]
//        node work/23-self-review/diagnose/diagnose.js resolve | stats
// Exit: 0 done - 1 a usage error, an attributed diagnosis with no --file or --span, a failed read-back, a crash
'use strict';

const crypto = require('node:crypto');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const { readJsonHeaderless } = require('../../../scripts/lib/json-writer');
const { REPO } = require('../../../scripts/lib/repo-root');

const DIAG = process.env.ALEX_DIAGNOSES_LOG || path.join(REPO, 'vault', 'projects', 'self-review', 'diagnoses.jsonl');
const CORR =
  process.env.ALEX_CORRECTIONS_LOG || path.join(REPO, 'vault', 'projects', 'teach-alex', 'corrections-log.md');
const MANIFEST = path.join(REPO, 'system', 'manifest.json');
// Below this confidence there is no attributable instruction, and nothing is proposed.
const CONFIDENCE_GATE = 80;
const RESOLVE_DAYS = 60;
const ID_HASH_LENGTH = 8;
// How long record() and resolve() wait for the human-actions child before treating it as hung; a test
// overrides this to make that path fast to exercise.
const CHILD_TIMEOUT_MS = Number(process.env.ALEX_DIAGNOSE_CHILD_TIMEOUT_MS) || 30_000;
// How much of the span and of the correction the queued proposal quotes.
const QUOTE_LENGTH = 80;

/**
 * @typedef {object} Culprit the instruction a diagnosis names
 * @property {string | undefined} file
 * @property {number | null} line
 * @property {string | null} span
 */

/**
 * @typedef {object} Diagnosis
 * @property {string} id
 * @property {string} date YYYY-MM-DD
 * @property {string} correction
 * @property {string} class
 * @property {number} confidence NaN for a confidence that is not a number, stored as null
 * @property {Culprit | null} culprit
 * @property {string | null} proposal
 * @property {string} status open, no-attribution or resolved
 * @property {string | null} resolve_by YYYY-MM-DD
 * @property {boolean | null} recurred
 * @property {string} [resolved_date]
 * @property {boolean | null} [applied]
 */

/**
 * @typedef {object} ResolveEvent the row resolve appends; it updates the diagnosis of the same id
 * @property {string} id
 * @property {true} resolve_event
 * @property {string} resolved_date YYYY-MM-DD
 * @property {boolean} recurred
 * @property {boolean | null} applied null when the human-actions list could not be read
 */

/**
 * Parse one subcommand's own arguments (the command line after the subcommand word) through
 * scripts/lib/args.js, and return the values corpus() and record() read instead of scanning process.argv
 * by hand. An unrecognised flag warns on stderr and is dropped (the routine edge never refuses one of
 * those), but a KNOWN flag given no value, or given another flag's own name as its value, is a Refusal
 * this program stops over: node's parseArgs treats any dash-led separate-token value as ambiguous for a
 * string option, known flag name or not, so `record --file --span q` never lets "--span" become --file's
 * value by accident.
 * @param {Record<string, { type: 'string' | 'boolean' }>} options this subcommand's known flags
 * @param {string[]} argv the command line after the subcommand word
 * @returns {Record<string, string | boolean | undefined>}
 */
function parseRoutine(options, argv) {
  const { parseCommandLine } = require('../../../scripts/lib/args');
  const { Refusal } = require('../../../scripts/lib/errors');
  try {
    return /** @type {Record<string, string | boolean | undefined>} */ (
      parseCommandLine({ name: 'diagnose', edge: 'routine', options, allowPositionals: false, argv }).values
    );
  } catch (error) {
    if (!(error instanceof Refusal)) throw error;
    console.error(`diagnose: REFUSED - ${/** @type {Error} */ (error).message}`);
    process.exit(1);
  }
}

const today = () => new Date().toISOString().slice(0, 10);

/**
 * The day `n` days after `iso`, in UTC.
 * @param {string} iso YYYY-MM-DD
 * @param {number} n
 */
function addDays(iso, n) {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/** Every diagnosis by id, the latest row winning and each resolve event folded into its diagnosis. */
function load() {
  /** @type {Map<string, Diagnosis>} */
  const byId = new Map();
  if (!fs.existsSync(DIAG)) return byId;
  for (const line of fs.readFileSync(DIAG, 'utf8').split('\n')) {
    const t = line.trim();
    if (!t) continue;
    let r;
    try {
      r = JSON.parse(t);
    } catch {
      continue;
    }
    if (r.resolve_event) {
      const p = byId.get(r.id);
      if (p) {
        Object.assign(p, {
          status: 'resolved',
          recurred: r.recurred,
          resolved_date: r.resolved_date,
          applied: r.applied
        });
      }
    } else byId.set(r.id, r);
  }
  return byId;
}

/**
 * Append one row and read the last line back: it must parse and carry this row's id; a torn one crashes (kept).
 * @param {Diagnosis | ResolveEvent} obj
 */
function append(obj) {
  fs.mkdirSync(path.dirname(DIAG), { recursive: true });
  fs.appendFileSync(DIAG, `${JSON.stringify(obj)}\n`, 'utf8');
  const lines = fs.readFileSync(DIAG, 'utf8').trim().split('\n');
  if (JSON.parse(lines[lines.length - 1]).id !== obj.id) {
    console.error('diagnose: append verify FAILED');
    process.exit(1);
  }
}

/** The project registry, system/manifest.json. */
function manifest() {
  return readJsonHeaderless(MANIFEST);
}

/**
 * The CLAUDE.md of a project the manifest registers with a work_dir, or null.
 * @param {string} name
 */
function projectClaudeMd(name) {
  const m = manifest();
  const all = [...(m.projects || []), ...(m.meta?.unnumbered || [])];
  const row = all.find((p) => p.name === name);
  return row?.work_dir ? path.join(row.work_dir, 'CLAUDE.md') : null;
}

/**
 * `corpus`: the files the reasoning step may cite, and the rules it answers under.
 * @param {Record<string, string | boolean | undefined>} values
 */
function corpus(values) {
  const project = /** @type {string | undefined} */ (values.project);
  const files = [
    ['CLAUDE.md', 'root: Standing Orders, gates, model-routing, the Skill Bindings table'],
    ['soul.md', 'voice + identity (gitignored; law even so)']
  ];
  if (project) {
    const p = projectClaudeMd(project);
    if (p) files.push([p.replace(/\\/g, '/'), `#${project} behaviour`]);
    else console.error(`(no work_dir for project '${project}' in the manifest)`);
  }
  console.log('Bounded candidate instruction corpus (the ONLY files the reasoning step may cite):');
  for (const [f, why] of files) console.log(`  ${f}  <- ${why}`);
  console.log('\nRules for the reasoning step (Alex, claude-sonnet-4-6, no voice block):');
  console.log(`  - cite a quoted span + file:line from WITHIN this set, or return confidence < ${CONFIDENCE_GATE}.`);
  console.log('  - "no attributable instruction" is a legitimate, common answer. Do not invent a culprit.');
}

/**
 * A diagnosis's id: its date without dashes and a short hash of the date and the correction.
 * @param {string} date
 * @param {string} correction
 */
function diagnosisId(date, correction) {
  const hash = crypto.createHash('sha1').update(`${date}|${correction}`).digest('hex').slice(0, ID_HASH_LENGTH);
  return `diag-${date.replace(/-/g, '')}-${hash}`;
}

/**
 * Describe a human-actions child's failure for a warning line: its own stderr when it wrote any, or, when
 * it was killed for running past CHILD_TIMEOUT_MS, that instead (execFileSync sets `.signal` on a timeout
 * kill). A Buffer is truthy even when it holds zero bytes, so an empty stderr falls through to the child's
 * own exit status and execFileSync's own message, never a trimmed empty string.
 * @param {Error & { stderr?: Buffer, signal?: string | null, status?: number | null }} e
 */
function describeChildError(e) {
  if (e.signal) return `the queue did not answer within ${CHILD_TIMEOUT_MS}ms (killed with ${e.signal})`;
  const stderr = e.stderr ? e.stderr.toString().trim() : '';
  if (stderr) return stderr;
  return typeof e.status === 'number' ? `the child exited ${e.status}: ${e.message}` : e.message;
}

/**
 * True when human-actions' own listing carries an open row for `id`, matched on the listing's row shape
 * (`- [SEVERITY] <id> (`), never a plain substring of the whole listing, which would also match `id` inside
 * another item's `what` text. record() and resolve() both read the queue back through this one function,
 * so one reader interprets the queue for both.
 * @param {string} id
 * @returns {boolean}
 */
function queueListsId(id) {
  const list = execFileSync('node', ['scripts/human-actions.js', 'list'], {
    cwd: REPO,
    stdio: 'pipe',
    timeout: CHILD_TIMEOUT_MS
  }).toString();
  const escaped = id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`^- \\[[A-Z]+\\] ${escaped} \\(`, 'm').test(list);
}

/**
 * The proposal the owner's queue receives for an attributed diagnosis.
 * @param {Diagnosis} rec
 * @param {Culprit} culprit
 * @param {string} correction
 */
function proposalText(rec, culprit, correction) {
  const where = `${culprit.file}:${culprit.line || '?'}`;
  const quote = (culprit.span || '').slice(0, QUOTE_LENGTH);
  const change = rec.proposal ? `Suggested change: ${rec.proposal}. ` : '';
  return `PROPOSED instruction fix (self-review diagnose, confidence ${rec.confidence}): ${where} - "${quote}". ${change}From correction: "${correction.slice(0, QUOTE_LENGTH)}". Alex proposes; you edit the source + regenerate. Never auto-applied. Resolve-by ${rec.resolve_by}.`;
}

/**
 * `record`: store one diagnosis and, when it clears the gate, queue its proposal for the owner.
 * @param {Record<string, string | boolean | undefined>} values
 */
function record(values) {
  const correction = /** @type {string | undefined} */ (values.correction);
  const klass = /** @type {string | undefined} */ (values.class);
  if (!correction || !klass) {
    console.error('record needs --correction and --class');
    process.exit(1);
  }
  const confidence = parseInt(/** @type {string} */ (values.confidence) || '0', 10);
  const date = /** @type {string} */ (values.date) || today();
  const id = diagnosisId(date, correction);
  const attributed = confidence >= CONFIDENCE_GATE;
  const line = /** @type {string | undefined} */ (values.line);
  const file = /** @type {string | undefined} */ (values.file);
  const span = /** @type {string | undefined} */ (values.span);
  /** @type {Culprit | null} */
  const culprit = attributed ? { file, line: line ? parseInt(line, 10) : null, span: span || null } : null;
  /** @type {Diagnosis} */
  const rec = {
    id,
    date,
    correction,
    class: klass,
    confidence,
    culprit,
    proposal: attributed ? /** @type {string | undefined} */ (values.proposal) || null : null,
    status: attributed ? 'open' : 'no-attribution',
    resolve_by: attributed ? addDays(date, RESOLVE_DAYS) : null,
    recurred: null
  };
  if (culprit && (!culprit.file || !culprit.span)) {
    console.error(`an attributed diagnosis (confidence >= ${CONFIDENCE_GATE}) needs --file and --span`);
    process.exit(1);
  }
  append(rec);
  if (!culprit) {
    console.log(
      `recorded: ${id} -> NO attributable instruction (confidence ${confidence} < ${CONFIDENCE_GATE}). Nothing proposed. This is the honest common case.`
    );
    return;
  }
  const what = proposalText(rec, culprit, correction);
  const why =
    'Editing CLAUDE.md/soul.md is hand-authored law, gated to the owner (NEVER-TOUCH / #23 hard rule). Diagnose only proposes.';
  if (values['dry-run']) {
    console.log(
      `recorded: ${id} (open, resolve-by ${rec.resolve_by}). DRY-RUN, would queue human-action:\n  id=${id} sev=low\n  ${what}`
    );
    return;
  }
  // The line below says "+ queued gated proposal" only once the queue's own listing has been read back and
  // shows the row open, whether or not `add` itself threw - an `add` that refused because the id is
  // already open (a repeat correction) still leaves the row genuinely queued, and only the listing
  // answers that. Both children get CHILD_TIMEOUT_MS, so a hung child never hangs record() with it.
  /** @type {(Error & { stderr?: Buffer, signal?: string | null, status?: number | null }) | null} */
  let addError = null;
  try {
    execFileSync(
      'node',
      ['scripts/human-actions.js', 'add', '--id', id, '--what', what, '--why', why, '--severity', 'low'],
      { cwd: REPO, stdio: 'pipe', timeout: CHILD_TIMEOUT_MS }
    );
  } catch (e) {
    addError = /** @type {Error & { stderr?: Buffer, signal?: string | null, status?: number | null }} */ (e);
  }
  let queued = false;
  /** @type {(Error & { stderr?: Buffer, signal?: string | null, status?: number | null }) | null} */
  let listError = null;
  try {
    queued = queueListsId(id);
  } catch (e) {
    listError = /** @type {Error & { stderr?: Buffer, signal?: string | null, status?: number | null }} */ (e);
  }
  if (queued) {
    console.log(`recorded: ${id} (open, resolve-by ${rec.resolve_by}) + queued gated proposal ${id}.`);
  } else {
    // addError first: when add itself refused or crashed, that is the actionable diagnostic, and the read-back
    // (which still ran) only had a fact worth reporting on its own when add did NOT throw - a hung or broken
    // `list` behind a perfectly good `add` is a different, narrower failure from "the queue is unreachable".
    const reason = addError
      ? `proposal not queued: ${describeChildError(addError)}`
      : listError
        ? `queue state unknown: ${describeChildError(listError)}`
        : 'proposal not queued: the queue does not list it back';
    console.error(`warning: human-actions ${reason}`);
    console.log(`recorded: ${id} (open, resolve-by ${rec.resolve_by}). Proposal NOT confirmed queued.`);
  }
}

/**
 * True when the corrections log holds a correction of `klass` dated after `dateIso`.
 * @param {string} dateIso
 * @param {string} klass
 */
function correctionsAfter(dateIso, klass) {
  if (!fs.existsSync(CORR)) return false;
  // Built per call: the pattern is global, and a shared one would keep its lastIndex from the last search.
  const re = /^##\s*\[(\d{4}-\d{2}-\d{2})[^\]]*\]\s*type=([a-z-]+)/gim;
  const text = fs.readFileSync(CORR, 'utf8');
  let m = re.exec(text);
  while (m) {
    if (m[1] > dateIso && m[2] === klass) return true;
    m = re.exec(text);
  }
  return false;
}

/** `resolve`: score every open diagnosis past its resolve-by date, then print the stats. */
function resolve() {
  const byId = load();
  const due = [...byId.values()].filter((d) => d.status === 'open' && d.resolve_by && d.resolve_by <= today());
  if (!due.length) {
    console.log('resolve: no open diagnoses are due yet.');
    return;
  }
  for (const d of due) {
    const recurred = correctionsAfter(d.date, d.class);
    // Applied means the owner closed the queued proposal: its id is no longer open in the queue's own
    // listing (queueListsId, the same reader record() uses). A list that cannot be read leaves it unknown.
    let applied = null;
    try {
      applied = !queueListsId(d.id);
    } catch {}
    append({ id: d.id, resolve_event: true, resolved_date: today(), recurred, applied });
    console.log(
      `resolved ${d.id}: class=${d.class} recurred=${recurred} applied=${applied}` +
        (recurred
          ? '  (class returned -> the diagnosis likely missed, or the fix was not applied)'
          : '  (class did not return -> consistent with a correct diagnosis IF the fix was applied)')
    );
  }
  stats();
}

/** `stats`: the row counts, and the diagnoser's record over the resolved diagnoses whose fix was applied. */
function stats() {
  const all = [...load().values()];
  const c = (/** @type {(d: Diagnosis) => boolean} */ f) => all.filter(f).length;
  const resolvedAttrib = all.filter((d) => d.status === 'resolved');
  // Only an applied fix can score the diagnoser: an unapplied one says nothing about the diagnosis.
  const scored = resolvedAttrib.filter((d) => d.applied === true);
  const right = scored.filter((d) => d.recurred === false).length;
  console.log(
    `diagnoses: ${all.length} total | open ${c((d) => d.status === 'open')} | no-attribution ${c((d) => d.status === 'no-attribution')} | resolved ${resolvedAttrib.length}`
  );
  if (scored.length) {
    console.log(
      `diagnoser accuracy (of applied+resolved): ${right}/${scored.length} did not recur. Small n; a signal, never a scoreboard.`
    );
  } else {
    console.log(
      'diagnoser accuracy: not enough applied+resolved diagnoses to say (by design, ~a dozen resolved rows/year).'
    );
  }
}

// corpus's and record's own flags: the one table each subcommand's parseRoutine call reads below, so a
// flag added to or dropped from one is a change everyone can see in one place.
/** @type {Record<string, { type: 'string' | 'boolean' }>} */
const CORPUS_FLAGS = { project: { type: 'string' } };
/** @type {Record<string, { type: 'string' | 'boolean' }>} */
const RECORD_FLAGS = {
  correction: { type: 'string' },
  class: { type: 'string' },
  confidence: { type: 'string' },
  file: { type: 'string' },
  line: { type: 'string' },
  span: { type: 'string' },
  proposal: { type: 'string' },
  date: { type: 'string' },
  'dry-run': { type: 'boolean' }
};
const cmd = process.argv[2];
const cmdArgs = process.argv.slice(3);
// The parse runs once per invocation here, never inside resolve()/stats() themselves, since resolve calls
// stats() internally and a second parse on the same command line would warn about the same flag twice.
if (cmd === 'corpus') {
  corpus(parseRoutine(CORPUS_FLAGS, cmdArgs));
} else if (cmd === 'record') {
  record(parseRoutine(RECORD_FLAGS, cmdArgs));
} else if (cmd === 'resolve') {
  parseRoutine({}, cmdArgs);
  resolve();
} else if (cmd === 'stats') {
  parseRoutine({}, cmdArgs);
  stats();
} else {
  console.error('usage: diagnose.js corpus|record|resolve|stats  (see header)');
  process.exit(1);
}
