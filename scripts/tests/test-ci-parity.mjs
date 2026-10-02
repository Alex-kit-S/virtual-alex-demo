#!/usr/bin/env node
// scripts/tests/test-ci-parity.mjs - the CI step lists cannot drift apart without saying why.
//
// WHAT. This Kit carries THREE CI step lists: the Kit's Windows job and macOS job in
// .github/workflows/ci.yml, and the online template's Ubuntu job in
// variants/online/.github/workflows/ci.yml, which the generator lands at .github/workflows/ci.yml in
// the template. Nothing else compares them, and the three can drift apart silently: a step one list
// runs and another does not, or a test file no list runs at all, so a test written for the tree it
// ships into could silently never run there.
//
// THE RULE, two legs:
//   P  PARITY. A step present in one list and absent from another fails, unless an exemption below
//      names that list, that step and a reason. A step is identified by what it RUNS (the command
//      of a one-line `run:`, the action of a `uses:` together with its `with:` inputs), never by its
//      display name, because the same test carries different names in different jobs. The inputs are
//      part of a `uses:` step's identity because they are what the step does: two lists that both run
//      setup-node on different Node versions test different floors, and with the action alone that
//      difference was invisible.
//   O  ORPHANS. Every test file in scripts/tests/ must be run by at least one list, or be named
//      below with a reason. A test nothing runs is indistinguishable from a passing one.
//   Stale exemptions fail too: one naming a step that list now runs, or a step no list runs any
//   more. An exemption that outlives its reason is how a list goes back to drifting.
//
// IN WHICH TREE. In the Kit, all three lists exist and both legs run. In a generated template only
// the online list exists (variants/ is a drop row), so leg P has nothing to compare and says so, and
// leg O runs against the one list the template CI actually has. Honest in the tree it ships into.
//
// HOW. Reads and parses the three YAML lists as text; no workflow runs. parseJobs, stepId and
// checkParity are exported pure functions with no test file of their own: the S section below proves
// them against synthetic fixtures (every refusal shown before the pass), and R and G prove them against
// the real tree. There is no product file to mutate that is not this one, so the mutation proof for this
// file plants a change directly in these functions and shows the S section catching it.
//
// NEVER. It never edits a workflow. It reads.
//
// Usage: node scripts/tests/test-ci-parity.mjs
// Exit: 0 all pass - 1 any failure

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const KIT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

