#!/usr/bin/env node
// scripts/import-memory.mjs - bring an owner's laptop memory (soul.md and vault/) into this repository
// from a ZIP, without the ZIP ever becoming a commit (the /setup --import step).
//
// WHERE THE ZIP COMES FROM. Never from a commit: online, every committed byte is history forever, and
// uploading a file on github.com with "Add file" IS a commit. The owner attaches the ZIP to a release
// on their own private repository instead (not in git history, deleted when the import is done), and
// the session downloads it OUTSIDE the working tree with `gh release download`.
//
// WHAT. It takes soul.md and vault/ out of the ZIP and writes them here, in this order, and every
// refusal comes before a single byte is written:
//   Z0 the ZIP must sit outside this repository, so no autosave or `git add` can ever pick it up
//   Z1 the archive: at most 100 MB, no zip64, no encrypted or unsupported entry among those taken
//   Z2 zip-slip: an absolute name, a drive letter, a backslash, a NUL or a `..` segment refuses the
//      whole archive (an honest export never has one)
//   Z3 only soul.md and vault/** are taken, top folder stripped first (a zipped laptop folder works);
//      everything else, and __MACOSX/, .DS_Store and vault/.obsidian/, is listed as skipped, never written
//   Z4 a link inside soul.md or vault/ refuses (a vault holds no links); a link elsewhere is skipped
//   Z5 size: no taken file over 10 MB (the commit gate's guard, per test-autosave-paths.mjs), at most 250 MB and
//      20,000 files in all; every inflate is capped at the declared size, and the bytes must match the size and CRC
//   Z6 the commit gate's content legs, before anything is written: secret-scan.mjs and
//      employer-data-guard.mjs over every taken file. A hit refuses (file:line and leg, never the
//      value), unless --skip-flagged, which the owner agrees to, leaves exactly those files out
//   Z7 never overwrites without asking: --apply refuses while any target exists, unless --overwrite,
//      which /setup passes only after the owner has seen the list and said yes
//   Z8 no path is both a file and a folder: a name used twice, a file the archive also uses as a
//      folder, or either side already existing here as the other kind, refuses, --overwrite or not
//
// HOW. The command line parses through scripts/lib/args.js, operator edge. readCentral reads the ZIP's own central
// directory, planNames plans what is taken and where it lands, and in --apply mode importMemory inflates and
// writes it. Without --apply it is a dry run that prints the plan and writes nothing. --root names the
// repository the files land in; without it, the import lands in the checkout this script itself belongs to
// (repo-root.js's REPO), never the working directory - /setup runs it from that checkout with no --root.
//
// NEVER. Never reads a ZIP from inside this repository, runs a git command, or prints the value a
// content leg flagged. The files it writes are saved by the autosave like any other write; the ZIP never
// is. Z0 is path-based: a hard-linked ZIP already inside this repository passes it, unpinned.
//
// Usage: node scripts/import-memory.mjs <zip> [--apply] [--overwrite] [--skip-flagged] [--root <repo>]
// Exit: 0 done (or a clean plan) - 2 refused, with every reason - 1 script error

import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { scanText, isBinary } from './secret-scan.mjs';
import { evaluate, readProfile, readAllowlist } from './employer-data-guard.mjs';
import { REPO } from './lib/repo-root.js';
import { Refusal as KitRefusal, isMain } from './lib/errors.js';
import { parseCommandLine } from './lib/args.js';

export const LIMITS = { archive: 100 * 1024 * 1024, file: 10485760, total: 250 * 1024 * 1024, files: 20000 };

/** @type {import('node:util').ParseArgsOptionsConfig} */
const FLAGS = {
  apply: { type: 'boolean' },
  overwrite: { type: 'boolean' },
  'skip-flagged': { type: 'boolean' },
  root: { type: 'string' }
};

class ImportRefusal extends KitRefusal {
  constructor(reasons) {
    super(reasons.join(' | '));
    this.reasons = reasons;
  }
}
export { ImportRefusal as Refusal };

