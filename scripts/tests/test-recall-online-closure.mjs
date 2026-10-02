#!/usr/bin/env node
// @ts-check
// scripts/tests/test-recall-online-closure.mjs - the recall spine's online reach, and the drop that holds it.
//
// WHAT. The recall spine is a laptop organ: the online tree ships two of its files and drops the rest by exact
// path, and this file holds that line from the side that ships, each item measured rather than read off a
// document. scripts/close-out-online.sh, the step every online Routine and session ends with, runs
// scripts/status-rotate.js and scripts/outputs-ledger.js on every run and requires system/recall/lib/lessons.js
// only for a real L-line (`L: none`, the Routine default, is answered before the require). lessons.js,
// status-rotate.js and outputs-ledger.js load with node:sqlite blocked and pull in nothing that needs it, and
// the parser the close-out needs lives in lessons.js alone, which holds the grammar's one body and requires no
// repository file. The thirteen laptop files have no online entry point, each is a drop row by its exact path,
// and a generated tree holds none of them. A drop carries with it the exact path close-out-online.sh resolves,
// the relative require scripts/tests/test-lesson-parse.js uses, and a README that names the laptop scripts by
// path only. Deleted, a drop that broke the online close-out, or a re-export that dragged node:sqlite online,
// would pass CI.
//
// HOW. A require runs in a child process, with a preload that makes node:sqlite throw where a test asks, and
// reports the repository files it added; everything else reads a tracked file. The file runs in the Kit and
// inside a GENERATED online tree (the online CI list runs it there), where variants/ and every drop row are
// absent: a read of such a path goes to its applied twin, the online settings file, or the file is asserted
// absent, never asserted away where it exists, so all seven tests run in both trees. What only a laptop can
// show, the ledger half failing loudly without node:sqlite, is scripts/tests/test-recall-laptop-closure.mjs,
// in the Kit only.
//
// NEVER. Writes into the checkout or reaches a network: a probe that could write runs from a copy under the
// OS temp folder.
//
// Usage: node scripts/tests/test-recall-online-closure.mjs
// Exit: 0 every test passed - 1 a test failed

import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const KIT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const TMP = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'alex-c5-oc-')));
after(() => fs.rmSync(TMP, { recursive: true, force: true }));

// Makes require('node:sqlite') throw, the way a Node build without it would.
const BLOCK = path.join(TMP, 'block-sqlite.cjs');
fs.writeFileSync(
  BLOCK,
  `${[
    "'use strict';",
    "const Module = require('module');",
    'const orig = Module._load;',
    "Module._load = function (req) { if (req === 'node:sqlite' || req === 'sqlite') throw new Error('node:sqlite unavailable (test block)'); return orig.apply(this, arguments); };"
  ].join('\n')}\n`
);

const INERT = [
  'system/recall/harvest.js',
  'system/recall/recall-inject.js',
  'system/recall/lib/db.js',
  'system/recall/lib/facts.js',
  'system/recall/lib/harvest-core.js',
  'system/recall/harvesters/h-manifest.js',
  'system/recall/harvesters/h-scheduler.js',
  'system/recall/harvesters/h-validators.js',
  'system/recall/harvesters/h-recovery.js',
  'system/recall/harvesters/h-skills.js',
  'system/recall/harvesters/h-attest.js',
  'scripts/facts-check.js',
  'scripts/lesson-harvest.js'
];
// This file runs in the KIT and inside a GENERATED online tree (the online CI list runs it there). The
// generated tree has no variants/ folder and none of the drop rows, so every read of a dropped path is
// resolved to its applied twin or the file is asserted absent, never asserted away where it does exist.
const IN_ONLINE_TREE = !fs.existsSync(path.join(KIT, 'variants'));
const WRAPPERS = ['scripts/run-vault-index.ps1', 'work/18-recovery-layer/check.ps1'];
/** @param {string} rel a path from the root */
const read = (rel) => fs.readFileSync(path.join(KIT, rel), 'utf8');
/**
 * Runs node from the root.
 * @param {string[]} args
 * @param {{ cwd?: string }} [opts]
 */
