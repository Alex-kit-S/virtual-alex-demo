#!/usr/bin/env node
// scripts/import-memory.mjs - bring an owner's laptop memory (soul.md and vault/) into this repository
// from a ZIP, without the ZIP ever becoming a commit. (2026-09-24, Virtual Alex fleet seat 5: the
// /setup --import step, decision D3 "bring your memory".)
//
// WHERE THE ZIP COMES FROM. Never from a commit. Online, every committed byte is history forever, and
// uploading a file on github.com with "Add file" IS a commit. The owner attaches the ZIP to a release
// on their own private repository instead: a release asset is not in git history and is deleted when
// the import is done. The session downloads it OUTSIDE the working tree with `gh release download`
// (code.claude.com/docs/en/cloud-environments, "GitHub proxy": release-asset requests reach the
// repositories attached to the session, and gh is pre-installed and named for `gh release`).
//
// WHAT. It takes soul.md and vault/ out of the ZIP and writes them here, in this order, and every
// refusal comes before a single byte is written:
//   Z0 the ZIP must sit outside this repository, so no autosave or `git add` can ever pick it up
//   Z1 the archive: at most 100 MB, no zip64, no encrypted or unsupported entry among those taken
//   Z2 zip-slip: an entry name that is absolute, has a drive letter, a backslash, a NUL, or a `..`
//      segment refuses the whole archive (an honest export never has one)
//   Z3 only soul.md and vault/** are taken. One common top folder is stripped first, so a zipped
//      laptop folder works. Everything else, and __MACOSX/, .DS_Store and vault/.obsidian/, is listed
//      as skipped, never written
//   Z4 a link inside soul.md or vault/ refuses (a vault holds no links); a link elsewhere is skipped
//   Z5 size: no taken file over 10 MB (the commit gate's own size guard), at most 250 MB and 20,000
//      files in all; every inflate is capped at the declared size, and the bytes must match the
//      declared size and CRC
//   Z6 the content legs of the commit gate, before anything is written: scripts/secret-scan.mjs and
//      scripts/employer-data-guard.mjs over every taken file. A hit refuses (file:line and leg, never
//      the value), unless --skip-flagged, which the owner agrees to, leaves exactly those files out
//   Z7 never overwrites without asking: --apply refuses while any target exists, unless --overwrite,
//      which /setup passes only after the owner has seen the list and said yes
//   Z8 no path is both a file and a folder: an entry named twice, a file the archive also uses as a
//      folder, a folder or a link in this repository where the archive has a file, or a file or a link
//      in this repository where the archive needs a folder, refuses, --overwrite or not (fleet Fix C,
//      review finding F07: it used to write two files, then crash on the third with a stack trace)
//
// HOW. node scripts/import-memory.mjs <zip> [--apply] [--overwrite] [--skip-flagged] [--root <repo>]
//      Without --apply it is a dry run that prints the plan and writes nothing.
// Exit: 0 done (or a clean plan) · 2 refused, with every reason · 1 script error. Node builtins only.
//
// NEVER. Never reads a ZIP from inside this repository, never runs a git command that changes
// anything (the one git call asks where the repository root is), never prints the value a content
// leg flagged, and never overwrites an existing file without --overwrite. The files it writes are
// saved by the autosave like any other write; the ZIP itself never is.
'use strict';

import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { scanText, isBinary } from './secret-scan.mjs';
import { evaluate, readProfile, readAllowlist } from './employer-data-guard.mjs';

export const LIMITS = { archive: 100 * 1024 * 1024, file: 10485760, total: 250 * 1024 * 1024, files: 20000 };

export class Refusal extends Error {
  constructor(reasons) { super(reasons.join(' | ')); this.reasons = reasons; }
}

// CRC-32 (the ZIP polynomial), so the check does not depend on the node version having zlib.crc32.
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; }
  return t;
})();
export function crc32(buf) {
  let c = 0xFFFFFFFF;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xFF] ^ (c >>> 8);
  return (c ^ 0xFFFFFFFF) >>> 0;
}

