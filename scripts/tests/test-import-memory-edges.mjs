#!/usr/bin/env node
// scripts/tests/test-import-memory-edges.mjs - the edges of scripts/import-memory.mjs that
// test-import-memory.mjs does not reach, and its known defects, each pinned as it behaves today.
//
// WHAT. test-import-memory.mjs holds every guard (Z0-Z8) on its main shape. This file holds the command
// line (usage, an unknown argument), the archive-level refusals (not a ZIP, zip64, a name that is not
// UTF-8, several zip-slip entries listed together, nothing to take), the limits, and four known defects,
// each pinned as it is today (its own PINNED DEFECT test below names the id; NEVER lists what each is).
// Deleted, one of these command-line or archive-level checks could regress with nothing to catch it.
//
// HOW. main() is called in-process with a recording log, and each archive is built here by a small
// writer, in the OS temp directory.
//
// NEVER. Never writes inside the repository it runs in. Flips a PINNED DEFECT assertion on its own; each
// pins today's behaviour until a FIX row in the ratchet changes it. R4-4: a ZIP inside the repository
// under a folder whose name starts with ".." passes Z0, imports, and stays untracked for the next
// autosave. R4-L16: a missing ZIP reads as an ERROR stack trace at exit 1, not a Z1 refusal. R4-L17: a
// crafted central directory reads as a RangeError at exit 1, not a Z1 refusal. R4-L18: entries that differ
// only by case, or by "./", overwrite each other silently.
//
// Usage: node scripts/tests/test-import-memory-edges.mjs
// Exit: 0 all pass - 1 any failure

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import * as I from '../import-memory.mjs';

const CRC = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();
const crc32 = (b) => {
  let c = 0xffffffff;
  for (let i = 0; i < b.length; i++) c = CRC[(c ^ b[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};
function zipBuf(entries) {
  const locals = [];
  const central = [];
  let off = 0;
  for (const en of entries) {
    const name = Buffer.isBuffer(en.name) ? en.name : Buffer.from(en.name, 'utf8');
    const data = Buffer.from(en.data ?? '', 'utf8');
    const crc = crc32(data);
    const lh = Buffer.alloc(30);
    lh.writeUInt32LE(0x04034b50, 0);
    lh.writeUInt16LE(20, 4);
    lh.writeUInt32LE(crc, 14);
    lh.writeUInt32LE(data.length, 18);
    lh.writeUInt32LE(data.length, 22);
    lh.writeUInt16LE(name.length, 26);
    locals.push(lh, name, data);
    const ch = Buffer.alloc(46);
    ch.writeUInt32LE(0x02014b50, 0);
    ch.writeUInt16LE(20, 4);
    ch.writeUInt16LE(20, 6);
    ch.writeUInt32LE(crc, 16);
    ch.writeUInt32LE(data.length, 20);
    ch.writeUInt32LE(data.length, 24);
    ch.writeUInt16LE(name.length, 28);
    ch.writeUInt32LE(off, 42);
    central.push(ch, name);
    off += 30 + name.length + data.length;
  }
  const cd = Buffer.concat(central);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(entries.length, 8);
  eocd.writeUInt16LE(entries.length, 10);
  eocd.writeUInt32LE(cd.length, 12);
  eocd.writeUInt32LE(off, 16);
  return Buffer.concat([...locals, cd, eocd]);
}
function setup(t) {
  const T = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'c3-imp-')));
  t.after(() => fs.rmSync(T, { recursive: true, force: true }));
  const repo = path.join(T, 'repo');
  fs.mkdirSync(path.join(repo, 'system'), { recursive: true });
  const env = { ...process.env };
  for (const k of Object.keys(env)) if (/^GIT_/.test(k)) delete env[k];
  spawnSync('git', ['init', '-q'], { cwd: repo, env: { ...env, GIT_CONFIG_NOSYSTEM: '1' } });
  const main = (args) => {
    const out = [];
    const code = I.main(args, (l) => out.push(l));
    return { code, lines: out };
  };
  const put = (name, buf) => {
    const f = path.join(T, name);
    fs.mkdirSync(path.dirname(f), { recursive: true });
    fs.writeFileSync(f, buf);
    return f;
  };
  return { T, repo, main, put, env };
}
const SOUL = { name: 'soul.md', data: '# Soul\n' };

test('the exports and the limits the guards enforce', () => {
  assert.deepEqual(Object.keys(I).sort(), [
    'LIMITS',
    'Refusal',
    'crc32',
    'importMemory',
    'main',
    'planNames',
    'readCentral',
    'slipReason'
  ]);
  assert.deepEqual(I.LIMITS, { archive: 104857600, file: 10485760, total: 262144000, files: 20000 });
  assert.equal(I.crc32(Buffer.from('123456789')), 0xcbf43926, 'the standard CRC-32 check value');
});

