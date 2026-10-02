#!/usr/bin/env node
// scripts/employer-data-guard.mjs - the mechanical half of "employer data stays out of the vault":
// the online commit gate's third leg, the online autosave's second content leg.
//
// WHAT. The Kit's personal-data scanner guards a PUBLIC repo: it blocks other people's names, money,
// health values and phone numbers from reaching GitHub. Virtual Alex inverts that premise. The repo is
// private and IS the vault, so names, money and health values are exactly what it holds, and a scanner
// built on the old premise would block the vault itself. What still has to stay out is the owner's
// EMPLOYER's data, on three legs, each high precision by design: employer-address (any address at the
// employer domain, subdomains included, that is not the owner's own work address, a named colleague by
// construction); personnummer (the Swedish personal identity number, separated or not, coordination
// numbers included, no allowlist for this leg on purpose because the vault never needs one, the owner's
// own included); spreadsheet-export (any *.xlsx, *.xls, *.csv or *.pbix under vault/ or inbox/, because
// employer data arrives as an export and the Kit's vault is markdown). It does not catch a pasted table
// with no address and no personnummer; nothing deterministic does.
//
// HOW. The command line parses through scripts/lib/args.js, operator edge. The two profile fields the
// online /setup writes into system/install-profile.json arm LEG 1 ONLY:
// employer_domain and owner_work_address. With both empty the owner named no employer, leg 1 is
// disarmed and the guard says so once per run; legs 2 and 3 run regardless, because a personnummer or an
// HR export is third-party personal data whether or not an employer was named. The allowlist,
// system/employer-data-allowlist.json, holds a reason per row for legs 1 and 3 only, written ONLY
// through this script's own CLI, never by hand:
//   node scripts/employer-data-guard.mjs --allow-address <address> --reason "<why it is fine>"
//   node scripts/employer-data-guard.mjs --allow-path <repo path>  --reason "<why it is fine>"
//   node scripts/employer-data-guard.mjs --init-allowlist          (the empty file, once)
// A row with no reason is refused. Two scan modes, the autosave contract (scripts/autosave.sh step 2):
//   node scripts/employer-data-guard.mjs --file <path>      one file as it is on disk
//   node scripts/employer-data-guard.mjs --staged           every path this commit adds or modifies,
//                                                           read from the INDEX (the online pre-commit)
//
// NEVER. Prints the matched value: an address or a personnummer IS the data this guard exists to keep
// out of logs and transcripts, so a hit prints only `employer-data-guard: <file>:<line> <leg>` (content
// legs) or `employer-data-guard: <file> <leg> (path)` (the export leg). Exits 0 past a hit or an error:
// exit 2 is at least one hit, exit 1 is "the guard could not do its job" (an unreadable file, a broken
// allowlist, git failed), and every caller treats non-zero as a refusal.
//
// Usage: node scripts/employer-data-guard.mjs --file <path> | --staged | --init-allowlist |
//        --allow-address <a> --reason <r> | --allow-path <p> --reason <r>
// Exit: 0 clean - 1 the guard could not do its job - 2 at least one hit

import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { readJson, writeJson, readJsonHeaderless } = require('./lib/json-writer.js');
const { parseCommandLine } = require('./lib/args.js');
const { Refusal: KitRefusal } = require('./lib/errors.js');

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PROFILE_REL = 'system/install-profile.json';
const ALLOWLIST_REL = 'system/employer-data-allowlist.json';
const SCHEMA = 'employer-data-allowlist@1';
const WRITER = 'scripts/employer-data-guard.mjs';
const PURPOSE =
  'Reviewed exceptions for scripts/employer-data-guard.mjs: addresses at the employer domain and spreadsheet paths under vault/ or inbox/ that somebody looked at and decided are fine, each with its reason written down.';

/** @type {import('node:util').ParseArgsOptionsConfig} */
const FLAGS = {
  'init-allowlist': { type: 'boolean' },
  'allow-address': { type: 'string' },
  'allow-path': { type: 'string' },
  reason: { type: 'string' },
  file: { type: 'string' },
  staged: { type: 'boolean' }
};