/** The central directory of a ZIP: [{ index, name, dir, link, method, flags, crc, csize, usize, offset }]. */
export function readCentral(buf) {
  const min = Math.max(0, buf.length - 65557);
  let eocd = -1;
  for (let i = buf.length - 22; i >= min; i--) if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  if (eocd < 0) throw new Refusal(['Z1 not a ZIP archive (no end-of-central-directory record)']);
  if (eocd >= 20 && buf.readUInt32LE(eocd - 20) === 0x07064b50) throw new Refusal(['Z1 a zip64 archive; export a smaller one, or split the vault']);
  const count = buf.readUInt16LE(eocd + 10);
  const cdSize = buf.readUInt32LE(eocd + 12);
  const cdOff = buf.readUInt32LE(eocd + 16);
  if (count === 0xFFFF || cdOff === 0xFFFFFFFF || cdOff + cdSize > eocd) throw new Refusal(['Z1 the archive directory is out of range or zip64']);
  const entries = [];
  let p = cdOff;
  for (let index = 0; index < count; index++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) throw new Refusal([`Z1 entry ${index + 1}: a damaged central directory`]);
    const madeBy = buf.readUInt16LE(p + 4);
    const flags = buf.readUInt16LE(p + 8);
    const method = buf.readUInt16LE(p + 10);
    const crc = buf.readUInt32LE(p + 16);
    const csize = buf.readUInt32LE(p + 20);
    const usize = buf.readUInt32LE(p + 24);
    const nlen = buf.readUInt16LE(p + 28);
    const xlen = buf.readUInt16LE(p + 30);
    const clen = buf.readUInt16LE(p + 32);
    const ext = buf.readUInt32LE(p + 38);
    const offset = buf.readUInt32LE(p + 42);
    const rawName = buf.subarray(p + 46, p + 46 + nlen);
    const extra = buf.subarray(p + 46 + nlen, p + 46 + nlen + xlen);
    let name = null;
    // The Info-ZIP Unicode Path field (0x7075) carries the UTF-8 name when the archiver wrote a legacy
    // one; Windows and 7-Zip use it for a Turkish or Arabic file name.
    for (let x = 0; x + 4 <= extra.length;) {
      const id = extra.readUInt16LE(x); const len = extra.readUInt16LE(x + 2);
      if (id === 0x7075 && len >= 5 && extra[x + 4] === 1) name = extra.subarray(x + 9, x + 4 + len).toString('utf8');
      x += 4 + len;
    }
    if (name === null) {
      try { name = new TextDecoder('utf-8', { fatal: true }).decode(rawName); } catch { throw new Refusal([`Z1 entry ${index + 1}: a file name that is not UTF-8; zip the folder again with the system's own "Compress" or 7-Zip`]); }
    }
    const unix = (madeBy >> 8) === 3 ? (ext >>> 16) : 0;
    entries.push({ index, name, dir: name.endsWith('/'), link: (unix & 0o170000) === 0o120000, method, flags, crc, csize, usize, offset });
    p += 46 + nlen + xlen + clen;
  }
  return entries;
}

/** Z2: why a name could land outside the repository, or null. */
export function slipReason(name) {
  if (!name) return 'an empty name';
  if (name.includes('\0')) return 'a NUL in the name';
  if (name.includes('\\')) return 'a backslash in the name';
  if (name.startsWith('/')) return 'an absolute path';
  if (/^[A-Za-z]:/.test(name)) return 'a drive letter';
  if (name.split('/').some((s) => s === '..')) return 'a ".." segment';
  return null;
}

/** Z3: the path an entry lands at after the one common top folder is stripped, and whether it is taken. */
export function planNames(entries) {
  const real = entries.filter((e) => !e.name.startsWith('__MACOSX/'));
  const atRoot = real.some((e) => e.name === 'soul.md' || e.name.startsWith('vault/'));
  const tops = new Set(real.map((e) => e.name.split('/')[0]));
  const strip = !atRoot && tops.size === 1 && real.every((e) => e.name.includes('/')) ? `${[...tops][0]}/` : '';
  return entries.map((e) => {
    if (e.name.startsWith('__MACOSX/')) return { ...e, rel: e.name, take: false, why: 'macOS resource data' };
    const rel = e.name.slice(strip.length);
    const base = path.posix.basename(rel);
    let take = rel === 'soul.md' || (rel.startsWith('vault/') && !e.dir);
    let why = take ? '' : 'not soul.md or vault/';
    if (take && base === '.DS_Store') { take = false; why = 'macOS folder data'; }
    if (take && rel.startsWith('vault/.obsidian/')) { take = false; why = 'Obsidian device settings, never saved online'; }
    return { ...e, rel, take, why };
  });
}

function inflate(buf, e) {
  if (e.offset + 30 > buf.length || buf.readUInt32LE(e.offset) !== 0x04034b50) throw new Refusal([`Z1 ${e.rel}: a damaged local header`]);
  const start = e.offset + 30 + buf.readUInt16LE(e.offset + 26) + buf.readUInt16LE(e.offset + 28);
  if (start + e.csize > buf.length) throw new Refusal([`Z1 ${e.rel}: its data runs past the end of the archive`]);
  const raw = buf.subarray(start, start + e.csize);
  let out;
  if (e.method === 0) out = Buffer.from(raw);
  else {
    // The cap is the declared size, but never below 1: node refuses maxOutputLength 0 as out of range,
    // and a deflated EMPTY file (an empty Obsidian note, from any zipper that deflates everything)
    // declares 0. One byte of headroom is still a cap, and the length check below refuses it.
    try { out = zlib.inflateRawSync(raw, { maxOutputLength: Math.max(1, e.usize) }); } catch (err) {
      throw new Refusal([`Z5 ${e.rel}: inflates past its declared ${e.usize} bytes or is damaged (${err.code || err.message})`]);
    }
  }
  if (out.length !== e.usize) throw new Refusal([`Z5 ${e.rel}: ${out.length} bytes, but the archive declares ${e.usize}`]);
  if (crc32(out) !== e.crc) throw new Refusal([`Z5 ${e.rel}: the CRC does not match; the archive is damaged`]);
  return out;
}

