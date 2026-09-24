#!/usr/bin/env node
// scripts/build-online-template.mjs - the ONE writer of the Virtual Alex template.
//
// WHAT. Virtual Alex is the Kit running inside a Claude Code cloud session: a private GitHub repo,
// born from a template with "Use this template", is the whole machine. This script generates that
// template from this Kit and pushes it. Nobody edits the generated tree by hand; a change to the
// online variant is a change here, then a re-run.
//
// HOW. Every component row in system/kit-manifest.json carries an `online` field:
//   ship     the row's paths are copied from this Kit as they are
//   drop     the row's paths are absent from the online tree
//   variant  the row's paths come from variants/online/<same path> (a file, or a whole subtree for a
//            directory row); the Kit's own content at that path is not read at all
// The source set is the Kit's HEAD COMMIT (git ls-tree HEAD), and every file is written from its blob
// (git cat-file), never copied from the working tree (2026-09-24, fleet Fix A, review finding F01:
// until then an edit nobody committed, and a CRLF working copy git status called clean, both shipped,
// and the template carried bytes no Kit commit held). An uncommitted change is reported, by content,
// and left out. Every committed path must be claimed by a row; the most specific claim wins (a path named
// exactly beats the directory it sits in). A row without an online value, a tracked path no row
// claims, a path two rows claim, or a file under variants/online/ whose row is not variant REFUSES
// the build (exit 2). A listed path that does not exist is reported and never fatal: several
// online-only files are listed in the manifest before they are written.
//
// Modes (exactly one):
//   --check   build into the build directory, diff against the remote main: exit 0 identical, 2 drift
//   --push    build, append the changelog row, commit as the Kit's git identity, push, read back
// Options:
//   --remote <url>   the template repository (default: the generic Virtual Alex template)
//   --out <dir>      the build directory (default: a per-remote directory under the OS temp dir)
//   --seed <dir>     copy that install's starter/ and its two owner docs in (HOW-SHARING-WORKS.md,
//                    WHAT-ALEX-CAN-DO.md), never its INSTALL-<NAME>.md: that is the USB-and-Terminal
//                    laptop guide, and the online tree carries INSTALL-ONLINE.md. Refused against
//                    the generic remote, because a seed carries one person's material. A seed's text
//                    is a folder on disk, not a commit, so its CRLF line endings are written LF
//   --template-remote <url>  the template this tree's owners update from, written into
//                    system/template-source.json. Default: --remote for a template build, the generic
//                    template for a seed build, because owners update from the template, never their seed
//
// THE CHANGELOG. Every --push of the generic template appends one row to system/template-changelog.jsonl
// here in the Kit (tracked; re-included in .gitignore by name because system/* is denied by class) and
// the row ships with the tree, so /update in an owner's repo can print what changed since their
// template_commit. The row names the PRIVILEGED paths the build touched, the ones that change how the
// owner's Alex behaves. A diff that touches a privileged path while the row flags nothing refuses the
// build: a changelog that stays silent about a settings change is worse than no changelog. A seed
// build writes no row; a seed is one person's copy of a template version, not a version. Every
// build, seed or not, then renders CHANGELOG.md at the tree's root from the jsonl it carries
// (scripts/lib/render-changelog.mjs). The markdown exists in generated trees only, never in the Kit
// (its manifest row is drop), and scripts/tests/test-changelog.mjs fails any tree where it disagrees.
//
// THE DONOR SCRUB (2026-09-24, fleet seat 7). scripts/clone-scrub-check.js hunts the Kit author's
// identity, so its patterns ARE that identity, and a public template cannot carry the scanner without
// publishing what it hunts. It is a drop row online (row donor-scrub) and runs HERE instead: after the
// tree is written and staged, donorScrub() runs it over the build directory's INDEX, the exact bytes
// --check diffs and --push commits, and again after --push adds the changelog row. Any hit refuses the
// build before a result is reported or a commit is made. The owner's own starter/ is left out, as the
// scanner always has, because a seed's starter is that owner's words.
//
// WHAT THE BUILD WRITES THAT THE KIT DOES NOT TRACK (fleet Fix A). Beside CHANGELOG.md: VERSION, the
// tree's build number, date and Kit commit rendered from the same jsonl (review finding F44: it read a
// month-old laptop stamp), and system/template-source.json, the address /update fetches from, through
// scripts/lib/json-writer.js (review finding F12: /update fetched one hard-coded private address).
// Both are drop rows in the manifest and exist in generated trees only.
//
// NO CARRIAGE RETURN SHIPS (fleet Fix A, review finding F02). Every file this build writes is checked
// for a CR byte, and one in a text file refuses the build before anything is staged, unless its
// attribute is eol=crlf (the Windows launchers, all drop rows online) or -text on a file that is not
// executed (skill content, byte-pinned by skills-lock.json). A CR in a shell script is a broken script
// on the Linux VM, and nothing refused one before.
//
// NEVER. This script never writes a .claude/skills/ link (they are symlinks, a Windows checkout cannot
// make them, and the owner's first cloud session does), never reads soul.md or vault/ (untracked here,
// so outside the source set by construction), never pushes a seed to the generic template, and never
// commits or reports a tree the donor scrub has not passed.
//
// BUILD REPO. The build directory is a git clone of the remote: fetch main, replace the working tree
// with the generated one (Kit files from their blobs), `git add -A`, replay the Kit's executable bits
// (git ls-tree carries them even from a Windows checkout, and a Linux VM skips a hook that is not +x),
// and the staged diff IS the delta. The Kit's .gitattributes ride along, so the blobs the template
// stores are the blobs the Kit stores.
//
// Exit: 0 ok · 2 refused, or drift under --check · 1 script error. Node builtins only.
'use strict';

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const writeLock = require('./lib/write-lock.js');
const { canonicalText, writeJson } = require('./lib/json-writer.js');
import { writeChangelog } from './lib/render-changelog.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const KIT = path.resolve(HERE, '..');
export const DEFAULT_REMOTE = 'https://github.com/Alex-kit-S/virtual-alex';
export const MANIFEST_REL = 'system/kit-manifest.json';
export const CHANGELOG_REL = 'system/template-changelog.jsonl';
export const VARIANTS_REL = 'variants/online';
export const TEMPLATE_SOURCE_REL = 'system/template-source.json';
export const TEMPLATE_SOURCE_SCHEMA = 'template-source@1';
export const ONLINE_VALUES = ['ship', 'drop', 'variant'];

