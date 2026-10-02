#!/usr/bin/env node
// @ts-check
// scripts/lib/template-gate.mjs - where /update fetches this Alex's template from, and whether that
// template head passed its CI.
//
// WHAT. The two answers /update needs before it changes anything, each a refusal when it cannot give one.
// `remote` prints the template's address from system/template-source.json, the file the template build
// (scripts/build-online-template.mjs) writes into every tree it generates. A seed's file names the
// generic template too, because owners update from the template, never from their seed. `ci <sha>`
// passes a template head only when the newest run of its CI job on exactly that commit finished with
// success, so an owner never applies a head whose tests failed or have not finished.
//
// HOW. readTemplateSource(root) reads the file through json-writer.js readJson under its schema and
// accepts one address shape, https://github.com/<owner>/<repo> with an optional .git and trailing slash,
// which it prints without them. readChecks asks gh for one page of the check runs of the job named
// CI_CHECK on that commit, through the cloud session's GitHub proxy, which answers only for repositories
// attached to the session; in a one-repository session the read is refused with a sentence saying to
// attach the template, the two-repository session /update already describes. ciVerdict judges the run
// with the highest id. main(argv) parses the command line through scripts/lib/args.js on the operator
// edge: `--root <dir>` or `--root=<dir>` reads another tree (the tests use it), the rest is the command
// and its sha. A refusal is a Refusal, printed as one line on stderr: exit 1 for a line this gate cannot
// parse (an unknown flag, a stray word), exit 2 for every other refusal.
//
// NEVER. Guesses an address: a missing file, or one that names no GitHub repository, refuses rather than
// falling back to a constant. Reads the check runs of another app or workflow: the template also carries
// a heartbeat workflow that fails by design when dispatched there, and other apps can queue suites that
// never finish, so only the job named CI_CHECK counts. Writes anything. Decides whether it was run or
// imported by comparing typed paths: Node resolves the main module through links (macOS's /var ->
// /private/var temp folder, a junction on Windows), and a gate that thinks it was imported exits 0 having
// decided nothing. Leaves scripts/lib/: the online settings deny Edit on that path, so a session cannot
// quietly weaken the gate an owner's next /update relies on, and every template build that changes it
// names it as a sensitive file in the changelog /update prints before its yes. An unknown flag or a stray
// word is an operator's mistake, not a model's, so it refuses with exit 1 rather than running on a guess.
// Knowingly keeps the defects scripts/tests/test-template-gate-cli.mjs pins (R4-7, R4-L1, R4-L3): an SSH
// address is refused, a missing gh is told to attach the template, and only the first page of check runs
// is read.
//
// Usage: node scripts/lib/template-gate.mjs remote [--root <dir>]
//        node scripts/lib/template-gate.mjs ci <40-character sha> [--root <dir>]
// Exit: 0 the url, or the green line, on stdout - 1 a script error - 2 refused, one line on stderr

import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { readJson } = require('./json-writer.js');
const { REPO } = require('./repo-root.js');
const { Refusal, isMain } = require('./errors.js');
const { EXIT } = require('./exit-codes.js');

export const SOURCE_REL = 'system/template-source.json';
export const SOURCE_SCHEMA = 'template-source@1';
// The job id in the template's .github/workflows/ci.yml (generated from the Kit's
// variants/online/.github/workflows/ci.yml). An owner's gate reads a NEWER template's check runs, so a
// rename there would refuse every owner for ever; scripts/tests/test-template-gate.mjs fails the Kit
// when that job is not named this.
export const CI_CHECK = 'portable-tests';
const GITHUB_REPO = /^https:\/\/github\.com\/([A-Za-z0-9-]+)\/([A-Za-z0-9._-]+?)(?:\.git)?\/?$/;
// A template head as /update passes it: a full, lowercase commit sha.
const FULL_SHA = /^[0-9a-f]{40}$/;
// How much of a sha a sentence shows.
const SHORT_SHA = 12;
// The check runs one gh call asks for; a second page is never read.
const CHECK_RUNS_PAGE = 100;
const USAGE = 'usage: node scripts/lib/template-gate.mjs remote | ci <sha> [--root <dir>]';
// How a refusal the owner cannot fix alone ends.
const TELL_MAINTAINER = 'Nothing has changed. Send this line to whoever maintains the template.';
const EXIT_OK = 0;

