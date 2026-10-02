#!/usr/bin/env node
// @ts-check
// scripts/tests/test-prompt-stale-checks.mjs - scripts/prompt-regression-check.js, the generator's advisory
// prompt check, pinned as it behaves.
//
// WHAT. Holds both modes of the checker. The case replay: its PASS line counting cases and assertions, a lost
// required shape, a forbidden shape and a missing target as FAILED lines on stderr with exit 1, and WARNING with
// exit 0 under --advisory. The delivered audit: a conforming artifact's PASS line with its rule count, every
// delivered rule's exact message, the model consistency cross-check both ways, the word ceiling, the
// grandfathering cutover, --since, --file, a missing file, and no artifacts at all as exit 0. Deleted, a changed
// message, a lost rule or a red fresh clone would pass CI. The generator's other advisory step,
// scripts/stale-status-check.js, is laptop-only and tested in scripts/tests/test-stale-status-check.mjs.
//
// HOW. Every test builds a throwaway tree under one OS temp folder with the REAL script, its lib/
// dependencies (repo-root.js, json-writer.js, and args.js with errors.js and exit-codes.js for its command
// line) and no others, a one-case cases.json and the artifacts it needs, and runs the script there as a
// child process with the ALEX_ variables removed. A test named "PINNED DEFECT <id>" asserts behaviour known
// to be wrong; its fix flips exactly that assertion when the defect ledger schedules it.
//
// NEVER. Writes into the checkout or reaches a network. Fixes a defect it pins (R8-14): the advisory findings
// go to stderr, so the generator step that logs stdout logs an empty line; a Built for value carrying a
// parenthesis skips the model cross-check; --n 0 audits one artifact and --n x audits every one; and an
// invalid regex in cases.json crashes the check, under --advisory too.
//
// Usage: node scripts/tests/test-prompt-stale-checks.mjs
// Exit: 0 every test passed - 1 a test failed

import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const KIT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const TMP = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'alex-c5-ps-')));
after(() => fs.rmSync(TMP, { recursive: true, force: true }));

let n = 0;
/**
 * @param {string} root
 * @param {string} rel
 * @param {string} content
 */
function put(root, rel, content) {
  fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
  fs.writeFileSync(path.join(root, rel), content);
}
/** The environment with every ALEX_ variable removed. */
function env() {
  /** @type {NodeJS.ProcessEnv} */
  const e = {};
  for (const [k, v] of Object.entries(process.env)) if (!/^ALEX_/.test(k)) e[k] = v;
  return e;
}
/**
 * Runs one script of the tree from its root.
 * @param {string} root
 * @param {string} script a file name under scripts/
 * @param {string[]} [args]
 */
function run(root, script, args = []) {
  const r = spawnSync(process.execPath, [path.join(root, 'scripts', script), ...args], {
    cwd: root,
    env: env(),
    encoding: 'utf8'
  });
  /** @param {string} s */
  const lines = (s) => s.trimEnd().split('\n').filter(Boolean);
  return { status: r.status, stdout: r.stdout, stderr: r.stderr, out: lines(r.stdout), err: lines(r.stderr) };
}

// ---------------------------------------------------------------- prompt-regression-check
const GOOD = [
  'CONTEXT',
  'x',
  'INPUT',
  'Identify the skills that are needed for the task and use them',
  'OUTPUT',
  'Close-Out Gate',
  'Built for: Opus 5 - Suggested effort: high',
  ''
].join('\n');
/** A throwaway tree holding the real script, one command file and a one-case cases.json. */
function promptTree() {
  const root = path.join(TMP, `p${++n}`);
  fs.mkdirSync(path.join(root, 'scripts', 'lib'), { recursive: true });
  fs.copyFileSync(
    path.join(KIT, 'scripts', 'prompt-regression-check.js'),
    path.join(root, 'scripts', 'prompt-regression-check.js')
  );
  fs.copyFileSync(path.join(KIT, 'scripts', 'lib', 'repo-root.js'), path.join(root, 'scripts', 'lib', 'repo-root.js'));
  fs.copyFileSync(
    path.join(KIT, 'scripts', 'lib', 'json-writer.js'),
    path.join(root, 'scripts', 'lib', 'json-writer.js')
  );
  // prompt-regression-check.js parses its command line through args.js, which needs errors.js and
  // exit-codes.js as it loads.
  fs.copyFileSync(path.join(KIT, 'scripts', 'lib', 'args.js'), path.join(root, 'scripts', 'lib', 'args.js'));
  fs.copyFileSync(path.join(KIT, 'scripts', 'lib', 'errors.js'), path.join(root, 'scripts', 'lib', 'errors.js'));
  fs.copyFileSync(
    path.join(KIT, 'scripts', 'lib', 'exit-codes.js'),
    path.join(root, 'scripts', 'lib', 'exit-codes.js')
  );
  put(root, '.claude/commands/status.md', '# Status\n\nnode scripts/waiting-on-them.js briefline\n');
  put(
    root,
    'work/26-prompting/regression-cases/cases.json',
    JSON.stringify(
      {
        cases: [
          {
            id: 'status-briefline',
            target: '.claude/commands/status.md',
            must_contain: ['waiting-on-them\\.js briefline'],
            must_not_contain: ['never-this']
          }
        ]
      },
      null,
      2
    )
  );
  return root;
}
/**
 * @param {string} root
 * @param {string[]} [args]
 */