// The paths that change how an owner's Alex behaves. A build that touches one must say so in its
// changelog row, because /update prints that row before the owner says yes.
export const PRIVILEGED = [
  '.claude/settings.json',
  '.claude/commands/',
  'scripts/hooks/',
  'scripts/lib/',
  '.github/workflows/',
  'scheduler/routines/',
  'CLAUDE.md',
  '.mcp.json',
];

// Never written by this script, whatever the manifest says.
const NEVER_WRITTEN = ['.claude/skills/'];

// The owner docs a per-person seed carries beside its starter/. INSTALL-<NAME>.md is not one of
// them: it is the laptop install guide (a USB stick and a Terminal), and an online seed that
// carried it would mislead its owner on the first page; INSTALL-ONLINE.md is the online guide.
const OWNER_DOCS = [/^HOW-SHARING-WORKS\.md$/, /^WHAT-ALEX-CAN-DO\.md$/];

export class Refusal extends Error {
  constructor(message) {
    super(message);
    this.name = 'Refusal';
    this.exitCode = 2;
  }
}

const say = (m) => console.log(`build-online-template: ${m}`);

// ---------------------------------------------------------------------------------------------
// git
// ---------------------------------------------------------------------------------------------
function git(args, { cwd = KIT, input, allowFail = false } = {}) {
  const r = spawnSync('git', args, { cwd, input, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  if (r.error) throw r.error;
  if (r.status !== 0 && !allowFail) {
    throw new Error(`git ${args.join(' ')} failed (exit ${r.status}) in ${cwd}: ${(r.stderr || '').trim()}`);
  }
  return r;
}

/** git ls-files -s of a repo: [{mode, sha, path}], forward slashes, in index order. */
export function trackedEntries(cwd = KIT, pathspec = []) {
  const out = git(['ls-files', '-s', '-z', '--', ...pathspec], { cwd }).stdout;
  const entries = [];
  for (const rec of out.split('\0')) {
    if (!rec) continue;
    const tab = rec.indexOf('\t');
    const [mode, sha] = rec.slice(0, tab).split(' ');
    entries.push({ mode, sha, path: rec.slice(tab + 1) });
  }
  return entries;
}

/** git ls-tree -r of a commit: [{mode, sha, path}]. THE source set of a build; gitlinks are left out. */
export function committedEntries(cwd = KIT, rev = 'HEAD') {
  const out = git(['ls-tree', '-r', '-z', '--full-tree', rev], { cwd }).stdout;
  const entries = [];
  for (const rec of out.split('\0')) {
    if (!rec) continue;
    const tab = rec.indexOf('\t');
    const [mode, type, sha] = rec.slice(0, tab).split(' ');
    if (type !== 'blob') continue;
    entries.push({ mode, sha, path: rec.slice(tab + 1) });
  }
  return entries;
}

/** The raw bytes of each blob, by sha, in one git cat-file --batch call. No filter is applied. */
export function readBlobs(shas, cwd = KIT) {
  const want = [...new Set(shas)];
  const blobs = new Map();
  if (!want.length) return blobs;
  const r = spawnSync('git', ['cat-file', '--batch'], { cwd, input: want.join('\n') + '\n', maxBuffer: 1024 * 1024 * 1024 });
  if (r.error) throw r.error;
  if (r.status !== 0) throw new Error(`git cat-file --batch failed (exit ${r.status}) in ${cwd}: ${String(r.stderr || '').trim()}`);
  const buf = r.stdout;
  let at = 0;
  for (const sha of want) {
    const nl = buf.indexOf(0x0a, at);
    const head = buf.subarray(at, nl).toString('utf8');
    const [got, type, size] = head.split(' ');
    if (got !== sha || type !== 'blob') throw new Error(`git cat-file answered "${head}" for ${sha}`);
    const start = nl + 1;
    blobs.set(sha, buf.subarray(start, start + Number(size)));
    at = start + Number(size) + 1;
  }
  return blobs;
}

/**
 * Every tracked path whose CONTENT differs from HEAD: staged changes (blob ids, not stat) plus every
 * working file re-hashed through git's own filters, as `git add` would store it. Never the stat cache,
 * which is how 38 CRLF working copies read as clean for a day (review finding F01).
 */
export function dirtyPaths(cwd = KIT) {
  const staged = git(['diff', '--cached', '--name-only', '--no-renames', '-z', 'HEAD'], { cwd }).stdout.split('\0').filter(Boolean);
  const index = trackedEntries(cwd).filter((e) => e.mode !== '160000');
  const present = index.filter((e) => fs.existsSync(path.join(cwd, e.path)));
  const missing = index.filter((e) => !fs.existsSync(path.join(cwd, e.path))).map((e) => e.path);
  const hashes = present.length
    ? git(['hash-object', '--stdin-paths'], { cwd, input: present.map((e) => e.path).join('\n') + '\n' }).stdout.split('\n')
    : [];
  const changed = present.filter((e, i) => hashes[i] !== e.sha).map((e) => e.path);
  return [...new Set([...staged, ...missing, ...changed])].sort();
}

// ---------------------------------------------------------------------------------------------
// manifest -> claims -> plan (pure over their inputs, so the tests feed them synthetic data)
// ---------------------------------------------------------------------------------------------
export function loadManifest(file = path.join(KIT, MANIFEST_REL)) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

/** Every row's paths as claims [{id, online, prefix, isDir}]. Refuses a row without a valid online value. */
export function resolveRows(manifest) {
  const rows = manifest && Array.isArray(manifest.components) ? manifest.components : null;
  if (!rows) throw new Refusal('the manifest has no components[] array');
  const claims = [];
  const seen = new Map(); // prefix -> row id, because a path is claimed once
  for (const row of rows) {
    if (!row || typeof row.id !== 'string' || !row.id) throw new Refusal('a component row has no id');
    if (!ONLINE_VALUES.includes(row.online)) {
      throw new Refusal(
        `row "${row.id}" has no online value (found ${JSON.stringify(row.online)}); ` +
        `every row needs one of ${ONLINE_VALUES.join(' | ')}`);
    }
    if (!Array.isArray(row.paths) || row.paths.length === 0) throw new Refusal(`row "${row.id}" lists no paths`);
    for (const p of row.paths) {
      if (typeof p !== 'string' || !p || p.startsWith('/') || p.includes('..') || p.includes('\\')) {
        throw new Refusal(`row "${row.id}" has a malformed path ${JSON.stringify(p)} (repo-relative, forward slashes, no ..)`);
      }
      if (seen.has(p)) throw new Refusal(`path "${p}" is claimed by both "${seen.get(p)}" and "${row.id}"; a path is claimed once`);
      seen.set(p, row.id);
      claims.push({ id: row.id, online: row.online, prefix: p, isDir: p.endsWith('/') });
    }
  }
  return claims;
}

/** The most specific claim for a path, or null. An exact name beats a directory; a longer prefix beats a shorter one. */
export function claimFor(relPath, claims) {
  let best = null;
  for (const c of claims) {
    const hit = c.isDir ? relPath.startsWith(c.prefix) : relPath === c.prefix;
    if (hit && (!best || c.prefix.length > best.prefix.length)) best = c;
  }
  return best;
}

/** Map every tracked path to its claim. Refuses a path no row claims. */
export function classify(paths, claims) {
  const map = new Map();
  const unclaimed = [];
  for (const p of paths) {
    if (NEVER_WRITTEN.some((n) => p.startsWith(n))) continue;
    const c = claimFor(p, claims);
    if (!c) { unclaimed.push(p); continue; }
    map.set(p, c);
  }
  if (unclaimed.length) {
    const shown = unclaimed.slice(0, 20).join(', ') + (unclaimed.length > 20 ? ` (+${unclaimed.length - 20} more)` : '');
    throw new Refusal(`${unclaimed.length} tracked path(s) claimed by no manifest row: ${shown}. Add a row with an online value; the manifest is the ship set.`);
  }
  return map;
}

/**
 * Decide the online tree from the Kit's tracked entries and the claims.
 * Returns { files: [{dst, src, mode}], reports: [string], counts }.
 */
export function planTree(kitEntries, claims, kitRoot = KIT) {
  const reports = [];
  const files = [];
  const counts = { ship: 0, drop: 0, variant: 0, links: 0 };
  const variantPrefix = VARIANTS_REL + '/';
  const byPath = new Map(kitEntries.map((e) => [e.path, e]));
  const map = classify(kitEntries.map((e) => e.path), claims);
  const kitMatched = new Set();
  const variantMatched = new Set();

  // 1. Kit paths by their claim. A variant claim does not read the Kit's content at all.
  for (const [p, c] of map) {
    kitMatched.add(c.prefix);
    const e = byPath.get(p);
    if (e.mode === '120000') { counts.links++; reports.push(`SKIP link ${p}: this script never writes a link`); continue; }
    if (c.online === 'ship') { files.push({ dst: p, src: path.join(kitRoot, p), blob: e.sha, mode: e.mode }); counts.ship++; }
    // A variants/online/ path is "dropped" as a Kit path and re-read below at its real path, so it is
    // not a drop in the summary's sense; counting it would inflate the number a reader checks.
    else if (c.online === 'drop' && !p.startsWith(variantPrefix)) counts.drop++;
  }

  // 2. Every tracked file under variants/online/ lands at its real path, and only under a variant row.
  for (const e of kitEntries) {
    if (!e.path.startsWith(variantPrefix)) continue;
    const dst = e.path.slice(variantPrefix.length);
    if (NEVER_WRITTEN.some((n) => dst.startsWith(n))) { reports.push(`SKIP ${e.path}: never written`); continue; }
    const c = claimFor(dst, claims);
    if (!c || c.online !== 'variant') {
      throw new Refusal(
        `${e.path} exists under ${VARIANTS_REL}/ but ${c ? `its row "${c.id}" is ${c.online}` : `no row claims ${dst}`}; ` +
        `a replacement nobody reads is a silent miss. Flip the row to variant or remove the file.`);
    }
    if (e.mode === '120000') { counts.links++; reports.push(`SKIP link ${e.path}: this script never writes a link`); continue; }
    variantMatched.add(c.prefix);
    files.push({ dst, src: path.join(kitRoot, e.path), blob: e.sha, mode: e.mode });
    counts.variant++;
  }

  // 3. Listed paths that matched nothing: reported, never fatal.
  for (const c of claims) {
    if (c.online === 'variant') {
      if (variantMatched.has(c.prefix)) continue;
      const kitHas = kitMatched.has(c.prefix) ? '; the Kit has the path, and it is NOT shipped because the row is variant' : '';
      reports.push(`ABSENT variant ${VARIANTS_REL}/${c.prefix} (row "${c.id}"): nothing copied${kitHas}`);
    } else if (!kitMatched.has(c.prefix)) {
      reports.push(`ABSENT ${c.online} path ${c.prefix} (row "${c.id}"): listed, not tracked here, nothing to ${c.online}`);
    }
  }

  const seen = new Set();
  for (const f of files) {
    if (seen.has(f.dst)) throw new Refusal(`two sources land at ${f.dst}`);
    seen.add(f.dst);
  }
  return { files, reports, counts };
}

// ---------------------------------------------------------------------------------------------
// privileged paths and the changelog row
// ---------------------------------------------------------------------------------------------
export function isPrivileged(relPath) {
  return PRIVILEGED.some((p) => (p.endsWith('/') ? relPath.startsWith(p) : relPath === p));
}

export function flaggedOf(changedPaths) {
  return [...new Set(changedPaths.filter(isPrivileged))].sort();
}

/**
 * The guard on the row about to be written: every privileged path in the diff must be in the row's
 * flagged list. Refuses on a silent row. Returns the privileged paths the diff touched.
 */
export function assertFlagged(changedPaths, flagged) {
  const touched = flaggedOf(changedPaths);
  if (!touched.length) return touched;
  const list = Array.isArray(flagged) ? flagged : [];
  const missing = touched.filter((p) => !list.includes(p));
  if (missing.length) {
    throw new Refusal(
      `the diff touched privileged path(s) ${missing.join(', ')} but the changelog row flags ` +
      `${list.length ? list.join(', ') : 'NOTHING'}; a row that stays silent about a settings change does not ship`);
  }
  return touched;
}

/**
 * The number the next pushed build gets: one more than the rows already written. A row that carries
 * an explicit `build` (every row from build 24 on) must sit at that position; one that does not means
 * a row was deleted or inserted, and the push refuses rather than mislabel every build after it.
 * Legacy rows (builds 1 to 23) carry no number and count by position, which they always matched.
 */
export function nextBuild(changelogText) {
  const lines = String(changelogText || '').split('\n').filter((l) => l.trim());
  lines.forEach((l, i) => {
    let row;
    try { row = JSON.parse(l); } catch { throw new Refusal(`${CHANGELOG_REL} row ${i + 1} is not JSON; the changelog is the build history and must parse`); }
    if (row.build !== undefined && row.build !== i + 1) {
      throw new Refusal(`${CHANGELOG_REL} row ${i + 1} says build ${row.build}; a row was deleted or inserted, so the next number cannot be trusted`);
    }
  });
  return lines.length + 1;
}

export function changelogRow({ kitCommit, kitDirty, previous, files, changed, flagged, build }) {
  return {
    at: new Date().toISOString().replace(/\.\d{3}Z$/, 'Z'),
    ...(Number.isInteger(build) ? { build } : {}),
    kit_commit: kitCommit,
    kit_dirty: Boolean(kitDirty),
    previous_template_commit: previous || null,
    files,
    changed: changed.length,
    flagged,
  };
}

/** One JSONL line: the JSON writer's key order and naming rules, collapsed to a single line. */
export function rowText(row) {
  return JSON.stringify(JSON.parse(canonicalText(row)));
}

// ---------------------------------------------------------------------------------------------
// the seed
// ---------------------------------------------------------------------------------------------
export function seedFiles(seedDir) {
  const starter = path.join(seedDir, 'starter');
  if (!fs.existsSync(starter) || !fs.statSync(starter).isDirectory()) {
    throw new Refusal(`${seedDir} has no starter/ directory; a seed without a starter is not a seed`);
  }
  const files = [];
  const walk = (dir, rel) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const abs = path.join(dir, e.name);
      const r = `${rel}/${e.name}`;
      if (e.isDirectory()) walk(abs, r);
      else if (e.isFile()) files.push({ dst: r, src: abs, mode: '100644', seed: true });
    }
  };
  walk(starter, 'starter');
  const docs = fs.readdirSync(seedDir).filter((n) => OWNER_DOCS.some((re) => re.test(n))).sort();
  for (const n of docs) files.push({ dst: n, src: path.join(seedDir, n), mode: '100644', seed: true });
  return { files, docs };
}