// Why a step is absent from a list. `list` is kit-windows, kit-macos or online; `step` is the
// identity printed by a failure (copy it from there).
export const EXEMPT = [
  {
    list: 'kit-macos',
    step: 'run .\\scripts\\tests\\test-soul-canary.ps1',
    reason:
      'Windows PowerShell 5.1 test of a .ps1 library the Windows installs run; the macOS runner has no Windows PowerShell and macOS installs run the node wrappers instead'
  },
  {
    list: 'online',
    step: 'run .\\scripts\\tests\\test-soul-canary.ps1',
    reason:
      'the .ps1 files are drop rows in system/kit-manifest.json, so the test and the library it tests are absent from the online tree'
  },
  {
    list: 'kit-macos',
    step: 'run .\\scripts\\tests\\test-completion-sentinel.ps1',
    reason:
      'Windows PowerShell 5.1 test of scripts/lib/close-out.ps1; the macOS runner has no Windows PowerShell and macOS installs close out through run-job.mjs'
  },
  {
    list: 'online',
    step: 'run .\\scripts\\tests\\test-completion-sentinel.ps1',
    reason:
      'the .ps1 files are drop rows in system/kit-manifest.json, so the test and scripts/lib/close-out.ps1 are absent from the online tree'
  },
  {
    list: 'kit-windows',
    step: 'block Doctor runs on darwin (exit 0/2 are both healthy verdicts; 1 is a script error)',
    reason:
      'a darwin smoke of bootstrap.mjs on a bare runner, the only Mac rig this project has; Windows installs run the same doctor logic through test-doctor-honesty, which every list runs'
  },
  {
    list: 'online',
    step: 'block Doctor runs on darwin (exit 0/2 are both healthy verdicts; 1 is a script error)',
    reason:
      'a darwin smoke; online there is no Mac and nothing is installed, and test-doctor-honesty covers the doctor logic in this list'
  },
  {
    list: 'kit-windows',
    step: 'block Launcher syntax (bash -n on every .command)',
    reason: '.command launchers are macOS files; Windows installs use the .cmd twins'
  },
  {
    list: 'online',
    step: 'block Launcher syntax (bash -n on every .command)',
    reason: 'the launchers are drop rows online: nothing is installed or started locally'
  },
  {
    list: 'kit-windows',
    step: 'block Generate + plutil-lint every launchd plist (real lint, darwin only has plutil)',
    reason: 'plutil exists only on darwin; the plist shape itself is tested in every list by test-gen-launchd'
  },
  {
    list: 'online',
    step: 'block Generate + plutil-lint every launchd plist (real lint, darwin only has plutil)',
    reason: 'online there is no launchd: the five Routines are the scheduler'
  },
  {
    list: 'online',
    step: 'run node scripts/tests/test-seed-contract.mjs',
    reason:
      'the seed contract checker is fleet tooling for the operator and is a drop row in system/kit-manifest.json, so the test and the script it tests are absent from the online tree'
  },
  {
    list: 'online',
    step: 'run node scripts/tests/test-new-virtual-alex.mjs',
    reason:
      'the fleet script is operator tooling and is a drop row in system/kit-manifest.json, so the test and the script it tests are absent from the online tree'
  },
  {
    list: 'online',
    step: 'run node scripts/clone-scrub-check.js',
    reason:
      'the donor-identity scan hunts the Kit author, so its patterns are that identity and it is a drop row (donor-scrub) in system/kit-manifest.json; scripts/build-online-template.mjs runs it over every generated tree before --check reports or --push commits'
  },
  {
    list: 'online',
    step: 'run node scripts/tests/test-clone-scrub-scope.mjs',
    reason:
      'the test of the donor-identity scan, including its build-time legs; it sits in the same drop row as the scanner, so it and the script it tests are absent from the online tree'
  },
  {
    list: 'kit-windows',
    step: 'run node scripts/tests/shell-tools.mjs',
    reason:
      'shell lint gives one answer on every platform, and shellcheck ships on the Ubuntu runner image only; the online list runs it, and this job exists to prove PowerShell and the Windows installs'
  },
  {
    list: 'kit-macos',
    step: 'run node scripts/tests/shell-tools.mjs',
    reason:
      'shell lint gives one answer on every platform, and shellcheck ships on the Ubuntu runner image only; the online list runs it, and this job exists to prove the launchers and the link layer on darwin'
  },
  {
    list: 'kit-windows',
    step: 'run node scripts/tests/python-floor.mjs',
    reason:
      'the floor is a property of the interpreter version, not the platform, so one list proves it: the online list runs it last on Ubuntu, and the second setup-python it needs would change python for every later step of this job'
  },
  {
    list: 'kit-macos',
    step: 'run node scripts/tests/python-floor.mjs',
    reason:
      'actions/python-versions has no Python 3.9 build for darwin arm64, which macos-latest is, so this job cannot run the floor; the online list runs it last on Ubuntu'
  },
  {
    list: 'kit-windows',
    step: 'uses actions/setup-python@v6 with python-version=3.9',
    reason:
      "the Python floor step's interpreter: the online list switches to 3.9 last, for the floor step alone, and this job runs neither"
  },
  {
    list: 'kit-macos',
    step: 'uses actions/setup-python@v6 with python-version=3.9',
    reason:
      "the Python floor step's interpreter: actions/python-versions has no 3.9 build for darwin arm64, and this job runs no floor step"
  },
  {
    list: 'online',
    step: 'run node scripts/tests/test-validate-harvest-contract.mjs',
    reason:
      'it runs the recall harvester h-validators.js, which is a drop row (laptop-only) in system/kit-manifest.json, so the test and the harvester are absent from the online tree'
  },
  {
    list: 'online',
    step: 'run python scripts/tests/test_vault_search_recall_reader.py',
    reason:
      'it reads and runs the query of system/recall/recall-inject.js, which is a drop row (laptop-only) in system/kit-manifest.json, so the test and the reader are absent from the online tree; test_vault_search_index_contract.py holds the index schema here'
  },
  {
    list: 'online',
    step: 'run node scripts/tests/test-stale-status-check.mjs',
    reason:
      'scripts/stale-status-check.js is a drop row (laptop-only) in system/kit-manifest.json: the baseline it compares against is written by check.ps1 -Init, which a cloud session never runs, so the test and the script are absent from the online tree'
  },
  {
    list: 'online',
    step: 'run node scripts/tests/test-recall-laptop-closure.mjs',
    reason:
      "the recall spine's laptop half: every test in it reads a recall file that is a drop row (laptop-only) in system/kit-manifest.json, so the test is absent from the online tree; test-recall-online-closure.mjs holds the drop from the online side"
  },
  {
    list: 'online',
    step: 'run node scripts/tests/test-recall-harvest.mjs',
    reason:
      'the recall harvester and its six harvesters are drop rows (laptop-only) in system/kit-manifest.json: online there is no facts.db and no harvester is scheduled, so the test and the code it tests are absent from the online tree'
  },
  {
    list: 'online',
    step: 'run node scripts/tests/test-lesson-harvest-inject.mjs',
    reason:
      'scripts/lesson-harvest.js and system/recall/recall-inject.js are drop rows (laptop-only) in system/kit-manifest.json: online there is no recall hook and the L-line goes to a committed lessons file instead, so the test and the code it tests are absent from the online tree'
  },
  {
    list: 'online',
    step: 'run node scripts/tests/test-facts-check-c21.mjs',
    reason:
      'scripts/facts-check.js (recovery check C21) is a drop row (laptop-only) in system/kit-manifest.json: it tests documents against facts.db, which the online tree never holds, so the test and the script are absent from the online tree'
  },
  {
    list: 'online',
    step: 'run node scripts/tests/test-hooks-gate-dry-run.mjs',
    reason:
      'scripts/hooks-gate-dry-run.mjs is a drop row (laptop-only) in system/kit-manifest.json: it measures a laptop install before its commit gate is switched on, and the online tree ships its own gate from the start, so the test and the script are absent from the online tree'
  },
  {
    list: 'online',
    step: 'run node scripts/tests/test-kit-doctor.mjs',
    reason:
      'scripts/kit-doctor.js is a drop row (laptop-only) in system/kit-manifest.json: it is the laptop install doctor Update-Alex runs, and online nothing is installed and /update replaces Update-Alex, so the test and the script are absent from the online tree'
  },
  {
    list: 'online',
    step: 'run node scripts/tests/test-personal-data-scan.mjs',
    reason:
      "scripts/personal-data-scan.js is a drop row (laptop-only) in system/kit-manifest.json: its names leg would block the owner's own vault, so the online gate runs employer-data-guard in its slot, and the test and the wall are absent from the online tree"
  },
  {
    list: 'online',
    step: 'run node scripts/tests/test-generate-scheduler-stubbed.mjs',
    reason:
      'the scheduler step of the generator is laptop-only by design: in an online tree (no variants/online) it is skipped, because the Routines are the schedule and nothing registers on the machine, so every case here, which drives schtasks or launchctl through a stub, has no step to drive. The test is a drop row (laptop-only) in system/kit-manifest.json, absent from the online tree; test-generate-online-tree.mjs holds the online skip'
  },
  {
    list: 'online',
    step: 'run node scripts/tests/test-validate-v2-live.mjs',
    reason:
      'the live half of V2 and its installer hint are laptop surfaces by design: in an online tree (no variants/online) no job is registered and V2 names the Routines instead of the installer, so the registered-job fixtures here describe a machine that tree never is. The test is a drop row (laptop-only) in system/kit-manifest.json, absent from the online tree; test-generate-online-tree.mjs holds the online hint'
  },
  {
    list: 'online',
    step: 'run node scripts/tests/test-v18-ps1-nonascii.mjs',
    reason:
      'V18 (f) itself runs on win32 only and the online tree runs on Ubuntu, where the leg never fires. The test is a drop row (laptop-only) in system/kit-manifest.json by the same design as test-generate-scheduler-stubbed.mjs and test-validate-v2-live.mjs, so it and the behaviour it proves are absent from the online tree'
  },
  {
    list: 'online',
    step: 'run python scripts/tests/test_vault_search_laptop_wrapper.py',
    reason:
      'scripts/run-vault-index.ps1, the laptop job whose command line it parses, is a drop row (local-wrappers) in system/kit-manifest.json; the test is a drop row (laptop-only), so it and the wrapper are absent from the online tree; test_vault_search_cli.py holds every mode the online tree runs'
  },
  {
    list: 'online',
    step: 'run node scripts/tests/test-generate-regions-kit.mjs',
    reason:
      'every case here renders the committed surfaces from variants/online/, the source of the online tree, which the online tree does not carry. The test is a drop row (laptop-only) in system/kit-manifest.json, absent from the online tree; test-generate-regions.mjs holds the regions both trees share'
  },
  {
    list: 'online',
    step: 'run node scripts/tests/test-generate-kit-selection.mjs',
    reason:
      'it copies a real Kit checkout and runs the generator there, and the online tree is a build output, not a Kit. The test is a drop row (laptop-only) in system/kit-manifest.json, absent from the online tree; test-generate-online-tree.mjs holds the online side'
  },
  {
    list: 'online',
    step: 'run node scripts/tests/test-hook-contracts-kit.mjs',
    reason:
      'it compares the laptop .claude/settings.json with variants/online/.claude/settings.json, and the online tree carries only its own. The test is a drop row (laptop-only) in system/kit-manifest.json, absent from the online tree; test-hook-contracts.mjs runs every hook event in the tree it is in'
  },
  {
    list: 'online',
    step: 'run node scripts/tests/test-online-pre-commit-kit.mjs',
    reason:
      "it holds the size-guard loop of variants/online/scripts/hooks/pre-commit equal to the Kit hook's own copy, and the online tree carries one hook, not both. The test is a drop row (laptop-only) in system/kit-manifest.json, absent from the online tree; test-online-pre-commit.mjs runs the online hook's legs"
  },
  {
    list: 'online',
    step: 'run node scripts/tests/test-online-workflows-contract-kit.mjs',
    reason:
      'it reads the online workflows where the Kit keeps them (variants/online/) and the fleet script, a drop row (fleet) in system/kit-manifest.json; the test is a drop row (laptop-only), absent from the online tree; test-online-workflows-contract.mjs reads the workflows the online tree carries'
  },
  {
    list: 'online',
    step: 'run node scripts/tests/test-update-command-contract-kit.mjs',
    reason:
      'the Update-Alex launchers are drop rows (launchers) in system/kit-manifest.json and their cmd.exe runner needs a Windows host; the test is a drop row (laptop-only), so it and the launchers are absent from the online tree; test-update-command-contract.mjs runs the frozen /update text'
  },
  {
    list: 'online',
    step: 'run node scripts/tests/test-setup-command-contract-kit.mjs',
    reason:
      'scripts/bootstrap.ps1 is a drop row (local-wrappers) in system/kit-manifest.json and runs on a Windows host only; the test is a drop row (laptop-only), so it and the script are absent from the online tree; test-setup-command-contract.mjs runs the frozen /setup text'
  },
  {
    list: 'online',
    step: 'run node scripts/tests/test-migrations-frozen-kit.mjs',
    reason:
      "it counts migration 001's names in the Kit's own .claude/commands/setup.md beside its online copy, and the online tree carries one setup.md. The test is a drop row (laptop-only) in system/kit-manifest.json, absent from the online tree; test-migrations-frozen.mjs holds both migrations byte for byte"
  },
  {
    list: 'online',
    step: 'run node scripts/tests/test-validate-v9-kit.mjs',
    reason:
      "its case needs a repository whose first commit is more than 14 days old, and a freshly built online tree's first commit is the build itself, so it runs against the Kit's own history. The test is a drop row (laptop-only) in system/kit-manifest.json, absent from the online tree; test-validate-v9.mjs holds the day-one install"
  },
  {
    list: 'online',
    step: 'run node scripts/tests/test-validate-v18-commands-kit.mjs',
    reason:
      "its cases resolve a command against two command trees, the Kit's own and variants/online's, and a generated tree has one. The test is a drop row (laptop-only) in system/kit-manifest.json, absent from the online tree; test-validate-v18-commands.mjs holds the single tree"
  },
  {
    list: 'online',
    step: 'run node scripts/tests/test-validate-known-bad-shipped-kit.mjs',
    reason:
      'the pinned wrappers and scripts/run-job.mjs are drop rows (local-wrappers) in system/kit-manifest.json, and V18 (f) itself needs a Windows host to parse a .ps1 with; the test is a drop row (laptop-only), so it and its subjects are absent from the online tree'
  },
  {
    list: 'online',
    step: 'run node scripts/tests/test-build-online-template-kit.mjs',
    reason:
      "every case here builds from a Kit checkout, and the online tree is a build output, not a Kit. The test is a drop row (laptop-only) in system/kit-manifest.json, absent from the online tree; test-build-online-template.mjs holds the builder's guards"
  },
  {
    list: 'online',
    step: 'run node scripts/tests/test-import-memory-kit.mjs',
    reason:
      "a Windows short (8.3) name is a file-system feature the online CI's Ubuntu runner does not have, so the case can never run there. The test is a drop row (laptop-only) in system/kit-manifest.json, absent from the online tree; test-import-memory.mjs holds every other Z0 case"
  },
  {
    list: 'online',
    step: 'run node scripts/tests/test-build-template-exports-kit.mjs',
    reason:
      "the pinned behaviour needs a disk that folds case (Windows, and a default macOS volume), and the online CI's Ubuntu runner has a case-sensitive one, where another case is another folder. The test is a drop row (laptop-only) in system/kit-manifest.json, absent from the online tree"
  },
  {
    list: 'online',
    step: 'run node scripts/tests/test-bootstrap-doctor-kit.mjs',
    reason:
      'the core.longpaths row and the shell retry run on Windows only in scripts/bootstrap.mjs, and the online CI runs on Ubuntu. The test is a drop row (laptop-only) in system/kit-manifest.json, absent from the online tree; test-bootstrap-doctor.mjs asserts what the doctor does off Windows'
  }
];
export const ORPHAN_EXEMPT = [
  {
    file: 'test-soul-canary-live.ps1',
    reason:
      'a LIVE test that spends a real claude -p call to prove the SessionStart hook injects soul.md; run on demand, never in CI, which has no Claude account'
  }
];

