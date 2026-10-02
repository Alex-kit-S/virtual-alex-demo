#!/usr/bin/env node
// scripts/tests/test-l2-surface.mjs - docs/L2.json, the frozen surface, and the test that its names still resolve.
//
// WHAT. docs/L2.json is the published list the standard's section 3.5 asks for: every file a caller the
// rewrite may not change reaches, with the export names those callers import and every caller row with
// its arguments and what it reads back (stdout lines, exit codes). Run as a test, this file proves each
// listed file is still at its path and each listed export name still resolves, in the module system its
// callers load it through. Deleted, a rewrite could rename install-state's stamp() or move a module the
// fleet imports with every test green, because the callers that break (the launchers, the old /update
// text, the fleet, a migration) are code no test in this list runs.
//
// HOW. Run with --write, it regenerates docs/L2.json from the caller census: one JSON row per call into
// a file, {callee, what, caller, line, args, reads_back}, in <folder>/*.jsonl. A caller is frozen when it
// is a hook (either settings file, or Claude Code itself), a Routine prompt, a command file, a launcher,
// a git hook, a CI workflow, a migration, a dynamic require(path.join(...)), a shell script's inline node
// program, or dropped Kit code: code the Kit tracks that the rewrite does not score, which is the online
// drop set plus the files --dropped names until the manifest drops them itself. A row reaches its callee
// when it runs it (cli, hook, git, env, exit code, ci) or imports from it (export, require, import, a
// named use); a mention (text, path, file, documented) does not. A callee is L2 when it is in the scope
// the code standard scores and a frozen caller reaches it; test files are left out, because a CI step
// reaching a test by path is already held by test-ci-parity.mjs, and the wiring files (the settings, the
// git hooks, the workflows) are left out because they are the frozen layer above L2. Export names are
// read from the row's `what`, each checked against the module before anything is written: a census row
// naming an export the module lacks refuses the write. The file goes through scripts/lib/json-writer.js.
//
// NEVER. Writes anything when it runs as a test. Imports a listed module into its own process: each
// probe is a separate node child in a temp folder, because an L2 file may be a CLI. Writes a census path,
// a machine path or a personal name into docs/L2.json: the census folder is an argument, never recorded.
// Accepts an unknown flag.
//
// Usage: node scripts/tests/test-l2-surface.mjs [--write --census <folder> [--dropped <file>]]
// Exit: 0 every name resolves, or docs/L2.json was written - 1 a name or a file is missing, a census row
// names an export the module lacks, or a flag was refused

