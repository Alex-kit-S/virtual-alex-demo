#!/usr/bin/env node
// scripts/tests/test-build-template-exports.mjs - the frozen surface of scripts/build-online-template.mjs
// that other code imports, and its argument parser, pinned before the rewrite.
//
// WHAT. Two fleet scripts import the builder by name: scripts/new-virtual-alex.mjs:54 takes
// { KIT, DEFAULT_REMOTE, CHANGELOG_REL } and scripts/seed-contract-check.mjs:46-48 takes
// { KIT, seedFiles, planTree, trackedEntries, resolveRows, loadManifest, VARIANTS_REL }, and the seed
// checker COPIES planTree's files[].src (seed-contract-check.mjs:149). This file holds the export surface
// the fleet scripts import, held whole so a dropped name fails here: every name's shape and the parser's
// behaviour, including its known defects, each asserted AS IT IS TODAY and tagged PINNED DEFECT <id>, so a
// fix flips a named test.
//
// HOW. Pure calls and fixture git repositories in the OS temp directory. Nothing is built, nothing is
// pushed, no network.
//
// NEVER. Never writes inside the repository it runs in.
//
// Usage: node scripts/tests/test-build-template-exports.mjs
// Exit: 0 every assertion held - 1 one failed

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import * as B from '../build-online-template.mjs';
import { SOURCE_REL } from '../lib/template-gate.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..', '..');
const BUILDER = path.join(ROOT, 'scripts', 'build-online-template.mjs');
const GENERIC = 'https://github.com/Alex-kit-S/virtual-alex';

// A git child with no inherited repository redirection and no machine config.
function gitEnv(extra = {}) {
  const env = { ...process.env };
  for (const k of Object.keys(env)) if (/^GIT_/.test(k)) delete env[k];
  return {
    ...env,
    GIT_CONFIG_NOSYSTEM: '1',
    GIT_CONFIG_GLOBAL: path.join(os.tmpdir(), 'c3-no-such-gitconfig'),
    ...extra
  };
}
const git = (cwd, ...args) => {
  const r = spawnSync(
    'git',
    ['-c', 'core.autocrlf=false', '-c', 'user.name=T', '-c', 'user.email=t@example.invalid', ...args],
    { cwd, encoding: 'utf8', env: gitEnv() }
  );
  if (r.status !== 0) throw new Error(`git ${args.join(' ')}: ${r.stderr}`);
  return r.stdout;
};
const tmp = (t, prefix) => {
  const d = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), prefix)));
  t.after(() => fs.rmSync(d, { recursive: true, force: true }));
  return d;
};
const refusalOf = (fn) => {
  try {
    fn();
  } catch (e) {
    return e;
  }
  return null;
};

// ------------------------------------------------------------------ the names other files import
test('the names new-virtual-alex.mjs imports exist, with the values it relies on', () => {
  assert.equal(B.KIT, ROOT, 'KIT is the tree the builder sits in');
  assert.equal(B.DEFAULT_REMOTE, GENERIC);
  assert.equal(B.CHANGELOG_REL, 'system/template-changelog.jsonl');
});

test('the names seed-contract-check.mjs imports exist and are callables of the pinned kind', () => {
  assert.equal(B.VARIANTS_REL, 'variants/online');
  const named = {
    seedFiles: B.seedFiles,
    planTree: B.planTree,
    trackedEntries: B.trackedEntries,
    resolveRows: B.resolveRows,
    loadManifest: B.loadManifest
  };
  for (const [name, value] of Object.entries(named)) {
    assert.equal(typeof value, 'function', `${name} is exported as a function`);
  }
  // Declared parameters before the first default: planTree(kitEntries, claims, kitRoot = KIT),
  // seedFiles(seedDir), resolveRows(manifest), trackedEntries(cwd = KIT, pathspec = []), loadManifest(file = ...).
  assert.deepEqual(
    {
      planTree: B.planTree.length,
      seedFiles: B.seedFiles.length,
      resolveRows: B.resolveRows.length,
      trackedEntries: B.trackedEntries.length,
      loadManifest: B.loadManifest.length
    },
    { planTree: 2, seedFiles: 1, resolveRows: 1, trackedEntries: 0, loadManifest: 0 }
  );
});