// ---------------------------------------------------------------------------------------------
// the donor scrub, at build time
// ---------------------------------------------------------------------------------------------
/**
 * Refuses (Refusal, exit 2) when the staged index of `out` carries the Kit author's identity, dead
 * infrastructure, another machine's paths or a stray database id. Returns 0 on a clean tree. Uses THIS
 * Kit's scanner and allowlist; the generated tree carries neither. Loaded lazily, because this script
 * also ships in the online tree, where the scanner is absent and nothing is ever built.
 */
export function donorScrub(out) {
  const file = path.join(HERE, 'clone-scrub-check.js');
  if (!fs.existsSync(file)) {
    throw new Refusal('scripts/clone-scrub-check.js is not beside this script, so the tree cannot be scrubbed; the template is built from the Kit, never from a generated tree');
  }
  const hits = require(file).scan({ root: out, cached: true });
  if (hits.length) {
    const shown = hits.slice(0, 20).map((h) => `[${h.cat}] ${h.file}:${h.line}: ${h.text}`);
    if (hits.length > 20) shown.push(`... and ${hits.length - 20} more`);
    throw new Refusal(
      `donor scrub: ${hits.length} hit(s) in the generated tree, so nothing was reported or pushed. ` +
      `Fix the Kit file, or add a reviewed row WITH its reason to system/clone-scrub-allowlist.json:\n    ${shown.join('\n    ')}`);
  }
  return 0;
}

