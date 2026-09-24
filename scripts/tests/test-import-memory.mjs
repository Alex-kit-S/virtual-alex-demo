#!/usr/bin/env node
// scripts/tests/test-import-memory.mjs - /setup --import's importer refuses every unsafe archive before
// it writes a byte, then imports a clean one. (2026-09-24, Virtual Alex fleet seat 5.)
//
// WHAT. What is proven, negative legs first. Every archive is built here by a small ZIP writer, so each
// guard meets exactly the shape it exists for:
//   I1  NEGATIVE a ZIP inside the repository is refused (a save could commit it)
//   I2  NEGATIVE zip-slip: a ".." segment, an absolute path and a backslash each refuse the archive
//   I3  NEGATIVE a link inside vault/ is refused
//   I4  NEGATIVE a file over the commit gate's 10 MB size guard is refused (11 MB of zeros, 11 KB zipped)
//   I5  NEGATIVE a file that inflates past its declared size is refused, and so is a wrong CRC
//   I6  NEGATIVE an encrypted entry, and a method other than stored or deflated, are refused
//   I7  NEGATIVE a secret shape in a vault page is refused with file:line and leg, and the value is
//       never printed; an employer address with the employer in the profile is refused the same way
//   I8  NEGATIVE --apply refuses while a target exists, and writes nothing, until --overwrite
//   I9  a clean laptop-folder ZIP: the top folder stripped, __MACOSX/, .DS_Store, .obsidian/, a link
//       outside vault/ and a README all skipped; the dry run writes nothing
//   I10 --apply writes exactly soul.md and the vault pages, byte for byte
//   I11 --skip-flagged leaves exactly the flagged file out and writes the rest
//   I12 NEGATIVE a deflated EMPTY note (Obsidian vaults hold them) imports, where it used to refuse the
//       whole archive; I12b the one-byte cap still refuses an "empty" entry that inflates to bytes
//   I13 NEGATIVE a file and a folder at the same path, in the archive or against this repository,
//       refuse before a byte is written, --overwrite or not
//   L1  NEGATIVE run through a linked folder, the importer still decides (it used to exit 0 silently)
//
// HOW. The secret fixture is assembled at run time from fragments, as the scanner's own test does,
// so this file never carries a shape the scanners hunt.
//   node scripts/tests/test-import-memory.mjs      (exit 0 = all pass)
//
// NEVER. Never writes inside this repository: every archive and every import target is built in
// the OS temp directory, which is removed at the end.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const KIT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const { main, crc32 } = await import(new URL('../import-memory.mjs', import.meta.url));

let pass = 0; const fails = [];
function ok(cond, name, detail) {
  const line = `${name}${detail ? ` - ${detail}` : ''}`;
  if (cond) { pass++; console.log(`PASS  ${line}`); } else { fails.push(line); console.log(`FAIL  ${line}`); }
}
const TMP = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'alex-import-')));

