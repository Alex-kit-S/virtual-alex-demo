#!/usr/bin/env node
/*
 * scripts/employer-data-guard.mjs - the mechanical half of the "employer data stays out of the
 * vault" order (Virtual Alex plan Phase 3, seat 5 C5 and C12, built 2026-09-23).
 *
 * WHY IT EXISTS. The Kit's personal-data scanner guards a PUBLIC repo: it blocks other people's
 * names, money, health values and phone numbers from reaching GitHub. Virtual Alex inverts that
 * premise. The repo is private and IS the vault, so names, money and health values are exactly what
 * it holds, and a scanner built on the old premise would block the vault itself. What still has to
 * stay out is the owner's EMPLOYER's data: a colleague's address, a Swedish personal identity number
 * from an HR export, a spreadsheet pulled from work. That order exists in the constitution as prose
 * ("Employer Data Stays Out Of The Vault"); this is the machine behind it.
 *
 * THREE LEGS, each high precision by design, on the staged content or one file:
 *   1. employer-address    any address at the owner's employer domain (subdomains included) that
 *                          is NOT the owner's own work address. A named colleague, by construction.
 *   2. personnummer        the Swedish personal identity number shape, YYMMDD-NNNN or
 *                          YYYYMMDD-NNNN. No allowlist for this leg, on purpose: the vault never
 *                          needs one, the owner's own included.
 *   3. spreadsheet-export  any *.xlsx, *.xls, *.csv or *.pbix under vault/ or inbox/. Employer data
 *                          arrives as an export, and the Kit's vault is markdown.
 * The two profile fields the online /setup writes into system/install-profile.json arm LEG 1 ONLY:
 * `employer_domain` and `owner_work_address`. With both empty the owner named no employer, leg 1 is
 * disarmed and the guard says so once per run; legs 2 and 3 run regardless (master ruling
 * 2026-09-23: a personnummer or an HR export is third-party personal data whether or not an employer
 * was named, and an owner with no employer is exactly the one who never thinks about it). It does not
 * catch a pasted table with no address and no personnummer; nothing deterministic does, and the order
 * in the constitution stays the rule for that case.
 *
 * THE ALLOWLIST. system/employer-data-allowlist.json, a reason per row, for legs 1 and 3 only,
 * written ONLY through this script (the JSON writer, docs/json-standard.md), never by hand:
 *   node scripts/employer-data-guard.mjs --allow-address <address> --reason "<why it is fine>"
 *   node scripts/employer-data-guard.mjs --allow-path <repo path>  --reason "<why it is fine>"
 *   node scripts/employer-data-guard.mjs --init-allowlist          (the empty file, once)
 * A row with no reason is refused; an entry with no reason is a hole. The file is an identity
 * surface (system/*allowlist*.json in the guard's IDENTITY_PATHS), so a Routine cannot edit it.
 *
 * TWO SCAN MODES, ONE CONTRACT (the autosave contract, scripts/autosave.sh step 2):
 *   node scripts/employer-data-guard.mjs --file <path>      one file as it is on disk
 *   node scripts/employer-data-guard.mjs --staged           every path this commit adds or modifies,
 *                                                           read from the INDEX (the online pre-commit)
 * Exit 0 = clean. Exit 2 = at least one hit, printed as
 *   employer-data-guard: <file>:<line> <leg>        (content legs)
 *   employer-data-guard: <file> <leg> (path)        (the export leg)
 * and NEVER the matched value: an address or a personnummer IS the data this guard exists to keep
 * out of logs and transcripts. Exit 1 = the guard could not do its job (unreadable file, a broken
 * allowlist, git failed); every caller treats non-zero as a refusal, which is the fail-closed half.
 *
 * Node builtins plus scripts/lib/json-writer.js. Test: node scripts/tests/test-employer-data-guard.mjs.
 */

import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { readJson, writeJson } = require('./lib/json-writer.js');

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PROFILE_REL = 'system/install-profile.json';
const ALLOWLIST_REL = 'system/employer-data-allowlist.json';
const SCHEMA = 'employer-data-allowlist@1';
const WRITER = 'scripts/employer-data-guard.mjs';
const PURPOSE = 'Reviewed exceptions for scripts/employer-data-guard.mjs: addresses at the employer domain and spreadsheet paths under vault/ or inbox/ that somebody looked at and decided are fine, each with its reason written down.';