// dup-refusal-class: Refusal is scripts/lib/errors.js's class, subclassed, not a
// second hand-rolled one. The export name and .reasons stay the same either way (main() never breaks), so
// this is the one place that would catch a regression back to a bare `class Refusal extends Error`.
test("Refusal is scripts/lib/errors.js's class, subclassed: the name and exit code come from there", async () => {
  const { Refusal: KitRefusal } = await import('../lib/errors.js');
  const r = new I.Refusal(['one', 'two']);
  assert.ok(r instanceof KitRefusal, 'instanceof the shared Refusal, not a second hand-rolled class');
  assert.equal(r.name, 'Refusal');
  assert.equal(r.exitCode, 2);
  assert.equal(r.message, 'one | two');
  assert.deepEqual(r.reasons, ['one', 'two']);
});

test('the command line: no ZIP is the usage line, an unknown flag or a second ZIP is an ERROR line, both exit 1', (t) => {
  const s = setup(t);
  assert.deepEqual(s.main([]), {
    code: 1,
    lines: [
      'import-memory: usage: node scripts/import-memory.mjs <zip> [--apply] [--overwrite] [--skip-flagged] [--root <repo>]'
    ]
  });
  assert.deepEqual(s.main(['a.zip', '--bogus']), {
    code: 1,
    lines: [
      'import-memory: ERROR - unknown flag --bogus; this command takes --apply, --overwrite, --skip-flagged, --root'
    ]
  });
  assert.deepEqual(s.main(['a.zip', '-x']), {
    code: 1,
    lines: ['import-memory: ERROR - unknown flag -x; this command takes --apply, --overwrite, --skip-flagged, --root']
  });
  assert.deepEqual(s.main(['a.zip', 'b.zip']), { code: 1, lines: ['import-memory: ERROR - unknown argument b.zip'] });
  assert.deepEqual(s.main(['a.zip', '--root']), {
    code: 1,
    lines: ["import-memory: ERROR - Option '--root <value>' argument missing"]
  });
});

test('archive-level refusals, each one REFUSED line then the summary, exit 2, nothing written', (t) => {
  const s = setup(t);
  const eocd = zipBuf([SOUL]);
  const zip64 = Buffer.concat([eocd.subarray(0, eocd.length - 22), Buffer.alloc(20), eocd.subarray(eocd.length - 22)]);
  zip64.writeUInt32LE(0x07064b50, zip64.length - 42);
  const cases = [
    [
      'not-a-zip.zip',
      Buffer.from('this is just text, not an archive\n'),
      ['REFUSED Z1 not a ZIP archive (no end-of-central-directory record)']
    ],
    ['zip64.zip', zip64, ['REFUSED Z1 a zip64 archive; export a smaller one, or split the vault']],
    [
      'latin1.zip',
      zipBuf([{ name: Buffer.from([0x76, 0x61, 0x75, 0x6c, 0x74, 0x2f, 0xe9, 0x2e, 0x6d, 0x64]), data: 'x' }]),
      [
        'REFUSED Z1 entry 1: a file name that is not UTF-8; zip the folder again with the system\'s own "Compress" or 7-Zip'
      ]
    ],
    [
      'two-slips.zip',
      zipBuf([SOUL, { name: '../up.md', data: 'x' }, { name: 'C:/win.md', data: 'x' }]),
      [
        'REFUSED Z2 entry 2 "../up.md": a ".." segment; the whole archive is refused',
        'REFUSED Z2 entry 3 "C:/win.md": a drive letter; the whole archive is refused'
      ]
    ],
    [
      'nothing.zip',
      zipBuf([{ name: 'README.md', data: 'x' }]),
      ['REFUSED Z3 the archive holds no soul.md and nothing under vault/']
    ]
  ];
  for (const [name, buf, reasons] of cases) {
    const r = s.main([s.put(name, buf), '--root', s.repo, '--apply']);
    assert.deepEqual(r, { code: 2, lines: [...reasons, 'import-memory: REFUSED - nothing was written'] }, name);
  }
  assert.deepEqual(fs.readdirSync(s.repo).sort(), ['.git', 'system']);
});