test('the whole export surface (12 of these have no importer; dropping one is a documented diff)', () => {
  assert.deepEqual(Object.keys(B).sort(), [
    'CHANGELOG_REL',
    'DEFAULT_REMOTE',
    'KIT',
    'MANIFEST_REL',
    'ONLINE_VALUES',
    'PRIVILEGED',
    'Refusal',
    'TEMPLATE_SOURCE_REL',
    'TEMPLATE_SOURCE_SCHEMA',
    'VARIANTS_REL',
    'assertFlagged',
    'carriageReturns',
    'changelogRow',
    'claimFor',
    'classify',
    'committedEntries',
    'dirtyPaths',
    'donorScrub',
    'flaggedOf',
    'isPrivileged',
    'loadManifest',
    'nextBuild',
    'parseArgs',
    'planTree',
    'readBlobs',
    'resolveRows',
    'rowText',
    'seedFiles',
    'trackedEntries',
    'writeTemplateSource',
    'writeTree'
  ]);
  assert.equal(B.MANIFEST_REL, 'system/kit-manifest.json');
  assert.equal(B.TEMPLATE_SOURCE_REL, 'system/template-source.json');
  assert.equal(B.TEMPLATE_SOURCE_SCHEMA, 'template-source@1');
  assert.equal(
    SOURCE_REL,
    B.TEMPLATE_SOURCE_REL,
    'template-gate.mjs keeps its own copy of this path rather than importing the builder, so the two must agree'
  );
  assert.deepEqual(B.ONLINE_VALUES, ['ship', 'drop', 'variant']);
  assert.deepEqual(B.PRIVILEGED, [
    '.claude/settings.json',
    '.claude/commands/',
    'scripts/hooks/',
    'scripts/lib/',
    '.github/workflows/',
    'scheduler/routines/',
    'CLAUDE.md',
    '.mcp.json'
  ]);
});

test('Refusal is an Error named Refusal carrying exit code 2 (test-clone-scrub-scope reads B.Refusal)', () => {
  const r = new B.Refusal('why');
  assert.ok(r instanceof Error);
  assert.equal(r.name, 'Refusal');
  assert.equal(r.exitCode, 2);
  assert.equal(r.message, 'why');
});

test('importing the builder runs nothing: no output, exit 0 (both fleet scripts and three tests import it)', () => {
  const r = spawnSync(
    process.execPath,
    [
      '--input-type=module',
      '-e',
      `await import(${JSON.stringify(pathToFileURL(BUILDER).href)}); console.log('imported');`
    ],
    { encoding: 'utf8', env: gitEnv() }
  );
  assert.equal(r.status, 0, r.stderr);
  assert.equal(r.stdout, 'imported\n');
  assert.equal(r.stderr, '');
});

// ------------------------------------------------------------------ the shapes they return
test('loadManifest() with no argument reads <KIT>/system/kit-manifest.json', () => {
  const file = path.join(ROOT, 'system', 'kit-manifest.json');
  if (!fs.existsSync(file)) return; // a tree without the manifest has nothing to read; the call would throw ENOENT
  assert.deepEqual(B.loadManifest(), JSON.parse(fs.readFileSync(file, 'utf8')));
});

test('loadManifest(file) reads that file and a syntax error is a plain Error, not a Refusal', (t) => {
  const d = tmp(t, 'c3-exp-');
  fs.writeFileSync(path.join(d, 'm.json'), '{"components":[]}');
  assert.deepEqual(B.loadManifest(path.join(d, 'm.json')), { components: [] });
  fs.writeFileSync(path.join(d, 'bad.json'), '{');
  const e = refusalOf(() => B.loadManifest(path.join(d, 'bad.json')));
  assert.ok(e instanceof SyntaxError && !(e instanceof B.Refusal));
});

test('resolveRows returns one claim per path, in row order, as {id, online, prefix, isDir}', () => {
  const claims = B.resolveRows({
    components: [
      { id: 'a', online: 'ship', paths: ['docs/', 'README.md'] },
      { id: 'b', online: 'variant', paths: ['CLAUDE.md'] },
      { id: 'c', online: 'drop', paths: ['variants/'] }
    ]
  });
  assert.deepEqual(claims, [
    { id: 'a', online: 'ship', prefix: 'docs/', isDir: true },
    { id: 'a', online: 'ship', prefix: 'README.md', isDir: false },
    { id: 'b', online: 'variant', prefix: 'CLAUDE.md', isDir: false },
    { id: 'c', online: 'drop', prefix: 'variants/', isDir: true }
  ]);
});