/**
 * A known value-taking flag as the LAST token, with nothing after it to be its value, dropped so it reads
 * as though it were never given. node:util's strict parseArgs refuses that shape ("argument missing"),
 * but this CLI's existing usage line (below) is the one every caller before args.js has always seen for
 * it, so the shape stays unrefused here and falls through to that same usage check.
 * @param {string[]} argv
 * @returns {string[]}
 */
function droppingATrailingValuelessFlag(argv) {
  const last = argv.at(-1);
  const name = last?.startsWith('--') ? last.slice(2) : null;
  if (name && FLAGS[name]?.type === 'string') return argv.slice(0, -1);
  return argv;
}

const EXPORT_EXT = /\.(xlsx|xls|csv|pbix)$/i;
const EXPORT_DIRS = ['vault/', 'inbox/'];
// contract: read as text by scripts/tests/test-employer-data-guard.mjs:135-137. This regex stays one literal on one line, so that test can lift its source and scan every tracked file with it.
// biome-ignore format: the guard test builds a live RegExp from this exact line
const PERSONNUMMER = /\b\d{8}-\d{4}\b|\b\d{6}[-+]\d{4}\b|\b(?:19|20)?\d{2}(?:0[1-9]|1[0-2])(?:0[1-9]|[12]\d|3[01]|6[1-9]|[78]\d|9[01])\d{4}\b/;
const VENDORED = ['.agents/skills/', '.claude/skills/'];

// A separated number (YYMMDD-NNNN, YYMMDD+NNNN, YYYYMMDD-NNNN) is a hit on its shape. An unseparated
// one (YYMMDDNNNN, YYYYMMDDNNNN: what payroll and HR exports store) is a hit only when the pattern's
// date is plausible AND the last ten digits pass the Luhn check digit every personnummer carries,
// which keeps an unspaced 070 phone number (a 2007 "date") and most ordinary long numbers out.
const PERSONNUMMER_ALL = new RegExp(PERSONNUMMER.source, 'g');
function luhnValid(digits) {
  let sum = 0;
  for (let i = 0; i < digits.length; i++) {
    let n = digits.charCodeAt(i) - 48;
    if (i % 2 === 0) {
      n *= 2;
      if (n > 9) n -= 9;
    }
    sum += n;
  }
  return sum % 10 === 0;
}
function hasPersonnummer(line) {
  for (const m of line.matchAll(PERSONNUMMER_ALL)) {
    if (/[-+]/.test(m[0]) || luhnValid(m[0].slice(-10))) return true;
  }
  return false;
}

// This function, isBinary below and the staged-path listing further down are duplicated in
// scripts/secret-scan.mjs; scripts/lib/git.js and scripts/lib/staged-paths.js hold the shared shape,
// but adoption is held here because scripts/tests/test-employer-guard-known-bad.mjs copies this file
// into a throwaway repository without the two new lib files and runs the copy as a child process.
function git(args, opts = {}) {
  const r = spawnSync('git', args, { encoding: 'buffer', maxBuffer: 256 * 1024 * 1024, ...opts });
  if (r.error) throw new Error(`git ${args[0]}: ${r.error.message}`);
  if (r.status !== 0) throw new Error(`git ${args.join(' ')} exited ${r.status}: ${r.stderr.toString('utf8').trim()}`);
  return r.stdout;
}

/**
 * The repo root from the working directory (hooks and the autosave run at the toplevel; a test runs
 * the guard against a throwaway repo), falling back to this file's own checkout.
 * @returns {string}
 */
export function repoRoot() {
  const r = spawnSync('git', ['rev-parse', '--show-toplevel'], { encoding: 'utf8' });
  if (r.status === 0 && r.stdout.trim()) return r.stdout.trim();
  return path.resolve(HERE, '..');
}