// ------------------------------------------------------------------ a small, honest YAML reader
// Enough for these workflow files and no more: jobs at indent 2, steps as `      - ` items, keys at
// indent 8, `run: |` blocks, and a `with:` block of one-line `key: value` pairs at indent 10. It throws
// on a shape it does not understand rather than guessing, because a parser that silently drops a step
// or an input would make this whole check vacuous.
export function parseJobs(text) {
  const lines = text.replace(/\r\n/g, '\n').split('\n');
  const jobs = {};
  let inJobs = false,
    job = null,
    step = null,
    block = null,
    inWith = false;
  const flush = () => {
    if (step && job) jobs[job].push(step);
    step = null;
    block = null;
    inWith = false;
  };
  for (const raw of lines) {
    if (/^jobs:\s*$/.test(raw)) {
      inJobs = true;
      continue;
    }
    if (!inJobs) continue;
    if (/^\S/.test(raw) && raw.trim()) {
      flush();
      inJobs = false;
      continue;
    }
    const jm = raw.match(/^ {2}([A-Za-z0-9_-]+):\s*$/);
    if (jm) {
      flush();
      job = jm[1];
      jobs[job] = [];
      continue;
    }
    if (block !== null && (raw.trim() === '' || /^ {10,}/.test(raw))) {
      step.run_block.push(raw.trim());
      continue;
    }
    block = null;
    if (inWith) {
      const wm = raw.match(/^ {10}([A-Za-z0-9_-]+):\s*(.*)$/);
      if (wm) {
        step.with[wm[1]] = unquote(wm[2]);
        continue;
      }
      if (raw.trim() === '' || /^\s*#/.test(raw)) continue;
      if (/^ {10,}\S/.test(raw))
        throw new Error(
          `job ${job}: a with: input this reader does not understand (${raw.trim()}); it reads one-line key: value pairs`
        );
      inWith = false;
    }
    const sm = raw.match(/^ {6}- (\w[\w-]*):\s*(.*)$/);
    if (sm) {
      flush();
      step = { name: null, run: null, uses: null, run_block: null, with: null };
      setKey(step, sm[1], sm[2]);
      if (sm[1] === 'run' && sm[2].trim() === '|') {
        step.run = null;
        step.run_block = [];
        block = true;
      }
      continue;
    }
    const km = raw.match(/^ {8}(\w[\w-]*):\s*(.*)$/);
    if (km && step && km[1] === 'with' && km[2].trim() === '') {
      step.with = {};
      inWith = true;
      continue;
    }
    if (km && step) {
      setKey(step, km[1], km[2]);
      if (km[1] === 'run' && km[2].trim() === '|') {
        step.run = null;
        step.run_block = [];
        block = true;
      }
    }
  }
  flush();
  for (const [name, steps] of Object.entries(jobs)) {
    for (const s of steps)
      if (!s.run && !s.uses && !s.run_block)
        throw new Error(
          `job ${name}: a step with neither run nor uses (${s.name || 'unnamed'}); the reader does not understand this shape`
        );
  }
  return jobs;
}
const unquote = (val) => val.trim().replace(/^(['"])(.*)\1$/, '$2');
function setKey(step, key, val) {
  const v = unquote(val);
  if (key === 'name') step.name = v;
  else if (key === 'run') step.run = v;
  else if (key === 'uses') step.uses = v;
}
export function stepId(s) {
  if (s.uses) {
    const inputs = Object.keys(s.with || {})
      .sort()
      .map((k) => `${k}=${s.with[k]}`);
    return `uses ${s.uses}${inputs.length ? ` with ${inputs.join(', ')}` : ''}`;
  }
  if (s.run) return `run ${s.run.replace(/\s+/g, ' ')}`;
  return `block ${s.name}`;
}
function runsText(steps) {
  return steps.map((s) => [s.run || '', ...(s.run_block || [])].join('\n')).join('\n');
}

// ------------------------------------------------------------------ the check, as a pure function
export function checkParity({ lists, testFiles, exempt = EXEMPT, orphanExempt = ORPHAN_EXEMPT, parity = true }) {
  const problems = [];
  const ids = {};
  for (const [list, steps] of Object.entries(lists)) ids[list] = new Set(steps.map(stepId));
  const all = new Set(Object.values(ids).flatMap((s) => [...s]));
  const names = Object.keys(lists);

  for (const e of exempt) {
    if (!e.reason || !String(e.reason).trim()) problems.push(`exemption without a reason: ${e.list} / ${e.step}`);
  }
  if (parity) {
    for (const id of [...all].sort()) {
      for (const list of names) {
        if (ids[list].has(id)) continue;
        if (!exempt.some((e) => e.list === list && e.step === id)) {
          const where = names.filter((n) => ids[n].has(id)).join(', ');
          problems.push(`DRIFT: "${id}" runs in ${where} and not in ${list}, with no exemption naming ${list}`);
        }
      }
    }
    for (const e of exempt) {
      if (!names.includes(e.list)) continue;
      if (ids[e.list].has(e.step))
        problems.push(`STALE exemption: ${e.list} now runs "${e.step}"; remove the exemption`);
      else if (!all.has(e.step))
        problems.push(`STALE exemption: no list runs "${e.step}" any more; remove the exemption`);
    }
  }
  const text = Object.values(lists).map(runsText).join('\n');
  for (const f of testFiles) {
    if (text.includes(`scripts/tests/${f}`) || text.includes(`scripts\\tests\\${f}`)) continue;
    const x = orphanExempt.find((o) => o.file === f);
    if (!x) problems.push(`ORPHAN: scripts/tests/${f} is run by no CI list and has no exemption`);
    else if (!x.reason || !String(x.reason).trim()) problems.push(`orphan exemption without a reason: ${f}`);
  }
  for (const o of orphanExempt) {
    if (
      testFiles.includes(o.file) &&
      (text.includes(`scripts/tests/${o.file}`) || text.includes(`scripts\\tests\\${o.file}`))
    ) {
      problems.push(`STALE orphan exemption: a list now runs ${o.file}; remove the exemption`);
    }
  }
  return problems;
}

// ------------------------------------------------------------------ the tree in front of us
export function loadLists(root) {
  const kitCi = path.join(root, '.github', 'workflows', 'ci.yml');
  const onlineCi = path.join(root, 'variants', 'online', '.github', 'workflows', 'ci.yml');
  if (fs.existsSync(onlineCi)) {
    const k = parseJobs(fs.readFileSync(kitCi, 'utf8'));
    const o = parseJobs(fs.readFileSync(onlineCi, 'utf8'));
    for (const [j, file] of [
      ['portable-tests', kitCi],
      ['portable-tests-macos', kitCi]
    ])
      if (!k[j]) throw new Error(`${file} has no job ${j}`);
    if (!o['portable-tests']) throw new Error(`${onlineCi} has no job portable-tests`);
    return {
      tree: 'kit',
      lists: { 'kit-windows': k['portable-tests'], 'kit-macos': k['portable-tests-macos'], online: o['portable-tests'] }
    };
  }
  const text = fs.readFileSync(kitCi, 'utf8');
  if (!/^# Virtual Alex CI/m.test(text))
    throw new Error(
      `${kitCi}: no variants/online/ here, and this is not the Virtual Alex workflow either; cannot tell which tree this is`
    );
  const o = parseJobs(text);
  if (!o['portable-tests']) throw new Error(`${kitCi} has no job portable-tests`);
  return { tree: 'generated', lists: { online: o['portable-tests'] } };
}
export function testFilesIn(root) {
  return fs
    .readdirSync(path.join(root, 'scripts', 'tests'))
    .filter((f) => /^(test[-_].*|portability-check)\.(mjs|js|cjs|py|ps1)$/.test(f))
    .sort();
}

// ------------------------------------------------------------------ run
describe('S. the check on synthetic lists, every refusal first', () => {
  const Y = (steps) =>
    `jobs:\n  portable-tests:\n    runs-on: x\n    steps:\n${steps.map((s) => `      - name: ${s}\n        run: node scripts/tests/${s}\n`).join('')}`;
  const a = parseJobs(Y(['test-a.mjs', 'test-b.mjs']))['portable-tests'];
  const b = parseJobs(Y(['test-a.mjs']))['portable-tests'];

  test('S1 a step in one list and not the other is DRIFT', () => {
    const s1 = checkParity({
      lists: { 'kit-windows': a, online: b },
      testFiles: ['test-a.mjs', 'test-b.mjs'],
      exempt: [],
      orphanExempt: []
    });
    assert.ok(
      s1.length === 1 &&
        /DRIFT: "run node scripts\/tests\/test-b\.mjs" runs in kit-windows and not in online/.test(s1[0]),
      `S1 NEGATIVE a step in one list and not the other is DRIFT - ${s1.join(' | ')}`
    );
  });

  test('S2 an exemption with an empty reason is refused', () => {
    const s2 = checkParity({
      lists: { 'kit-windows': a, online: b },
      testFiles: ['test-a.mjs', 'test-b.mjs'],
      exempt: [{ list: 'online', step: 'run node scripts/tests/test-b.mjs', reason: '' }],
      orphanExempt: []
    });
    assert.ok(
      s2.some((p) => /exemption without a reason/.test(p)),
      `S2 NEGATIVE an exemption with an empty reason is refused - ${s2.join(' | ')}`
    );
  });

  test('S3 the same drift WITH a named reason passes', () => {
    const s3 = checkParity({
      lists: { 'kit-windows': a, online: b },
      testFiles: ['test-a.mjs', 'test-b.mjs'],
      exempt: [{ list: 'online', step: 'run node scripts/tests/test-b.mjs', reason: 'a real reason' }],
      orphanExempt: []
    });
    assert.equal(s3.length, 0, 'S3 the same drift WITH a named reason passes');
  });

  test('S4 an exemption for a step that list now runs is STALE', () => {
    const s4 = checkParity({
      lists: { 'kit-windows': a, online: a },
      testFiles: ['test-a.mjs', 'test-b.mjs'],
      exempt: [{ list: 'online', step: 'run node scripts/tests/test-b.mjs', reason: 'a real reason' }],
      orphanExempt: []
    });
    assert.ok(
      s4.some((p) => /STALE exemption: online now runs/.test(p)),
      `S4 NEGATIVE an exemption for a step that list now runs is STALE - ${s4.join(' | ')}`
    );
  });

  test('S5 a test file no list runs is an ORPHAN', () => {
    const s5 = checkParity({
      lists: { 'kit-windows': b, online: b },
      testFiles: ['test-a.mjs', 'test-c.mjs'],
      exempt: [],
      orphanExempt: []
    });
    assert.ok(
      s5.some((p) => /ORPHAN: scripts\/tests\/test-c\.mjs/.test(p)),
      `S5 NEGATIVE a test file no list runs is an ORPHAN - ${s5.join(' | ')}`
    );
  });

  test('S6 the reader refuses a step it cannot understand rather than dropping it', () => {
    assert.throws(
      () => parseJobs('jobs:\n  j:\n    steps:\n      - name: nothing here\n'),
      'S6 NEGATIVE the reader refuses a step it cannot understand rather than dropping it'
    );
  });

  const N = (version) =>
    parseJobs(
      `jobs:\n  portable-tests:\n    runs-on: x\n    steps:\n      - uses: actions/setup-node@v5\n        with:\n          node-version: ${version}\n      - name: t\n        run: node scripts/tests/test-a.mjs\n`
    )['portable-tests'];

  test('S7-S7b the same action with a different with: input in two lists is DRIFT, both ways; quoting alone is not', () => {
    const s7 = checkParity({
      lists: { 'kit-windows': N("'22.16'"), 'kit-macos': N('22') },
      testFiles: ['test-a.mjs'],
      exempt: [],
      orphanExempt: []
    });
    assert.ok(
      s7.length === 2 &&
        /DRIFT: "uses actions\/setup-node@v5 with node-version=22\.16" runs in kit-windows and not in kit-macos/.test(
          s7.join('|')
        ) &&
        /DRIFT: "uses actions\/setup-node@v5 with node-version=22" runs in kit-macos and not in kit-windows/.test(
          s7.join('|')
        ),
      `S7 NEGATIVE the same action with a different with: input in two lists is DRIFT, both ways - ${s7.join(' | ')}`
    );
    const s7b = checkParity({
      lists: { 'kit-windows': N("'22.16'"), 'kit-macos': N('"22.16"') },
      testFiles: ['test-a.mjs'],
      exempt: [],
      orphanExempt: []
    });
    assert.equal(s7b.length, 0, 'S7b the same input quoted two ways is the same step');
  });

  test('S8 the reader refuses a with: input it cannot read as one line rather than dropping it', () => {
    assert.throws(
      () =>
        parseJobs(
          'jobs:\n  j:\n    steps:\n      - uses: a/b@v1\n        with:\n          k:\n            nested: 1\n'
        ),
      'S8 NEGATIVE the reader refuses a with: input it cannot read as one line rather than dropping it'
    );
  });
});

describe('R. the real lists in front of us', () => {
  const { tree, lists } = loadLists(KIT);
  const files = testFilesIn(KIT);

  test("R0 the tree's lists were read", () => {
    const sizes = Object.entries(lists)
      .map(([k, v]) => `${k} ${v.length}`)
      .join(', ');
    assert.ok(
      Object.values(lists).every((v) => v.length >= 10),
      `R0 the ${tree} tree's lists were read (${sizes} steps)`
    );
  });

  test('R1 the three CI lists agree, and every test file is run by a list', (t) => {
    if (tree === 'generated') {
      t.diagnostic(
        'leg P skipped: a generated template carries one list; the parity leg runs in the Kit, where all three live'
      );
    }
    const problems = checkParity({ lists, testFiles: files, parity: tree === 'kit' });
    for (const p of problems) t.diagnostic(p);
    assert.equal(
      problems.length,
      0,
      `R1 ${tree === 'kit' ? 'the three CI lists agree, every difference exempted with a reason, and ' : ''}every test file is run by a list - ${files.length} test file(s)`
    );
  });
});

// G. where the online job runs. The online tests prove the TEMPLATE: they belong in the template and in
// each seed (both are GitHub template repositories) and on a manual dispatch, never in a template-born
// owner repository, which autosaves dozens of times a day and holds content no Kit manifest claims. The
// org name alone is not a safe proxy for "template or seed": an owner repository inside the same org
// would run the template's tests over its own vault and fail test-build-online-template's P4. The truth
// table is evaluated, not matched.
describe('G. where the online job runs', () => {
  const onlineCi = [
    path.join(KIT, 'variants', 'online', '.github', 'workflows', 'ci.yml'),
    path.join(KIT, '.github', 'workflows', 'ci.yml')
  ].find((p) => fs.existsSync(p) && /^# Virtual Alex CI/m.test(fs.readFileSync(p, 'utf8')));
  const gates = onlineCi
    ? [...fs.readFileSync(onlineCi, 'utf8').matchAll(/^ {4}if:\s*\$\{\{\s*(.+?)\s*\}\}\s*$/gm)].map((m) => m[1])
    : [];
  const expr = gates.length === 1 ? gates[0] : null;
  const run = (event, repo, isTemplate) => {
    if (!expr) return true;
    const js = expr
      .replace(/github\.event\.repository\.is_template/g, String(isTemplate))
      .replace(/github\.event_name/g, JSON.stringify(event))
      .replace(/startsWith\(github\.repository,\s*'([^']*)'\)/g, (_, p) => String(repo.startsWith(p)));
    if (!/^[\s!|&()'"a-z_/.=-]+$/i.test(js)) throw new Error(`unexpected gate expression: ${expr}`);
    return Function(`"use strict"; return (${js.replace(/'/g, '"')});`)();
  };

  test('G0 the online job carries exactly one if: gate', () => {
    assert.equal(
      gates.length,
      1,
      `G0 the online job carries exactly one if: gate - ${gates.length} found in ${onlineCi ? path.relative(KIT, onlineCi).replace(/\\/g, '/') : 'no online ci.yml'}`
    );
  });
  test('G1-G5 the gate runs the template, a seed and a manual dispatch, and skips an owner repository', () => {
    assert.equal(run('push', 'Alex-kit-S/virtual-alex', true), true, 'G1 a push to the template runs the tests');
    assert.equal(run('push', 'Alex-kit-S/virtual-alex-owner-seed', true), true, 'G2 a push to a seed runs the tests');
    assert.equal(
      run('push', 'Alex-kit-S/virtual-alex-demo', false),
      false,
      'G3 NEGATIVE a push to an owner repository INSIDE the template org is skipped'
    );
    assert.equal(
      run('push', 'an-owner/alex', false),
      false,
      'G4 NEGATIVE a push to an owner repository outside the org is skipped'
    );
    assert.equal(run('workflow_dispatch', 'an-owner/alex', false), true, 'G5 a manual dispatch runs anywhere');
  });
});