test('resolveRows refuses a manifest shape it cannot read, each with its own sentence', () => {
  const cases = [
    [null, 'the manifest has no components[] array'],
    [{ components: [{ online: 'ship', paths: ['x'] }] }, 'a component row has no id'],
    [{ components: [{ id: 'r', online: 'ship', paths: [] }] }, 'row "r" lists no paths'],
    [
      { components: [{ id: 'r', online: 'ship', paths: ['/abs'] }] },
      'row "r" has a malformed path "/abs" (repo-relative, forward slashes, no ..)'
    ],
    [
      { components: [{ id: 'r', online: 'ship', paths: ['a/../b'] }] },
      'row "r" has a malformed path "a/../b" (repo-relative, forward slashes, no ..)'
    ],
    [
      { components: [{ id: 'r', online: 'ship', paths: ['a\\b'] }] },
      'row "r" has a malformed path "a\\\\b" (repo-relative, forward slashes, no ..)'
    ],
    [
      { components: [{ id: 'r', online: 'maybe', paths: ['x'] }] },
      'row "r" has no online value (found "maybe"); every row needs one of ship | drop | variant'
    ]
  ];
  for (const [m, msg] of cases) {
    const e = refusalOf(() => B.resolveRows(m));
    assert.ok(e instanceof B.Refusal, `refused: ${msg}`);
    assert.equal(e.message, msg);
  }
});

test('planTree returns files[] as {dst, src, blob, mode}; src is the absolute path under kitRoot the seed checker copies', () => {
  const kitRoot = path.join(os.tmpdir(), 'c3-kitroot');
  const claims = B.resolveRows({
    components: [
      { id: 'constitution', online: 'variant', paths: ['CLAUDE.md'] },
      { id: 'scripts', online: 'ship', paths: ['scripts/'] },
      { id: 'variants', online: 'drop', paths: ['variants/'] },
      { id: 'later', online: 'ship', paths: ['not-yet.md'] }
    ]
  });
  const entries = [
    { mode: '100644', sha: 'a'.repeat(40), path: 'CLAUDE.md' },
    { mode: '100644', sha: 'b'.repeat(40), path: 'variants/online/CLAUDE.md' },
    { mode: '100755', sha: 'c'.repeat(40), path: 'scripts/hooks/pre-commit' },
    { mode: '120000', sha: 'd'.repeat(40), path: 'scripts/link' }
  ];
  const plan = B.planTree(entries, claims, kitRoot);
  assert.deepEqual(plan.files, [
    {
      dst: 'scripts/hooks/pre-commit',
      src: path.join(kitRoot, 'scripts/hooks/pre-commit'),
      blob: 'c'.repeat(40),
      mode: '100755'
    },
    { dst: 'CLAUDE.md', src: path.join(kitRoot, 'variants/online/CLAUDE.md'), blob: 'b'.repeat(40), mode: '100644' }
  ]);
  assert.deepEqual(plan.counts, { ship: 1, drop: 0, variant: 1, links: 1 });
  assert.deepEqual(plan.reports, [
    'SKIP link scripts/link: this script never writes a link',
    'ABSENT ship path not-yet.md (row "later"): listed, not tracked here, nothing to ship'
  ]);
});

test('planTree with two arguments takes KIT as kitRoot, so src points at a real file of this tree', () => {
  const claims = B.resolveRows({ components: [{ id: 'scripts', online: 'ship', paths: ['scripts/'] }] });
  const plan = B.planTree([{ mode: '100644', sha: 'e'.repeat(40), path: 'scripts/build-online-template.mjs' }], claims);
  assert.equal(plan.files[0].src, BUILDER);
  assert.ok(fs.existsSync(plan.files[0].src));
});

test('planTree reports an absent variant and a variant whose Kit path exists but does not ship', () => {
  const claims = B.resolveRows({
    components: [
      { id: 'v', online: 'variant', paths: ['x.md', 'y.md'] },
      { id: 'rest', online: 'drop', paths: ['variants/'] }
    ]
  });
  const plan = B.planTree([{ mode: '100644', sha: 'f'.repeat(40), path: 'x.md' }], claims, '/k');
  assert.deepEqual(plan.files, []);
  assert.deepEqual(plan.reports, [
    'ABSENT variant variants/online/x.md (row "v"): nothing copied; the Kit has the path, and it is NOT shipped because the row is variant',
    'ABSENT variant variants/online/y.md (row "v"): nothing copied',
    'ABSENT drop path variants/ (row "rest"): listed, not tracked here, nothing to drop'
  ]);
});

