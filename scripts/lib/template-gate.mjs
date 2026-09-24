#!/usr/bin/env node
// scripts/lib/template-gate.mjs - where /update fetches this Alex's template from, and whether that
// template head passed its CI.
//
// WHAT. Two answers /update needs before it changes anything, each a refusal when it cannot give one.
//   remote      prints the template's address from system/template-source.json. The template build
//               writes that file into every tree it generates (scripts/build-online-template.mjs),
//               naming the generic template even inside a seed, because owners update from the
//               template and never from their seed. Until 2026-09-24 /update fetched one hard-coded
//               private address, so the owners of any other template (a public one) would have
//               fetched a repository they cannot see (review finding F12).
//   ci <sha>    reads the CI check run of that commit on the template and passes only a head whose
//               newest run of the CI job finished with success. Until 2026-09-24 /update applied a
//               template head whatever its CI said (review finding F02).
//
// HOW. node scripts/lib/template-gate.mjs remote          -> the url on stdout, exit 0
//      node scripts/lib/template-gate.mjs ci <sha>         -> "CI green ..." on stdout, exit 0
//      Either refuses with one plain sentence on stderr and exit 2. --root <dir> reads another tree
//      (the tests use it). The CI read is `gh api` through the cloud session's GitHub proxy, which
//      answers only for repositories attached to the session: in a one-repository session the read is
//      refused, and the refusal says to attach the template, which is the two-repository session
//      /update already describes.
//
// NEVER. Never guesses an address: a missing file, or one that names no GitHub repository, refuses
// rather than falling back to a constant. Never reads the check runs of other apps or workflows (the
// template also carries a heartbeat workflow that FAILS by design when dispatched there, and other
// apps can queue suites that never finish): only the job named CI_CHECK counts. Never writes.
//
// WHERE IT LIVES. Under scripts/lib/ on purpose: the online settings deny Edit on that path, so a session
// cannot quietly weaken the gate an owner's next /update relies on, and every template build that
// changes it is a flagged, privileged path in the changelog /update prints before its yes.
//
// Exit: 0 pass · 2 refused · 1 script error. Node builtins and gh.
'use strict';

import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { readJson } = require('./json-writer.js');

export const SOURCE_REL = 'system/template-source.json';
export const SOURCE_SCHEMA = 'template-source@1';
// The job id in the template's .github/workflows/ci.yml (generated from the Kit's
// variants/online/.github/workflows/ci.yml). An owner's gate reads a NEWER template's check runs, so a
// rename there would refuse every owner forever; scripts/tests/test-template-gate.mjs fails the Kit
// when that job is not named this.
export const CI_CHECK = 'portable-tests';
const GITHUB_REPO = /^https:\/\/github\.com\/([A-Za-z0-9-]+)\/([A-Za-z0-9._-]+?)(?:\.git)?\/?$/;

export class Refusal extends Error {
  constructor(message) { super(message); this.name = 'Refusal'; this.exitCode = 2; }
}

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

/** { remote, repo } from <root>/system/template-source.json, or a Refusal in plain words. */
export function readTemplateSource(root = ROOT) {
  const file = path.join(root, SOURCE_REL);
  if (!fs.existsSync(file)) {
    throw new Refusal(`${SOURCE_REL} is missing, so I do not know which template this Alex updates from. Nothing has changed. Send this line to whoever maintains the template.`);
  }
  let data;
  try { data = readJson(file, SOURCE_SCHEMA); } catch (e) {
    throw new Refusal(`${SOURCE_REL} cannot be read (${e.message}). Nothing has changed. Send this line to whoever maintains the template.`);
  }
  const remote = typeof data.template_remote === 'string' ? data.template_remote.trim() : '';
  const m = GITHUB_REPO.exec(remote);
  if (!m) {
    throw new Refusal(`${SOURCE_REL} names no GitHub repository (template_remote is ${JSON.stringify(data.template_remote ?? null)}). Nothing has changed. Send this line to whoever maintains the template.`);
  }
  return { remote: `https://github.com/${m[1]}/${m[2]}`, repo: `${m[1]}/${m[2]}` };
}