// A ZIP writer, enough for the tests: stored or deflated entries, and every field a guard reads can be
// overridden (declared size, CRC, flags, method, the unix mode that marks a link).
function zip(file, entries) {
  const locals = []; const central = []; let off = 0;
  for (const en of entries) {
    const name = Buffer.from(en.name, 'utf8');
    const data = Buffer.isBuffer(en.data) ? en.data : Buffer.from(en.data ?? '', 'utf8');
    const method = en.method ?? (en.deflate ? 8 : 0);
    const body = method === 8 ? zlib.deflateRawSync(data) : data;
    const crc = en.crc ?? crc32(data);
    const usize = en.usize ?? data.length;
    const flags = en.flags ?? 0x0800;
    const lh = Buffer.alloc(30);
    lh.writeUInt32LE(0x04034b50, 0); lh.writeUInt16LE(20, 4); lh.writeUInt16LE(flags, 6); lh.writeUInt16LE(method, 8);
    lh.writeUInt32LE(crc, 14); lh.writeUInt32LE(body.length, 18); lh.writeUInt32LE(usize, 22); lh.writeUInt16LE(name.length, 26);
    locals.push(lh, name, body);
    const ch = Buffer.alloc(46);
    ch.writeUInt32LE(0x02014b50, 0); ch.writeUInt16LE(en.link ? (3 << 8) | 20 : 20, 4); ch.writeUInt16LE(20, 6);
    ch.writeUInt16LE(flags, 8); ch.writeUInt16LE(method, 10); ch.writeUInt32LE(crc, 16); ch.writeUInt32LE(body.length, 20);
    ch.writeUInt32LE(usize, 24); ch.writeUInt16LE(name.length, 28); ch.writeUInt32LE(en.link ? (0o120777 << 16) >>> 0 : 0, 38);
    ch.writeUInt32LE(off, 42);
    central.push(ch, name);
    off += 30 + name.length + body.length;
  }
  const cd = Buffer.concat(central);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0); eocd.writeUInt16LE(entries.length, 8); eocd.writeUInt16LE(entries.length, 10);
  eocd.writeUInt32LE(cd.length, 12); eocd.writeUInt32LE(off, 16);
  fs.writeFileSync(file, Buffer.concat([...locals, cd, eocd]));
  return file;
}
let n = 0;
function repo(profile) {
  const dir = path.join(TMP, `repo-${++n}`);
  fs.mkdirSync(path.join(dir, 'system'), { recursive: true });
  spawnSync('git', ['init', '-q'], { cwd: dir });
  if (profile) fs.writeFileSync(path.join(dir, 'system', 'install-profile.json'), JSON.stringify(profile));
  return dir;
}
const run = (args) => { const out = []; const code = main(args, (l) => out.push(l)); return { code, out: out.join('\n') }; };
const refused = (r, re) => r.code === 2 && re.test(r.out) && /nothing was written/.test(r.out);
const empty = (dir) => !fs.existsSync(path.join(dir, 'soul.md')) && !fs.existsSync(path.join(dir, 'vault'));
const SOUL = '# Soul - Who I Am\n\n## My Role\nTranslator.\n';
const PAGE = '---\ntags: [me]\n---\n# Goals\nFinish the deck.\n';
const SECRET = ['gh', 'p_', 'A'.repeat(36)].join('');