// ---------------------------------------------------------------------------------------------
// the build repo
// ---------------------------------------------------------------------------------------------
function kitState() {
  const kitCommit = git(['rev-parse', 'HEAD']).stdout.trim();
  const dirty = dirtyPaths(KIT);
  const untrackedVariants = git(['ls-files', '--others', '--exclude-standard', '--', VARIANTS_REL]).stdout.split('\n').filter(Boolean);
  const name = git(['config', '--get', 'user.name'], { allowFail: true }).stdout.trim();
  const email = git(['config', '--get', 'user.email'], { allowFail: true }).stdout.trim();
  return { kitCommit, dirty, untrackedVariants, name, email };
}

/** Make `out` a clone of the remote's main (or an unborn main on a first build). Returns the remote main sha or null. */
function prepareBuildRepo(out, remote) {
  fs.mkdirSync(out, { recursive: true });
  const init = () => {
    git(['init', '-q', '-b', 'main'], { cwd: out });
    git(['config', 'core.autocrlf', 'false'], { cwd: out });
    git(['remote', 'add', 'origin', remote], { cwd: out });
  };
  if (!fs.existsSync(path.join(out, '.git'))) init();
  else git(['remote', 'set-url', 'origin', remote], { cwd: out });

  const fetched = git(['fetch', '-q', 'origin', 'main'], { cwd: out, allowFail: true });
  if (fetched.status === 0) {
    git(['checkout', '-q', '-B', 'main', 'FETCH_HEAD'], { cwd: out });
    return git(['rev-parse', 'HEAD'], { cwd: out }).stdout.trim();
  }
  const err = (fetched.stderr || '').trim();
  if (!/couldn't find remote ref|remote branch main not found/i.test(err)) {
    throw new Refusal(`cannot fetch ${remote} main: ${err || `exit ${fetched.status}`}`);
  }
  // An empty remote: a first build. Start from nothing, whatever a previous run left here.
  fs.rmSync(path.join(out, '.git'), { recursive: true, force: true });
  init();
  return null;
}

