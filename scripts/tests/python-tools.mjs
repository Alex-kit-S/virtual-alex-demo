#!/usr/bin/env node
// scripts/tests/python-tools.mjs - the CI's Python tool step, run only on the Python files the ratchet enforces.
//
// WHAT. Runs the standard's three Python tools, ruff check, ruff format --check and mypy --strict, on
// exactly the Python files a finished wave has put under the ratchet, and on nothing else. That is what
// lets the tool step be green from the day it lands: with no file enforced it runs no tool and says so,
// and every file a wave finishes is held to the tools from then on.
//
// HOW. It reads the enforced list of scripts/tests/code-standard-ratchet.json through the JSON
// standard's reader and keeps the .py paths; a listed path that is not on disk is a failure. With none
// it prints that nothing is enforced and exits 0 without starting a tool. Otherwise it needs the
// standard's ruff.toml and mypy.ini at the repository root, because without them each tool runs on its
// own defaults, weaker than the standard, and would pass what the standard fails. Then it runs, on
// exactly those files, the pins docs/CODE-STANDARD.md section 9.1 names, each tool handed the tracked
// config by name, because ruff otherwise uses the closest ruff.toml or pyproject.toml to each file and a
// config a wave added deeper in the tree would replace the root one for its folder:
//   ruff 0.16.9 check --config ruff.toml --no-cache --output-format=github <files>
//   ruff 0.16.9 format --check --config ruff.toml --no-cache <files>
//   mypy 2.3.1 --config-file mypy.ini --cache-dir ../.mypy-cache <files>   (mypy.ini: strict and 3.10)
// through `pipx run`, the form the CI runner images carry, or `uvx --from` where pipx is absent, the
// standard's documented equivalent with the same pins. All three run even when one fails, so one CI step
// shows every finding, and each prints its own output.
//
// NEVER. Installs anything: pipx and uvx fetch the pinned tool into their own cache, outside the
// checkout. Runs a tool on a file the ratchet does not enforce. Writes into the checkout: ruff runs with
// --no-cache and mypy's cache goes one folder up. Passes when it could not check: a non-empty list with
// no pipx and no uvx, or with a config missing, is a failure. Accepts an argument.
//
// Usage: node scripts/tests/python-tools.mjs
// Exit: 0 every enforced Python file is clean, or none is enforced - 1 a tool found something, a tool, a
// runner, a config or an enforced file is missing, or an argument was given

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { RATCHET_REL, REPO, readRatchet } from './code-standard.mjs';

const RUFF = 'ruff==0.16.9';
const MYPY = 'mypy==2.3.1';
const RUFF_TOML = 'ruff.toml';
const MYPY_INI = 'mypy.ini';
const CONFIGS = [RUFF_TOML, MYPY_INI];
const MYPY_CACHE = path.join('..', '.mypy-cache');

const say = (line) => console.log(`python-tools: ${line}`);

/** The first tool runner on PATH, as a function from (pin, tool, args) to a command line, or null. */
function findRunner() {
  const answers = (cmd) => spawnSync(cmd, ['--version'], { encoding: 'utf8' }).status === 0;
  if (answers('pipx')) return { name: 'pipx run', line: (pin, _tool, args) => ['pipx', ['run', pin, ...args]] };
  if (answers('uvx')) return { name: 'uvx --from', line: (pin, tool, args) => ['uvx', ['--from', pin, tool, ...args]] };
  return null;
}

function main(argv) {
  if (argv.length) {
    console.error(
      `python-tools: REFUSED - it takes no argument (given: ${argv.join(' ')}); the ratchet decides the files`
    );
    return 1;
  }
  const files = (readRatchet().enforced || []).filter((p) => p.endsWith('.py'));
  if (!files.length) {
    say(`nothing to check: ${RATCHET_REL} enforces no Python file, so ruff and mypy did not run`);
    return 0;
  }
  const gone = files.filter((f) => !fs.existsSync(path.join(REPO, f)));
  if (gone.length) {
    console.error(
      `python-tools: FAIL - the ratchet enforces ${gone.join(', ')}, which this tree does not hold; fix the enforced list`
    );
    return 1;
  }
  const noConfig = CONFIGS.filter((c) => !fs.existsSync(path.join(REPO, c)));
  if (noConfig.length) {
    console.error(
      `python-tools: FAIL - missing ${noConfig.join(' and ')} at the repository root; without it a tool runs on its defaults and passes what the standard fails`
    );
    return 1;
  }
  const runner = findRunner();
  if (!runner) {
    console.error(
      'python-tools: FAIL - neither pipx nor uvx is on PATH, so the pinned tools cannot run; nothing was checked'
    );
    return 1;
  }
  say(`${files.length} enforced Python file(s), tools through ${runner.name}: ${files.join(', ')}`);
  const steps = [
    ['ruff check', RUFF, 'ruff', ['check', '--config', RUFF_TOML, '--no-cache', '--output-format=github', ...files]],
    ['ruff format --check', RUFF, 'ruff', ['format', '--check', '--config', RUFF_TOML, '--no-cache', ...files]],
    ['mypy', MYPY, 'mypy', ['--config-file', MYPY_INI, '--cache-dir', MYPY_CACHE, ...files]]
  ];
  const failed = [];
  for (const [label, pin, tool, args] of steps) {
    const [cmd, cmdArgs] = runner.line(pin, tool, args);
    const r = spawnSync(cmd, cmdArgs, { cwd: REPO, stdio: 'inherit' });
    const code = r.error ? `could not start (${r.error.message})` : `exit ${r.status}`;
    say(`${label} (${pin}) -> ${code}`);
    if (r.error || r.status !== 0) failed.push(`${label} ${code}`);
  }
  if (failed.length) {
    console.error(`python-tools: FAIL - ${failed.join('; ')}`);
    return 1;
  }
  say(`PASS - ${files.length} enforced Python file(s) clean under ruff check, ruff format --check and mypy`);
  return 0;
}

process.exitCode = main(process.argv.slice(2));