/**
 * `p` as a forward-slashed path relative to `root`, when it names something under `root`; `p` unchanged
 * (slashes normalized) otherwise. Used to turn an absolute or backslashed path into the repo-relative
 * form every report and allowlist entry is keyed on.
 * @param {string} p
 * @param {string} root
 * @returns {string}
 */
export function normalizePath(p, root) {
  let s = String(p).replace(/\\/g, '/');
  if (path.isAbsolute(s) || /^[A-Za-z]:\//.test(s)) {
    const rel = path.relative(root, s).replace(/\\/g, '/');
    if (rel && !rel.startsWith('..')) s = rel;
  }
  return s.replace(/^\.\//, '');
}

/**
 * The employer domain and the owner's own work address from system/install-profile.json, lower-cased
 * and trimmed; both empty when the file is missing or names neither field. `employer_domain` wins over
 * an `@domain` guessed from `owner_work_address`.
 * @param {string} root
 * @returns {{ domain: string, owner: string }}
 */
export function readProfile(root) {
  const file = path.join(root, PROFILE_REL);
  const j = readJsonHeaderless(file, { bom: true, ifMissing: {} });
  const owner = String(j.owner_work_address || '')
    .trim()
    .toLowerCase();
  let domain = String(j.employer_domain || '')
    .trim()
    .toLowerCase()
    .replace(/^@/, '');
  if (!domain && owner.includes('@')) domain = owner.split('@')[1];
  return { domain, owner };
}

function emptyAllowlist() {
  return { addresses: [], paths: [] };
}

/**
 * The reviewed exceptions from system/employer-data-allowlist.json: every address lower-cased and every
 * path forward-slashed, each with its reason. Empty when the file does not exist yet. Throws when the
 * file exists but a row has no reason, a missing or foreign schema, or the JSON does not parse.
 * @param {string} root
 * @returns {{ addresses: { address: string, reason: string }[], paths: { path: string, reason: string }[] }}
 */
export function readAllowlist(root) {
  const file = path.join(root, ALLOWLIST_REL);
  if (!fs.existsSync(file)) return emptyAllowlist();
  const j = readJson(file, SCHEMA); // throws loudly on a missing or foreign schema (rule 4)
  const out = { addresses: [], paths: [] };
  for (const kind of ['addresses', 'paths']) {
    const rows = Array.isArray(j[kind]) ? j[kind] : [];
    const key = kind === 'addresses' ? 'address' : 'path';
    for (const row of rows) {
      const v = row && typeof row[key] === 'string' ? row[key].trim() : '';
      const reason = row && typeof row.reason === 'string' ? row.reason.trim() : '';
      if (!v || !reason)
        throw new Error(
          `${ALLOWLIST_REL}: a ${kind} row has no ${v ? 'reason' : key}; an entry with no reason is a hole (row: ${JSON.stringify(row)})`
        );
      out[kind].push({ [key]: kind === 'addresses' ? v.toLowerCase() : v.replace(/\\/g, '/'), reason });
    }
  }
  return out;
}

function writeAllowlist(root, data) {
  const file = path.join(root, ALLOWLIST_REL);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  return writeJson(file, data, { purpose: PURPOSE, writer: WRITER, schema: SCHEMA });
}

/**
 * Whether `buf` is binary, by git's own test: a NUL byte in the first 8000 bytes.
 * @param {Buffer} buf
 * @returns {boolean}
 */
export function isBinary(buf) {
  const n = Math.min(buf.length, 8000);
  for (let i = 0; i < n; i++) if (buf[i] === 0) return true;
  return false;
}

function escapeRe(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Pure: the hits for one path and its bytes under a profile and an allowlist.
 * @param {{ file: string, buf: Buffer, profile: { domain: string, owner: string }, allow: { addresses: { address: string }[], paths: { path: string }[] } }} args
 * @returns {{ line: number, leg: string }[]} line is 0 for the path leg
 */
export function evaluate({ file, buf, profile, allow }) {
  const hits = [];
  const rel = file.replace(/\\/g, '/');
  if (EXPORT_EXT.test(rel) && EXPORT_DIRS.some((d) => rel.startsWith(d))) {
    if (!allow.paths.some((r) => r.path === rel)) hits.push({ line: 0, leg: 'spreadsheet-export' });
  }
  if (!buf || isBinary(buf)) return hits;
  // Vendored third-party skill trees are skipped by the CONTENT legs, as personal-data-scan and
  // clone-scrub-check skip them: a skill's own schemas and examples are not the owner's employer
  // data, even though an XSD or a sample document can carry a six-dash-four shape by coincidence.
  // The path leg above still applies everywhere, and a Routine cannot write under these paths at all.
  if (VENDORED.some((d) => rel.startsWith(d))) return hits;
  const text = buf.toString('utf8');
  // The domain must END the address: not followed by a domain character, and not by a dot that opens
  // another label (x@acme.example.evil.example is evil.example's user, not the employer's), while a
  // sentence-ending period after the address still lets it match.
  const addrRe = profile.domain
    ? new RegExp(`[A-Za-z0-9._%+-]+@(?:[a-z0-9-]+\\.)*${escapeRe(profile.domain)}(?![A-Za-z0-9-]|\\.[A-Za-z0-9])`, 'gi')
    : null;
  const allowed = new Set(allow.addresses.map((r) => r.address));
  const lines = text.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (addrRe) {
      addrRe.lastIndex = 0;
      for (let m = addrRe.exec(line); m !== null; m = addrRe.exec(line)) {
        const a = m[0].toLowerCase();
        if (a === profile.owner || allowed.has(a)) continue;
        hits.push({ line: i + 1, leg: 'employer-address' });
        break;
      }
    }
    if (hasPersonnummer(line)) hits.push({ line: i + 1, leg: 'personnummer' });
  }
  return hits;
}

function report(file, hits) {
  for (const h of hits) {
    if (h.line === 0) process.stdout.write(`employer-data-guard: ${file} ${h.leg} (path)\n`);
    else process.stdout.write(`employer-data-guard: ${file}:${h.line} ${h.leg}\n`);
  }
}

/**
 * The CLI: the allowlist sub-commands (--init-allowlist, --allow-address/--allow-path with --reason), or
 * one of the two scan modes (--file <path>, --staged). An unknown flag refuses before anything runs.
 * @param {string[]} argv
 * @returns {number} the exit code
 */
export function main(argv) {
  let parsed;
  try {
    parsed = parseCommandLine({
      name: 'employer-data-guard',
      edge: 'operator',
      options: FLAGS,
      argv: droppingATrailingValuelessFlag(argv)
    });
  } catch (e) {
    if (!(e instanceof KitRefusal)) throw e;
    process.stderr.write(`employer-data-guard: ERROR - ${e.message}\n`);
    return 1;
  }
  const root = repoRoot();
  try {
    // ---- the allowlist CLI ------------------------------------------------------------------
    if (parsed.values['init-allowlist']) {
      const file = path.join(root, ALLOWLIST_REL);
      if (fs.existsSync(file)) {
        readAllowlist(root);
        process.stdout.write(`employer-data-guard: ${ALLOWLIST_REL} exists and reads back under ${SCHEMA}\n`);
        return 0;
      }
      const r = writeAllowlist(root, emptyAllowlist());
      process.stdout.write(
        `employer-data-guard: wrote the empty allowlist ${ALLOWLIST_REL} (${r.bytes} B, ${SCHEMA})\n`
      );
      return 0;
    }
    const allowAddress = parsed.values['allow-address'];
    const allowPath = parsed.values['allow-path'];
    if (allowAddress !== undefined || allowPath !== undefined) {
      const reason = String(parsed.values.reason || '').trim();
      const value = (allowAddress !== undefined ? allowAddress : allowPath) || '';
      if (!value.trim()) {
        process.stderr.write('employer-data-guard: REFUSED - the value to allow is empty\n');
        return 1;
      }
      if (!reason) {
        process.stderr.write(
          'employer-data-guard: REFUSED - --reason is required; an entry with no reason is a hole, nothing written\n'
        );
        return 1;
      }
      const list = readAllowlist(root);
      if (allowAddress !== undefined) {
        const a = value.trim().toLowerCase();
        if (!a.includes('@')) {
          process.stderr.write(`employer-data-guard: REFUSED - not an address: ${JSON.stringify(a)}\n`);
          return 1;
        }
        list.addresses = list.addresses.filter((r) => r.address !== a).concat([{ address: a, reason }]);
      } else {
        const p = normalizePath(value.trim(), root);
        list.paths = list.paths.filter((r) => r.path !== p).concat([{ path: p, reason }]);
      }
      const r = writeAllowlist(root, list);
      const back = readAllowlist(root);
      process.stdout.write(
        `employer-data-guard: ${ALLOWLIST_REL} ${r.reason} (${back.addresses.length} address row(s), ${back.paths.length} path row(s), read back under ${SCHEMA})\n`
      );
      return 0;
    }

    // ---- the two scan modes -----------------------------------------------------------------
    const fileArg = parsed.values.file;
    const staged = Boolean(parsed.values.staged);
    if ((fileArg !== undefined) === staged) {
      process.stderr.write(
        'employer-data-guard: usage: node scripts/employer-data-guard.mjs --file <path> | --staged | --init-allowlist | --allow-address <a> --reason <r> | --allow-path <p> --reason <r>\n'
      );
      return 1;
    }
    const profile = readProfile(root);
    if (!profile.domain) {
      // Only leg 1 needs the profile. A personnummer or an HR export is third-party personal data
      // whether or not the owner named an employer, and an owner with no employer is exactly the one
      // who never thinks about it. evaluate() skips the address leg when the domain is empty; legs 2
      // and 3 run regardless. Said once per run, never silent.
      process.stdout.write(
        `employer-data-guard: leg 1 (employer address) disarmed: no employer recorded in ${PROFILE_REL} (employer_domain and owner_work_address are both empty); legs 2 (personnummer) and 3 (spreadsheet export) still run\n`
      );
    }
    const allow = readAllowlist(root);
    let total = 0;
    if (fileArg !== undefined) {
      if (!fileArg) {
        process.stderr.write('employer-data-guard: --file needs a path\n');
        return 1;
      }
      const rel = normalizePath(fileArg, root);
      const hits = evaluate({ file: rel, buf: fs.readFileSync(fileArg), profile, allow });
      report(fileArg, hits);
      total = hits.length;
    } else {
      const paths = git(['diff', '--cached', '--name-only', '--diff-filter=AM', '--no-renames', '-z'])
        .toString('utf8')
        .split('\0')
        .filter(Boolean);
      for (const file of paths) {
        // :0:<path> (stage 0, explicit), not :<path>: git's revision parser reads a bare :<path> whose
        // first segment looks like a stage number and a colon as "stage 0 of <path>" rather than "stage 0
        // of the path literally named 0:<path>", the same ambiguity scripts/secret-scan.mjs's matching
        // read guards against.
        const hits = evaluate({ file, buf: git(['show', `:0:${file}`]), profile, allow });
        report(file, hits);
        total += hits.length;
      }
    }
    if (total > 0) {
      process.stderr.write(
        `employer-data-guard: ${total} hit(s); the value is never printed. Employer data stays out of the vault: remove it, or record a reviewed exception with its reason through this script (legs 1 and 3 only).\n`
      );
      return 2;
    }
    return 0;
  } catch (e) {
    process.stderr.write(`employer-data-guard: ERROR ${e.message}\n`);
    return 1;
  }
}

if (process.argv[1] && /employer-data-guard\.mjs$/.test(process.argv[1].replace(/\\/g, '/'))) {
  process.exit(main(process.argv.slice(2)));
}
