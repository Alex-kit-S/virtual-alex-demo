#!/usr/bin/env node
// scripts/tests/js-tools.mjs - the CI's JavaScript tool step, run only on the files Biome's list enforces.
//
// WHAT. Runs the standard's two JavaScript tools, biome ci and tsc, on exactly the JavaScript files a
// finished wave has put under the ratchet, and on nothing else. That is what lets the tool step be green
// from the day it lands: with no file enforced it starts no tool, downloads nothing and says so, and
// every file a wave finishes is held to both tools from then on.
//
// HOW. The enforced JavaScript is Biome's own list, biome.json files.includes, as the checker resolves
// it: the checker's enforcedSet over its own scope, less the ratchet's own list, which holds the two
// migrations that never go to a formatter. A problem the checker finds with the enforced set is a
// failure here too. With no file it prints that nothing is enforced and exits 0 before it looks for
// npx. Otherwise it needs jsconfig.json at the repository root, and it refuses a biome.json or
// biome.jsonc in any folder between an enforced file and the root: Biome applies such a config to its
// folder whatever --config-path says, and one that excludes everything passes a finding unread. Then it
// runs the pins docs/CODE-STANDARD.md section 9.1 names, from the repository root, each tool handed the
// tracked config by name:
//   npx --yes @biomejs/biome@2.5.14 ci --error-on-warnings --config-path biome.json .
//   npm install --silent --no-audit --no-fund --prefix .. @types/node@22.16.5
//   npx --yes --package typescript@7.0.2 -- tsc -p <the generated config>
// Biome reads its own list, so `.` checks exactly the enforced files. tsc takes no file list beside -p,
// so the config it gets is written into a fresh folder inside the checkout's parent: it extends the
// tracked jsconfig.json, names exactly the enforced files and includes nothing else, so no config deeper
// in the tree is read, and tsc finds the Node types by walking up from it into the parent's
// node_modules. Both tools run even when the first fails, so one step shows every finding.
//
// NEVER. Writes into the checkout: the Node types and the generated config go one folder up, and the
// config's folder is removed before it returns. Runs a tool on a file Biome's list does not name, or
// under a config other than the tracked one. Passes when it could not check: with a non-empty list, a
// malformed enforced set, no jsconfig.json, a nested Biome config or no npx is a failure. Accepts an
// argument.
//
// Usage: node scripts/tests/js-tools.mjs
// Exit: 0 every enforced JavaScript file is clean, or none is enforced - 1 a tool found something, a
// tool, a config or an enforced file is missing, a nested config was found, or an argument was given

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { BIOME_REL, REPO, enforcedSet, loadScope, readRatchet } from './code-standard.mjs';

const BIOME = '@biomejs/biome@2.5.14';
const TYPESCRIPT = 'typescript@7.0.2';
const NODE_TYPES = '@types/node@22.16.5';
const JSCONFIG = 'jsconfig.json';
const BIOME_CONFIG_NAMES = ['biome.json', 'biome.jsonc'];
const WINDOWS = process.platform === 'win32';

const say = (line) => console.log(`js-tools: ${line}`);

function fail(line) {
  console.error(`js-tools: FAIL - ${line}`);
  return 1;
}

/**
 * Run npm or npx from the repository root: {ok, said}. On Windows both are .cmd shims, which Node starts
 * only through a shell; every argument here is a constant or a relative path with no space in it, so the
 * joined line needs no quoting.
 */
function npm(name, args, quiet = false) {
  const stdio = quiet ? 'ignore' : 'inherit';
  const r = WINDOWS
    ? spawnSync([name, ...args].join(' '), { cwd: REPO, stdio, shell: true })
    : spawnSync(name, args, { cwd: REPO, stdio });
  if (r.error) return { ok: false, said: `could not start (${r.error.message})` };
  return { ok: r.status === 0, said: `exit ${r.status}` };
}

