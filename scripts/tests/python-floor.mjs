#!/usr/bin/env node
// scripts/tests/python-floor.mjs - the online CI's Python floor step: vault search run on the floor version.
//
// WHAT. Proves the product's Python still runs on the oldest interpreter an owner's machine may hand it:
// scripts/vault_search.py builds an index over a small vault and finds a page in it, on the version
// ruff.toml declares as its target. ruff holds the syntax half of that floor; this step is the runtime
// half, because a call to something newer than the floor parses cleanly and fails only when it runs.
// It is a behaviour check, not a ratchet: it always runs, and it has nothing to enforce.
//
// HOW. Reads the floor from ruff.toml's top-level target-version ("py39" is 3.9). Takes the interpreter
// at exactly that version: python on PATH, which in CI is the floor because the step before this one
// is actions/setup-python at that version; or, where python is another version, the one
// `uv python find <floor>` reports, which searches and installs nothing. Writes a two-page vault into a
// fresh temp folder, points vault_search.py at it, and at an index and a read log in the same folder,
// through ALEX_VAULT_DIR, ALEX_INDEX_DB and ALEX_READS_LOG, then runs build and one search and reads
// what they print: the build indexes both pages, and the search returns only the page that holds the
// query word, under its heading trail.
//
// NEVER. Writes into the checkout: the vault, the index and the read log live in the temp folder, which
// is removed before it returns, and Python writes no bytecode. Passes on an interpreter that is not the
// floor: with none found it fails and says it checked nothing. Accepts an argument.
//
// Usage: node scripts/tests/python-floor.mjs
// Exit: 0 build and search behaved on the floor interpreter - 1 they did not, the floor or its
// interpreter could not be found, or an argument was given

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { REPO } from './code-standard.mjs';

const RUFF_TOML = 'ruff.toml';
const VAULT_SEARCH = 'scripts/vault_search.py';
const QUERY = 'zebrafloor';
const PAGES = {
  'projects/floor.md': `# Floor check\n\nThis page proves the index builds on the floor.\n\n## Detail\n\nThe word ${QUERY} lives only here.\n`,
  'people/someone.md': '# Someone\n\nA page without the query word.\n'
};
const BUILT = /^indexed 2 files -> \d+ chunks in /m;
const FOUND = /^1\. .+\/projects\/floor\.md:\d+ {2}\[Floor check > Detail\]$/m;
const VERSION_PROBE = 'import sys; print("%d.%d.%d" % sys.version_info[:3])';

const say = (line) => console.log(`python-floor: ${line}`);

function fail(line) {
  console.error(`python-floor: FAIL - ${line}`);
  return 1;
}

/** The floor ruff.toml declares, as "3.9", or null when its top level names no target-version. */
function declaredFloor() {
  const file = path.join(REPO, RUFF_TOML);
  if (!fs.existsSync(file)) return null;
  const topLevel = fs.readFileSync(file, 'utf8').split(/^\[/m)[0];
  const m = /^target-version\s*=\s*"py3(\d+)"\s*$/m.exec(topLevel);
  return m ? `3.${m[1]}` : null;
}

/** The interpreter at exactly `floor` as {command, version}, or {tried} naming what was found instead. */
function floorInterpreter(floor) {
  const versionOf = (command) => {
    const r = spawnSync(command, ['-c', VERSION_PROBE], { encoding: 'utf8' });
    return r.status === 0 ? r.stdout.trim() : null;
  };
  const tried = [];
  const onPath = versionOf('python');
  if (onPath?.startsWith(`${floor}.`)) return { command: 'python', version: onPath };
  tried.push(`python is ${onPath ?? 'absent'}`);
  const found = spawnSync('uv', ['python', 'find', floor], { encoding: 'utf8' });
  const command = found.status === 0 ? found.stdout.trim() : '';
  const version = command ? versionOf(command) : null;
  if (version?.startsWith(`${floor}.`)) return { command, version };
  tried.push(found.error ? 'uv is absent' : `uv python find ${floor} found none`);
  return { tried };
}

/** Run vault_search.py with `args` against the temp folder: {ok, out}, out holding stdout then stderr. */
function vaultSearch(python, tmp, args) {
  const env = {
    ...process.env,
    ALEX_VAULT_DIR: path.join(tmp, 'vault'),
    ALEX_INDEX_DB: path.join(tmp, 'index', 'vault-search.db'),
    ALEX_READS_LOG: path.join(tmp, 'vault-reads.jsonl'),
    PYTHONDONTWRITEBYTECODE: '1'
  };
  const r = spawnSync(python, [VAULT_SEARCH, ...args], { cwd: REPO, env, encoding: 'utf8' });
  const out = `${r.stdout ?? ''}${r.stderr ?? ''}`.replace(/\r\n/g, '\n').trim();
  return { ok: !r.error && r.status === 0, out: r.error ? `could not start (${r.error.message})` : out };
}

function main(argv) {
  try {
    parseArgs({ args: argv, options: {}, strict: true, allowPositionals: false });
  } catch (e) {
    console.error(`python-floor: REFUSED - ${e.message}; it takes no argument, ${RUFF_TOML} names the floor`);
    return 1;
  }
  const floor = declaredFloor();
  if (!floor) return fail(`${RUFF_TOML} declares no top-level target-version, so there is no floor to run on`);
  const py = floorInterpreter(floor);
  if (!py.command) return fail(`no Python ${floor} to run on (${py.tried.join('; ')}); nothing was checked`);
  say(`Python ${py.version} (${py.command}), the floor ${RUFF_TOML} declares`);
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'python-floor-'));
  try {
    for (const [rel, text] of Object.entries(PAGES)) {
      const file = path.join(tmp, 'vault', rel);
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, text);
    }
    const build = vaultSearch(py.command, tmp, ['build']);
    if (!build.ok || !BUILT.test(build.out)) return fail(`build did not index the two pages:\n${build.out}`);
    say(`build: ${build.out.split('\n')[0]}`);
    const search = vaultSearch(py.command, tmp, ['search', QUERY]);
    const results = search.out.split('\n').filter((l) => /^\d+\. /.test(l));
    if (!search.ok || !FOUND.test(search.out) || results.length !== 1)
      return fail(`search ${QUERY} did not return the one page that holds it:\n${search.out}`);
    say(`search: ${results[0]}`);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
  say(`PASS - ${VAULT_SEARCH} builds and searches on Python ${py.version}`);
  return 0;
}

process.exitCode = main(process.argv.slice(2));
