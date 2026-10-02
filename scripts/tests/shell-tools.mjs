#!/usr/bin/env node
// scripts/tests/shell-tools.mjs - the online CI's shell lint step, run only on the shell files the ratchet enforces.
//
// WHAT. Runs shellcheck on exactly the shell scripts a finished wave has put under the ratchet, and on
// nothing else. With no script enforced it starts no tool and says so, which is what lets the step be
// green from the day it lands; every script a wave finishes is held to shellcheck from then on. It is a
// step of the online list only: the Ubuntu runner image carries shellcheck, the two Kit jobs exist to
// prove PowerShell, the launchers and the link layer, and shell lint gives one answer on every platform.
//
// HOW. Reads the enforced list of scripts/tests/code-standard-ratchet.json through the checker's reader
// and keeps the entries the checker scores as shell: a .sh file, or the pre-commit hook. An entry under
// variants/online/ is the online tree's own copy of a file: in the Kit it is read where it sits, and in a
// generated tree, which has no variants/ folder, at the path it ships to. An entry found at neither is a
// failure. With none it prints that nothing is enforced and exits 0 before it looks for shellcheck.
// Otherwise it runs shellcheck --norc on exactly those files, from the repository root: the shellcheck
// on PATH, or where there is none, the pinned package shellcheck-py 0.9.0.6 through uvx, which is
// shellcheck 0.9.0, the version the Ubuntu runner image carries. --norc because shellcheck otherwise
// reads a .shellcheckrc from each script's folder upward, and one a wave added beside a script could
// switch its checks off; the tree tracks none, so the defaults are the standard.
//
// NEVER. Installs into the checkout or the system: uvx keeps its pinned package in its own cache.
// Runs shellcheck on a file the ratchet does not enforce, or under an rc file. Writes into the checkout.
// Passes when it could not check: with a non-empty list, a listed file missing, or no shellcheck and no
// uvx, is a failure. Accepts an argument.
//
// Usage: node scripts/tests/shell-tools.mjs
// Exit: 0 every enforced shell file is clean, or none is enforced - 1 shellcheck found something, a
// runner or an enforced file is missing, or an argument was given

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { KIT_ONLY_PREFIX, RATCHET_REL, REPO, VARIANT_PREFIX, languageOf, readRatchet } from './code-standard.mjs';

const SHELLCHECK_PY = 'shellcheck-py==0.9.0.6';
const NO_RC = '--norc';

const say = (line) => console.log(`shell-tools: ${line}`);

function fail(line) {
  console.error(`shell-tools: FAIL - ${line}`);
  return 1;
}

const isFile = (rel) => fs.statSync(path.join(REPO, rel), { throwIfNoEntry: false })?.isFile() ?? false;

/**
 * Where an enforced entry sits in this tree, or null. A variant entry is read at the path it ships to
 * only in a generated tree, which has no variants/ folder; in the Kit it must be where it is named. A
 * kit: entry names the Kit's own file, shadowed everywhere else by its online replacement at the bare
 * path, so it is read at the path under the prefix in every tree that has one.
 */
function located(entry) {
  if (isFile(entry)) return entry;
  if (entry.startsWith(KIT_ONLY_PREFIX) && isFile(entry.slice(KIT_ONLY_PREFIX.length)))
    return entry.slice(KIT_ONLY_PREFIX.length);
  const generated = !fs.existsSync(path.join(REPO, VARIANT_PREFIX));
  if (generated && entry.startsWith(VARIANT_PREFIX) && isFile(entry.slice(VARIANT_PREFIX.length)))
    return entry.slice(VARIANT_PREFIX.length);
  return null;
}

/** The first shellcheck this machine can run, as a function from files to a command line, or null. */
function findShellcheck() {
  const answers = (cmd) => spawnSync(cmd, ['--version'], { encoding: 'utf8' }).status === 0;
  if (answers('shellcheck')) return { name: 'shellcheck on PATH', line: (files) => ['shellcheck', [NO_RC, ...files]] };
  if (answers('uvx'))
    return {
      name: `uvx --from ${SHELLCHECK_PY}`,
      line: (files) => ['uvx', ['--from', SHELLCHECK_PY, 'shellcheck', NO_RC, ...files]]
    };
  return null;
}

function main(argv) {
  try {
    parseArgs({ args: argv, options: {}, strict: true, allowPositionals: false });
  } catch (e) {
    console.error(`shell-tools: REFUSED - ${e.message}; it takes no argument, the ratchet decides the files`);
    return 1;
  }
  const entries = (readRatchet().enforced || []).filter((p) => {
    const shipped = p.startsWith(VARIANT_PREFIX)
      ? p.slice(VARIANT_PREFIX.length)
      : p.startsWith(KIT_ONLY_PREFIX)
        ? p.slice(KIT_ONLY_PREFIX.length)
        : p;
    return languageOf(shipped) === 'shell';
  });
  if (!entries.length) {
    say(`nothing to check: ${RATCHET_REL} enforces no shell file, so shellcheck did not run`);
    return 0;
  }
  const gone = entries.filter((p) => !located(p));
  if (gone.length)
    return fail(`the ratchet enforces ${gone.join(', ')}, which this tree does not hold; fix the enforced list`);
  const files = entries.map(located);
  const runner = findShellcheck();
  if (!runner) return fail('neither shellcheck nor uvx is on PATH, so shellcheck cannot run; nothing was checked');
  say(`${files.length} enforced shell file(s), shellcheck through ${runner.name}: ${files.join(', ')}`);
  const [cmd, args] = runner.line(files);
  const r = spawnSync(cmd, args, { cwd: REPO, stdio: 'inherit' });
  const said = r.error ? `could not start (${r.error.message})` : `exit ${r.status}`;
  say(`shellcheck -> ${said}`);
  if (r.error || r.status !== 0) return fail(`shellcheck ${said}`);
  say(`PASS - ${files.length} enforced shell file(s) clean under shellcheck`);
  return 0;
}

process.exitCode = main(process.argv.slice(2));