/**
 * One check run as the GitHub API answers it; only these fields are read.
 * @typedef {object} CheckRun
 * @property {number | string} id
 * @property {string} name the job
 * @property {string} head_sha the commit it tested
 * @property {string} status 'completed' once it has finished
 * @property {string | null} conclusion 'success' when it passed
 * @property {string} [details_url]
 * @property {string} [html_url]
 */

/**
 * @typedef {object} Verdict
 * @property {boolean} green true only for a finished, successful newest run
 * @property {CheckRun} [run] the run judged, when there is one
 * @property {string} why the sentence the owner is shown
 */

/**
 * What running gh answered, in spawnSync's shape.
 * @typedef {{ status?: number | null, stdout?: string, stderr?: string, error?: Error } | null | undefined} GhResult
 */

// Refusal is the one class every file in this tree throws for "will not", never "could not"; a bare
// `new Refusal(message)` here still carries EXIT.REFUSED, so every existing call below is unchanged.
export { Refusal };

/**
 * The template's address from <root>/system/template-source.json, or a Refusal in plain words.
 * @param {string} [root] the tree, this checkout by default
 * @returns {{ remote: string, repo: string }} the https url and owner/repo
 */
export function readTemplateSource(root = REPO) {
  const file = path.join(root, SOURCE_REL);
  if (!fs.existsSync(file)) {
    throw new Refusal(
      `${SOURCE_REL} is missing, so I do not know which template this Alex updates from. ${TELL_MAINTAINER}`
    );
  }
  let data;
  try {
    data = readJson(file, SOURCE_SCHEMA);
  } catch (e) {
    throw new Refusal(`${SOURCE_REL} cannot be read (${/** @type {Error} */ (e).message}). ${TELL_MAINTAINER}`);
  }
  const remote = typeof data.template_remote === 'string' ? data.template_remote.trim() : '';
  const m = GITHUB_REPO.exec(remote);
  if (!m) {
    const named = JSON.stringify(data.template_remote ?? null);
    throw new Refusal(`${SOURCE_REL} names no GitHub repository (template_remote is ${named}). ${TELL_MAINTAINER}`);
  }
  const repo = `${m[1]}/${m[2]}`;
  return { remote: `https://github.com/${repo}`, repo };
}

/**
 * The verdict on one head from a check-runs answer. Green only when the NEWEST run of CI_CHECK on
 * exactly this sha finished with success: an older success under a newer failure is red, and a run
 * still going is not green yet.
 * @param {{ check_runs?: CheckRun[] } | null | undefined} answer what the API returned
 * @param {string} sha the template head
 * @returns {Verdict}
 */
export function ciVerdict(answer, sha) {
  const runs = (answer && Array.isArray(answer.check_runs) ? answer.check_runs : []).filter(
    (r) => r && r.name === CI_CHECK && r.head_sha === sha
  );
  const head = `the template head ${sha.slice(0, SHORT_SHA)}`;
  if (!runs.length) {
    return {
      green: false,
      why: `${head} has no CI result yet. Its CI may still be starting: try /update again in ten minutes. Nothing has changed.`
    };
  }
  const run = runs.reduce((a, b) => (Number(b.id) > Number(a.id) ? b : a));
  const where = run.details_url || run.html_url || `check run ${run.id}`;
  if (run.status !== 'completed') {
    return {
      green: false,
      run,
      why: `${head} is still being tested (${where}). Try /update again in ten minutes. Nothing has changed.`
    };
  }
  if (run.conclusion !== 'success') {
    return {
      green: false,
      run,
      why: `${head} FAILED its tests (${run.conclusion}, ${where}), so I will not apply it. ${TELL_MAINTAINER}`
    };
  }
  return { green: true, run, why: `CI green on ${head}: ${where}` };
}

