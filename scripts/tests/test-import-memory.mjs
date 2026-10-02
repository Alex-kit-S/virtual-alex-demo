#!/usr/bin/env node
// scripts/tests/test-import-memory.mjs - /setup --import's importer refuses every unsafe archive before
// it writes a byte, then imports a clean one. Deleted, a guard could silently stop refusing (or start
// refusing a clean archive) and nothing would say so.
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
//   NEGATIVE run through a linked folder, the importer still decides rather than silently doing nothing
//   NEGATIVE the fallback with no --root at all: REPO resolves the SAME repository top whether the
//       script runs from the top itself or from a subfolder inside it, and Z0 still fires there
//   NEGATIVE Z0 compares REAL paths, not just typed ones: a zip inside the repository named through a link
//       still refuses, and so does the mirror case, --root itself named through a link. The short (8.3)
//       name side of the same comparison is the Kit-only sibling test-import-memory-kit.mjs: a generated
//       online tree has no Windows host to grant one.
//
// HOW. The secret fixture is assembled at run time from fragments, as the scanner's own test does, so
// this file never carries a shape the scanners hunt. A link the host cannot make is a recorded failure.
//
// NEVER. Never writes inside this repository: every archive and every import target is built in
// the OS temp directory, which is removed at the end.
//
// Usage: node scripts/tests/test-import-memory.mjs
// Exit: 0 all pass - 1 any failure

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, describe, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import zlib from 'node:zlib';

const KIT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const { main, crc32 } = await import(new URL('../import-memory.mjs', import.meta.url));

const TMP = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'alex-import-')));
after(() => fs.rmSync(TMP, { recursive: true, force: true }));

// A ZIP writer, enough for the tests: stored or deflated entries, and every field a guard reads can be
// overridden (declared size, CRC, flags, method, the unix mode that marks a link).
function zip(file, entries) {
  const locals = [];
  const central = [];
  let off = 0;
  for (const en of entries) {
    const name = Buffer.from(en.name, 'utf8');
    const data = Buffer.isBuffer(en.data) ? en.data : Buffer.from(en.data ?? '', 'utf8');
    const method = en.method ?? (en.deflate ? 8 : 0);
    const body = method === 8 ? zlib.deflateRawSync(data) : data;
    const crc = en.crc ?? crc32(data);
    const usize = en.usize ?? data.length;
    const flags = en.flags ?? 0x0800;
    const lh = Buffer.alloc(30);
    lh.writeUInt32LE(0x04034b50, 0);
    lh.writeUInt16LE(20, 4);
    lh.writeUInt16LE(flags, 6);
    lh.writeUInt16LE(method, 8);
    lh.writeUInt32LE(crc, 14);
    lh.writeUInt32LE(body.length, 18);
    lh.writeUInt32LE(usize, 22);
    lh.writeUInt16LE(name.length, 26);
    locals.push(lh, name, body);
    const ch = Buffer.alloc(46);
    ch.writeUInt32LE(0x02014b50, 0);
    ch.writeUInt16LE(en.link ? (3 << 8) | 20 : 20, 4);
    ch.writeUInt16LE(20, 6);
    ch.writeUInt16LE(flags, 8);
    ch.writeUInt16LE(method, 10);
    ch.writeUInt32LE(crc, 16);
    ch.writeUInt32LE(body.length, 20);
    ch.writeUInt32LE(usize, 24);
    ch.writeUInt16LE(name.length, 28);
    ch.writeUInt32LE(en.link ? (0o120777 << 16) >>> 0 : 0, 38);
    ch.writeUInt32LE(off, 42);
    central.push(ch, name);
    off += 30 + name.length + body.length;
  }
  const cd = Buffer.concat(central);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(entries.length, 8);
  eocd.writeUInt16LE(entries.length, 10);
  eocd.writeUInt32LE(cd.length, 12);
  eocd.writeUInt32LE(off, 16);
  fs.writeFileSync(file, Buffer.concat([...locals, cd, eocd]));
  return file;
}
// Without --root the import lands in the checkout the running script
// itself belongs to (scripts/lib/repo-root.js's REPO), never the cwd's repository. So the two tests below
// that exercise the no-root fallback must run a COPY of the script, with the libraries it now needs,
// planted inside the throwaway repository - running KIT's own script directly would resolve REPO to this
// real worktree and write into it.
const SCRIPT_FILES = [
  'scripts/import-memory.mjs',
  'scripts/secret-scan.mjs',
  'scripts/employer-data-guard.mjs',
  'scripts/lib/json-writer.js',
  'scripts/lib/repo-root.js',
  'scripts/lib/errors.js',
  'scripts/lib/exit-codes.js',
  'scripts/lib/args.js'
];
function copyScript(dir) {
  for (const rel of SCRIPT_FILES) {
    const dest = path.join(dir, rel);
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.copyFileSync(path.join(KIT, rel), dest);
  }
  return path.join(dir, 'scripts', 'import-memory.mjs');
}