test('the dry-run and apply summary lines, and a skip list naming each reason', (t) => {
  const s = setup(t);
  const z = s.put(
    'm.zip',
    zipBuf([
      SOUL,
      { name: 'vault/me/a.md', data: 'a' },
      { name: 'vault/.DS_Store', data: 'x' },
      { name: 'vault/.obsidian/app.json', data: '{}' },
      { name: 'notes.txt', data: 'x' }
    ])
  );
  const plan = s.main([z, '--root', s.repo]);
  assert.deepEqual(plan, {
    code: 0,
    lines: [
      '  skip  vault/.DS_Store (macOS folder data)',
      '  skip  vault/.obsidian/app.json (Obsidian device settings, never saved online)',
      '  skip  notes.txt (not soul.md or vault/)',
      'import-memory: PLAN 2 file(s) to write, nothing written (dry run); 3 skipped, 0 left out, 0 would replace an existing file'
    ]
  });
  const apply = s.main([z, '--root', s.repo, '--apply']);
  assert.equal(
    apply.lines.pop(),
    'import-memory: WROTE 2 file(s); 3 skipped, 0 left out, 0 would replace an existing file'
  );
});

test('PINNED DEFECT R4-4: a ZIP inside the repository under a folder named "..cache" passes Z0, imports, and stays untracked for the next autosave', (t) => {
  const s = setup(t);
  const z = path.join(s.repo, '..cache', 'm.zip');
  fs.mkdirSync(path.dirname(z));
  fs.writeFileSync(z, zipBuf([SOUL, { name: 'vault/me/a.md', data: 'a' }]));
  const inside = s.main([z, '--root', s.repo]);
  assert.deepEqual(inside.lines, [
    'import-memory: PLAN 2 file(s) to write, nothing written (dry run); 0 skipped, 0 left out, 0 would replace an existing file'
  ]);
  assert.equal(s.main([z, '--root', s.repo, '--apply']).code, 0);
  const st = spawnSync('git', ['status', '--porcelain', '--untracked-files=all', '..cache'], {
    cwd: s.repo,
    encoding: 'utf8',
    env: s.env
  });
  assert.equal(st.stdout, '?? ..cache/m.zip\n');
  // The same ZIP one folder over, named without the dots, is refused as Z0 should refuse this one.
  const plain = path.join(s.repo, 'cache', 'm.zip');
  fs.mkdirSync(path.dirname(plain));
  fs.copyFileSync(z, plain);
  assert.equal(s.main([plain, '--root', s.repo]).code, 2);
});

test('PINNED DEFECT R4-L16: a ZIP that does not exist is an ERROR with a stack, exit 1', (t) => {
  const s = setup(t);
  const r = s.main([path.join(s.T, 'nope.zip'), '--root', s.repo]);
  assert.equal(r.code, 1);
  assert.match(
    r.lines[0],
    /^import-memory: ERROR - Error: ENOENT: no such file or directory, stat '.*nope\.zip'\n {4}at /
  );
});

test('PINNED DEFECT R4-L17: a central directory whose name runs past the file is a RangeError with exit 1, not a Z1 refusal', (t) => {
  const s = setup(t);
  const ch = Buffer.alloc(46);
  ch.writeUInt32LE(0x02014b50, 0);
  ch.writeUInt16LE(60000, 28);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(2, 8);
  eocd.writeUInt16LE(2, 10);
  eocd.writeUInt32LE(46, 12);
  eocd.writeUInt32LE(0, 16);
  const r = s.main([s.put('crafted.zip', Buffer.concat([ch, eocd])), '--root', s.repo]);
  assert.equal(r.code, 1);
  assert.match(
    r.lines[0],
    /^import-memory: ERROR - RangeError \[ERR_OUT_OF_RANGE\]: The value of "offset" is out of range\./
  );
});

test('PINNED DEFECT R4-L18: "vault/./x.md" and "vault/x.md" are both written to one file (the later wins), and so are names differing only by case where the disk folds case', (t) => {
  const s = setup(t);
  const z = s.put(
    'dup.zip',
    zipBuf([
      { name: 'vault/Case.md', data: 'upper' },
      { name: 'vault/case.md', data: 'lower' },
      { name: 'vault/./dot.md', data: 'dotted' },
      { name: 'vault/dot.md', data: 'plain' }
    ])
  );
  const r = s.main([z, '--root', s.repo, '--apply']);
  assert.deepEqual(r, {
    code: 0,
    lines: ['import-memory: WROTE 4 file(s); 0 skipped, 0 left out, 0 would replace an existing file']
  });
  const files = fs.readdirSync(path.join(s.repo, 'vault')).sort();
  const folds = fs.existsSync(path.join(s.repo, 'VAULT'));
  if (folds) {
    assert.deepEqual(files, ['Case.md', 'dot.md'], 'four entries, two files');
    assert.equal(
      fs.readFileSync(path.join(s.repo, 'vault', 'Case.md'), 'utf8'),
      'lower',
      "the first name, the second entry's content"
    );
  } else {
    assert.deepEqual(files, ['Case.md', 'case.md', 'dot.md']);
  }
  assert.equal(fs.readFileSync(path.join(s.repo, 'vault', 'dot.md'), 'utf8'), 'plain');
});