function wipeExceptGit(out) {
  for (const e of fs.readdirSync(out)) {
    if (e === '.git') continue;
    fs.rmSync(path.join(out, e), { recursive: true, force: true });
  }
}

/** Git's own binary test: a NUL byte in the first 8000 bytes. */
const isText = (buf) => !buf.subarray(0, 8000).includes(0);

/**
 * Writes every planned file into `out`: a Kit file from its committed blob, a seed file from its
 * folder with CRLF written LF. Returns [{dst, mode, buf}] and how many seed files were normalised.
 */
export function writeTree(out, files, kitRoot = KIT) {
  const blobs = readBlobs(files.filter((f) => f.blob).map((f) => f.blob), kitRoot);
  const written = [];
  let normalised = 0;
  for (const f of files) {
    let buf;
    if (f.blob) buf = blobs.get(f.blob);
    else if (f.seed) {
      buf = fs.readFileSync(f.src);
      if (isText(buf) && buf.includes(0x0d)) {
        const lf = Buffer.from(buf.toString('latin1').replace(/\r\n/g, '\n'), 'latin1');
        if (!lf.equals(buf)) { buf = lf; normalised++; }
      }
    } else {
      throw new Refusal(`${f.dst} has no committed blob; a Kit file is written from its commit, never from the working tree`);
    }
    const abs = path.join(out, f.dst);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, buf);
    // The mode on disk too, not only in the index: on macOS and Linux (core.filemode=true) every later
    // `git add -A` re-reads it, and a 0644 file there un-does replayModes (found by the macOS CI leg).
    fs.chmodSync(abs, f.mode === '100755' ? 0o755 : 0o644);
    written.push({ dst: f.dst, mode: f.mode, buf });
  }
  return { written, normalised };
}