let n = 0;
function repo(profile) {
  const dir = path.join(TMP, `repo-${++n}`);
  fs.mkdirSync(path.join(dir, 'system'), { recursive: true });
  spawnSync('git', ['init', '-q'], { cwd: dir });
  if (profile) fs.writeFileSync(path.join(dir, 'system', 'install-profile.json'), JSON.stringify(profile));
  return dir;
}
const run = (args) => {
  const out = [];
  const code = main(args, (l) => out.push(l));
  return { code, out: out.join('\n') };
};
const refused = (r, re) => r.code === 2 && re.test(r.out) && /nothing was written/.test(r.out);
const empty = (dir) => !fs.existsSync(path.join(dir, 'soul.md')) && !fs.existsSync(path.join(dir, 'vault'));
const SOUL = '# Soul - Who I Am\n\n## My Role\nTranslator.\n';
const PAGE = '---\ntags: [me]\n---\n# Goals\nFinish the deck.\n';
const SECRET = ['gh', 'p_', 'A'.repeat(36)].join('');

describe('import-memory.mjs: the archive importer', () => {
  test('I1 NEGATIVE a ZIP inside the repository is refused', () => {
    const dir = repo();
    const z = zip(path.join(dir, 'memory.zip'), [{ name: 'soul.md', data: SOUL }]);
    const r = run([z, '--root', dir, '--apply']);
    assert.ok(refused(r, /REFUSED Z0 .* is inside this repository/) && empty(dir), r.out.split('\n')[0]);
  });

  test('I2 NEGATIVE zip-slip by a ".." segment, an absolute path and a backslash each refuse the whole archive', () => {
    for (const [label, bad] of [
      ['a ".." segment', 'vault/../../evil.md'],
      ['an absolute path', '/etc/evil.md'],
      ['a backslash', 'vault\\..\\evil.md']
    ]) {
      const dir = repo();
      const z = zip(path.join(TMP, `slip-${n}.zip`), [
        { name: 'soul.md', data: SOUL },
        { name: bad, data: 'x' }
      ]);
      const r = run([z, '--root', dir, '--apply']);
      assert.ok(
        refused(r, new RegExp(`REFUSED Z2 entry 2 .*: ${label}[^;]*; the whole archive is refused`)) && empty(dir),
        `by ${label}: ${r.out.split('\n')[0]}`
      );
    }
  });

  test('I3 NEGATIVE a link inside vault/ is refused', () => {
    const dir = repo();
    const z = zip(path.join(TMP, 'link.zip'), [
      { name: 'soul.md', data: SOUL },
      { name: 'vault/me/goals.md', data: '../../../etc/passwd', link: true }
    ]);
    const r = run([z, '--root', dir, '--apply']);
    assert.ok(refused(r, /REFUSED Z4 vault\/me\/goals\.md is a link/) && empty(dir), r.out.split('\n')[0]);
  });

  test('I4 NEGATIVE a file over the 10 MB size guard is refused', () => {
    const dir = repo();
    const z = zip(path.join(TMP, 'big.zip'), [
      { name: 'vault/big.md', data: Buffer.alloc(11 * 1024 * 1024), deflate: true }
    ]);
    const r = run([z, '--root', dir, '--apply']);
    assert.ok(
      refused(r, /REFUSED Z5 vault\/big\.md is 11534336 bytes, over the 10485760-byte size guard/) && empty(dir),
      `archive ${fs.statSync(z).size} bytes: ${r.out.split('\n')[0]}`
    );
  });

  test('I5 NEGATIVE a file inflating past its declared size is refused, and so is a wrong CRC', () => {
    const dir = repo();
    const z = zip(path.join(TMP, 'lie.zip'), [
      { name: 'vault/a.md', data: Buffer.alloc(4096), deflate: true, usize: 100 }
    ]);
    const r = run([z, '--root', dir, '--apply']);
    assert.ok(
      refused(r, /REFUSED Z5 vault\/a\.md: inflates past its declared 100 bytes/) && empty(dir),
      `I5a: ${r.out.split('\n')[0]}`
    );
    const z2 = zip(path.join(TMP, 'crc.zip'), [{ name: 'vault/a.md', data: PAGE, crc: 12345 }]);
    const r2 = run([z2, '--root', dir, '--apply']);
    assert.ok(
      refused(r2, /REFUSED Z5 vault\/a\.md: the CRC does not match/) && empty(dir),
      `I5b: ${r2.out.split('\n')[0]}`
    );
  });

  test('I6 NEGATIVE an encrypted entry and an unsupported compression method are refused', () => {
    const dir = repo();
    const z = zip(path.join(TMP, 'enc.zip'), [
      { name: 'soul.md', data: SOUL, flags: 0x0801 },
      { name: 'vault/b.md', data: PAGE, method: 12 }
    ]);
    const r = run([z, '--root', dir, '--apply']);
    assert.ok(
      refused(r, /REFUSED Z1 soul\.md is encrypted/) &&
        /REFUSED Z1 vault\/b\.md uses compression method 12/.test(r.out) &&
        empty(dir),
      r.out.split('\n').slice(0, 2).join(' | ')
    );
  });

  test('I7 NEGATIVE a secret shape and an employer address are refused with file:line and leg, value never printed', () => {
    const dir = repo();
    const z = zip(path.join(TMP, 'secret.zip'), [
      { name: 'soul.md', data: SOUL },
      { name: 'vault/notes.md', data: `# Notes\nold token ${SECRET}\n` }
    ]);
    const r = run([z, '--root', dir, '--apply']);
    assert.ok(
      refused(r, /REFUSED Z6 vault\/notes\.md:2 secret-scan github-token/) && !r.out.includes(SECRET) && empty(dir),
      `I7a: ${r.out.split('\n')[0]}`
    );
    const dir2 = repo({ employer_domain: 'employer.example', owner_work_address: 'me@employer.example' });
    const z2 = zip(path.join(TMP, 'employer.zip'), [
      { name: 'vault/people/boss.md', data: '# Boss\nboss@employer.example\n' }
    ]);
    const r2 = run([z2, '--root', dir2, '--apply']);
    assert.ok(
      refused(r2, /REFUSED Z6 vault\/people\/boss\.md:2 employer-data-guard employer-address/) && empty(dir2),
      `I7b: ${r2.out.split('\n')[0]}`
    );
  });

  test('I8 NEGATIVE --apply refuses while a target exists and writes nothing, until --overwrite', () => {
    const dir = repo();
    fs.writeFileSync(path.join(dir, 'soul.md'), 'the soul /setup wrote today\n');
    const z = zip(path.join(TMP, 'over.zip'), [
      { name: 'soul.md', data: SOUL },
      { name: 'vault/me/goals.md', data: PAGE }
    ]);
    const r = run([z, '--root', dir, '--apply']);
    assert.ok(
      refused(r, /REFUSED Z7 1 file\(s\) already exist and would be replaced: soul\.md/) &&
        fs.readFileSync(path.join(dir, 'soul.md'), 'utf8') === 'the soul /setup wrote today\n' &&
        !fs.existsSync(path.join(dir, 'vault')),
      `I8a: ${r.out.split('\n')[0]}`
    );
    const r2 = run([z, '--root', dir, '--apply', '--overwrite']);
    assert.ok(
      r2.code === 0 && fs.readFileSync(path.join(dir, 'soul.md'), 'utf8') === SOUL,
      `I8b: ${r2.out.split('\n').pop()}`
    );
  });

  test('I9 + I10: a clean laptop-folder ZIP plans and then writes exactly soul.md and the vault pages, byte for byte', () => {
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
      { name: '__MACOSX/alex-owner/._soul.md', data: 'x' }
    ];
    const z = zip(path.join(TMP, 'laptop.zip'), entries);
    const r = run([z, '--root', dir]);
    assert.ok(
      r.code === 0 && /PLAN 3 file\(s\) to write, nothing written \(dry run\); 6 skipped/.test(r.out) && empty(dir),
      `I9: ${r.out.split('\n').pop()}`
    );
    const r2 = run([z, '--root', dir, '--apply']);
    const got = ['soul.md', 'vault/me/goals.md', 'vault/people/family/aunt.md'].every((f) =>
      fs.existsSync(path.join(dir, f))
    );
    const exact = fs.readFileSync(path.join(dir, 'vault/me/goals.md'), 'utf8') === PAGE;
    const nothingElse =
      !fs.existsSync(path.join(dir, 'README.md')) &&
      !fs.existsSync(path.join(dir, '.claude')) &&
      !fs.existsSync(path.join(dir, 'vault', '.obsidian')) &&
      !fs.existsSync(path.join(dir, 'vault', '.DS_Store'));
    assert.ok(r2.code === 0 && got && exact && nothingElse, `I10: ${r2.out.split('\n').pop()}`);
  });

  test('I11 --skip-flagged leaves exactly the flagged file out and writes the rest', () => {
    const dir = repo();
    const z = zip(path.join(TMP, 'skip.zip'), [
      { name: 'soul.md', data: SOUL },
      { name: 'vault/notes.md', data: `x ${SECRET}\n` },
      { name: 'vault/me/goals.md', data: PAGE }
    ]);
    const r = run([z, '--root', dir, '--apply', '--skip-flagged']);
    assert.ok(
      r.code === 0 &&
        !fs.existsSync(path.join(dir, 'vault/notes.md')) &&
        fs.existsSync(path.join(dir, 'vault/me/goals.md')) &&
        /left out \(flagged, --skip-flagged\) {2}vault\/notes\.md/.test(r.out),
      r.out.split('\n').pop()
    );
  });

  // An Obsidian vault routinely holds empty notes, and a zipper that deflates everything (Python's
  // zipfile with ZIP_DEFLATED) stores a 0-byte file as 2 deflated bytes. The inflate cap is the declared
  // size raised to a 1-byte floor (node rejects a 0 cap as out of range), so a genuinely empty page still
  // imports instead of refusing the whole archive over it.
  test('I12 NEGATIVE a deflated EMPTY note imports as an empty file; I12b the 1-byte cap still refuses one that inflates to bytes', () => {
    const dir = repo();
    const z = zip(path.join(TMP, 'empty.zip'), [
      { name: 'soul.md', data: SOUL, deflate: true },
      { name: 'vault/empty-note.md', data: '', deflate: true },
      { name: 'vault/me/goals.md', data: PAGE, deflate: true }
    ]);
    const r = run([z, '--root', dir, '--apply']);
    const e = path.join(dir, 'vault', 'empty-note.md');
    assert.ok(
      r.code === 0 &&
        fs.existsSync(e) &&
        fs.statSync(e).size === 0 &&
        fs.readFileSync(path.join(dir, 'vault/me/goals.md'), 'utf8') === PAGE,
      `I12: ${r.out.split('\n').pop()}`
    );
    const z2 = zip(path.join(TMP, 'empty-lie.zip'), [
      { name: 'vault/empty-note.md', data: 'not empty at all', deflate: true, usize: 0, crc: 0 }
    ]);
    const r2 = run([z2, '--root', repo(), '--apply']);
    assert.ok(
      refused(r2, /REFUSED Z5 vault\/empty-note\.md: inflates past its declared 0 bytes/),
      `I12b: ${r2.out.split('\n')[0]}`
    );
  });

  // A file and a folder at the same path: Z8 checks every target before any write, so this shape refuses
  // cleanly up front instead of writing soul.md and vault/people, then crashing on the folder with a
  // stack trace partway through.
  test('I13 NEGATIVE a file and a folder at the same path refuse before anything is written, --overwrite or not', () => {
    const dir = repo();
    const z = zip(path.join(TMP, 'clash.zip'), [
      { name: 'soul.md', data: SOUL },
      { name: 'vault/people', data: 'a file' },
      { name: 'vault/people/a.md', data: PAGE }
    ]);
    const r = run([z, '--root', dir, '--apply']);
    assert.ok(
      refused(r, /REFUSED Z8 vault\/people is a file in the archive and also a folder/) && empty(dir),
      `I13a: ${r.out.split('\n')[0]}`
    );
    const dir2 = repo();
    fs.mkdirSync(path.join(dir2, 'vault', 'me', 'goals.md'), { recursive: true });
    fs.writeFileSync(path.join(dir2, 'vault', 'people'), 'a file where the archive needs a folder\n');
    const z2 = zip(path.join(TMP, 'clash2.zip'), [
      { name: 'soul.md', data: SOUL },
      { name: 'vault/me/goals.md', data: PAGE },
      { name: 'vault/people/a.md', data: PAGE }
    ]);
    const r2 = run([z2, '--root', dir2, '--apply', '--overwrite']);
    assert.ok(
      refused(r2, /REFUSED Z8 vault\/me\/goals\.md is a folder in this repository/) &&
        /REFUSED Z8 vault\/people is a file in this repository/.test(r2.out) &&
        !fs.existsSync(path.join(dir2, 'soul.md')),
      `I13b: ${r2.out.split('\n').slice(0, 2).join(' | ')}`
    );
  });

  // Run through a linked folder (macOS's temp dir is /var -> /private/var; a junction on Windows): the
  // typed zip path and REPO must compare equal through the link, not just lexically, or Z0 would let an
  // import inside the repository through silently. /setup --import runs it on the cloud VM.
  test('NEGATIVE run through a linked folder, the importer still refuses rather than silently doing nothing', () => {
    const link = path.join(TMP, 'scripts-link');
    try {
      fs.symlinkSync(path.join(KIT, 'scripts'), link, 'junction');
    } catch (e) {
      assert.fail(`a folder link can be made here: ${e.message}`);
    }
    try {
      const dir = repo();
      const z = zip(path.join(dir, 'inside.zip'), [{ name: 'soul.md', data: SOUL }]);
      const via = spawnSync(process.execPath, [path.join(link, 'import-memory.mjs'), z, '--root', dir, '--apply'], {
        encoding: 'utf8'
      });
      assert.ok(
        via.status === 2 && /REFUSED Z0/.test(via.stdout),
        `exit ${via.status}, ${(via.stdout + via.stderr).trim().length} byte(s) of output`
      );
    } finally {
      fs.rmSync(link, { force: true }); // the link itself, never what it points at
    }
  });

  // /setup passes no --root (variants/online/.claude/commands/setup.md:422 and :434): main() falls back
  // to REPO (scripts/lib/repo-root.js), the checkout the running script itself belongs to - never the cwd,
  // and never a repository the cwd happens to sit in. Every test above always passes --root
  // explicitly, so this fallback - and Z0's behaviour under it - was never run at all. It must resolve the
  // SAME root whether the script runs from the repository's own top or from a subfolder inside it, since
  // REPO is fixed at the script's own location and does not read the cwd at all.
  test('no --root at all, from the repo root and from a subfolder: REPO resolves the same top, and Z0 still fires there', () => {
    const dir = repo();
    fs.mkdirSync(path.join(dir, 'work', '01-sub'), { recursive: true });
    const insideZip = zip(path.join(dir, 'inside2.zip'), [{ name: 'soul.md', data: SOUL }]);
    const outsideZip = zip(path.join(TMP, 'outside-noroot.zip'), [{ name: 'soul.md', data: SOUL }]);
    const script = copyScript(dir);
    const sub = path.join(dir, 'work', '01-sub');
    for (const [label, cwd] of [
      ['the repo root', dir],
      ['a subfolder', sub]
    ]) {
      const bad = spawnSync(process.execPath, [script, insideZip], { cwd, encoding: 'utf8' });
      assert.ok(bad.status === 2 && /REFUSED Z0/.test(bad.stdout), `from ${label}: exit ${bad.status}`);
    }
    for (const [label, cwd] of [
      ['the repo root', dir],
      ['a subfolder', sub]
    ]) {
      const good = spawnSync(process.execPath, [script, outsideZip, '--apply'], { cwd, encoding: 'utf8' });
      assert.ok(good.status === 0 && fs.existsSync(path.join(dir, 'soul.md')), `from ${label}: exit ${good.status}`);
      fs.rmSync(path.join(dir, 'soul.md'), { force: true });
    }
  });

  // Z0 must compare REAL paths, not just the caller-typed zip path against rootAbs with plain
  // path.relative: that catches the common case but misses the moment either side is spelled through an
  // alias. Neither case below depends on 8.3 names being enabled, except the short-name case, which is
  // skipped by name where the machine has none.
  describe('Z0 compares REAL paths, whichever side is aliased', () => {
    // The zip sits at dir/via-link.zip; the caller reaches it through a junction to dir, so the path
    // handed to importMemory() never contains dir's own spelling at all. --root is dir itself, typed
    // plainly, so this is Z0's comparison in isolation, with no short name involved.
    test('NEGATIVE a zip inside the repository, named through a link to it, still refuses with Z0', () => {
      const dir = repo();
      const link = path.join(TMP, `im-z0-link-${n}`);
      try {
        fs.symlinkSync(dir, link, 'junction');
      } catch (e) {
        assert.fail(`a folder link to a repository can be made here: ${e.message}`);
      }
      try {
        zip(path.join(dir, 'via-link.zip'), [{ name: 'soul.md', data: SOUL }]);
        const viaLink = path.join(link, 'via-link.zip');
        const r = run([viaLink, '--root', dir, '--apply']);
        assert.ok(refused(r, /REFUSED Z0 .* is inside this repository/) && empty(dir), r.out.split('\n')[0]);
      } finally {
        fs.rmSync(link, { force: true }); // the link itself, never what it points at
      }
    });

    // The production shape (no --root, REPO comes from where the running script itself sits) with the
    // mismatch a link creates: the script is reached through a link to its own repository, so REPO
    // (repo-root.js's __dirname, never realpath'd) resolves to the LINK's spelling while the zip is named
    // through the same link too - the mirror of the case above, but on the root side and with no --root
    // at all.
    test('NEGATIVE no --root, the running script and the zip both named through a link to the repository, still refuses with Z0', () => {
      const dir2 = repo();
      copyScript(dir2);
      const link2 = path.join(TMP, `im-z0-link2-${n}`);
      try {
        fs.symlinkSync(dir2, link2, 'junction');
      } catch (e) {
        assert.fail(`a second folder link can be made here: ${e.message}`);
      }
      try {
        zip(path.join(dir2, 'via-link2.zip'), [{ name: 'soul.md', data: SOUL }]);
        const viaLink2 = path.join(link2, 'via-link2.zip');
        const script = path.join(link2, 'scripts', 'import-memory.mjs');
        const bad = spawnSync(process.execPath, [script, viaLink2], { cwd: link2, encoding: 'utf8' });
        assert.ok(bad.status === 2 && /REFUSED Z0/.test(bad.stdout), `exit ${bad.status}`);
      } finally {
        fs.rmSync(link2, { force: true });
      }
    });

    // The other operand: --root itself is named through a link (a caller can pass --root through one, the
    // same way a subfolder cwd reaches this repository); the zip is given by its own plain, unaliased
    // path, physically inside the folder the link points at. The two cases above both alias the zip and
    // leave --root typed plainly; this is the mirror case, and without it a fix that only resolved the
    // zip side (never the root side) would still pass every case above.
    test('NEGATIVE a zip named plainly, but --root itself named through a link to the same repository, still refuses with Z0', () => {
      const dir4 = repo();
      const link4 = path.join(TMP, `im-z0-link4-${n}`);
      try {
        fs.symlinkSync(dir4, link4, 'junction');
      } catch (e) {
        assert.fail(`a fourth folder link can be made here: ${e.message}`);
      }
      try {
        const z4 = zip(path.join(dir4, 'via-root-link.zip'), [{ name: 'soul.md', data: SOUL }]);
        const r4 = run([z4, '--root', link4, '--apply']);
        assert.ok(refused(r4, /REFUSED Z0 .* is inside this repository/) && empty(dir4), r4.out.split('\n')[0]);
      } finally {
        fs.rmSync(link4, { force: true });
      }
    });

    // The mirror of the four cases above. There, the alias sits OUTSIDE the repository and points IN.
    // Here, a junction sits INSIDE the repository (dir5/dl) and points OUT to an unrelated folder; the ZIP
    // is typed THROUGH that junction (dir5/dl/mem.zip), a path that never lexically leaves dir5, while its
    // REAL location resolves outside dir5 entirely. Comparing real paths alone would see only the real,
    // outside location and let it through - and Git for Windows follows a directory junction when
    // staging, so `git add -A` would commit the ZIP's bytes despite Z0 "refusing" it by real path. The
    // typed comparison must also run, and must also refuse.
    test('NEGATIVE a zip typed through a junction inside the repository that points outside it, still refuses with Z0', () => {
      const dir5 = repo();
      const outside5 = path.join(TMP, `im-z0e-outside-${n}`);
      fs.mkdirSync(outside5, { recursive: true });
      const junction5 = path.join(dir5, 'dl');
      try {
        fs.symlinkSync(outside5, junction5, 'junction');
      } catch (e) {
        assert.fail(`a junction inside a repository can be made here: ${e.message}`);
      }
      try {
        zip(path.join(outside5, 'mem.zip'), [{ name: 'soul.md', data: SOUL }]);
        const viaJunction = path.join(junction5, 'mem.zip');
        const r5 = run([viaJunction, '--root', dir5, '--apply']);
        assert.ok(refused(r5, /REFUSED Z0 .* is inside this repository/) && empty(dir5), r5.out.split('\n')[0]);
      } finally {
        fs.rmSync(junction5, { force: true }); // the junction itself, never what it points at
      }
    });

    // real()'s ENOENT-only fallback: a missing path (the common case: a caller's typo) falls back to
    // the typed path so the existing statSync below can give a clear message. Any OTHER realpath failure
    // (a permission error, a native realpath that cannot resolve a path on some RAM or virtual drive) must
    // refuse rather than silently comparing an unresolved path against a resolved one. No such drive
    // exists on this machine, so the failure is simulated by monkey-patching fs.realpathSync.native for
    // exactly the zip's path, restored immediately after.
    test('NEGATIVE a realpath failure other than ENOENT refuses Z0, rather than falling back to the typed path', () => {
      const dir6 = repo();
      const outsideZip6 = zip(path.join(TMP, `im-z0-realpath-fails-${n}.zip`), [{ name: 'soul.md', data: SOUL }]);
      const target6 = path.resolve(outsideZip6);
      const nativeRealpath = fs.realpathSync.native;
      fs.realpathSync.native = (p) => {
        if (path.resolve(p) === target6) {
          const e = new Error('a simulated I/O error, realpath');
          e.code = 'EIO';
          throw e;
        }
        return nativeRealpath(p);
      };
      let r6;
      try {
        r6 = run([outsideZip6, '--root', dir6, '--apply']);
      } finally {
        fs.realpathSync.native = nativeRealpath;
      }
      assert.ok(
        refused(r6, /REFUSED Z0 .*real location could not be established \(EIO\)/) && empty(dir6),
        r6.out.split('\n')[0]
      );
    });
  });
});