test('trackedEntries(cwd, pathspec) is git ls-files -s as [{mode, sha, path}], forward slashes, index order', (t) => {
  const d = tmp(t, 'c3-exp-');
  git(d, 'init', '-q');
  fs.mkdirSync(path.join(d, 'a', 'b'), { recursive: true });
  fs.writeFileSync(path.join(d, 'a', 'b', 'c.txt'), 'c\n');
  fs.writeFileSync(path.join(d, 'z.sh'), '#!/bin/sh\n');
  git(d, 'add', '.');
  git(d, 'update-index', '--chmod=+x', 'z.sh');
  const sha = (rel) => git(d, 'rev-parse', `:${rel}`).trim();
  assert.deepEqual(B.trackedEntries(d), [
    { mode: '100644', sha: sha('a/b/c.txt'), path: 'a/b/c.txt' },
    { mode: '100755', sha: sha('z.sh'), path: 'z.sh' }
  ]);
  assert.deepEqual(
    B.trackedEntries(d, ['a/']).map((e) => e.path),
    ['a/b/c.txt']
  );
});

test('seedFiles returns starter/** and the two owner docs as {dst, src, mode 100644, seed true}, docs sorted', (t) => {
  const d = tmp(t, 'c3-seed-');
  fs.mkdirSync(path.join(d, 'starter', 'deep'), { recursive: true });
  fs.writeFileSync(path.join(d, 'starter', 'ABOUT-X.md'), 'x\n');
  fs.writeFileSync(path.join(d, 'starter', 'deep', 'profile.json'), '{}\n');
  for (const n of ['WHAT-ALEX-CAN-DO.md', 'HOW-SHARING-WORKS.md', 'INSTALL-X.md', 'notes.md'])
    fs.writeFileSync(path.join(d, n), n);
  const s = B.seedFiles(d);
  assert.deepEqual(s.docs, ['HOW-SHARING-WORKS.md', 'WHAT-ALEX-CAN-DO.md']);
  const byDst = Object.fromEntries(s.files.map((f) => [f.dst, f]));
  assert.deepEqual(Object.keys(byDst).sort(), [
    'HOW-SHARING-WORKS.md',
    'WHAT-ALEX-CAN-DO.md',
    'starter/ABOUT-X.md',
    'starter/deep/profile.json'
  ]);
  assert.deepEqual(byDst['starter/deep/profile.json'], {
    dst: 'starter/deep/profile.json',
    src: path.join(d, 'starter', 'deep', 'profile.json'),
    mode: '100644',
    seed: true
  });
  assert.deepEqual(byDst['HOW-SHARING-WORKS.md'], {
    dst: 'HOW-SHARING-WORKS.md',
    src: path.join(d, 'HOW-SHARING-WORKS.md'),
    mode: '100644',
    seed: true
  });
  // The docs come after the starter files.
  assert.deepEqual(
    s.files.slice(-2).map((f) => f.dst),
    ['HOW-SHARING-WORKS.md', 'WHAT-ALEX-CAN-DO.md']
  );
});

// ------------------------------------------------------------------ parseArgs
const defaultOut = (remote) =>
  path.resolve(
    path.join(
      os.tmpdir(),
      'virtual-alex-build',
      remote
        .trim()
        .replace(/\/+$/, '')
        .replace(/\.git$/, '')
        .replace(/[^A-Za-z0-9._-]+/g, '_')
    )
  );

test('parseArgs defaults: the generic remote, a per-remote build folder in the OS temp dir, no seed', () => {
  assert.deepEqual(B.parseArgs(['--check']), {
    check: true,
    push: false,
    remote: GENERIC,
    out: path.join(os.tmpdir(), 'virtual-alex-build', 'https_github.com_Alex-kit-S_virtual-alex'),
    seed: null,
    templateRemote: GENERIC
  });
  const a = B.parseArgs(['--push', '--remote', 'https://example.test/o/r.git/']);
  assert.equal(a.out, defaultOut('https://example.test/o/r.git/'));
  assert.equal(a.out, path.join(os.tmpdir(), 'virtual-alex-build', 'https_example.test_o_r'));
  assert.equal(a.templateRemote, 'https://example.test/o/r.git/', 'a template build names its own --remote, as typed');
});