function node(args, opts = {}) {
  const r = spawnSync(process.execPath, args, { cwd: KIT, encoding: 'utf8', ...opts });
  return { status: r.status, stdout: r.stdout.trim(), stderr: r.stderr };
}
// A copy of what git sees in this tree (tracked files plus untracked ones it does not ignore, symlinks
// kept as links) at `dest`, leaving out every path `skip` names. Inherited GIT_* is stripped and git
// reads an empty fixture config, so the listing is this tree's own.
/**
 * @param {string} dest
 * @param {(rel: string) => boolean} [skip]
 */
function copyOfCheckout(dest, skip = () => false) {
  fs.writeFileSync(path.join(TMP, 'gitconfig'), '');
  const env = Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.startsWith('GIT_')));
  Object.assign(env, { GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: path.join(TMP, 'gitconfig') });
  const ls = spawnSync('git', ['ls-files', '-z', '--cached', '--others', '--exclude-standard'], {
    cwd: KIT,
    env,
    encoding: 'utf8'
  });
  assert.equal(ls.status, 0, `git ls-files failed in ${KIT}: ${ls.stderr}`);
  for (const rel of ls.stdout.split('\0').filter(Boolean)) {
    if (skip(rel)) continue;
    const src = path.join(KIT, rel);
    const dst = path.join(dest, rel);
    let st;
    try {
      st = fs.lstatSync(src);
    } catch {
      continue;
    }
    fs.mkdirSync(path.dirname(dst), { recursive: true });
    if (st.isSymbolicLink()) fs.symlinkSync(fs.readlinkSync(src), dst);
    else if (st.isFile()) fs.copyFileSync(src, dst);
  }
  return dest;
}
/**
 * Which repository files requiring `rel` pulls in, relative and sorted, and the message of what it threw.
 * @param {string} rel
 * @param {{ block?: boolean }} [options] `block` makes node:sqlite throw
 * @returns {{ err: string, added: string[] }}
 */
function requires(rel, { block = false } = {}) {
  const script = [
    "const p = require('path');",
    'const before = new Set(Object.keys(require.cache));',
    `let err = ''; try { require(p.resolve(${JSON.stringify(rel)})); } catch (e) { err = e.message; }`,
    "const added = Object.keys(require.cache).filter((k) => !before.has(k)).map((k) => p.relative(process.cwd(), k).split(p.sep).join('/')).sort();",
    'console.log(JSON.stringify({ err, added }));'
  ].join('\n');
  const r = node([...(block ? ['--require', BLOCK] : []), '-e', script]);
  assert.equal(r.status, 0, r.stderr);
  return JSON.parse(r.stdout);
}

test('close-out-online.sh, the step every online Routine ends with, runs status-rotate and the ledger on EVERY run and reaches lessons.js only through its exact path', () => {
  const sh = read('scripts/close-out-online.sh');
  assert.ok(sh.includes('node scripts/status-rotate.js'), 'step 1');
  assert.ok(
    sh.includes('node scripts/outputs-ledger.js reconcile') && sh.includes('node scripts/outputs-ledger.js render'),
    'step 2'
  );
  assert.ok(
    sh.includes("require(path.resolve('system/recall/lib/lessons.js'))"),
    'step 3 resolves that exact path, so a drop that moves the file must leave a re-export behind'
  );
  // a plain sh.indexOf('L: none') finds the phrase's first mention anywhere, including the header
  // comment and the Usage line, so it would still "pass" even if the real screen moved below the require.
  // Strip comment lines first, and anchor on the code the screen actually is: the quoted "l: none" the case
  // pattern in step_lesson matches against, lowercased same as $lowered.
  const codeOnly = sh
    .split('\n')
    .filter((l) => !l.trim().startsWith('#'))
    .join('\n');
  const screen = codeOnly.indexOf('"l: none"');
  const requireAt = codeOnly.indexOf("require(path.resolve('system/recall/lib/lessons.js'))");
  assert.ok(screen > 0, "the code carries the none-screen's exact quoted case-pattern token");
  assert.ok(
    screen < requireAt,
    'the "l: none" screen comes BEFORE the require, so a Routine that reports no lesson never loads it'
  );
  assert.ok(
    !/node scripts\/lesson-harvest\.js|system\/recall\/harvest\.js|recall-inject/.test(sh),
    'and it never reaches the ledger half'
  );
});