/** The whole import. Returns { planned, skipped, flagged, overwrite, written }; throws Refusal. */
export function importMemory({ zip, root, apply = false, overwrite = false, skipFlagged = false }) {
  const zipAbs = path.resolve(zip);
  const rootAbs = path.resolve(root);
  const inside = path.relative(rootAbs, zipAbs);
  if (!inside.startsWith('..') && !path.isAbsolute(inside)) {
    throw new Refusal([`Z0 ${zip} is inside this repository; download it outside the working tree (the system temp folder) so no save can ever commit it`]);
  }
  const size = fs.statSync(zipAbs).size;
  if (size > LIMITS.archive) throw new Refusal([`Z1 the archive is ${size} bytes, over ${LIMITS.archive}`]);
  const buf = fs.readFileSync(zipAbs);
  const entries = readCentral(buf);

  const slips = entries.map((e) => [e, slipReason(e.name)]).filter(([, r]) => r);
  if (slips.length) throw new Refusal(slips.map(([e, r]) => `Z2 entry ${e.index + 1} ${JSON.stringify(e.name)}: ${r}; the whole archive is refused`));

  const plan = planNames(entries);
  const taken = plan.filter((e) => e.take);
  const problems = [];
  for (const e of taken) {
    if (e.link) problems.push(`Z4 ${e.rel} is a link; a vault holds no links`);
    if (e.flags & 1) problems.push(`Z1 ${e.rel} is encrypted; export it without a password`);
    if (e.method !== 0 && e.method !== 8) problems.push(`Z1 ${e.rel} uses compression method ${e.method}; only stored and deflated are read`);
    if (e.usize > LIMITS.file) problems.push(`Z5 ${e.rel} is ${e.usize} bytes, over the ${LIMITS.file}-byte size guard the commit gate enforces`);
  }
  const total = taken.reduce((n, e) => n + e.usize, 0);
  if (taken.length > LIMITS.files) problems.push(`Z5 ${taken.length} files, over ${LIMITS.files}`);
  if (total > LIMITS.total) problems.push(`Z5 ${total} bytes in all, over ${LIMITS.total}`);
  if (!taken.length) problems.push('Z3 the archive holds no soul.md and nothing under vault/');
  if (problems.length) throw new Refusal(problems);

  // Z5 + Z6: the bytes, then the content legs, still before any write.
  const profile = readProfile(rootAbs);
  const allow = readAllowlist(rootAbs);
  const flagged = [];
  for (const e of taken) {
    e.bytes = inflate(buf, e);
    const hits = [];
    if (!isBinary(e.bytes)) for (const h of scanText(e.bytes.toString('utf8'))) hits.push(`${e.rel}:${h.line} secret-scan ${h.name}`);
    for (const h of evaluate({ file: e.rel, buf: e.bytes, profile, allow })) hits.push(h.line ? `${e.rel}:${h.line} employer-data-guard ${h.leg}` : `${e.rel} employer-data-guard ${h.leg} (path)`);
    if (hits.length) flagged.push({ rel: e.rel, hits });
  }
  if (flagged.length && !skipFlagged) {
    throw new Refusal(flagged.flatMap((f) => f.hits.map((h) => `Z6 ${h}`)).concat(['Z6 nothing was written; remove those files from the archive, or rerun with --skip-flagged once the owner agrees to leave exactly these out']));
  }
  const keep = taken.filter((e) => !flagged.some((f) => f.rel === e.rel));

  // Z7
  const targets = keep.map((e) => {
    const abs = path.resolve(rootAbs, e.rel);
    const rel = path.relative(rootAbs, abs);
    if (rel.startsWith('..') || path.isAbsolute(rel)) throw new Refusal([`Z2 ${e.rel} resolves outside the repository`]);
    return { e, abs, exists: fs.existsSync(abs) };
  });
  // Z8: a path cannot be a file and a folder at once, and --overwrite replaces files, never folders or
  // links. Checked here, before the first write, because the loop below cannot undo half an import.
  const lstat = (p) => { try { return fs.lstatSync(p); } catch { return null; } };
  const clash = new Set();
  const byRel = new Set();
  for (const t of targets) {
    if (byRel.has(t.e.rel)) clash.add(`Z8 ${t.e.rel} appears twice in the archive`);
    byRel.add(t.e.rel);
  }
  for (const t of targets) {
    const parts = t.e.rel.split('/');
    for (let i = 1; i < parts.length; i++) {
      const prefix = parts.slice(0, i).join('/');
      if (byRel.has(prefix)) clash.add(`Z8 ${prefix} is a file in the archive and also a folder holding ${t.e.rel}`);
      const st = lstat(path.join(rootAbs, prefix));
      if (st && !st.isDirectory()) clash.add(`Z8 ${prefix} is a ${st.isSymbolicLink() ? 'link' : 'file'} in this repository, but the archive puts ${t.e.rel} inside it`);
    }
    const st = lstat(t.abs);
    if (st && st.isDirectory()) clash.add(`Z8 ${t.e.rel} is a folder in this repository, and the archive holds a file by that name`);
    if (st && st.isSymbolicLink()) clash.add(`Z8 ${t.e.rel} is a link in this repository; an import never writes through a link`);
  }
  if (clash.size) throw new Refusal([...clash]);
  const existing = targets.filter((t) => t.exists).map((t) => t.e.rel);
  const result = {
    planned: keep.map((e) => e.rel),
    skipped: plan.filter((e) => !e.take).map((e) => `${e.rel} (${e.link ? 'a link' : e.why})`),
    flagged: flagged.map((f) => f.rel),
    overwrite: existing,
    written: [],
  };
  if (!apply) return result;
  if (existing.length && !overwrite) {
    throw new Refusal([`Z7 ${existing.length} file(s) already exist and would be replaced: ${existing.slice(0, 20).join(', ')}${existing.length > 20 ? ', ...' : ''}; show the owner this list, and rerun with --overwrite only after they say yes`]);
  }
  for (const t of targets) {
    fs.mkdirSync(path.dirname(t.abs), { recursive: true });
    fs.writeFileSync(t.abs, t.e.bytes);
    result.written.push(t.e.rel);
  }
  return result;
}