const prompt = (root, args = []) => run(root, 'prompt-regression-check.js', args);

test('the case replay: a PASS line counting cases and assertions on stdout; a vanished required shape and a forbidden shape that appeared are FAILED lines on STDERR with exit 1; --advisory prints WARNING and exits 0', () => {
  const root = promptTree();
  const ok = prompt(root);
  assert.deepEqual([ok.status, ok.out, ok.err], [0, ['prompt-regression: PASS (1 cases, 2 assertions).'], []]);
  put(root, '.claude/commands/status.md', '# Status\n\nnode scripts/waiting-on-THEM briefline\n');
  const bad = prompt(root);
  assert.equal(bad.status, 1);
  assert.deepEqual(bad.stdout, '', 'nothing on stdout: the generator step that logs stdout logs nothing');
  assert.deepEqual(bad.err, [
    'prompt-regression: 1 FAILED(s) across 1 cases:',
    '  FAILED: [status-briefline] MISSING required shape /waiting-on-them\\.js briefline/ in .claude/commands/status.md'
  ]);
  const adv = prompt(root, ['--advisory']);
  assert.equal(adv.status, 0);
  assert.equal(adv.err[0], 'prompt-regression: 1 WARNING(s) across 1 cases:');
  put(root, '.claude/commands/status.md', '# Status\n\nnode scripts/waiting-on-them.js briefline\nnever-this\n');
  assert.equal(
    prompt(root).err[1],
    '  FAILED: [status-briefline] FORBIDDEN shape /never-this/ present in .claude/commands/status.md'
  );
  fs.rmSync(path.join(root, '.claude', 'commands', 'status.md'));
  assert.equal(prompt(root).err[1], '  FAILED: [status-briefline] target missing: .claude/commands/status.md');
});

test('--delivered: a conforming artifact passes with its rule count; every rule of a bad artifact is named with its exact message, including the model cross-check; the word ceiling; --advisory downgrades', () => {
  const root = promptTree();
  put(root, 'outputs/prompting/2026-09-01/a-good.md', GOOD);
  const ok = prompt(root, ['--delivered']);
  assert.deepEqual([ok.status, ok.out], [0, ['prompt-regression --delivered: PASS (1 artifact(s), 9 rules each).']]);
  put(
    root,
    'outputs/prompting/2026-09-02/c-bad.md',
    '# CONTEXT\nINPUT\nOUTPUT\nplease double-check\nBuilt for: Fable 5 - x\nscope asked\n'
  );
  const bad = prompt(root, ['--delivered', '--n', '1']);
  assert.equal(bad.status, 1);
  assert.deepEqual(
    bad.err,
    [
      'prompt-regression --delivered: 5 FAILED(s) across 1 artifact(s):',
      '  FAILED: [outputs/prompting/2026-09-02/c-bad.md] skills-sentence: missing the verbatim skills sentence that INPUT 2 must open with',
      '  FAILED: [outputs/prompting/2026-09-02/c-bad.md] close-out: missing the Close-Out Gate reference, which is always the last OUTPUT step',
      '  FAILED: [outputs/prompting/2026-09-02/c-bad.md] suggested-effort: missing the `Suggested effort:` line',
      '  FAILED: [outputs/prompting/2026-09-02/c-bad.md] no-blanket-verification: contains a blanket verification instruction (verification hygiene: an external read-back, a render check, or a named gate only)',
      '  FAILED: [outputs/prompting/2026-09-02/c-bad.md] model-consistency: Built for Fable 5 but carries Opus-5-only lines (the delegation cap / scope-asked line)'
    ],
    'the three headers pass in their markdown form, so only the other rules fire'
  );
  assert.equal(prompt(root, ['--delivered', '--n', '1', '--advisory']).status, 0);
  put(
    root,
    'outputs/prompting/2026-09-03/d-opus.md',
    `${GOOD}Delegate independent subtasks and keep working while they run\n`
  );
  assert.equal(
    prompt(root, ['--delivered', '--n', '1']).err[1],
    '  FAILED: [outputs/prompting/2026-09-03/d-opus.md] model-consistency: Built for Opus 5 but carries Fable-5-only lines (grounded-progress / delegate-and-keep-working)'
  );
  put(root, 'outputs/prompting/2026-09-04/e-long.md', `${GOOD}${'word '.repeat(1200)}\n`);
  assert.equal(
    prompt(root, ['--delivered', '--n', '1']).err[1],
    '  FAILED: [outputs/prompting/2026-09-04/e-long.md] length: 1226 words, over the 400-900 band (hard ceiling 1200). Point at a pattern instead of inlining it, or say in one line why this relay needs the size.'
  );
});