test('with node:sqlite blocked: lessons.js, status-rotate.js and outputs-ledger.js all load and pull in nothing that needs it', () => {
  const lessons = requires('system/recall/lib/lessons.js', { block: true });
  assert.equal(lessons.err, '');
  assert.deepEqual(
    lessons.added,
    ['system/recall/lib/lessons.js'],
    'lessons.js requires nothing at all, so a re-export can never drag the ledger online'
  );
  const rotate = requires('scripts/status-rotate.js', { block: true });
  assert.equal(rotate.err, '');
  assert.deepEqual(
    rotate.added,
    ['scripts/status-rotate.js'],
    'the write lock is required inside the CLI branch only, so requiring the module is free'
  );
  // outputs-ledger.js has no module export and runs its command dispatch at load, so it is probed by
  // running it with a command instead of requiring it. It finds outputs/ from its OWN folder, not the
  // working directory, so it runs from a copy of this checkout that leaves outputs/ out: in place, once an
  // earlier step had created outputs/, render would write outputs/INDEX.md into the checkout. The whole
  // tree is copied, not the one script, so any file it requires resolves exactly as it does here.
  const ledgerTree = copyOfCheckout(path.join(TMP, 'ledger-tree'), (rel) => rel.startsWith('outputs/'));
  assert.ok(!fs.existsSync(path.join(ledgerTree, 'outputs')), 'the copy has no outputs/ folder');
  const ledger = node(['--require', BLOCK, path.join(ledgerTree, 'scripts', 'outputs-ledger.js'), 'render'], {
    cwd: TMP
  });
  assert.notEqual(ledger.status, 0, 'it fails on the absent outputs/ folder of the copy, never on node:sqlite');
  assert.ok(!/node:sqlite/.test(ledger.stderr), ledger.stderr.slice(0, 120));
});

test('the parse helper keeps the two callers it has: close-out-online.sh by absolute path, test-lesson-parse.js by relative require', () => {
  assert.ok(read('scripts/tests/test-lesson-parse.js').includes("require('../../system/recall/lib/lessons')"));
  const mod = requires('system/recall/lib/lessons.js');
  assert.equal(mod.err, '');
  const exports = node([
    '-e',
    "console.log(Object.keys(require(require('path').resolve('system/recall/lib/lessons.js'))).sort().join(','))"
  ]);
  assert.equal(
    exports.stdout,
    'normalize,parseLLine,upsertLesson',
    'the export surface both callers and a re-export would have to keep'
  );
});

test('the laptop organ has no online entry point: the online settings file registers no recall hook, no online command or Routine prompt names any of these thirteen files, and a generated tree holds none of them', (t) => {
  // In the KIT the online settings file lives under variants/; in a GENERATED tree the variant has already
  // been applied, so .claude/settings.json IS the online one and variants/ is gone (a drop row).
  const online = JSON.parse(read(IN_ONLINE_TREE ? '.claude/settings.json' : 'variants/online/.claude/settings.json'));
  /** @param {{ hooks: Record<string, unknown[]> }} s a settings file */
  const cmds = (s) => JSON.stringify(s.hooks.UserPromptSubmit || []);
  assert.ok(
    !cmds(online).includes('recall-inject'),
    'the online settings file registers no recall hook, so the hook never runs online'
  );
  assert.ok(
    cmds(online).includes('capture-typed-input.js'),
    'its UserPromptSubmit array exists and carries the other hook, so this is a deliberate absence'
  );
  if (IN_ONLINE_TREE) {
    t.diagnostic(
      'the laptop half is not asserted here: a generated online tree ships ONE settings file and it is the online one'
    );
  } else {
    assert.ok(
      cmds(JSON.parse(read('.claude/settings.json'))).includes('system/recall/recall-inject.js'),
      'while the laptop settings file runs it on every prompt'
    );
  }
  const surfaces = [];
  for (const dir of ['variants/online/.claude/commands', '.claude/commands', 'scheduler/routines']) {
    const abs = path.join(KIT, dir);
    if (!fs.existsSync(abs)) continue;
    for (const f of fs.readdirSync(abs).filter((x) => x.endsWith('.md')))
      surfaces.push([`${dir}/${f}`, fs.readFileSync(path.join(abs, f), 'utf8')]);
  }
  assert.ok(surfaces.length > 10, `${surfaces.length} command and Routine files were read`);
  const named = [];
  for (const [rel, text] of surfaces)
    for (const inert of INERT) if (text.includes(inert)) named.push(`${rel} -> ${inert}`);
  // In the Kit the online surfaces are variants/online/.claude/commands plus the Routines; in a generated
  // tree the applied .claude/commands ARE those surfaces, so every command file counts there.
  const onlineSurfaces = named.filter(
    (x) =>
      x.startsWith('scheduler/routines/') ||
      x.startsWith('variants/online/') ||
      (IN_ONLINE_TREE && x.startsWith('.claude/commands/'))
  );
  assert.deepEqual(onlineSurfaces, [], 'no Routine prompt and no online command reaches the inert set');
  for (const f of INERT) {
    assert.equal(
      fs.existsSync(path.join(KIT, f)),
      !IN_ONLINE_TREE,
      IN_ONLINE_TREE ? `${f} is a drop row, and the generated tree still holds it` : `${f} stays in the Kit`
    );
  }
});