function repoRootOf(dir) {
  const r = spawnSync('git', ['rev-parse', '--show-toplevel'], { cwd: dir, encoding: 'utf8' });
  return r.status === 0 && r.stdout.trim() ? r.stdout.trim() : dir;
}

export function main(argv, log = console.log) {
  const a = { zip: null, root: null, apply: false, overwrite: false, skipFlagged: false };
  for (let i = 0; i < argv.length; i++) {
    const x = argv[i];
    if (x === '--apply') a.apply = true;
    else if (x === '--overwrite') a.overwrite = true;
    else if (x === '--skip-flagged') a.skipFlagged = true;
    else if (x === '--root') a.root = argv[++i];
    else if (!x.startsWith('--') && !a.zip) a.zip = x;
    else { log(`import-memory: ERROR - unknown argument ${x}`); return 1; }
  }
  if (!a.zip) { log('import-memory: usage: node scripts/import-memory.mjs <zip> [--apply] [--overwrite] [--skip-flagged] [--root <repo>]'); return 1; }
  try {
    const r = importMemory({ ...a, root: a.root || repoRootOf(process.cwd()) });
    for (const s of r.skipped) log(`  skip  ${s}`);
    for (const f of r.flagged) log(`  left out (flagged, --skip-flagged)  ${f}`);
    for (const o of r.overwrite) log(`  replaces an existing file  ${o}`);
    log(`import-memory: ${a.apply ? `WROTE ${r.written.length} file(s)` : `PLAN ${r.planned.length} file(s) to write, nothing written (dry run)`}; ${r.skipped.length} skipped, ${r.flagged.length} left out, ${r.overwrite.length} would replace an existing file`);
    return 0;
  } catch (e) {
    if (e instanceof Refusal) { for (const m of e.reasons) log(`REFUSED ${m}`); log('import-memory: REFUSED - nothing was written'); return 2; }
    log(`import-memory: ERROR - ${e.stack || e.message}`);
    return 1;
  }
}

// Am I the script node was asked to run? Compared as REAL paths: node resolves the main module through
// links, so a run through a linked folder (macOS's /var -> /private/var, a junction on Windows) read as
// "imported", did nothing and exited 0, an import that silently never happened (fleet Fix C,
// 2026-09-24; the same fix as the build and the /update gate in Fix A).
const real = (p) => { try { return fs.realpathSync.native(p); } catch { return path.resolve(p); } };
const invoked = process.argv[1] ? real(process.argv[1]) : '';
const self = real(fileURLToPath(import.meta.url));
const isMain = process.platform === 'win32' ? invoked.toLowerCase() === self.toLowerCase() : invoked === self;
if (isMain) process.exit(main(process.argv.slice(2)));