const EXPORT_EXT = /\.(xlsx|xls|csv|pbix)$/i;
const EXPORT_DIRS = ['vault/', 'inbox/'];
const PERSONNUMMER = /\b\d{8}-\d{4}\b|\b\d{6}-\d{4}\b/;
const VENDORED = ['.agents/skills/', '.claude/skills/'];

function git(args, opts = {}) {
  const r = spawnSync('git', args, { encoding: 'buffer', maxBuffer: 256 * 1024 * 1024, ...opts });
  if (r.error) throw new Error(`git ${args[0]}: ${r.error.message}`);
  if (r.status !== 0) throw new Error(`git ${args.join(' ')} exited ${r.status}: ${r.stderr.toString('utf8').trim()}`);
  return r.stdout;
}

// The repo root from the working directory (hooks and the autosave run at the toplevel; a test runs
// the guard against a throwaway repo), falling back to this file's own checkout.
export function repoRoot() {
  const r = spawnSync('git', ['rev-parse', '--show-toplevel'], { encoding: 'utf8' });
  if (r.status === 0 && r.stdout.trim()) return r.stdout.trim();
  return path.resolve(HERE, '..');
}

export function normalizePath(p, root) {
  let s = String(p).replace(/\\/g, '/');
  if (path.isAbsolute(s) || /^[A-Za-z]:\//.test(s)) {
    const rel = path.relative(root, s).replace(/\\/g, '/');
    if (rel && !rel.startsWith('..')) s = rel;
  }
  return s.replace(/^\.\//, '');
}

export function readProfile(root) {
  const file = path.join(root, PROFILE_REL);
  if (!fs.existsSync(file)) return { domain: '', owner: '' };
  let raw = fs.readFileSync(file, 'utf8');
  if (raw.charCodeAt(0) === 0xFEFF) raw = raw.slice(1);
  const j = JSON.parse(raw);
  const owner = String(j.owner_work_address || '').trim().toLowerCase();
  let domain = String(j.employer_domain || '').trim().toLowerCase().replace(/^@/, '');
  if (!domain && owner.includes('@')) domain = owner.split('@')[1];
  return { domain, owner };
}

function emptyAllowlist() { return { addresses: [], paths: [] }; }

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
      if (!v || !reason) throw new Error(`${ALLOWLIST_REL}: a ${kind} row has no ${v ? 'reason' : key}; an entry with no reason is a hole (row: ${JSON.stringify(row)})`);
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

export function isBinary(buf) {
  const n = Math.min(buf.length, 8000);
  for (let i = 0; i < n; i++) if (buf[i] === 0) return true;
  return false;
}

function escapeRe(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }

// Pure: the hits for one path and its bytes under a profile and an allowlist. Returns
// [{ line, leg }] where line is 0 for the path leg.
export function evaluate({ file, buf, profile, allow }) {
  const hits = [];
  const rel = file.replace(/\\/g, '/');
  if (EXPORT_EXT.test(rel) && EXPORT_DIRS.some((d) => rel.startsWith(d))) {
    if (!allow.paths.some((r) => r.path === rel)) hits.push({ line: 0, leg: 'spreadsheet-export' });
  }
  if (!buf || isBinary(buf)) return hits;
  // Vendored third-party skill trees are skipped by the CONTENT legs, as personal-data-scan and
  // clone-scrub-check skip them: a skill's own schemas and examples are not the owner's employer
  // data (a pptx XSD carried a six-dash-four shape by coincidence, measured 2026-09-23). The path
  // leg above still applies everywhere, and a Routine cannot write under these paths at all.
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
      let m;
      while ((m = addrRe.exec(line)) !== null) {
        const a = m[0].toLowerCase();
        if (a === profile.owner || allowed.has(a)) continue;
        hits.push({ line: i + 1, leg: 'employer-address' });
        break;
      }
    }
    if (PERSONNUMMER.test(line)) hits.push({ line: i + 1, leg: 'personnummer' });
  }
  return hits;
}

function report(file, hits) {
  for (const h of hits) {
    if (h.line === 0) process.stdout.write(`employer-data-guard: ${file} ${h.leg} (path)\n`);
    else process.stdout.write(`employer-data-guard: ${file}:${h.line} ${h.leg}\n`);
  }
}

function argAfter(argv, flag) {
  const i = argv.indexOf(flag);
  return i >= 0 ? argv[i + 1] : undefined;
}