test('the kit manifest holds the drop: each of the thirteen and both wrappers are drop rows by their exact paths, and the recall row ships lessons.js and the README by theirs, claiming no directory', () => {
  /** @type {{ id: string, online: string, paths: string[] }[]} */
  const rows = JSON.parse(read('system/kit-manifest.json')).components;
  const exactDrops = new Set(
    rows
      .filter((c) => c.online === 'drop')
      .flatMap((c) => c.paths)
      .filter((p) => !p.endsWith('/'))
  );
  for (const f of INERT)
    assert.ok(
      exactDrops.has(f),
      `${f} is a drop row by its exact path, which is what leaves a contract tag naming it to the Kit`
    );
  for (const w of WRAPPERS) assert.ok(exactDrops.has(w), `${w} is a drop row, so what it runs is unreachable online`);
  const recall = /** @type {{ id: string, online: string, paths: string[] }} */ (rows.find((c) => c.id === 'recall'));
  assert.deepEqual(
    [recall.online, [...recall.paths].sort()],
    ['ship', ['system/recall/README.md', 'system/recall/lib/lessons.js']],
    'the recall row ships the code map and the lessons parser by exact path'
  );
  assert.ok(
    !rows.some((c) => c.paths.some((p) => p.endsWith('/') && 'system/recall/'.startsWith(p))),
    'no row claims system/recall/ as a directory, so a new laptop file there is refused by the build until a row names it'
  );
});

test('what a drop carries with it: the shipped README names the two laptop scripts by path and never as a command line, which portability check P6 would fail where a script is not in the tree', () => {
  const readme = read('system/recall/README.md');
  assert.ok(
    !/node scripts\/(facts-check|lesson-harvest)\.js/.test(readme) &&
      readme.includes('`scripts/facts-check.js`') &&
      readme.includes('`scripts/lesson-harvest.js`'),
    'the README ships online, and a command line naming a script the tree does not hold makes P6 red there'
  );
  const p6 = read('scripts/tests/portability-check.mjs');
  assert.ok(p6.includes('P6 DEADCALL') && p6.includes('this tree does not hold'), 'P6 is the check that would fire');
  assert.ok(p6.includes("'.md'") || p6.includes('README'), 'P6 reads markdown as well as code');
});

test('C12 is the ONE online caller of the ledger, and it is shielded: check.mjs runs validate only when outputs/ exists and the script is present', () => {
  const check = read('work/18-recovery-layer/check.mjs');
  assert.ok(
    check.includes(
      "if (!exists('outputs')) { add('C12', GREEN, 'no outputs/ directory yet; nothing to name'); return; }"
    )
  );
  assert.ok(check.includes("if (!exists('scripts/outputs-ledger.js')) { add('C12', AMBER,"));
  assert.ok(
    check.includes("[abs('scripts/outputs-ledger.js'), 'validate']"),
    'and it shells out to validate, the one ledger command that never reads ledger.jsonl'
  );
});