/**
 * The files among `written` that carry a carriage return and may not: a text file (git's own binary
 * test) whose attribute in the generated tree is not eol=crlf, and not -text on a file that is never
 * executed (not +x, no #! line, not a shell extension). Attributes are read in `out`, whose
 * .gitattributes is the tree's own.
 */
export function carriageReturns(out, written) {
  const suspects = written.filter((w) => isText(w.buf) && w.buf.includes(0x0d));
  if (!suspects.length) return [];
  const r = git(['check-attr', '-z', '--stdin', 'text', 'eol'], { cwd: out, input: suspects.map((w) => w.dst).join('\0') + '\0' });
  const attr = new Map();
  const f = r.stdout.split('\0');
  for (let i = 0; i + 2 < f.length; i += 3) attr.set(`${f[i]}\0${f[i + 1]}`, f[i + 2]);
  return suspects.filter((w) => {
    if (attr.get(`${w.dst}\0eol`) === 'crlf') return false;
    const executed = w.mode === '100755' || w.buf.subarray(0, 2).toString('latin1') === '#!' || /\.(sh|bash|command)$/.test(w.dst);
    return !(attr.get(`${w.dst}\0text`) === 'unset' && !executed);
  }).map((w) => w.dst);
}

/** Writes system/template-source.json through the JSON writer, keeping its stamp while its content holds. */
export function writeTemplateSource(out, templateRemote) {
  const abs = path.join(out, TEMPLATE_SOURCE_REL);
  const data = { template_remote: normalizeRemote(templateRemote) };
  let generatedAt;
  const prev = git(['show', `HEAD:${TEMPLATE_SOURCE_REL}`], { cwd: out, allowFail: true });
  if (prev.status === 0) {
    try {
      const p = JSON.parse(prev.stdout);
      if (p._schema === TEMPLATE_SOURCE_SCHEMA && p.template_remote === data.template_remote) generatedAt = p._generated_at;
    } catch { /* an unreadable previous file is replaced under a new stamp */ }
  }
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  writeJson(abs, data, {
    purpose: 'The template /update fetches from and checks CI on. Written by every template and seed build; a seed names the generic template, because owners update from the template and never from their seed.',
    writer: 'scripts/build-online-template.mjs',
    schema: TEMPLATE_SOURCE_SCHEMA,
    generatedAt,
  });
  return TEMPLATE_SOURCE_REL;
}

/** The Kit's executable bits, replayed into the build index (a Windows checkout carries none on disk). */
function replayModes(out, files) {
  const exec = files.filter((f) => f.mode === '100755').map((f) => f.dst);
  const plain = files.filter((f) => f.mode !== '100755').map((f) => f.dst);
  if (exec.length) git(['update-index', '--chmod=+x', '-z', '--stdin'], { cwd: out, input: exec.join('\0') + '\0' });
  if (plain.length) git(['update-index', '--chmod=-x', '-z', '--stdin'], { cwd: out, input: plain.join('\0') + '\0' });
}