/**
 * The verdict on one head from a check-runs API answer. Green only when the NEWEST run of CI_CHECK
 * on exactly this sha finished with success: an older success under a newer failure is red, and a
 * run still going is not green yet.
 */
export function ciVerdict(answer, sha) {
  const runs = (answer && Array.isArray(answer.check_runs) ? answer.check_runs : [])
    .filter((r) => r && r.name === CI_CHECK && r.head_sha === sha);
  if (!runs.length) {
    return { green: false, why: `the template head ${sha.slice(0, 12)} has no CI result yet. Its CI may still be starting: try /update again in ten minutes. Nothing has changed.` };
  }
  const run = runs.reduce((a, b) => (Number(b.id) > Number(a.id) ? b : a));
  const where = run.details_url || run.html_url || `check run ${run.id}`;
  if (run.status !== 'completed') {
    return { green: false, run, why: `the template head ${sha.slice(0, 12)} is still being tested (${where}). Try /update again in ten minutes. Nothing has changed.` };
  }
  if (run.conclusion !== 'success') {
    return { green: false, run, why: `the template head ${sha.slice(0, 12)} FAILED its tests (${run.conclusion}, ${where}), so I will not apply it. Nothing has changed. Send this line to whoever maintains the template.` };
  }
  return { green: true, run, why: `CI green on the template head ${sha.slice(0, 12)}: ${where}` };
}

/** Reads the check runs through gh. `run` is injectable so the tests never touch the network. */
export function readChecks(repo, sha, run = (args) => spawnSync('gh', args, { encoding: 'utf8' })) {
  const r = run(['api', `repos/${repo}/commits/${sha}/check-runs?check_name=${CI_CHECK}&per_page=100`]);
  if (!r || r.error || r.status !== 0) {
    const why = r && r.error ? r.error.message : ((r && r.stderr) || '').trim().split('\n')[0] || `exit ${r && r.status}`;
    throw new Refusal(`I cannot read the CI result of ${repo} (${why}). Attach ${repo} to this session as a second repository and type /update again. Nothing has changed.`);
  }
  try { return JSON.parse(r.stdout); } catch {
    throw new Refusal(`the CI answer from ${repo} was not readable. Try /update again. Nothing has changed.`);
  }
}

export function main(argv, { run } = {}) {
  let root = ROOT;
  const rest = [];
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--root') root = path.resolve(argv[++i] || '.');
    else rest.push(argv[i]);
  }
  const [cmd, sha] = rest;
  if (cmd === 'remote') {
    return { out: readTemplateSource(root).remote };
  }
  if (cmd === 'ci') {
    if (!/^[0-9a-f]{40}$/.test(sha || '')) throw new Refusal(`ci needs the full 40-character template head, got ${JSON.stringify(sha ?? null)}`);
    const { repo } = readTemplateSource(root);
    const v = ciVerdict(readChecks(repo, sha, run), sha);
    if (!v.green) throw new Refusal(v.why);
    return { out: v.why };
  }
  throw new Refusal('usage: node scripts/lib/template-gate.mjs remote | ci <sha> [--root <dir>]');
}

// Am I the script node was asked to run? Compared as REAL paths: node resolves the main module through
// symlinks, so a run through a linked directory (macOS's /var -> /private/var temp dir, a junction on
// Windows) otherwise read as "imported", did nothing and exited 0 (fleet Fix A, 2026-09-24: found by the
// macOS CI leg; a gate that exits 0 without deciding anything passes whatever it guards).
const real = (p) => { try { return fs.realpathSync.native(p); } catch { return path.resolve(p); } };
const invoked = process.argv[1] ? real(process.argv[1]) : '';
const self = real(fileURLToPath(import.meta.url));
const isMain = process.platform === 'win32' ? invoked.toLowerCase() === self.toLowerCase() : invoked === self;
if (isMain) {
  try {
    console.log(main(process.argv.slice(2)).out);
    process.exit(0);
  } catch (e) {
    if (e instanceof Refusal) { console.error(`template-gate: REFUSED - ${e.message}`); process.exit(2); }
    console.error(`template-gate: ERROR - ${e.stack || e.message}`);
    process.exit(1);
  }
}