/**
 * Why a gh call failed, in one line: its spawn error, else the first line of its stderr, else its exit.
 * @param {GhResult} r
 */
function ghFailure(r) {
  if (!r) return `exit ${r}`;
  if (r.error) return r.error.message;
  return (r.stderr || '').trim().split('\n')[0] || `exit ${r.status}`;
}

/**
 * The check runs of CI_CHECK on one commit, read through gh.
 * @param {string} repo owner/repo
 * @param {string} sha the template head
 * @param {(args: string[]) => GhResult} [run] how gh is run; injectable, so the tests never touch the network
 * @returns {{ check_runs?: CheckRun[] } | null | undefined} whatever JSON.parse gives back, exactly the
 *   union ciVerdict already accepts, since the answer is never checked to be an object before it is read
 */
export function readChecks(repo, sha, run = (args) => spawnSync('gh', args, { encoding: 'utf8' })) {
  const r = run(['api', `repos/${repo}/commits/${sha}/check-runs?check_name=${CI_CHECK}&per_page=${CHECK_RUNS_PAGE}`]);
  if (!r || r.error || r.status !== 0) {
    throw new Refusal(
      `I cannot read the CI result of ${repo} (${ghFailure(r)}). Attach ${repo} to this session as a second repository and type /update again. Nothing has changed.`
    );
  }
  try {
    return JSON.parse(/** @type {string} */ (r.stdout));
  } catch {
    throw new Refusal(`the CI answer from ${repo} was not readable. Try /update again. Nothing has changed.`);
  }
}

/**
 * The command line without the process: the line to print, or a Refusal thrown.
 * @param {string[]} argv the arguments after the script
 * @param {{ run?: (args: string[]) => GhResult }} [options] run replaces gh, for the tests
 * @returns {{ out: string }}
 */
export function main(argv, { run } = {}) {
  const { parseCommandLine } = require('./args.js');
  const { values, positionals } = parseCommandLine({
    name: 'template-gate',
    edge: 'operator',
    options: { root: { type: 'string' } },
    allowPositionals: true,
    argv
  });
  const root = values.root ? path.resolve(String(values.root)) : REPO;
  const [cmd, sha, stray] = positionals;
  if (cmd === 'remote') {
    if (positionals.length > 1) {
      throw new Refusal(`remote takes no argument; got ${JSON.stringify(sha)}`, { exitCode: EXIT.FAILURE });
    }
    return { out: readTemplateSource(root).remote };
  }
  if (cmd === 'ci') {
    if (positionals.length > 2) {
      throw new Refusal(`ci takes one argument, the sha; got an extra ${JSON.stringify(stray)}`, {
        exitCode: EXIT.FAILURE
      });
    }
    if (!FULL_SHA.test(sha || '')) {
      throw new Refusal(`ci needs the full 40-character template head, got ${JSON.stringify(sha ?? null)}`);
    }
    const { repo } = readTemplateSource(root);
    const v = ciVerdict(readChecks(repo, sha, run), sha);
    if (!v.green) throw new Refusal(v.why);
    return { out: v.why };
  }
  throw new Refusal(USAGE);
}

if (isMain(import.meta.url)) {
  try {
    console.log(main(process.argv.slice(2)).out);
    process.exit(EXIT_OK);
  } catch (e) {
    const err = /** @type {Error & { exitCode?: number }} */ (e);
    if (err instanceof Refusal) {
      console.error(`template-gate: REFUSED - ${err.message}`);
      process.exit(err.exitCode ?? EXIT.REFUSED);
    }
    console.error(`template-gate: ERROR - ${err.stack || err.message}`);
    process.exit(EXIT.FAILURE);
  }
}