test('--delivered selects by date and by file: artifacts before the cutover are grandfathered, --since moves it, --file audits one, a missing file is a finding, and no artifacts at all is exit 0 with its own sentence', () => {
  const root = promptTree();
  put(root, 'outputs/prompting/2026-08-25/old.md', 'grandfathered, fails every rule\n');
  const none = prompt(root, ['--delivered']);
  assert.deepEqual(
    [none.status, none.out],
    [0, ['prompt-regression --delivered: no artifacts dated on/after 2026-08-26 to audit (nothing to do).']]
  );
  assert.equal(
    prompt(root, ['--delivered', '--since', '2026-08-01']).status,
    1,
    '--since reaches back past the cutover'
  );
  put(root, 'outputs/prompting/2026-09-01/a-good.md', GOOD);
  assert.equal(
    prompt(root, ['--delivered', '--since', '2026-09-03']).out[0],
    'prompt-regression --delivered: no artifacts dated on/after 2026-09-03 to audit (nothing to do).'
  );
  assert.deepEqual(prompt(root, ['--delivered', '--file', 'outputs/prompting/2026-09-01/a-good.md']).out, [
    'prompt-regression --delivered: PASS (1 artifact(s), 9 rules each).'
  ]);
  const missing = prompt(root, ['--delivered', '--file', 'nope.md']);
  assert.equal(missing.status, 1);
  assert.match(missing.err[1], /^ {2}FAILED: \[nope\.md\] target missing: /);
  fs.rmSync(path.join(root, 'outputs'), { recursive: true });
  assert.equal(
    prompt(root, ['--delivered']).status,
    0,
    'a fresh clone, where outputs/ is gitignored and absent, is never red'
  );
});

test('PINNED DEFECT R8-14: --n 0 audits ONE artifact and --n x audits every one, because the count is parsed with no validation', () => {
  const root = promptTree();
  // A FOURTH artifact, so "the default is three" pins DEFAULT_AUDITED at exactly 3 rather than passing
  // on any default of 3 or more: with only 3 artifacts to count, a default silently widened to 4 would
  // pass unnoticed. With four planted, the default still stops at 3 (unchanged assertion) and NaN's
  // "audit every one" now visibly picks up all four (the assertion text that moves).
  for (const d of ['2026-09-01', '2026-09-02', '2026-09-03', '2026-09-04'])
    put(root, `outputs/prompting/${d}/a.md`, 'CONTEXT\nINPUT\nOUTPUT\n');
  assert.match(
    prompt(root, ['--delivered']).err[0],
    /across 3 artifact\(s\)/,
    'the default is three (of four available)'
  );
  assert.match(
    prompt(root, ['--delivered', '--n', '0']).err[0],
    /across 1 artifact\(s\)/,
    'zero asks for none and gets one'
  );
  assert.match(
    prompt(root, ['--delivered', '--n', 'x']).err[0],
    /across 4 artifact\(s\)/,
    'a word asks for NaN and gets every artifact there is'
  );
});

test('PINNED DEFECT R8-14: a `Built for:` value carrying a parenthesis or a hyphenated id skips the model consistency check, so a Fable prompt with Opus lines passes', () => {
  const root = promptTree();
  const fableWithOpusLines = [
    'CONTEXT',
    'x',
    'INPUT',
    'Identify the skills that are needed for the task and use them',
    'OUTPUT',
    'Close-Out Gate',
    'Built for: Fable 5 (claude-fable-5)',
    'Suggested effort: high',
    'scope asked',
    ''
  ].join('\n');
  put(root, 'outputs/prompting/2026-09-01/b-parens.md', fableWithOpusLines);
  assert.deepEqual(prompt(root, ['--delivered', '--file', 'outputs/prompting/2026-09-01/b-parens.md']).out, [
    'prompt-regression --delivered: PASS (1 artifact(s), 9 rules each).'
  ]);
  put(
    root,
    'outputs/prompting/2026-09-01/c-plain.md',
    fableWithOpusLines.replace('Built for: Fable 5 (claude-fable-5)', 'Built for: Fable 5 - high')
  );
  assert.match(
    prompt(root, ['--delivered', '--file', 'outputs/prompting/2026-09-01/c-plain.md']).err[1],
    /model-consistency: Built for Fable 5 but carries Opus-5-only lines/,
    'control: the same artifact without the parenthesis is caught'
  );
});