// CRC-32 (the ZIP polynomial), so the check does not depend on the node version having zlib.crc32.
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();
export function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/** The central directory of a ZIP: [{ index, name, dir, link, method, flags, crc, csize, usize, offset }]. */
export function readCentral(buf) {
  const min = Math.max(0, buf.length - 65557);
  let eocd = -1;
  for (let i = buf.length - 22; i >= min; i--)
    if (buf.readUInt32LE(i) === 0x06054b50) {
      eocd = i;
      break;
    }
  if (eocd < 0) throw new ImportRefusal(['Z1 not a ZIP archive (no end-of-central-directory record)']);
  if (eocd >= 20 && buf.readUInt32LE(eocd - 20) === 0x07064b50)
    throw new ImportRefusal(['Z1 a zip64 archive; export a smaller one, or split the vault']);
  const count = buf.readUInt16LE(eocd + 10);
  const cdSize = buf.readUInt32LE(eocd + 12);
  const cdOff = buf.readUInt32LE(eocd + 16);
  if (count === 0xffff || cdOff === 0xffffffff || cdOff + cdSize > eocd)
    throw new ImportRefusal(['Z1 the archive directory is out of range or zip64']);
  const entries = [];
  let p = cdOff;
  for (let index = 0; index < count; index++) {
    if (buf.readUInt32LE(p) !== 0x02014b50)
      throw new ImportRefusal([`Z1 entry ${index + 1}: a damaged central directory`]);
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
    for (let x = 0; x + 4 <= extra.length; ) {
      const id = extra.readUInt16LE(x);
      const len = extra.readUInt16LE(x + 2);
      if (id === 0x7075 && len >= 5 && extra[x + 4] === 1) name = extra.subarray(x + 9, x + 4 + len).toString('utf8');
      x += 4 + len;
    }
    if (name === null) {
      try {
        name = new TextDecoder('utf-8', { fatal: true }).decode(rawName);
      } catch {
        throw new ImportRefusal([
          `Z1 entry ${index + 1}: a file name that is not UTF-8; zip the folder again with the system's own "Compress" or 7-Zip`
        ]);
      }
    }
    const unix = madeBy >> 8 === 3 ? ext >>> 16 : 0;
    entries.push({
      index,
      name,
      dir: name.endsWith('/'),
      link: (unix & 0o170000) === 0o120000,
      method,
      flags,
      crc,
      csize,
      usize,
      offset
    });
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
  const notMac = entries.filter((e) => !e.name.startsWith('__MACOSX/'));
  const atRoot = notMac.some((e) => e.name === 'soul.md' || e.name.startsWith('vault/'));
  const tops = new Set(notMac.map((e) => e.name.split('/')[0]));
  const strip = !atRoot && tops.size === 1 && notMac.every((e) => e.name.includes('/')) ? `${[...tops][0]}/` : '';
  return entries.map((e) => {
    if (e.name.startsWith('__MACOSX/')) return { ...e, rel: e.name, take: false, why: 'macOS resource data' };
    const rel = e.name.slice(strip.length);
    const base = path.posix.basename(rel);
    let take = rel === 'soul.md' || (rel.startsWith('vault/') && !e.dir);
    let why = take ? '' : 'not soul.md or vault/';
    if (take && base === '.DS_Store') {
      take = false;
      why = 'macOS folder data';
    }
    if (take && rel.startsWith('vault/.obsidian/')) {
      take = false;
      why = 'Obsidian device settings, never saved online';
    }
    return { ...e, rel, take, why };
  });
}

// The REAL-path helper Z0 below compares against the typed paths: resolves a link, a junction, or a
// Windows short (8.3) name to the same canonical path, so two spellings of the same file compare equal.
// It falls back to the plain resolved path only when the path does not exist yet (ENOENT) - Z0's own
// statSync just below turns a missing ZIP into a clear message. Any OTHER failure (a permission error, a
// native realpath that cannot resolve a path on some RAM or virtual drive) means the real location cannot
// be trusted, so it is rethrown rather than silently falling back to a typed path that might not be the
// same file at all; Z0 turns that into a refusal.
const real = (p) => {
  try {
    return fs.realpathSync.native(p);
  } catch (e) {
    if (e.code === 'ENOENT') return path.resolve(p);
    throw e;
  }
};

/** Is `p` at or under `root`, compared lexically (no filesystem access)? */
const insideOf = (root, p) => {
  const rel = path.relative(root, p);
  return !rel.startsWith('..') && !path.isAbsolute(rel);
};

function inflate(buf, e) {
  if (e.offset + 30 > buf.length || buf.readUInt32LE(e.offset) !== 0x04034b50)
    throw new ImportRefusal([`Z1 ${e.rel}: a damaged local header`]);
  const start = e.offset + 30 + buf.readUInt16LE(e.offset + 26) + buf.readUInt16LE(e.offset + 28);
  if (start + e.csize > buf.length) throw new ImportRefusal([`Z1 ${e.rel}: its data runs past the end of the archive`]);
  const raw = buf.subarray(start, start + e.csize);
  let out;
  if (e.method === 0) out = Buffer.from(raw);
  else {
    // The cap is the declared size, but never below 1: node refuses maxOutputLength 0 as out of range,
    // and a deflated EMPTY file (an empty Obsidian note, from any zipper that deflates everything)
    // declares 0. One byte of headroom is still a cap, and the length check below refuses it.
    try {
      out = zlib.inflateRawSync(raw, { maxOutputLength: Math.max(1, e.usize) });
    } catch (err) {
      throw new ImportRefusal([
        `Z5 ${e.rel}: inflates past its declared ${e.usize} bytes or is damaged (${err.code || err.message})`
      ]);
    }
  }
  if (out.length !== e.usize)
    throw new ImportRefusal([`Z5 ${e.rel}: ${out.length} bytes, but the archive declares ${e.usize}`]);
  if (crc32(out) !== e.crc) throw new ImportRefusal([`Z5 ${e.rel}: the CRC does not match; the archive is damaged`]);
  return out;
}

/** The whole import. Returns { planned, skipped, flagged, overwrite, written }; throws Refusal. */
export function importMemory({ zip, root, apply = false, overwrite = false, skipFlagged = false }) {
  const zipAbs = path.resolve(zip);
  const rootAbs = path.resolve(root);
  // Z0 refuses when EITHER spelling is inside: the strings as typed (rootAbs, zipAbs, compared lexically),
  // OR their REAL paths (real(), above). Comparing typed paths alone misses a zip that is truly inside the
  // repository under an alias: rootAbs is REPO (resolved once at load through any link, but keeping a
  // Windows short (8.3) name segment exactly as reached) or --root exactly as the caller typed it, while
  // the zip is exactly as typed, which on Windows can be a different short (8.3) alias for the same file,
  // or on any platform can reach the same file through a symbolic link or a junction.
  // But comparing ONLY real paths misses the mirror case: a junction INSIDE this repository that points
  // OUTSIDE it types as an inside path (the caller's spelling never leaves the repository) while its real
  // target resolves outside, and Git for Windows follows such a junction when staging, so the ZIP's bytes
  // would land in a commit despite Z0 "refusing" it by real path alone. Either comparison finding it
  // inside is enough to refuse.
  let realRoot, realZip;
  try {
    realRoot = real(rootAbs);
    realZip = real(zipAbs);
  } catch (e) {
    throw new ImportRefusal([
      `Z0 ${zip}'s real location could not be established (${e.code || e.message}); refusing rather than comparing an unresolved path`
    ]);
  }
  if (insideOf(rootAbs, zipAbs) || insideOf(realRoot, realZip)) {
    throw new ImportRefusal([
      `Z0 ${zip} is inside this repository; download it outside the working tree (the system temp folder) so no save can ever commit it`
    ]);
  }
  const size = fs.statSync(zipAbs).size;
  if (size > LIMITS.archive) throw new ImportRefusal([`Z1 the archive is ${size} bytes, over ${LIMITS.archive}`]);
  const buf = fs.readFileSync(zipAbs);
  const entries = readCentral(buf);

  const slips = entries.map((e) => [e, slipReason(e.name)]).filter(([, r]) => r);
  if (slips.length)
    throw new ImportRefusal(
      slips.map(([e, r]) => `Z2 entry ${e.index + 1} ${JSON.stringify(e.name)}: ${r}; the whole archive is refused`)
    );

  const plan = planNames(entries);
  const taken = plan.filter((e) => e.take);
  const problems = [];
  for (const e of taken) {
    if (e.link) problems.push(`Z4 ${e.rel} is a link; a vault holds no links`);
    if (e.flags & 1) problems.push(`Z1 ${e.rel} is encrypted; export it without a password`);
    if (e.method !== 0 && e.method !== 8)
      problems.push(`Z1 ${e.rel} uses compression method ${e.method}; only stored and deflated are read`);
    if (e.usize > LIMITS.file)
      problems.push(
        `Z5 ${e.rel} is ${e.usize} bytes, over the ${LIMITS.file}-byte size guard the commit gate enforces`
      );
  }
  const total = taken.reduce((n, e) => n + e.usize, 0);
  if (taken.length > LIMITS.files) problems.push(`Z5 ${taken.length} files, over ${LIMITS.files}`);
  if (total > LIMITS.total) problems.push(`Z5 ${total} bytes in all, over ${LIMITS.total}`);
  if (!taken.length) problems.push('Z3 the archive holds no soul.md and nothing under vault/');
  if (problems.length) throw new ImportRefusal(problems);

  // Z5 + Z6: the bytes, then the content legs, still before any write.
  const profile = readProfile(rootAbs);
  const allow = readAllowlist(rootAbs);
  const flagged = [];
  for (const e of taken) {
    e.bytes = inflate(buf, e);
    const hits = [];
    if (!isBinary(e.bytes))
      for (const h of scanText(e.bytes.toString('utf8'))) hits.push(`${e.rel}:${h.line} secret-scan ${h.name}`);
    for (const h of evaluate({ file: e.rel, buf: e.bytes, profile, allow }))
      hits.push(
        h.line ? `${e.rel}:${h.line} employer-data-guard ${h.leg}` : `${e.rel} employer-data-guard ${h.leg} (path)`
      );
    if (hits.length) flagged.push({ rel: e.rel, hits });
  }
  if (flagged.length && !skipFlagged) {
    throw new ImportRefusal(
      flagged
        .flatMap((f) => f.hits.map((h) => `Z6 ${h}`))
        .concat([
          'Z6 nothing was written; remove those files from the archive, or rerun with --skip-flagged once the owner agrees to leave exactly these out'
        ])
    );
  }
  const keep = taken.filter((e) => !flagged.some((f) => f.rel === e.rel));

  // Z7
  const targets = keep.map((e) => {
    const abs = path.resolve(rootAbs, e.rel);
    const rel = path.relative(rootAbs, abs);
    if (rel.startsWith('..') || path.isAbsolute(rel))
      throw new ImportRefusal([`Z2 ${e.rel} resolves outside the repository`]);
    return { e, abs, exists: fs.existsSync(abs) };
  });
  // Z8: a path cannot be a file and a folder at once, and --overwrite replaces files, never folders or
  // links. Checked here, before the first write, because the loop below cannot undo half an import.
  const lstat = (p) => {
    try {
      return fs.lstatSync(p);
    } catch {
      return null;
    }
  };
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
      if (st && !st.isDirectory())
        clash.add(
          `Z8 ${prefix} is a ${st.isSymbolicLink() ? 'link' : 'file'} in this repository, but the archive puts ${t.e.rel} inside it`
        );
    }
    const st = lstat(t.abs);
    if (st?.isDirectory())
      clash.add(`Z8 ${t.e.rel} is a folder in this repository, and the archive holds a file by that name`);
    if (st?.isSymbolicLink())
      clash.add(`Z8 ${t.e.rel} is a link in this repository; an import never writes through a link`);
  }
  if (clash.size) throw new ImportRefusal([...clash]);
  const existing = targets.filter((t) => t.exists).map((t) => t.e.rel);
  const result = {
    planned: keep.map((e) => e.rel),
    skipped: plan.filter((e) => !e.take).map((e) => `${e.rel} (${e.link ? 'a link' : e.why})`),
    flagged: flagged.map((f) => f.rel),
    overwrite: existing,
    written: []
  };
  if (!apply) return result;
  if (existing.length && !overwrite) {
    throw new ImportRefusal([
      `Z7 ${existing.length} file(s) already exist and would be replaced: ${existing.slice(0, 20).join(', ')}${existing.length > 20 ? ', ...' : ''}; show the owner this list, and rerun with --overwrite only after they say yes`
    ]);
  }
  for (const t of targets) {
    fs.mkdirSync(path.dirname(t.abs), { recursive: true });
    fs.writeFileSync(t.abs, t.e.bytes);
    result.written.push(t.e.rel);
  }
  return result;
}