/** Biome's list as the checker resolves it: {files} sorted, or {problems} the checker also refuses. */
async function enforcedJavaScript() {
  const scope = await loadScope(REPO);
  const ratchet = readRatchet(REPO);
  const { srcs, problems } = enforcedSet(scope, ratchet);
  if (problems.length) return { problems };
  const language = new Map(scope.files.map((f) => [f.src, f.lang]));
  const ratchetOwn = new Set(ratchet.enforced || []);
  return { files: [...srcs].filter((src) => language.get(src) === 'js' && !ratchetOwn.has(src)).sort() };
}

/** Every Biome config in a folder between an enforced file and the repository root. */
function nestedBiomeConfigs(files) {
  const found = new Set();
  for (const file of files) {
    for (let dir = path.posix.dirname(file); dir !== '.'; dir = path.posix.dirname(dir))
      for (const name of BIOME_CONFIG_NAMES) if (fs.existsSync(path.join(REPO, dir, name))) found.add(`${dir}/${name}`);
  }
  return [...found].sort();
}

/** tsc on exactly `files`, through a config generated one folder above the checkout: {ok, said}. */
function typeCheck(files) {
  const types = npm('npm', ['install', '--silent', '--no-audit', '--no-fund', '--prefix', '..', NODE_TYPES]);
  if (!types.ok) return { ok: false, said: `npm install ${NODE_TYPES} ${types.said}` };
  const dir = fs.mkdtempSync(path.join(path.dirname(REPO), '.js-tools-'));
  try {
    const config = path.join(dir, 'tsconfig.json');
    const absolute = (rel) => path.join(REPO, rel).split(path.sep).join('/');
    const text = JSON.stringify({ extends: absolute(JSCONFIG), files: files.map(absolute), include: [] }, null, 2);
    fs.writeFileSync(config, `${text}\n`);
    return npm('npx', ['--yes', '--package', TYPESCRIPT, '--', 'tsc', '-p', path.relative(REPO, config)]);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

async function main(argv) {
  try {
    parseArgs({ args: argv, options: {}, strict: true, allowPositionals: false });
  } catch (e) {
    console.error(`js-tools: REFUSED - ${e.message}; it takes no argument, Biome's list decides the files`);
    return 1;
  }
  const list = await enforcedJavaScript();
  if (list.problems) return fail(`the enforced set is malformed, so no tool ran: ${list.problems.join('; ')}`);
  const { files } = list;
  if (!files.length) {
    say(`nothing to check: ${BIOME_REL} files.includes enforces no JavaScript file, so Biome and tsc did not run`);
    return 0;
  }
  if (!fs.existsSync(path.join(REPO, JSCONFIG)))
    return fail(
      `missing ${JSCONFIG} at the repository root; without it tsc runs on its defaults and passes what the standard fails`
    );
  const nested = nestedBiomeConfigs(files);
  if (nested.length)
    return fail(
      `${nested.join(', ')} would replace ${BIOME_REL} for the enforced files beneath it; the standard has one Biome config`
    );
  if (!npm('npx', ['--version'], true).ok)
    return fail('npx is not on PATH, so Biome and tsc cannot run; nothing was checked');
  say(`${files.length} enforced JavaScript file(s): ${files.join(', ')}`);
  const failed = [];
  const biome = npm('npx', ['--yes', BIOME, 'ci', '--error-on-warnings', '--config-path', BIOME_REL, '.']);
  say(`biome ci (${BIOME}) -> ${biome.said}`);
  if (!biome.ok) failed.push(`biome ci ${biome.said}`);
  const tsc = typeCheck(files);
  say(`tsc (${TYPESCRIPT}, ${NODE_TYPES}) -> ${tsc.said}`);
  if (!tsc.ok) failed.push(`tsc ${tsc.said}`);
  if (failed.length) return fail(failed.join('; '));
  say(`PASS - ${files.length} enforced JavaScript file(s) clean under biome ci and tsc`);
  return 0;
}

process.exitCode = await main(process.argv.slice(2));