test('PINNED DEFECT R8-14: cases.json that will not parse is reported but never crashes, while an INVALID REGEX inside it throws even under --advisory, so the generator step dies on a data error', () => {
  const root = promptTree();
  put(root, 'work/26-prompting/regression-cases/cases.json', '{ broken');
  const broken = prompt(root);
  assert.equal(broken.status, 1);
  assert.match(broken.err[0], /^prompt-regression: cannot read cases\.json - /);
  assert.equal(prompt(root, ['--advisory']).status, 0, 'advisory survives a malformed file');
  put(
    root,
    'work/26-prompting/regression-cases/cases.json',
    JSON.stringify({
      cases: [{ id: 'broken-regex', target: '.claude/commands/status.md', must_contain: ['(unclosed'] }]
    })
  );
  const crash = prompt(root, ['--advisory']);
  assert.equal(crash.status, 1, 'advisory does not survive an unparseable regex');
  assert.match(crash.stderr, /SyntaxError: Invalid regular expression/);
});

test('a bad command line REFUSES with exit 2, whatever else is on the line and whether --advisory is present, because this script has no hook or Routine caller to warn instead', () => {
  const root = promptTree();
  /** @type {[string[], RegExp][]} */
  const cases = [
    [['--bogus'], /^prompt-regression: REFUSED, unknown flag --bogus; this command takes /],
    [['--DELIVERED'], /^prompt-regression: REFUSED, unknown flag --DELIVERED; this command takes /],
    [['--delivered=1'], /^prompt-regression: REFUSED, Option '--delivered' does not take an argument/],
    [
      ['--advisory', '--bogus', '--delivered', '--since', '2026-09-05', '--n', '2'],
      /^prompt-regression: REFUSED, unknown flag --bogus; this command takes /
    ]
  ];
  for (const [args, pattern] of cases) {
    const r = prompt(root, args);
    assert.equal(r.status, 2, `${JSON.stringify(args)}: exit ${r.status}\n${r.stdout}${r.stderr}`);
    assert.deepEqual(r.out, [], `${JSON.stringify(args)}: REFUSED goes to stderr, nothing on stdout`);
    assert.match(r.err[0], pattern, JSON.stringify(args));
  }
});

test('an empty-string argument is refused with exit 2, the shape an unset $FLAGS takes in a caller script', () => {
  const root = promptTree();
  const r = prompt(root, ['']);
  assert.equal(r.status, 2, `exit ${r.status}\n${r.stdout}${r.stderr}`);
  assert.deepEqual(r.out, [], 'REFUSED goes to stderr, nothing on stdout');
  assert.match(r.err[0], /^prompt-regression: REFUSED, Unexpected argument ''/);
});

test('a value-flag whose value looks like another flag is refused as ambiguous, never taken as the literal value', () => {
  const root = promptTree();
  for (const args of [
    ['--file', '--since', '2026-01-01'],
    ['--delivered', '--n', '-1'],
    ['--delivered', '--n', '--advisory']
  ]) {
    const r = prompt(root, args);
    assert.equal(r.status, 2, `${JSON.stringify(args)}: exit ${r.status}\n${r.stdout}${r.stderr}`);
    assert.match(r.err[0], /^prompt-regression: REFUSED, Option '--\w+' argument is ambiguous\./, JSON.stringify(args));
  }
});

test('a known flag given no value REFUSES too, the same operator edge rule as an unknown one', () => {
  const root = promptTree();
  for (const args of [
    ['--delivered', '--n'],
    ['--delivered', '--since']
  ]) {
    const r = prompt(root, args);
    assert.equal(r.status, 2, `${JSON.stringify(args)}: exit ${r.status}\n${r.stdout}${r.stderr}`);
    assert.match(
      r.err[0],
      /^prompt-regression: REFUSED, Option '--\w+ <value>' argument missing/,
      JSON.stringify(args)
    );
  }
});

test('the generator step 3b call (--advisory alone) is unaffected, and a repeated flag or a flag --delivered/--n/--advisory never need is still accepted', () => {
  const root = promptTree();
  assert.equal(prompt(root, ['--advisory']).status, 0, 'the generator step 3b call, fixed arguments only');
  for (const args of [
    ['--delivered', '--file', 'nope.md', '--file', 'outputs/prompting/2026-09-01/a.md'],
    ['--file', 'nope.md'],
    ['--n', '1', '--advisory']
  ]) {
    assert.notEqual(
      prompt(root, args).status,
      2,
      `${JSON.stringify(args)} names only known flags, each given a value, and must not be refused`
    );
  }
});