test('parseArgs: --out and --seed are resolved; a seed names the GENERIC template, whatever its --remote', () => {
  const out = path.join(os.tmpdir(), 'c3-rel', '..', 'c3-out');
  const a = B.parseArgs(['--push', '--seed', 'rel/alex-zed', '--remote', 'https://github.com/o/seed', '--out', out]);
  assert.equal(a.seed, path.resolve('rel/alex-zed'));
  assert.equal(a.out, path.join(os.tmpdir(), 'c3-out'));
  assert.equal(a.templateRemote, GENERIC);
  assert.equal(
    B.parseArgs([
      '--push',
      '--seed',
      's',
      '--remote',
      'https://github.com/o/seed',
      '--template-remote',
      'https://github.com/o/t'
    ]).templateRemote,
    'https://github.com/o/t'
  );
});

test('parseArgs refusals, each exit 2 with its own sentence', () => {
  const cases = [
    [[], 'pick exactly one of --check or --push'],
    [['--check', '--push'], 'pick exactly one of --check or --push'],
    [['--check', '--bogus'], 'unknown argument --bogus'],
    [['--check', '--remote', ''], '--remote needs a url'],
    [['--check', '--remote'], '--remote needs a url'],
    [
      ['--push', '--seed', '/x/alex-y'],
      `--seed carries one person's material and never goes to the generic template ${GENERIC}; pass --remote <that person's seed repository>`
    ],
    [
      ['--push', '--seed', '/x/alex-y', '--remote', `${GENERIC}.git/`],
      `--seed carries one person's material and never goes to the generic template ${GENERIC}; pass --remote <that person's seed repository>`
    ],
    [['--check', '--out', ROOT], `--out ${ROOT} is inside the Kit; build outside it`],
    [
      ['--check', '--out', path.join(ROOT, 'sub', 'dir')],
      `--out ${path.join(ROOT, 'sub', 'dir')} is inside the Kit; build outside it`
    ]
  ];
  for (const [argv, msg] of cases) {
    const e = refusalOf(() => B.parseArgs(argv));
    assert.ok(e instanceof B.Refusal, `refused: ${argv.join(' ')}`);
    assert.equal(e.exitCode, 2);
    assert.equal(e.message, msg);
  }
});

test('PINNED DEFECT R3-2: the seed guard is a string comparison, so other spellings of the generic template are accepted for a seed', () => {
  for (const remote of [
    'https://github.com/alex-kit-s/virtual-alex',
    'git@github.com:Alex-kit-S/virtual-alex.git',
    'ssh://git@github.com/Alex-kit-S/virtual-alex.git'
  ]) {
    const a = B.parseArgs(['--push', '--seed', '/x/alex-y', '--remote', remote]);
    assert.equal(a.remote, remote, `ACCEPTED today: ${remote}`);
    assert.equal(a.seed, path.resolve('/x/alex-y'));
  }
});

test('PINNED DEFECT R3-7: a value flag as the last argument is silently dropped (--push --seed parses as a GENERIC push)', () => {
  const seedless = B.parseArgs(['--push', '--seed']);
  assert.equal(seedless.push, true);
  assert.equal(seedless.seed, undefined, 'the seed is undefined, not a refusal');
  assert.equal(seedless.remote, GENERIC);
  assert.equal(seedless.templateRemote, GENERIC);
  assert.equal(
    B.parseArgs(['--check', '--out']).out,
    defaultOut(GENERIC),
    'a missing --out value falls back to the default folder'
  );
  assert.equal(
    B.parseArgs(['--push', '--template-remote']).templateRemote,
    GENERIC,
    'a missing --template-remote value falls back to --remote'
  );
});

test('PINNED DEFECT R3-5: --template-remote is accepted unvalidated, and a generic build from an SSH --remote names that SSH string', () => {
  assert.equal(
    B.parseArgs(['--push', '--template-remote', 'git@github.com:o/r.git']).templateRemote,
    'git@github.com:o/r.git'
  );
  assert.equal(B.parseArgs(['--push', '--template-remote', 'not a url at all']).templateRemote, 'not a url at all');
  assert.equal(B.parseArgs(['--push', '--remote', 'git@github.com:o/r.git']).templateRemote, 'git@github.com:o/r.git');
});

test('PINNED DEFECT R3-1 (parse half): an --out at the folder that CONTAINS the Kit is accepted', () => {
  const parent = path.dirname(ROOT);
  assert.equal(B.parseArgs(['--check', '--out', parent]).out, parent);
});