import { after, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';
import { REPO, loadScope } from './code-standard.mjs';

const L2_REL = 'docs/L2.json';
const L2_SCHEMA = 'alex/l2-surface@1';
const L2_WRITER = 'scripts/tests/test-l2-surface.mjs';
const PROBE_TIMEOUT_MS = 30000;
const MIN_FILES = 20;
// Standard section 3.5 names these lib modules as L2 by caller and export; a regenerated list that lost
// one of them came from a census that lost its rows, and it must not pass.
const NAMED_BY_THE_STANDARD = {
  'scripts/lib/install-state.js': ['stamp'],
  'scripts/lib/json-writer.js': ['readJson', 'writeJson', 'jsonlRow'],
  'scripts/lib/write-lock.js': ['acquire'],
  'scripts/lib/radar-feeds.js': ['resolve'],
  'scripts/lib/skill-state.js': ['resolve'],
  'system/recall/lib/lessons.js': ['parseLLine'],
  'scripts/lib/build-soul-core.js': ['build']
};
const require = createRequire(import.meta.url);

// ------------------------------------------------------------------------------ classification

const WIRING =
  /^(?:variants\/online\/)?(?:\.claude\/settings\.json|scripts\/hooks\/pre-commit|\.github\/workflows\/[^/]+\.ya?ml)$/;
const RUNNABLE = /\.(?:js|mjs|cjs|py|sh|ps1|cmd|command)$|(?:^|\/)pre-commit$/;

/** The frozen class of a census row's caller, or null when the rewrite may change that caller. */
export function callerClass(row, { scope, tracked }) {
  const c = row.caller;
  if (c === 'Claude Code' || /^(?:variants\/online\/)?\.claude\/settings\.json$/.test(c)) return 'hook';
  if (/^(?:variants\/online\/)?scheduler\/routines\/[^/]+\.md$/.test(c)) return 'routine';
  if (/^(?:variants\/online\/)?\.claude\/commands\/[^/]+\.md$/.test(c)) return 'command';
  if (/^(?:Install-Alex|Update-Alex|Start-Here)\.(?:cmd|command)$/.test(c)) return 'launcher';
  if (/^(?:variants\/online\/)?scripts\/hooks\/pre-commit$/.test(c)) return 'git-hook';
  if (/^(?:variants\/online\/)?\.github\/workflows\/[^/]+\.ya?ml$/.test(c)) return 'ci';
  if (/^scripts\/migrations\/[^/]+\.js$/.test(c)) return 'migration';
  if (/require\(\s*path\.(?:join|resolve)\(/.test(String(row.args))) return 'dynamic-require';
  if (RUNNABLE.test(c) && tracked.has(c) && !scope.has(c) && !c.startsWith('.agents/')) return 'dropped';
  if (scope.has(c) && /\.sh$/.test(c) && reachOf(row.what) === 'import') return 'heredoc';
  return null;
}

/** execute, import, or null for a mention. */
export function reachOf(what) {
  if (/^(?:cli|hook|git |env|exit code|ci)\b/.test(what)) return 'execute';
  if (/^(?:export|require|import)\b/.test(what) || /\(use\)$/.test(what)) return 'import';
  return null;
}

/** The export names a row's `what` states: "export a, b", "require a + b", "readJson (use)". */
export function namesOf(what) {
  const body = /\(use\)$/.test(what) ? what.replace(/\(use\)$/, '') : what.replace(/^(?:export|require|import)\b/, '');
  return body
    .split(/[,+/]/)
    .map((part) => part.replace(/\(.*$/, '').trim())
    .filter((name) => /^[A-Za-z_$][\w$]*$/.test(name));
}

const saidView = (row) =>
  /^require\b/.test(row.what) || /\brequire\b|createRequire/.test(String(row.args))
    ? 'require'
    : /^import\b/.test(row.what) || /\bimport\b/.test(String(row.args))
      ? 'import'
      : null;

/**
 * The module system a caller loads a module through. An ES module is always imported. Otherwise the
 * row says so, or another row from the same caller into the same module does, which is how a named use
 * is traced to the createRequire() or the import that bound it. Failing both it is require: the Kit's
 * ES modules reach CommonJS through createRequire, and require is the module's own surface, where an
 * import sees only the names Node's static scan of the file can find.
 */
export function viewOf(row, callee, siblings = []) {
  if (callee.endsWith('.mjs')) return 'import';
  return saidView(row) ?? siblings.map(saidView).find(Boolean) ?? 'require';
}

/** The L2 files, sorted, from census rows: [{path, exports: [{name, views}], callers: [...]}]. */
export function surfaceOf(rows, { scope, tracked }) {
  const byPath = new Map();
  const pairs = new Map();
  for (const row of rows) {
    const key = `${row.caller}\u0000${row.callee}`;
    (pairs.get(key) || pairs.set(key, []).get(key)).push(row);
  }
  for (const row of rows) {
    if (!scope.has(row.callee) || row.callee.startsWith('scripts/tests/') || WIRING.test(row.callee)) continue;
    const reach = reachOf(row.what);
    const cls = reach && callerClass(row, { scope, tracked });
    if (!cls) continue;
    const entry = byPath.get(row.callee) || { path: row.callee, names: new Map(), callers: [] };
    byPath.set(row.callee, entry);
    entry.callers.push({
      args: String(row.args),
      caller: row.caller,
      census_row: row.census_row,
      class: cls,
      line: row.line,
      reach,
      reads_back: String(row.reads_back),
      what: row.what
    });
    if (reach === 'import') {
      for (const name of namesOf(row.what)) {
        const views = entry.names.get(name) || new Set();
        views.add(viewOf(row, row.callee, pairs.get(`${row.caller}\u0000${row.callee}`)));
        entry.names.set(name, views);
      }
    }
  }
  return [...byPath.values()]
    .sort((a, b) => (a.path < b.path ? -1 : 1))
    .map((e) => ({
      callers: e.callers,
      exports: [...e.names]
        .sort(([a], [b]) => (a < b ? -1 : 1))
        .map(([name, views]) => ({ name, views: [...views].sort() })),
      path: e.path
    }));
}

// ------------------------------------------------------------------------------------ the probe

/** The names a module exports in one view, from a node child run in `cwd`; throws when it cannot load. */
export function exportNames(file, view, cwd) {
  const code =
    view === 'import'
      ? `import(${JSON.stringify(pathToFileURL(file).href)}).then((m) => process.stdout.write(JSON.stringify(Object.keys(m))))`
      : `process.stdout.write(JSON.stringify(Object.keys(require(${JSON.stringify(file)}))))`;
  const r = spawnSync(process.execPath, ['-e', code], { cwd, encoding: 'utf8', timeout: PROBE_TIMEOUT_MS });
  if (r.error) throw r.error;
  if (r.status !== 0)
    throw new Error(
      `${file} did not load as ${view} (exit ${r.status}): ${String(r.stderr).trim().split('\n').slice(-3).join(' ')}`
    );
  return new Set(JSON.parse(r.stdout));
}

/** "path: name (view)" for every listed export the module does not carry in the view its callers use. */
export function missingExports(root, files, cwd) {
  const missing = [];
  for (const f of files) {
    const want = new Map();
    for (const e of f.exports) for (const v of e.views) (want.get(v) || want.set(v, []).get(v)).push(e.name);
    for (const [view, names] of want) {
      let have;
      try {
        have = exportNames(path.join(root, f.path), view, cwd);
      } catch (e) {
        missing.push(`${f.path}: ${e.message}`);
        continue;
      }
      for (const n of names) if (!have.has(n)) missing.push(`${f.path}: ${n} (${view})`);
    }
  }
  return missing;
}

// -------------------------------------------------------------------------------- regeneration

function readCensus(folder) {
  const rows = [];
  const hash = createHash('sha256');
  for (const name of fs
    .readdirSync(folder)
    .filter((n) => n.endsWith('.jsonl'))
    .sort()) {
    const text = fs.readFileSync(path.join(folder, name), 'utf8');
    hash.update(`${name}\n${text}`);
    text.split('\n').forEach((line, k) => {
      if (!line.trim()) return;
      const row = JSON.parse(line);
      row.census_row = `${name.replace(/\.jsonl$/, '')}:${k + 1}`;
      rows.push(row);
    });
  }
  return { rows, sha256: hash.digest('hex') };
}

async function write(values) {
  const { writeJson, readJson } = require(path.join(REPO, 'scripts', 'lib', 'json-writer.js'));
  const scopeInfo = await loadScope(REPO);
  if (!scopeInfo.isKit)
    return refuse('the census describes the Kit; regenerate docs/L2.json in the Kit, not in a generated tree');
  const existing = fs.existsSync(path.join(REPO, L2_REL)) ? readJson(path.join(REPO, L2_REL), L2_SCHEMA) : null;
  const dropped = values.dropped
    ? fs
        .readFileSync(values.dropped, 'utf8')
        .split('\n')
        .map((l) => l.replace(/#.*/, '').trim())
        .filter(Boolean)
    : existing
      ? existing.dropped_by_plan
      : [];
  const scope = new Set(scopeInfo.files.map((f) => f.src).filter((p) => !dropped.includes(p)));
  const { rows, sha256 } = readCensus(values.census);
  const files = surfaceOf(rows, { scope, tracked: scopeInfo.tracked });
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'alex-l2-probe-'));
  try {
    const missing = missingExports(REPO, files, cwd);
    if (missing.length)
      return refuse(
        `the census names ${missing.length} export(s) the modules do not carry:\n  ${missing.join('\n  ')}`
      );
  } finally {
    fs.rmSync(cwd, { recursive: true, force: true });
  }
  const data = {
    census: { rows: rows.length, sha256 },
    dropped_by_plan: [...dropped].sort(),
    files,
    rule: "A file is L2 when a caller the rewrite may not change reaches it by running it or importing from it: a hook, a Routine prompt, a command file, a launcher, a git hook, a CI workflow, a migration, a dynamic require, a shell script's inline node program, or dropped Kit code. Tests and the wiring files themselves are not listed. Its path, the listed export names, the arguments and the output its callers read back are frozen."
  };
  const r = writeJson(path.join(REPO, L2_REL), data, {
    purpose:
      'The L2 surface of docs/CODE-STANDARD.md section 3.5: every file a frozen caller reaches, its frozen export names, and each caller with the arguments it passes and what it reads back.',
    writer: L2_WRITER,
    schema: L2_SCHEMA
  });
  const names = files.reduce((n, f) => n + f.exports.length, 0);
  const callers = files.reduce((n, f) => n + f.callers.length, 0);
  console.log(
    `test-l2-surface: ${L2_REL} ${r.written ? r.reason : 'unchanged'}: ${files.length} files, ${names} export names, ${callers} caller rows from ${rows.length} census rows`
  );
  return 0;
}

function refuse(message) {
  console.error(`test-l2-surface: REFUSED - ${message}`);
  return 1;
}

// ------------------------------------------------------------------------------------- the test

function checker() {
  const { readJson } = require(path.join(REPO, 'scripts', 'lib', 'json-writer.js'));
  const TMP = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'alex-l2-')));
  after(() => fs.rmSync(TMP, { recursive: true, force: true }));
  const l2 = readJson(path.join(REPO, L2_REL), L2_SCHEMA);

  describe('the classifier', () => {
    const ctx = {
      scope: new Set(['scripts/a.js', 'scripts/b.sh', 'scripts/lib/m.js']),
      tracked: new Set(['scripts/a.js', 'scripts/b.sh', 'scripts/lib/m.js', 'scripts/run-job.mjs'])
    };
    test('a frozen caller is a hook, a prompt, a launcher, a gate, a workflow, a migration or dropped code; an in-scope caller is not', () => {
      const cls = (caller, what = 'cli', args = '') => callerClass({ caller, what, args }, ctx);
      assert.equal(cls('variants/online/.claude/settings.json'), 'hook');
      assert.equal(cls('scheduler/routines/brief.md'), 'routine');
      assert.equal(cls('.claude/commands/update.md'), 'command');
      assert.equal(cls('Update-Alex.command'), 'launcher');
      assert.equal(cls('scripts/hooks/pre-commit'), 'git-hook');
      assert.equal(cls('.github/workflows/ci.yml'), 'ci');
      assert.equal(cls('scripts/migrations/001-x.js'), 'migration');
      assert.equal(cls('scripts/run-job.mjs'), 'dropped');
      assert.equal(cls('scripts/b.sh', 'require canonicalText'), 'heredoc');
      assert.equal(cls('scripts/b.sh', 'cli'), null);
      assert.equal(cls('scripts/a.js', 'require x'), null);
      assert.equal(cls('docs/GETTING-STARTED.md'), null);
    });
    test('names come from the row, a whole-module import freezes none, and a mention reaches nothing', () => {
      assert.deepEqual(namesOf('export build({log})'), ['build']);
      assert.deepEqual(namesOf('export planTree + trackedEntries + resolveRows'), [
        'planTree',
        'trackedEntries',
        'resolveRows'
      ]);
      assert.deepEqual(namesOf('HEADER_KEYS / SNAKE_CASE / JsonWriterError (use)'), [
        'HEADER_KEYS',
        'SNAKE_CASE',
        'JsonWriterError'
      ]);
      assert.deepEqual(namesOf('export Refusal + text [donor-name] <file>:<line>'), ['Refusal']);
      assert.deepEqual(namesOf('export (whole module)'), []);
      assert.equal(reachOf('text (comment)'), null);
      assert.equal(reachOf('cli --staged'), 'execute');
      const files = surfaceOf(
        [
          {
            callee: 'scripts/lib/m.js',
            what: 'export stamp (node -e)',
            caller: '.claude/commands/update.md',
            line: 1,
            args: 'node -e "require(\'./scripts/lib/m.js\').stamp()"',
            reads_back: 'exit code',
            census_row: 'R0:1'
          },
          {
            callee: 'scripts/lib/m.js',
            what: 'require read',
            caller: 'scripts/a.js',
            line: 2,
            args: '',
            reads_back: '',
            census_row: 'R0:2'
          },
          {
            callee: 'scripts/a.js',
            what: 'text (comment)',
            caller: 'scheduler/routines/brief.md',
            line: 3,
            args: '',
            reads_back: '',
            census_row: 'R0:3'
          }
        ],
        ctx
      );
      assert.deepEqual(
        files.map((f) => [f.path, f.exports]),
        [['scripts/lib/m.js', [{ name: 'stamp', views: ['require'] }]]]
      );
    });
  });

  describe('the probe', () => {
    test('refuses a listed name a module does not carry, in either module system, and passes one it does', () => {
      fs.writeFileSync(
        path.join(TMP, 'm.js'),
        "'use strict';\nfunction stamp() {}\nfunction read() {}\nmodule.exports = { stamp, read };\n"
      );
      fs.writeFileSync(path.join(TMP, 'e.mjs'), 'export const KIT = 1;\n');
      const files = [
        {
          path: 'm.js',
          exports: [
            { name: 'stamp', views: ['import', 'require'] },
            { name: 'gone', views: ['require'] }
          ]
        },
        {
          path: 'e.mjs',
          exports: [
            { name: 'KIT', views: ['import'] },
            { name: 'DEFAULT_REMOTE', views: ['import'] }
          ]
        }
      ];
      assert.deepEqual(missingExports(TMP, files, TMP), ['m.js: gone (require)', 'e.mjs: DEFAULT_REMOTE (import)']);
    });
  });

  describe(L2_REL, () => {
    test('it lists at least the modules the standard names, with the names it names', () => {
      console.log(
        `test-l2-surface: ${l2.files.length} files, ${l2.files.reduce((n, f) => n + f.exports.length, 0)} export names, ${l2.files.reduce((n, f) => n + f.callers.length, 0)} caller rows`
      );
      assert.ok(
        l2.files.length >= MIN_FILES,
        `${l2.files.length} files; a list that lost its census would pass everything`
      );
      for (const [file, names] of Object.entries(NAMED_BY_THE_STANDARD)) {
        const f = l2.files.find((x) => x.path === file);
        assert.ok(f, `${file} is not listed`);
        for (const n of names)
          assert.ok(
            f.exports.some((e) => e.name === n),
            `${file}: ${n} is not listed`
          );
      }
    });
    test('every listed file is still at its path', () => {
      assert.deepEqual(
        l2.files.map((f) => f.path).filter((p) => !fs.existsSync(path.join(REPO, p))),
        []
      );
    });
    test('every listed export name resolves in the module system its callers load it through', () => {
      assert.deepEqual(missingExports(REPO, l2.files, TMP), []);
    });
  });
}

const argv = process.argv.slice(2);
if (argv.length) {
  let values;
  try {
    ({ values } = parseArgs({
      args: argv,
      options: { write: { type: 'boolean' }, census: { type: 'string' }, dropped: { type: 'string' } },
      strict: true,
      allowPositionals: false
    }));
  } catch (e) {
    values = null;
    process.exitCode = refuse(e.message);
  }
  if (values && (!values.write || !values.census))
    process.exitCode = refuse('--write --census <folder> is the one operator mode');
  else if (values) process.exitCode = await write(values);
} else {
  checker();
}