try {
  // ---- I1 ----
  {
    const dir = repo();
    const z = zip(path.join(dir, 'memory.zip'), [{ name: 'soul.md', data: SOUL }]);
    const r = run([z, '--root', dir, '--apply']);
    ok(refused(r, /REFUSED Z0 .* is inside this repository/) && empty(dir), 'I1 NEGATIVE a ZIP inside the repository is refused', r.out.split('\n')[0]);
  }
  // ---- I2 ----
  for (const [label, bad] of [['a ".." segment', 'vault/../../evil.md'], ['an absolute path', '/etc/evil.md'], ['a backslash', 'vault\\..\\evil.md']]) {
    const dir = repo();
    const z = zip(path.join(TMP, `slip-${n}.zip`), [{ name: 'soul.md', data: SOUL }, { name: bad, data: 'x' }]);
    const r = run([z, '--root', dir, '--apply']);
    ok(refused(r, new RegExp(`REFUSED Z2 entry 2 .*: ${label}[^;]*; the whole archive is refused`)) && empty(dir), `I2 NEGATIVE zip-slip by ${label} refuses the whole archive`, r.out.split('\n')[0]);
  }
  // ---- I3 ----
  {
    const dir = repo();
    const z = zip(path.join(TMP, 'link.zip'), [{ name: 'soul.md', data: SOUL }, { name: 'vault/me/goals.md', data: '../../../etc/passwd', link: true }]);
    const r = run([z, '--root', dir, '--apply']);
    ok(refused(r, /REFUSED Z4 vault\/me\/goals\.md is a link/) && empty(dir), 'I3 NEGATIVE a link inside vault/ is refused', r.out.split('\n')[0]);
  }
  // ---- I4 ----
  {
    const dir = repo();
    const z = zip(path.join(TMP, 'big.zip'), [{ name: 'vault/big.md', data: Buffer.alloc(11 * 1024 * 1024), deflate: true }]);
    const r = run([z, '--root', dir, '--apply']);
    ok(refused(r, /REFUSED Z5 vault\/big\.md is 11534336 bytes, over the 10485760-byte size guard/) && empty(dir),
      `I4 NEGATIVE a file over the 10 MB guard is refused (archive ${fs.statSync(z).size} bytes)`, r.out.split('\n')[0]);
  }
  // ---- I5 ----
  {
    const dir = repo();
    const z = zip(path.join(TMP, 'lie.zip'), [{ name: 'vault/a.md', data: Buffer.alloc(4096), deflate: true, usize: 100 }]);
    const r = run([z, '--root', dir, '--apply']);
    ok(refused(r, /REFUSED Z5 vault\/a\.md: inflates past its declared 100 bytes/) && empty(dir), 'I5a NEGATIVE a file inflating past its declared size is refused', r.out.split('\n')[0]);
    const z2 = zip(path.join(TMP, 'crc.zip'), [{ name: 'vault/a.md', data: PAGE, crc: 12345 }]);
    const r2 = run([z2, '--root', dir, '--apply']);
    ok(refused(r2, /REFUSED Z5 vault\/a\.md: the CRC does not match/) && empty(dir), 'I5b NEGATIVE a wrong CRC is refused', r2.out.split('\n')[0]);
  }
  // ---- I6 ----
  {
    const dir = repo();
    const z = zip(path.join(TMP, 'enc.zip'), [{ name: 'soul.md', data: SOUL, flags: 0x0801 }, { name: 'vault/b.md', data: PAGE, method: 12 }]);
    const r = run([z, '--root', dir, '--apply']);
    ok(refused(r, /REFUSED Z1 soul\.md is encrypted/) && /REFUSED Z1 vault\/b\.md uses compression method 12/.test(r.out) && empty(dir),
      'I6 NEGATIVE an encrypted entry and an unsupported method are refused', r.out.split('\n').slice(0, 2).join(' | '));
  }
  // ---- I7 ----
  {
    const dir = repo();
    const z = zip(path.join(TMP, 'secret.zip'), [{ name: 'soul.md', data: SOUL }, { name: 'vault/notes.md', data: `# Notes\nold token ${SECRET}\n` }]);
    const r = run([z, '--root', dir, '--apply']);
    ok(refused(r, /REFUSED Z6 vault\/notes\.md:2 secret-scan github-token/) && !r.out.includes(SECRET) && empty(dir),
      'I7a NEGATIVE a secret in a vault page is refused with file:line and leg, value never printed', r.out.split('\n')[0]);
    const dir2 = repo({ employer_domain: 'employer.example', owner_work_address: 'me@employer.example' });
    const z2 = zip(path.join(TMP, 'employer.zip'), [{ name: 'vault/people/boss.md', data: '# Boss\nboss@employer.example\n' }]);
    const r2 = run([z2, '--root', dir2, '--apply']);
    ok(refused(r2, /REFUSED Z6 vault\/people\/boss\.md:2 employer-data-guard employer-address/) && empty(dir2),
      'I7b NEGATIVE an employer address is refused when the profile names the employer', r2.out.split('\n')[0]);
  }
  // ---- I8 ----
  {
    const dir = repo();
    fs.writeFileSync(path.join(dir, 'soul.md'), 'the soul /setup wrote today\n');
    const z = zip(path.join(TMP, 'over.zip'), [{ name: 'soul.md', data: SOUL }, { name: 'vault/me/goals.md', data: PAGE }]);
    const r = run([z, '--root', dir, '--apply']);
    ok(refused(r, /REFUSED Z7 1 file\(s\) already exist and would be replaced: soul\.md/) && fs.readFileSync(path.join(dir, 'soul.md'), 'utf8') === 'the soul /setup wrote today\n' && !fs.existsSync(path.join(dir, 'vault')),
      'I8a NEGATIVE --apply refuses while a target exists, and writes nothing at all', r.out.split('\n')[0]);
    const r2 = run([z, '--root', dir, '--apply', '--overwrite']);
    ok(r2.code === 0 && fs.readFileSync(path.join(dir, 'soul.md'), 'utf8') === SOUL, 'I8b --overwrite, given after the owner says yes, replaces it', r2.out.split('\n').pop());
  }
  // ---- I9 + I10 ----
  {
    const dir = repo();
    const entries = [
      { name: 'alex-owner/', data: '' },
      { name: 'alex-owner/soul.md', data: SOUL, deflate: true },
      { name: 'alex-owner/vault/me/goals.md', data: PAGE, deflate: true },
      { name: 'alex-owner/vault/people/family/aunt.md', data: '# Aunt\nLives by the sea.\n' },
      { name: 'alex-owner/vault/.DS_Store', data: 'x' },
      { name: 'alex-owner/vault/.obsidian/workspace.json', data: '{}' },
      { name: 'alex-owner/.claude/skills/pdf', data: '../../.agents/skills/pdf', link: true },
      { name: 'alex-owner/README.md', data: '# readme' },
      { name: '__MACOSX/alex-owner/._soul.md', data: 'x' },
    ];
    const z = zip(path.join(TMP, 'laptop.zip'), entries);
    const r = run([z, '--root', dir]);
    ok(r.code === 0 && /PLAN 3 file\(s\) to write, nothing written \(dry run\); 6 skipped/.test(r.out) && empty(dir),
      'I9 a clean laptop-folder ZIP plans 3 files, skips 6, and the dry run writes nothing', r.out.split('\n').pop());
    const r2 = run([z, '--root', dir, '--apply']);
    const got = ['soul.md', 'vault/me/goals.md', 'vault/people/family/aunt.md'].every((f) => fs.existsSync(path.join(dir, f)));
    const exact = fs.readFileSync(path.join(dir, 'vault/me/goals.md'), 'utf8') === PAGE;
    const nothingElse = !fs.existsSync(path.join(dir, 'README.md')) && !fs.existsSync(path.join(dir, '.claude')) && !fs.existsSync(path.join(dir, 'vault', '.obsidian')) && !fs.existsSync(path.join(dir, 'vault', '.DS_Store'));
    ok(r2.code === 0 && got && exact && nothingElse, 'I10 --apply writes exactly soul.md and the vault pages, byte for byte, and nothing else', r2.out.split('\n').pop());
  }
  // ---- I11 ----
  {
    const dir = repo();
    const z = zip(path.join(TMP, 'skip.zip'), [{ name: 'soul.md', data: SOUL }, { name: 'vault/notes.md', data: `x ${SECRET}\n` }, { name: 'vault/me/goals.md', data: PAGE }]);
    const r = run([z, '--root', dir, '--apply', '--skip-flagged']);
    ok(r.code === 0 && !fs.existsSync(path.join(dir, 'vault/notes.md')) && fs.existsSync(path.join(dir, 'vault/me/goals.md')) && /left out \(flagged, --skip-flagged\)  vault\/notes\.md/.test(r.out),
      'I11 --skip-flagged leaves exactly the flagged file out and writes the rest', r.out.split('\n').pop());
  }
  // ---- I12 ----
  // An Obsidian vault routinely holds empty notes, and a zipper that deflates everything (Python's
  // zipfile with ZIP_DEFLATED, measured by the fleet review) stores a 0-byte file as 2 deflated bytes.
  // The inflate cap was the declared size, 0, which node rejects as out of range, so the WHOLE import
  // was refused over one empty page.
  {
    const dir = repo();
    const z = zip(path.join(TMP, 'empty.zip'), [{ name: 'soul.md', data: SOUL, deflate: true }, { name: 'vault/empty-note.md', data: '', deflate: true }, { name: 'vault/me/goals.md', data: PAGE, deflate: true }]);
    const r = run([z, '--root', dir, '--apply']);
    const e = path.join(dir, 'vault', 'empty-note.md');
    ok(r.code === 0 && fs.existsSync(e) && fs.statSync(e).size === 0 && fs.readFileSync(path.join(dir, 'vault/me/goals.md'), 'utf8') === PAGE,
      'I12 NEGATIVE a deflated EMPTY note imports as an empty file, and the rest of the archive with it', r.out.split('\n').pop());
    const z2 = zip(path.join(TMP, 'empty-lie.zip'), [{ name: 'vault/empty-note.md', data: 'not empty at all', deflate: true, usize: 0, crc: 0 }]);
    const r2 = run([z2, '--root', repo(), '--apply']);
    ok(refused(r2, /REFUSED Z5 vault\/empty-note\.md: inflates past its declared 0 bytes/),
      'I12b the cap still holds (a guard on the fix, passes before and after): an entry declared empty that inflates to bytes is refused', r2.out.split('\n')[0]);
  }
  // ---- I13 ----
  // A file and a folder at the same path. Before the pre-flight it wrote soul.md and vault/people,
  // then crashed on the folder with a stack trace: the "every refusal before a single byte" promise
  // was false for this shape.
  {
    const dir = repo();
    const z = zip(path.join(TMP, 'clash.zip'), [{ name: 'soul.md', data: SOUL }, { name: 'vault/people', data: 'a file' }, { name: 'vault/people/a.md', data: PAGE }]);
    const r = run([z, '--root', dir, '--apply']);
    ok(refused(r, /REFUSED Z8 vault\/people is a file in the archive and also a folder/) && empty(dir),
      'I13a NEGATIVE a file and a folder at the same path refuse before anything is written', r.out.split('\n')[0]);
    const dir2 = repo();
    fs.mkdirSync(path.join(dir2, 'vault', 'me', 'goals.md'), { recursive: true });
    fs.writeFileSync(path.join(dir2, 'vault', 'people'), 'a file where the archive needs a folder\n');
    const z2 = zip(path.join(TMP, 'clash2.zip'), [{ name: 'soul.md', data: SOUL }, { name: 'vault/me/goals.md', data: PAGE }, { name: 'vault/people/a.md', data: PAGE }]);
    const r2 = run([z2, '--root', dir2, '--apply', '--overwrite']);
    ok(refused(r2, /REFUSED Z8 vault\/me\/goals\.md is a folder in this repository/) && /REFUSED Z8 vault\/people is a file in this repository/.test(r2.out)
      && !fs.existsSync(path.join(dir2, 'soul.md')),
      'I13b NEGATIVE a folder where the archive has a file, and a file where it needs a folder, refuse even with --overwrite', r2.out.split('\n').slice(0, 2).join(' | '));
  }
  // ---- L1 ----
  // Run through a linked folder (macOS's temp dir is /var -> /private/var; a junction on Windows). The
  // importer compared the typed path with its own URL, decided it had been imported, did nothing and
  // exited 0: an import that silently never happened. /setup --import runs it on the cloud VM.
  {
    const link = path.join(TMP, 'scripts-link');
    let linked = false;
    try { fs.symlinkSync(path.join(KIT, 'scripts'), link, 'junction'); linked = true; } catch (e) { ok(false, 'L1 a folder link can be made here', e.message); }
    if (linked) {
      const dir = repo();
      const z = zip(path.join(dir, 'inside.zip'), [{ name: 'soul.md', data: SOUL }]);
      const via = spawnSync(process.execPath, [path.join(link, 'import-memory.mjs'), z, '--root', dir, '--apply'], { encoding: 'utf8' });
      ok(via.status === 2 && /REFUSED Z0/.test(via.stdout), 'L1 NEGATIVE run through a linked folder, the importer still decides and refuses',
        `exit ${via.status}, ${(via.stdout + via.stderr).trim().length} byte(s) of output`);
      fs.rmSync(link, { force: true }); // the link itself, never what it points at
    }
  }
} finally {
  fs.rmSync(TMP, { recursive: true, force: true });
}

console.log('');
if (fails.length) { console.log(`${fails.length} FAILURE(S)`); for (const f of fails) console.log(`  - ${f}`); process.exit(1); }
console.log(`ALL PASS (${pass})`);
