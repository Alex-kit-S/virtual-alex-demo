#!/usr/bin/env node
// scripts/tests/test-online-workflows-contract.mjs - the two workflows every Virtual Alex tree carries,
// held on the lines other code and other people depend on that no test held yet.
//
// WHAT. variants/online/.github/workflows/ci.yml and heartbeat.yml become .github/workflows/ in every
// template, seed and owner repository. test-ci-parity.mjs holds ci.yml's step list and its one job gate,
// test-heartbeat-check.mjs holds heartbeat.yml's schedule, gate step and conditions, and
// test-template-gate.mjs P3 holds the job id. What nothing held, and something reads:
//   - the FILE NAME ci.yml and its workflow_dispatch trigger: scripts/new-virtual-alex.mjs:188 lists runs
//     of `--workflow ci.yml` and :312 dispatches `gh workflow run ci.yml`; README.md:4's badge names it;
//   - ci.yml's triggers, its read-only token, the runner and runtime versions the tests are written for;
//   - heartbeat.yml's gate OUTPUT name (the step writes `template=` into $GITHUB_OUTPUT and three steps
//     read steps.gate.outputs.template), the token gh needs, and its runtime;
//   - the set of workflows an owner's repository runs: exactly these two.
// The schedule may never fire in a repository born from a template: that needs a live GitHub repository,
// so it is not testable here. test-online-workflows-contract-kit.mjs holds the two Kit-only readers (the
// README badge plus the fleet script, and the builder's own plan), split out when a generated online tree
// has no variants/ source or fleet script to check against.
//
// HOW. Reads the files as text, line by line.
//
// NEVER. Edits a workflow. Flips a PINNED DEFECT assertion on its own: each pins today's behaviour, and
// only a FIX row in the ratchet flips one. R3-L17: the actions are pinned by moving major tags, not
// commit shas. R3-L18: the portability step is named "(P1-P5)" for a seven-leg checker.
//
// Usage: node scripts/tests/test-online-workflows-contract.mjs
// Exit: 0 every assertion held - 1 one failed

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const IS_KIT = fs.existsSync(path.join(ROOT, 'variants', 'online'));
const WF = IS_KIT
  ? path.join(ROOT, 'variants', 'online', '.github', 'workflows')
  : path.join(ROOT, '.github', 'workflows');
const read = (name) => fs.readFileSync(path.join(WF, name), 'utf8');
const lines = (name) => read(name).split(/\r?\n/);
const top = (name, key) => {
  // The block under a top-level key: the key line and every line indented under it.
  const ls = lines(name);
  const i = ls.indexOf(`${key}:`);
  if (i < 0) return null;
  const out = [];
  for (let j = i + 1; j < ls.length && (ls[j] === '' || /^\s/.test(ls[j])); j++)
    if (ls[j].trim() && !ls[j].trim().startsWith('#')) out.push(ls[j]);
  return out;
};

test("an owner's repository carries exactly two workflows: ci.yml and heartbeat.yml", () => {
  assert.deepEqual(fs.readdirSync(WF).sort(), ['ci.yml', 'heartbeat.yml']);
});

test('ci.yml: name CI, triggered by a push to main, a pull request and a manual dispatch (new-virtual-alex dispatches ci.yml)', () => {
  assert.ok(lines('ci.yml').includes('name: CI'));
  assert.deepEqual(top('ci.yml', 'on'), ['  push:', '    branches: [main]', '  pull_request:', '  workflow_dispatch:']);
});

test('ci.yml: the token is read-only, and no line anywhere asks for write', () => {
  assert.deepEqual(top('ci.yml', 'permissions'), ['  contents: read']);
  assert.ok(!/:\s*write\b/.test(read('ci.yml')));
});

test('ci.yml: one job, portable-tests, on ubuntu-latest, 15 minutes, Node 22.16 (the laptop floor) and Python 3.12, then the Python 3.9 floor step last', () => {
  const ls = lines('ci.yml');
  assert.deepEqual(
    ls.filter((l) => /^ {2}\S/.test(l) && ls.indexOf('jobs:') < ls.indexOf(l)),
    ['  portable-tests:']
  );
  for (const want of [
    '    runs-on: ubuntu-latest',
    '    timeout-minutes: 15',
    "          node-version: '22.16'",
    "          python-version: '3.12'"
  ]) {
    assert.ok(ls.includes(want), want);
  }
  // The floor step's setup-python changes python for every later step, so nothing but the floor runs after it.
  const floor = ls.indexOf("          python-version: '3.9'");
  assert.ok(floor > 0, "python-version: '3.9'");
  assert.deepEqual(
    ls.slice(floor).filter((l) => /^ {8}run:/.test(l)),
    ['        run: node scripts/tests/python-floor.mjs']
  );
});

test('heartbeat.yml: name Heartbeat, one job heartbeat, 5 minutes, Node 22', () => {
  const ls = lines('heartbeat.yml');
  assert.ok(ls.includes('name: Heartbeat'));
  assert.deepEqual(
    ls.filter((l) => /^ {2}\S/.test(l) && ls.indexOf('jobs:') < ls.indexOf(l)),
    ['  heartbeat:']
  );
  for (const want of ['    runs-on: ubuntu-latest', '    timeout-minutes: 5', '          node-version: 22'])
    assert.ok(ls.includes(want), want);
});

test('heartbeat.yml: the gate step writes the output "template" that every later step reads, with the token gh needs', () => {
  const text = read('heartbeat.yml');
  // biome-ignore lint/suspicious/noTemplateCurlyInString: a GitHub Actions expression, not JS interpolation
  assert.ok(text.includes('          GH_TOKEN: ${{ github.token }}\n'));
  // biome-ignore lint/suspicious/noTemplateCurlyInString: a shell variable in the step's own script, not JS interpolation
  assert.ok(text.includes('          echo "template=${template}" >> "$GITHUB_OUTPUT"\n'));
  const readers = [...text.matchAll(/steps\.gate\.outputs\.(\w+)/g)].map((m) => m[1]);
  assert.deepEqual(readers, ['template', 'template', 'template']);
});

test('PINNED DEFECT R3-L17: the third-party actions are pinned by moving major tags, not commit shas', () => {
  const uses = (name) =>
    lines(name)
      .filter((l) => /uses:/.test(l))
      .map((l) => l.trim().replace(/^- /, ''));
  assert.deepEqual(uses('ci.yml'), [
    'uses: actions/checkout@v5',
    'uses: actions/setup-node@v5',
    'uses: actions/setup-python@v6',
    'uses: actions/setup-python@v6'
  ]);
  assert.deepEqual(uses('heartbeat.yml'), ['uses: actions/checkout@v5', 'uses: actions/setup-node@v5']);
});

test('PINNED DEFECT R3-L18: the portability step is still named "(P1-P5)" while the checker runs seven legs', () => {
  const ls = lines('ci.yml');
  const i = ls.indexOf('        run: node scripts/tests/portability-check.mjs');
  assert.equal(ls[i - 1], '      - name: Portability probes (P1-P5)');
  const checker = fs.readFileSync(path.join(ROOT, 'scripts', 'tests', 'portability-check.mjs'), 'utf8');
  assert.deepEqual(
    [...checker.matchAll(/^\/\/ {3}(P\d) /gm)].map((m) => m[1]),
    ['P1', 'P2', 'P3', 'P4', 'P5', 'P6', 'P7']
  );
});