export function main(argv) {
  const root = repoRoot();
  try {
    // ---- the allowlist CLI ------------------------------------------------------------------
    if (argv.includes('--init-allowlist')) {
      const file = path.join(root, ALLOWLIST_REL);
      if (fs.existsSync(file)) { readAllowlist(root); process.stdout.write(`employer-data-guard: ${ALLOWLIST_REL} exists and reads back under ${SCHEMA}\n`); return 0; }
      const r = writeAllowlist(root, emptyAllowlist());
      process.stdout.write(`employer-data-guard: wrote the empty allowlist ${ALLOWLIST_REL} (${r.bytes} B, ${SCHEMA})\n`);
      return 0;
    }
    const allowAddress = argAfter(argv, '--allow-address');
    const allowPath = argAfter(argv, '--allow-path');
    if (allowAddress !== undefined || allowPath !== undefined) {
      const reason = (argAfter(argv, '--reason') || '').trim();
      const value = (allowAddress !== undefined ? allowAddress : allowPath) || '';
      if (!value.trim()) { process.stderr.write('employer-data-guard: REFUSED - the value to allow is empty\n'); return 1; }
      if (!reason) { process.stderr.write('employer-data-guard: REFUSED - --reason is required; an entry with no reason is a hole, nothing written\n'); return 1; }
      const list = readAllowlist(root);
      if (allowAddress !== undefined) {
        const a = value.trim().toLowerCase();
        if (!a.includes('@')) { process.stderr.write(`employer-data-guard: REFUSED - not an address: ${JSON.stringify(a)}\n`); return 1; }
        list.addresses = list.addresses.filter((r) => r.address !== a).concat([{ address: a, reason }]);
      } else {
        const p = normalizePath(value.trim(), root);
        list.paths = list.paths.filter((r) => r.path !== p).concat([{ path: p, reason }]);
      }
      const r = writeAllowlist(root, list);
      const back = readAllowlist(root);
      process.stdout.write(`employer-data-guard: ${ALLOWLIST_REL} ${r.reason} (${back.addresses.length} address row(s), ${back.paths.length} path row(s), read back under ${SCHEMA})\n`);
      return 0;
    }

    // ---- the two scan modes -----------------------------------------------------------------
    const fileArg = argAfter(argv, '--file');
    const staged = argv.includes('--staged');
    if ((fileArg !== undefined) === staged) {
      process.stderr.write('employer-data-guard: usage: node scripts/employer-data-guard.mjs --file <path> | --staged | --init-allowlist | --allow-address <a> --reason <r> | --allow-path <p> --reason <r>\n');
      return 1;
    }
    const profile = readProfile(root);
    if (!profile.domain) {
      // Master ruling 2026-09-23 (seat 4 carry-over 3): only leg 1 needs the profile. A personnummer or
      // an HR export is third-party personal data whether or not the owner named an employer, and an
      // owner with no employer is exactly the one who never thinks about it. evaluate() skips the
      // address leg when the domain is empty; legs 2 and 3 run regardless. Said once per run, never silent.
      process.stdout.write(`employer-data-guard: leg 1 (employer address) disarmed: no employer recorded in ${PROFILE_REL} (employer_domain and owner_work_address are both empty); legs 2 (personnummer) and 3 (spreadsheet export) still run\n`);
    }
    const allow = readAllowlist(root);
    let total = 0;
    if (fileArg !== undefined) {
      if (!fileArg) { process.stderr.write('employer-data-guard: --file needs a path\n'); return 1; }
      const rel = normalizePath(fileArg, root);
      const hits = evaluate({ file: rel, buf: fs.readFileSync(fileArg), profile, allow });
      report(fileArg, hits);
      total = hits.length;
    } else {
      const paths = git(['diff', '--cached', '--name-only', '--diff-filter=AM', '--no-renames', '-z'])
        .toString('utf8').split('\0').filter(Boolean);
      for (const file of paths) {
        const hits = evaluate({ file, buf: git(['show', `:${file}`]), profile, allow });
        report(file, hits);
        total += hits.length;
      }
    }
    if (total > 0) {
      process.stderr.write(`employer-data-guard: ${total} hit(s); the value is never printed. Employer data stays out of the vault: remove it, or record a reviewed exception with its reason through this script (legs 1 and 3 only).\n`);
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