export function main(argv, log = console.log) {
  /** @type {{ values: { apply?: boolean, overwrite?: boolean, 'skip-flagged'?: boolean, root?: string }, positionals: string[] }} */
  let parsed;
  try {
    parsed = parseCommandLine({
      name: 'import-memory',
      edge: 'operator',
      options: FLAGS,
      allowPositionals: true,
      argv
    });
  } catch (e) {
    if (!(e instanceof KitRefusal)) throw e;
    log(`import-memory: ERROR - ${/** @type {Error} */ (e).message}`);
    return 1;
  }
  const [zip, ...rest] = parsed.positionals;
  if (!zip) {
    log(
      'import-memory: usage: node scripts/import-memory.mjs <zip> [--apply] [--overwrite] [--skip-flagged] [--root <repo>]'
    );
    return 1;
  }
  if (rest.length) {
    log(`import-memory: ERROR - unknown argument ${rest[0]}`);
    return 1;
  }
  const a = {
    zip,
    apply: Boolean(parsed.values.apply),
    overwrite: Boolean(parsed.values.overwrite),
    skipFlagged: Boolean(parsed.values['skip-flagged'])
  };
  try {
    const r = importMemory({ ...a, root: parsed.values.root || REPO });
    for (const s of r.skipped) log(`  skip  ${s}`);
    for (const f of r.flagged) log(`  left out (flagged, --skip-flagged)  ${f}`);
    for (const o of r.overwrite) log(`  replaces an existing file  ${o}`);
    log(
      `import-memory: ${a.apply ? `WROTE ${r.written.length} file(s)` : `PLAN ${r.planned.length} file(s) to write, nothing written (dry run)`}; ${r.skipped.length} skipped, ${r.flagged.length} left out, ${r.overwrite.length} would replace an existing file`
    );
    return 0;
  } catch (e) {
    if (e instanceof ImportRefusal) {
      for (const m of e.reasons) log(`REFUSED ${m}`);
      log('import-memory: REFUSED - nothing was written');
      return 2;
    }
    log(`import-memory: ERROR - ${e.stack || e.message}`);
    return 1;
  }
}

// isMain resolves through a link (errors.js's own realPath, which falls back on any realpath failure
// rather than rethrowing one), so a non-ENOENT realpath error on this script's own path no longer
// crashes at module load; real() above stays the stricter compare Z0 needs between --root and the ZIP.
if (isMain(import.meta.url)) process.exit(main(process.argv.slice(2)));