function stagedPaths(out) {
  return git(['diff', '--cached', '--name-only', '--no-renames', '-z'], { cwd: out }).stdout.split('\0').filter(Boolean);
}

// ---------------------------------------------------------------------------------------------
// main
// ---------------------------------------------------------------------------------------------
function normalizeRemote(url) {
  return String(url).trim().replace(/\/+$/, '').replace(/\.git$/, '');
}

export function parseArgs(argv) {
  const a = { check: false, push: false, remote: DEFAULT_REMOTE, out: null, seed: null, templateRemote: null };
  for (let i = 0; i < argv.length; i++) {
    const x = argv[i];
    if (x === '--check') a.check = true;
    else if (x === '--push') a.push = true;
    else if (x === '--remote') a.remote = argv[++i];
    else if (x === '--out') a.out = argv[++i];
    else if (x === '--seed') a.seed = argv[++i];
    else if (x === '--template-remote') a.templateRemote = argv[++i];
    else throw new Refusal(`unknown argument ${x}`);
  }
  if (a.check === a.push) throw new Refusal('pick exactly one of --check or --push');
  if (!a.remote) throw new Refusal('--remote needs a url');
  if (a.seed && normalizeRemote(a.seed) && normalizeRemote(a.remote) === normalizeRemote(DEFAULT_REMOTE)) {
    throw new Refusal(`--seed carries one person's material and never goes to the generic template ${DEFAULT_REMOTE}; pass --remote <that person's seed repository>`);
  }
  if (!a.out) a.out = path.join(os.tmpdir(), 'virtual-alex-build', normalizeRemote(a.remote).replace(/[^A-Za-z0-9._-]+/g, '_'));
  a.out = path.resolve(a.out);
  if (a.out === KIT || a.out.startsWith(KIT + path.sep)) throw new Refusal(`--out ${a.out} is inside the Kit; build outside it`);
  if (a.seed) a.seed = path.resolve(a.seed);
  if (!a.templateRemote) a.templateRemote = a.seed ? DEFAULT_REMOTE : a.remote;
  return a;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const held = writeLock.acquire({ label: 'build-online-template', log: say });
  if (!held.ok) throw new Refusal(`another repo-surface mutator holds the write lock (${held.reason})`);
  try {
    const state = kitState();
    if (!state.name || !state.email) {
      throw new Refusal('the Kit has no git user.name and user.email; the template commits as the Kit\'s identity and will not guess one');
    }
    const claims = resolveRows(loadManifest());
    const plan = planTree(committedEntries(KIT), claims);
    for (const r of plan.reports) say(r);
    if (state.untrackedVariants.length) {
      say(`WARN ${state.untrackedVariants.length} untracked file(s) under ${VARIANTS_REL}/ are NOT read (the source set is what git tracks; git add them first): ${state.untrackedVariants.slice(0, 10).join(', ')}`);
    }
    if (state.dirty.length) {
      say(`WARN the Kit has ${state.dirty.length} uncommitted change(s), found by content: ${state.dirty.slice(0, 10).join(' | ')}${state.dirty.length > 10 ? ' ...' : ''}. The build reads the commit ${state.kitCommit.slice(0, 12)}, so NONE of them are in it; a pushed row says kit_dirty=true`);
    }
    let files = plan.files;
    let seedName = null;
    if (args.seed) {
      const s = seedFiles(args.seed);
      seedName = path.basename(args.seed);
      files = files.concat(s.files);
      say(`seed ${seedName}: ${s.files.length - s.docs.length} file(s) from starter/ and ${s.docs.length} owner doc(s)${s.docs.length ? ` (${s.docs.join(', ')})` : ''}`);
    }
    say(`plan: ${plan.counts.ship} ship, ${plan.counts.variant} variant, ${plan.counts.drop} dropped, ${plan.counts.links} link(s) skipped; ${files.length} file(s) in the online tree`);

    const previous = prepareBuildRepo(args.out, args.remote);
    wipeExceptGit(args.out);
    const tree = writeTree(args.out, files);
    if (tree.normalised) say(`seed ${seedName}: ${tree.normalised} text file(s) had CRLF line endings, written LF (a seed folder is not a commit, and the tree's law is eol=lf)`);
    const cr = carriageReturns(args.out, tree.written);
    if (cr.length) {
      throw new Refusal(`${cr.length} file(s) carry a carriage return (CR) and would ship it, which breaks a script on the Linux VM: ${cr.slice(0, 20).join(', ')}. ` +
        'Renormalise them in the Kit (git add --renormalize, in a commit that changes line endings only); only an eol=crlf path, or a -text file that is never executed, may carry CR');
    }
    const derived = writeChangelog(args.out);
    derived.push(writeTemplateSource(args.out, args.templateRemote));
    say(`rendered ${derived.join(', ')} (the changelog and the version from the tree's jsonl; the template source names ${normalizeRemote(args.templateRemote)})`);
    git(['add', '-A'], { cwd: args.out });
    replayModes(args.out, files);
    donorScrub(args.out);
    say('donor scrub: CLEAN over the staged tree (the Kit\'s clone-scrub patterns and allowlist; the online tree carries neither)');
    const changed = stagedPaths(args.out);
    const flagged = flaggedOf(changed);
    say(`build dir ${args.out}; remote main ${previous || 'none (first build)'}; ${changed.length} path(s) differ; privileged: ${flagged.length ? flagged.join(', ') : 'none'}`);

    if (args.check) {
      if (!previous) throw new Refusal(`${args.remote} has no main yet: drift by definition`);
      if (!changed.length) { say(`CHECK OK: the generated tree is identical to ${args.remote} main ${previous}`); return 0; }
      for (const p of changed.slice(0, 50)) say(`  drift: ${p}`);
      throw new Refusal(`CHECK FAILED: ${changed.length} path(s) differ from ${args.remote} main ${previous}`);
    }

    // --push
    if (previous && !changed.length) { say(`nothing to push: the generated tree is identical to ${args.remote} main ${previous}`); return 0; }
    let subject;
    const flaggedText = flagged.length ? flagged.join(', ') : 'none';
    if (!seedName) {
      // The row goes on top of the COMMITTED changelog (the tree already holds its blob), and the Kit's
      // copy becomes exactly that text. A Kit copy that differs from its commit is a hand edit or a
      // row a failed push left behind; it refuses rather than being overwritten or shipped.
      const logAbs = path.join(KIT, CHANGELOG_REL);
      const dst = path.join(args.out, CHANGELOG_REL);
      const committedLog = fs.existsSync(dst) ? fs.readFileSync(dst, 'utf8') : '';
      const kitLog = fs.existsSync(logAbs) ? fs.readFileSync(logAbs, 'utf8').replace(/\r\n/g, '\n') : '';
      if (kitLog !== committedLog) {
        throw new Refusal(`${CHANGELOG_REL} in the Kit differs from its commit ${state.kitCommit.slice(0, 12)}; commit it, or restore it with git checkout, before a push appends the next row`);
      }
      const build = nextBuild(committedLog);
      const row = changelogRow({ kitCommit: state.kitCommit, kitDirty: state.dirty.length > 0, previous, files: files.length + derived.length, changed, flagged, build });
      assertFlagged(changed, row.flagged);
      const line = rowText(row);
      const nextLog = `${committedLog}${line}\n`;
      fs.mkdirSync(path.dirname(dst), { recursive: true });
      fs.writeFileSync(dst, nextLog, 'utf8');
      fs.writeFileSync(logAbs, nextLog, 'utf8');
      git(['add', '--', CHANGELOG_REL]); // tracked from its first row; the Kit's next commit carries it
      writeChangelog(args.out); // re-rendered, so CHANGELOG.md and VERSION carry the row this push just wrote
      git(['add', '-A'], { cwd: args.out });
      replayModes(args.out, files); // this add re-read the working tree; the Kit's modes win again
      donorScrub(args.out); // the row and the re-render are new bytes; the commit below carries exactly what this saw
      say(`changelog row appended to ${CHANGELOG_REL} and staged in the Kit: ${line}`);
      subject = `Virtual Alex template build ${build} from kit ${state.kitCommit.slice(0, 12)}${state.dirty.length ? ' (the Kit had uncommitted changes, not built)' : ''}: ${changed.length} path(s) changed; flagged: ${flaggedText}`;
    } else {
      say(`seed build: no changelog row (a seed is one person's copy of a template version, not a version); privileged paths in this diff: ${flaggedText}`);
      subject = `Virtual Alex seed ${seedName} from kit ${state.kitCommit.slice(0, 12)}: ${changed.length} path(s) changed; flagged: ${flaggedText}`;
    }
    git(['-c', `user.name=${state.name}`, '-c', `user.email=${state.email}`, 'commit', '-q', '-m', subject], { cwd: args.out });
    const local = git(['rev-parse', 'HEAD'], { cwd: args.out }).stdout.trim();
    git(['push', '-q', '-u', 'origin', 'main'], { cwd: args.out });
    const ls = git(['ls-remote', '--heads', 'origin', 'main'], { cwd: args.out }).stdout.trim();
    const remoteSha = ls.split(/\s+/)[0] || '';
    if (remoteSha !== local) throw new Refusal(`push read-back FAILED: local main ${local}, remote main ${remoteSha || '(absent)'}`);
    say(`PUSHED ${args.remote} main = ${local} (read back with git ls-remote: ${remoteSha})`);
    return 0;
  } finally {
    held.release();
  }
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
  main().then(
    (code) => process.exit(code),
    (e) => {
      if (e instanceof Refusal) { console.error(`build-online-template: REFUSED - ${e.message}`); process.exit(2); }
      console.error(`build-online-template: ERROR - ${e.stack || e.message}`);
      process.exit(1);
    });
}
