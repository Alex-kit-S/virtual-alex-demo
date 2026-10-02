#!/usr/bin/env node
// @ts-check
// scripts/tests/test-status-rotate-ledger.mjs - the two vault writers every online Routine runs at close-out.
//
// WHAT. Pins scripts/status-rotate.js, which moves the oldest dated blocks of an over-budget status page to
// its yearly history, and scripts/outputs-ledger.js, the deliverables ledger and its two generated INDEX
// files, as they behave today. For status-rotate: its modes and their exact lines, --project in both forms
// and which project a run picks, the last line and the exit codes close-out-online.sh, run-job.mjs and
// run-vault-index.ps1 read (0 ran, 1 failed, 2 deferred), the whole-block move, a block that shares a moved
// block's heading kept whole, each read-back check seen failing, the journal row written first, the History
// section with an owner's History block kept, and the write lock. For the ledger: its five commands with
// their first and last lines, the VALIDATE FAIL sentence test-check-mjs.mjs looks for, the row keys and their
// order, the latest row per path, and both INDEX files. Deleted, a close-out that loses a status block,
// rotates the wrong pages or breaks the ledger would pass with every other test green.
//
// HOW. Every fixture is a throwaway tree in the OS temp folder with the real scripts copied in
// (status-rotate beside the write lock only, as the close-out runtime tests copy it), a synthetic manifest
// and status pages of generated filler, so every byte count is reproducible. The plan's sizes are derived
// with the script's own splitBlocks; the shared-heading test types its two sizes, which pin that page's
// exact result. A preload file corrupts one write to show a read-back check failing. Children run with every
// ALEX_ variable removed.
//
// NEVER. Writes outside its temp folder, which it removes at the end, or reaches a network or a git
// repository. Flips a PINNED DEFECT assertion on its own: each pins today's behaviour, and only a FIX row in
// the ratchet flips one. R8-5: the Kit's own commands write outputs/ folders that validate, and so C12,
// rejects. R8-6: one torn ledger line bricks add, reconcile and render. R8-22: add takes a path outside
// outputs/ and renders an unescaped pipe, and validate, render and reconcile crash when outputs/ is missing.
//
// Usage: node scripts/tests/test-status-rotate-ledger.mjs
// Exit: 0 every test passed - 1 a test failed

import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

/** @typedef {{ heading: string, body: string, date: string | null, bytes: number }} Block */

const KIT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
/** The separator the INDEX puts between links, written as an escape so this file stays ASCII. */
const DOT = String.fromCharCode(0xb7);
/** @type {{ splitBlocks: (text: string) => { head: string, blocks: Block[] } }} */
const { splitBlocks } = createRequire(import.meta.url)(path.join(KIT, 'scripts', 'status-rotate.js'));
const TMP = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'alex-c5-sr-')));
after(() => fs.rmSync(TMP, { recursive: true, force: true }));

const BUDGET = 25600;
let n = 0;
/**
 * Write a file in a fixture tree, making its folders.
 * @param {string} root
 * @param {string} rel
 * @param {string} content
 */
function put(root, rel, content) {
  fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
  fs.writeFileSync(path.join(root, rel), content);
}
/** This process's environment without an ALEX_ variable, so no switch of the real session reaches a child. */
function env() {
  /** @type {Record<string, string | undefined>} */
  const e = {};
  for (const [k, v] of Object.entries(process.env)) if (!/^ALEX_/.test(k)) e[k] = v;
  return e;
}
/**
 * Run one of the tree's scripts from the tree's root.
 * @param {string} root
 * @param {string} script its name under scripts/
 * @param {string[]} [args]
 */
function run(root, script, args = []) {
  const r = spawnSync(process.execPath, [path.join(root, 'scripts', script), ...args], {
    cwd: root,
    env: env(),
    encoding: 'utf8'
  });
  return { status: r.status, stdout: r.stdout, stderr: r.stderr, lines: r.stdout.trimEnd().split('\n') };
}
/**
 * Write a status page from a block list, "heading@bytes[@marker]", comma separated, and return its size. A
 * heading carrying a date is movable; the body is deterministic filler, so every byte count is reproducible.
 * @param {string} root
 * @param {string} rel
 * @param {string} spec
 */
function statusPage(root, rel, spec) {
  let t = '---\ntags: [project]\n---\n# Status\n\n';
  for (const part of spec.split(',')) {
    const [h, bytes, mark] = part.split('@');
    t += `## ${h}\n${mark ? `${mark} ` : ''}${'x'.repeat(Number(bytes || 10))}\n\n`;
  }
  put(root, rel, t);
  return Buffer.byteLength(t);
}
/**
 * A fixture tree holding status-rotate beside the write lock, and a manifest listing these projects.
 * @param {Array<[string, number]>} [projects] name and number of each project
 */
function rotateTree(
  projects = [
    ['radar', 15],
    ['triage', 7]
  ]
) {
  const root = path.join(TMP, `r${++n}`);
  fs.mkdirSync(path.join(root, 'scripts', 'lib'), { recursive: true });
  fs.copyFileSync(path.join(KIT, 'scripts', 'status-rotate.js'), path.join(root, 'scripts', 'status-rotate.js'));
  // write-lock.js beside the libraries status-rotate.js requires for its unknown-flag warning.
  for (const lib of ['write-lock.js', 'args.js', 'errors.js', 'exit-codes.js']) {
    fs.copyFileSync(path.join(KIT, 'scripts', 'lib', lib), path.join(root, 'scripts', 'lib', lib));
  }
  put(
    root,
    'system/manifest.json',
    JSON.stringify(
      {
        meta: { vault: { status_byte_budget: BUDGET } },
        projects: projects.map(([name, num]) => ({ name, num, status_md: `vault/projects/${name}/status.md` }))
      },
      null,
      2
    )
  );
  return root;
}
/** @param {string} root @param {string[]} [args] */
const rotate = (root, args = []) => run(root, 'status-rotate.js', args);
/** @param {string} root @param {string} rel */
const readFile = (root, rel) => fs.readFileSync(path.join(root, rel), 'utf8');
/** @param {string} root @returns {any[]} the journal's rows, parsed */
const journal = (root) =>
  fs
    .readFileSync(path.join(root, 'system', 'status-rotate-journal.jsonl'), 'utf8')
    .trimEnd()
    .split('\n')
    .map((l) => JSON.parse(l));

// ---------------------------------------------------------------- status-rotate
// The two oldest of four dated blocks must move before the page fits, so the loop's "keep the newest"
// guard is not what stops it. Sizes are derived from the file with the script's own splitBlocks, so the
// assertion pins the arithmetic rather than a number typed by hand.
const FOUR_DATED =
  'Standing@300,2026-01-05 run@9000,2026-03-01 run@9000,2026-06-01 run@9000,2026-08-01 run@9000,2026-09-01 run@500';
/**
 * The bytes of the two oldest blocks of a FOUR_DATED page, measured with the script's own splitBlocks.
 * @param {string} root
 * @param {string} rel
 */
function projectedAfterTwo(root, rel) {
  const { blocks } = splitBlocks(fs.readFileSync(path.join(root, rel), 'utf8'));
  const moved = blocks.filter((b) => b.date === '2026-01-05' || b.date === '2026-03-01');
  assert.equal(moved.length, 2);
  return moved.reduce((n2, b) => n2 + b.bytes, 0);
}

test('status-rotate: a page over budget moves its OLDEST dated blocks whole, keeps the newest dated block, writes a journal row first and a History pointer section, and verifies from disk', () => {
  const root = rotateTree([['radar', 15]]);
  const before = statusPage(root, 'vault/projects/radar/status.md', FOUR_DATED);
  const movedBytes = projectedAfterTwo(root, 'vault/projects/radar/status.md');
  const r = rotate(root);
  assert.equal(r.status, 0);
  const after = Buffer.byteLength(readFile(root, 'vault/projects/radar/status.md'));
  assert.deepEqual(r.lines, [
    `  radar: ${before} B -> ~${before - movedBytes} B, moving 2 block(s): 2026-01-05, 2026-03-01`,
    `    rotated + verified: ${before} -> ${after} B (2 blocks to history/)`,
    `status-rotate: 2 block(s) moved across 1 status file(s), budget ${BUDGET} B`
  ]);
  assert.ok(after <= BUDGET && before > BUDGET);
  const status = readFile(root, 'vault/projects/radar/status.md');
  assert.ok(status.startsWith('---\ntags: [project]\n---\n# Status\n'), 'the frontmatter and preamble never move');
  assert.ok(!status.includes('## 2026-01-05 run') && !status.includes('## 2026-03-01 run'));
  assert.ok(
    status.includes('## 2026-06-01 run') && status.includes('## 2026-09-01 run'),
    'the newest dated block is kept even though the file is still over budget'
  );
  assert.ok(
    status.endsWith(
      '## History (rotated archives)\n\nOlder dated blocks live in append-only yearly archives (moved whole by scripts/status-rotate.js, journaled):\n- [[projects/radar/history/status-2026]]\n'
    )
  );
  const hist = readFile(root, 'vault/projects/radar/history/status-2026.md');
  assert.ok(hist.startsWith('---\ntags: [project, radar, history, archive]\ncreated: '));
  assert.ok(hist.includes('# radar - status history 2026'));
  assert.ok(hist.includes('## 2026-01-05 run') && hist.includes('## 2026-03-01 run'), 'both moved blocks, verbatim');
  const rows = journal(root);
  assert.deepEqual(
    rows.map((x) => Object.keys(x)),
    [
      ['ts', 'project', 'date', 'bytes', 'heading', 'to'],
      ['ts', 'project', 'date', 'bytes', 'heading', 'to']
    ]
  );
  assert.deepEqual(
    rows.map((x) => [x.project, x.date, x.bytes, x.heading, x.to]),
    [
      ['radar', '2026-01-05', movedBytes / 2, '## 2026-01-05 run', 'vault/projects/radar/history/status-2026.md'],
      ['radar', '2026-03-01', movedBytes / 2, '## 2026-03-01 run', 'vault/projects/radar/history/status-2026.md']
    ],
    "the row carries the block's own byte count, the heading verbatim and the repo-relative history path"
  );
  assert.match(rows[0].ts, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
  const second = rotate(root);
  assert.deepEqual(
    second.lines.at(-1),
    `status-rotate: 0 block(s) moved across 1 status file(s), budget ${BUDGET} B`,
    'a page under budget is untouched'
  );
});

test('status-rotate --dry reports what would move, touches nothing, and says (dry) in its last line', () => {
  const root = rotateTree([['radar', 15]]);
  const before = statusPage(root, 'vault/projects/radar/status.md', FOUR_DATED);
  const movedBytes = projectedAfterTwo(root, 'vault/projects/radar/status.md');
  const text = readFile(root, 'vault/projects/radar/status.md');
  const r = rotate(root, ['--dry']);
  assert.equal(r.status, 0);
  assert.deepEqual(r.lines, [
    `  radar: ${before} B -> ~${before - movedBytes} B, moving 2 block(s): 2026-01-05, 2026-03-01`,
    '    would move: ## 2026-01-05 run',
    '    would move: ## 2026-03-01 run',
    `status-rotate: (dry) 2 block(s) would move across 1 status file(s), budget ${BUDGET} B`
  ]);
  assert.equal(readFile(root, 'vault/projects/radar/status.md'), text);
  assert.ok(!fs.existsSync(path.join(root, 'vault', 'projects', 'radar', 'history')));
  assert.ok(!fs.existsSync(path.join(root, 'system', 'status-rotate-journal.jsonl')));
});

test('status-rotate: an over-budget page with nothing movable says so and moves nothing; a missing status.md is skipped; --project=NAME limits the run', () => {
  const root = rotateTree();
  const one = statusPage(root, 'vault/projects/triage/status.md', 'Standing@27000');
  statusPage(root, 'vault/projects/radar/status.md', 'Standing@100,2026-09-10 only dated@27000');
  const r = rotate(root);
  assert.equal(r.status, 0);
  assert.ok(
    r.lines.includes(
      `  triage: ${one} B over budget but nothing movable (undated or single dated block) - C24 will amber`
    )
  );
  assert.ok(
    r.lines.some((l) => /^ {2}radar: \d+ B over budget but nothing movable/.test(l)),
    'a single dated block is never moved'
  );
  assert.equal(r.lines.at(-1), `status-rotate: 0 block(s) moved across 2 status file(s), budget ${BUDGET} B`);
  const only = rotate(root, ['--project=radar']);
  assert.equal(only.lines.at(-1), `status-rotate: 0 block(s) moved across 1 status file(s), budget ${BUDGET} B`);
  fs.rmSync(path.join(root, 'vault', 'projects', 'triage', 'status.md'));
  assert.equal(
    rotate(root).lines.at(-1),
    `status-rotate: 0 block(s) moved across 1 status file(s), budget ${BUDGET} B`
  );
});

test('status-rotate: a held write lock DEFERS with exit 2 and the reason (the close-out reads that line); a manifest with no byte budget FAILS with exit 1', () => {
  const root = rotateTree([['radar', 15]]);
  statusPage(
    root,
    'vault/projects/radar/status.md',
    'Standing@300,2026-01-05 run@9000,2026-09-01 run@9000,2026-06-01 run@9000'
  );
  put(
    root,
    '.alex-lock-alex-surfaces/holder.json',
    JSON.stringify({ label: 'fixture-holder', pid: 4242, since: '2026-09-20T10:00:00.000Z' })
  );
  const held = rotate(root);
  assert.equal(held.status, 2);
  assert.equal(
    held.lines.at(-1),
    'status-rotate: deferred - held by fixture-holder (pid 4242) since 2026-09-20T10:00:00.000Z'
  );
  assert.ok(!fs.existsSync(path.join(root, 'system', 'status-rotate-journal.jsonl')), 'a deferred run writes nothing');
  fs.rmSync(path.join(root, '.alex-lock-alex-surfaces'), { recursive: true });
  const m = JSON.parse(readFile(root, 'system/manifest.json'));
  delete m.meta.vault.status_byte_budget;
  put(root, 'system/manifest.json', JSON.stringify(m));
  const failed = rotate(root);
  assert.equal(failed.status, 1);
  assert.equal(failed.stderr, 'status-rotate FAILED: meta.vault.status_byte_budget missing from manifest\n');
});

test('status-rotate exports splitBlocks, rotateFile and main; splitBlocks keeps the head, reads the date out of the heading and counts bytes per block', async () => {
  const mod = await import(`file:///${path.join(KIT, 'scripts', 'status-rotate.js').replace(/\\/g, '/')}`);
  assert.deepEqual(Object.keys(mod.default), ['splitBlocks', 'rotateFile', 'main']);
  const { splitBlocks } = mod.default;
  const parsed = splitBlocks('---\nfm\n---\n# H1\n\n## 2026-01-05 run\nbody\n\n## Standing\nmore\n');
  assert.equal(parsed.head, '---\nfm\n---\n# H1\n');
  assert.deepEqual(
    parsed.blocks.map((/** @type {Block} */ b) => [b.heading, b.date, b.bytes]),
    [
      ['## 2026-01-05 run', '2026-01-05', 23],
      ['## Standing', null, 17]
    ]
  );
  assert.deepEqual(splitBlocks('# no h2 at all\n'), { head: '# no h2 at all\n', blocks: [] });
});

test('status-rotate: a block sharing a heading with a moved block STAYS in status.md whole, while the moved one reaches history; the run prints "rotated + verified", exits 0 and journals one row', () => {
  const root = rotateTree([['radar', 15]]);
  const before = statusPage(
    root,
    'vault/projects/radar/status.md',
    'Standing@30,2026-01-05 run@9000@FIRST-COPY,2026-09-01 run@20,2026-01-05 run@9000@UNIQUE-SECOND-BODY,2026-03-01 run@9000'
  );
  const second = splitBlocks(readFile(root, 'vault/projects/radar/status.md')).blocks[3];
  assert.ok(second.body.includes('UNIQUE-SECOND-BODY'));
  const r = rotate(root);
  assert.equal(r.status, 0);
  assert.deepEqual(r.lines, [
    `  radar: ${before} B -> ~18178 B, moving 1 block(s): 2026-01-05`,
    `    rotated + verified: ${before} -> 18358 B (1 blocks to history/)`,
    `status-rotate: 1 block(s) moved across 1 status file(s), budget ${BUDGET} B`
  ]);
  const status = readFile(root, 'vault/projects/radar/status.md');
  const hist = readFile(root, 'vault/projects/radar/history/status-2026.md');
  /** @param {string} t @param {string} s */
  const count = (t, s) => t.split(s).length - 1;
  assert.equal(Buffer.byteLength(status), 18358);
  assert.deepEqual(
    [count(status, 'FIRST-COPY'), count(hist, 'FIRST-COPY')],
    [0, 1],
    'the first copy moved, as intended'
  );
  assert.deepEqual(
    [count(status, 'UNIQUE-SECOND-BODY'), count(hist, 'UNIQUE-SECOND-BODY')],
    [1, 0],
    'the second block stays in status.md and nowhere else'
  );
  assert.ok(status.includes(second.body.trimEnd()), 'whole: its heading and every byte of its body');
  assert.equal(count(status, '## 2026-01-05 run'), 1);
  assert.deepEqual(
    journal(root).map((x) => [x.date, x.heading]),
    [['2026-01-05', '## 2026-01-05 run']],
    'the journal records the one block that moved'
  );
});

test('status-rotate: --project in its space form ("--project NAME") limits the run exactly as --project=NAME does; a --project naming nothing still limits nothing', () => {
  const root = rotateTree();
  statusPage(root, 'vault/projects/radar/status.md', 'Standing@100');
  statusPage(root, 'vault/projects/triage/status.md', 'Standing@100');
  /** @param {number} files */
  const across = (files) => `status-rotate: 0 block(s) moved across ${files} status file(s), budget ${BUDGET} B`;
  for (const [args, last] of /** @type {Array<[string[], string]>} */ ([
    [['--project=radar'], across(1)],
    [['--project', 'radar'], across(1)],
    [['--project', 'radar', '--project=triage'], across(1)],
    [['--project=nonexistent'], across(0)],
    [['--project', 'nonexistent'], across(0)],
    [['--project'], across(2)],
    [['--project', '--dry'], `status-rotate: (dry) 0 block(s) would move across 2 status file(s), budget ${BUDGET} B`],
    [[], across(2)]
  ])) {
    const r = rotate(root, args);
    assert.deepEqual([r.status, r.stderr, r.lines.at(-1)], [0, '', last], args.join(' ') || '(none)');
  }
});

test('status-rotate --project: the FIRST one given wins in either form, a flag-shaped value names nothing, --project=NAME=x names NAME, and an empty --project= stops the search', () => {
  /** @type {Array<[string[], 'radar' | 'triage' | 'both']>} the arguments and the pages they run over */
  const cases = [
    [['--project', 'radar', '--project=triage'], 'radar'],
    [['--project', 'triage', '--project=radar'], 'triage'],
    [['--project=triage', '--project', 'radar'], 'triage'],
    [['--project=radar=x'], 'radar'],
    [['--project', '-x'], 'both'],
    [['--project', '--project=radar'], 'radar'],
    [['--project=', '--project', 'radar'], 'both']
  ];
  for (const [args, runs] of cases) {
    const root = rotateTree();
    statusPage(root, 'vault/projects/radar/status.md', FOUR_DATED);
    statusPage(root, 'vault/projects/triage/status.md', 'Standing@100');
    const r = rotate(root, args);
    const [moved, files] = { radar: [2, 1], triage: [0, 1], both: [2, 2] }[runs];
    assert.deepEqual(
      [r.status, r.stderr, r.lines.some((l) => l.startsWith('  radar: ')), r.lines.at(-1)],
      [
        0,
        '',
        runs !== 'triage',
        `status-rotate: ${moved} block(s) moved across ${files} status file(s), budget ${BUDGET} B`
      ],
      `${args.join(' ')}: only the over-budget radar page prints a line, so the line shows whether radar ran`
    );
  }
});

/**
 * The History section status-rotate writes for radar, linking these years.
 * @param {string[]} years
 */
const historySection = (years) =>
  '## History (rotated archives)\n\nOlder dated blocks live in append-only yearly archives (moved whole by scripts/status-rotate.js, journaled):\n' +
  years.map((y) => `- [[projects/radar/history/status-${y}]]\n`).join('');
/** @param {string} t @param {string} s how many times s occurs in t */
const occurrences = (t, s) => t.split(s).length - 1;

test('status-rotate rewrites only the History section a run wrote: a "## History (rotated ...)" block the owner wrote stays whole, run after run', () => {
  const root = rotateTree([['radar', 15]]);
  const rel = 'vault/projects/radar/status.md';
  statusPage(root, rel, FOUR_DATED);
  const owners =
    '## History (rotated notes)\n\nThe owner wrote this: keep the 2022 link.\n- [[projects/radar/history/status-2022]]';
  put(
    root,
    rel,
    `${readFile(root, rel)}## History (rotated archives)\n\n- [[projects/radar/history/status-2023]]\n\n${owners}\n`
  );
  const first = rotate(root);
  assert.deepEqual([first.status, first.stderr, first.lines.length], [0, '', 3]);
  assert.match(first.lines[1], /^ {4}rotated \+ verified: \d+ -> \d+ B \(2 blocks to history\/\)$/);
  let status = readFile(root, rel);
  assert.ok(
    status.endsWith(`## 2026-09-01 run\n${'x'.repeat(500)}\n\n${owners}\n\n${historySection(['2023', '2026'])}`),
    "the owner's block stays whole where it stood, and the section the run wrote is rewritten with its links carried over"
  );
  assert.deepEqual([occurrences(status, owners), occurrences(status, '## History (rotated archives)')], [1, 1]);
  assert.ok(!readFile(root, 'vault/projects/radar/history/status-2026.md').includes('The owner wrote this'));

  put(root, rel, `${status}\n## 2026-10-01 run\n${'x'.repeat(9000)}\n\n## 2026-11-01 run\n${'x'.repeat(9000)}\n`);
  const second = rotate(root);
  assert.deepEqual([second.status, second.stderr], [0, '']);
  assert.match(second.lines[0], /moving 2 block\(s\): 2026-06-01, 2026-08-01$/);
  status = readFile(root, rel);
  assert.deepEqual(
    [occurrences(status, owners), occurrences(status, '## History (rotated archives)')],
    [1, 1],
    "a later run takes the section it wrote for its own, never the owner's block before it"
  );
  assert.ok(status.endsWith(`## 2026-11-01 run\n${'x'.repeat(9000)}\n\n${historySection(['2023', '2026'])}`));
  assert.ok(status.indexOf(owners) < status.indexOf('## 2026-10-01 run'));
});

test('status-rotate: when two blocks carry the exact heading it writes, the LAST is the section a run wrote, and one above it stays whole', () => {
  const root = rotateTree([['radar', 15]]);
  const rel = 'vault/projects/radar/status.md';
  statusPage(root, rel, FOUR_DATED);
  const handCopy = '## History (rotated archives)\n\nA copy the owner kept by hand.';
  const text = readFile(root, rel).replace('## 2026-09-01 run', `${handCopy}\n\n## 2026-09-01 run`);
  put(root, rel, `${text}## History (rotated archives)\n\n- [[projects/radar/history/status-2024]]\n`);
  const r = rotate(root);
  assert.deepEqual([r.status, r.stderr], [0, '']);
  const status = readFile(root, rel);
  assert.equal(occurrences(status, handCopy), 1, 'the copy above stays, word for word');
  assert.ok(status.endsWith(`${'x'.repeat(500)}\n\n${historySection(['2024', '2026'])}`));
});

test('status-rotate finds the section it wrote on a CRLF page too, so a page saved with CRLF endings keeps ONE History section', () => {
  const root = rotateTree([['radar', 15]]);
  const rel = 'vault/projects/radar/status.md';
  statusPage(root, rel, FOUR_DATED);
  const text = `${readFile(root, rel)}## History (rotated archives)\n\n- [[projects/radar/history/status-2024]]\n`;
  put(root, rel, text.replace(/\n/g, '\r\n'));
  assert.equal(rotate(root).status, 0);
  const status = readFile(root, rel);
  assert.equal(occurrences(status, '## History (rotated archives)'), 1);
  assert.ok(status.endsWith(historySection(['2024', '2026'])), 'its year link carried over');
});

// The read-back can only be seen failing when a write goes wrong, so a preload corrupts one write, chosen by
// SR_FAULT, over a page where a kept block shares the moved block's heading: the case the read-back is for.
const SHARED_HEADING =
  'Standing@30,2026-01-05 run@9000@FIRST-COPY,2026-09-01 run@20,2026-01-05 run@9000@UNIQUE-SECOND-BODY,2026-03-01 run@9000';
const FAULTS = path.join(TMP, 'status-rotate-faults.cjs');
fs.writeFileSync(
  FAULTS,
  [
    "const fs = require('node:fs');",
    'const fault = process.env.SR_FAULT;',
    'const write = fs.writeFileSync;',
    'const append = fs.appendFileSync;',
    'fs.writeFileSync = function (file, data, ...rest) {',
    "  const staging = String(file).endsWith('.staging');",
    "  if (staging && fault === 'drop-kept') data = data.replace('UNIQUE-SECOND-BODY ', '');",
    "  if (staging && fault === 'keep-moved') data += '\\n## 2026-01-05 run\\nFIRST-COPY\\n';",
    '  return write.call(fs, file, data, ...rest);',
    '};',
    'fs.appendFileSync = function (file, data, ...rest) {',
    '  const history = /status-\\d{4}\\.md$/.test(String(file));',
    "  if (history && fault === 'drop-history') data = data.replaceAll('## 2026-01-05 run', '## (lost)');",
    "  if (history && fault === 'history-fails') throw new Error('injected: the history append failed');",
    '  return append.call(fs, file, data, ...rest);',
    '};',
    ''
  ].join('\n')
);
/**
 * Rotate a SHARED_HEADING page for radar with one write corrupted by FAULTS.
 * @param {string} fault
 */
function rotateWithFault(fault) {
  const root = rotateTree([['radar', 15]]);
  statusPage(root, 'vault/projects/radar/status.md', SHARED_HEADING);
  const page = readFile(root, 'vault/projects/radar/status.md');
  const r = spawnSync(process.execPath, ['--require', FAULTS, path.join(root, 'scripts', 'status-rotate.js')], {
    cwd: root,
    env: { ...env(), SR_FAULT: fault },
    encoding: 'utf8'
  });
  const radar = path.join(root, 'vault', 'projects', 'radar');
  return { root, radar, page, status: r.status, stderr: r.stderr, lines: r.stdout.trimEnd().split('\n') };
}

test('status-rotate read-back: a kept block missing from the status.md it wrote FAILS the run, exit 1, naming the block', () => {
  const r = rotateWithFault('drop-kept');
  assert.equal(r.status, 1);
  assert.equal(
    r.stderr,
    `status-rotate FAILED: VERIFY FAIL: "## 2026-01-05 run" missing from ${path.join(r.radar, 'status.md')}\n`
  );
  assert.equal(r.lines.length, 1, 'the plan line only: no "rotated + verified", no summary');
});

test('status-rotate read-back: a moved heading left in status.md more often than the kept blocks carry it FAILS the run', () => {
  const r = rotateWithFault('keep-moved');
  assert.equal(r.status, 1);
  assert.equal(
    r.stderr,
    `status-rotate FAILED: VERIFY FAIL: "## 2026-01-05 run" still in ${path.join(r.radar, 'status.md')}\n`
  );
  assert.equal(r.lines.length, 1);
});

test('status-rotate read-back: a moved heading missing from its history file FAILS the run, naming that file', () => {
  const r = rotateWithFault('drop-history');
  assert.equal(r.status, 1);
  assert.equal(
    r.stderr,
    `status-rotate FAILED: VERIFY FAIL: "## 2026-01-05 run" missing from ${path.join(r.radar, 'history', 'status-2026.md')}\n`
  );
  assert.equal(r.lines.length, 1);
});

test('status-rotate writes the journal row BEFORE any other write: a failed history append leaves the row, and status.md as it was', () => {
  const r = rotateWithFault('history-fails');
  assert.equal(r.status, 1);
  assert.equal(r.stderr, 'status-rotate FAILED: injected: the history append failed\n');
  assert.deepEqual(
    journal(r.root).map((x) => [x.date, x.heading]),
    [['2026-01-05', '## 2026-01-05 run']]
  );
  assert.equal(readFile(r.root, 'vault/projects/radar/status.md'), r.page, 'status.md was never rewritten');
});

test('an unknown flag warns on stderr and the run carries on exactly as it would without it (a Routine edge never refuses one)', () => {
  const root = rotateTree([['radar', 15]]);
  const clean = rotate(root);
  const withTypo = rotate(root, ['--dryrun']);
  assert.equal(withTypo.status, 0);
  assert.equal(withTypo.stderr, 'status-rotate: WARNING - ignored --dryrun: unknown flag --dryrun\n');
  assert.deepEqual(withTypo.lines, clean.lines, 'the same run as with no flag at all: --dryrun is not --dry');
  const secondRoot = rotateTree([['radar', 15]]);
  const dryWithTypo = rotate(secondRoot, ['--dry', '--project=radar', '--bogus']);
  const dryClean = rotate(rotateTree([['radar', 15]]), ['--dry', '--project=radar']);
  assert.equal(dryWithTypo.status, 0);
  assert.equal(dryWithTypo.stderr, 'status-rotate: WARNING - ignored --bogus: unknown flag --bogus\n');
  assert.deepEqual(dryWithTypo.lines, dryClean.lines, '--dry and --project still take effect beside the warning');
  // This program takes no bare words at all, so an unknown flag's warning swallows the word right after it
  // too (args.js's own allowPositionals:false rule), the same way a stray positional alone is silently
  // dropped with no warning at all (asserted elsewhere): the two are the same "no bare words here" fact.
  const thirdRoot = rotateTree([['radar', 15]]);
  const withSwallowed = rotate(thirdRoot, ['--bogus', 'somebareword']);
  assert.equal(withSwallowed.stderr, 'status-rotate: WARNING - ignored --bogus somebareword: unknown flag --bogus\n');
  assert.deepEqual(withSwallowed.lines, clean.lines);
});

test('status-rotate.js: every flag the Usage: header documents is a key of FLAGS, and every key of FLAGS is documented in Usage', () => {
  const source = fs.readFileSync(path.join(KIT, 'scripts', 'status-rotate.js'), 'utf8');
  const usageBlock = source.slice(source.indexOf('// Usage:'), source.indexOf('// Exit:'));
  const usageFlags = new Set([...usageBlock.matchAll(/--([a-z][a-z-]*)\b/g)].map((m) => m[1]));
  const tableFlags = new Set(
    [...source.matchAll(/const FLAGS = (\{[\s\S]*?\};)/g)]
      .flatMap((m) => [...m[1].matchAll(/(\w+): \{ type:/g)])
      .map((m) => m[1])
  );
  assert.deepEqual([...usageFlags].sort(), [...tableFlags].sort());
});

// ---------------------------------------------------------------- outputs-ledger
/** A fixture tree holding outputs-ledger alone, a manifest, and outputs/ folders of every kind it meets. */
function ledgerTree() {
  const root = path.join(TMP, `l${++n}`);
  fs.mkdirSync(path.join(root, 'scripts', 'lib'), { recursive: true });
  fs.copyFileSync(path.join(KIT, 'scripts', 'outputs-ledger.js'), path.join(root, 'scripts', 'outputs-ledger.js'));
  // warnUnknownFlags and manifestNames() (readJsonHeaderless) require these beside the script.
  for (const lib of ['args.js', 'errors.js', 'exit-codes.js', 'json-writer.js']) {
    fs.copyFileSync(path.join(KIT, 'scripts', 'lib', lib), path.join(root, 'scripts', 'lib', lib));
  }
  put(
    root,
    'system/manifest.json',
    JSON.stringify({ meta: { unnumbered: [{ name: 'voice' }] }, projects: [{ name: 'radar' }, { name: 'prompting' }] })
  );
  put(root, 'vault/.keep', '');
  put(root, 'outputs/radar/2026-09-20/brief.md', 'brief\n');
  put(root, 'outputs/sessions/2026-09-19-topic/notes.md', 'notes\n');
  put(root, 'outputs/prompting/2026-09-22/prompt.md', 'p\n');
  put(root, 'outputs/logs/x.log', 'a stream, never ledgered\n');
  put(root, 'outputs/radar/2026-09-20/tmp.tmp', 'skip\n');
  put(root, 'outputs/radar/2026-09-20/Model.SemanticModel/model.json', '{}\n');
  return root;
}
/** @param {string} root @param {string[]} args */
const ledger = (root, args) => run(root, 'outputs-ledger.js', args);
/** @param {string} root @returns {any[]} the ledger's rows, parsed */
const rows = (root) =>
  fs
    .readFileSync(path.join(root, 'outputs', 'ledger.jsonl'), 'utf8')
    .trimEnd()
    .split('\n')
    .map((l) => JSON.parse(l));

test('the ledger: validate, reconcile (the streams, the temp extension and the bundle internals skipped), the row keys and their order, and both generated INDEX files', () => {
  const root = ledgerTree();
  const v = ledger(root, ['validate']);
  assert.deepEqual([v.status, v.lines], [0, ['validate: outputs/ top-level naming clean.']]);
  const r = ledger(root, ['reconcile']);
  assert.equal(r.status, 0);
  assert.deepEqual(r.lines, [
    'reconcile: 3 row(s) added, 3 total. INDEX.md + vault/outputs-index.md rendered.',
    '  + 2026-09-22 prompting outputs/prompting/2026-09-22/prompt.md',
    '  + 2026-09-20 radar outputs/radar/2026-09-20/brief.md',
    '  + 2026-09-19 sessions outputs/sessions/2026-09-19-topic/notes.md'
  ]);
  assert.deepEqual(
    rows(root).map((x) => Object.keys(x)),
    Array(3).fill(['date', 'project', 'kind', 'desc', 'path', 'added'])
  );
  assert.deepEqual(
    rows(root).map((x) => [x.date, x.project, x.kind, x.desc, x.path, x.added]),
    [
      ['2026-09-22', 'prompting', 'md', 'prompt', 'outputs/prompting/2026-09-22/prompt.md', 'backfill'],
      ['2026-09-20', 'radar', 'md', 'brief', 'outputs/radar/2026-09-20/brief.md', 'backfill'],
      ['2026-09-19', 'sessions', 'md', 'notes', 'outputs/sessions/2026-09-19-topic/notes.md', 'backfill']
    ],
    'the date comes from the first dated path segment, the project from the top folder, the desc from the base name'
  );
  const again = ledger(root, ['reconcile']);
  assert.equal(
    again.lines[0],
    'reconcile: 0 row(s) added, 3 total. INDEX.md + vault/outputs-index.md rendered.',
    'idempotent'
  );
  const index = readFile(root, 'outputs/INDEX.md');
  assert.ok(
    index.startsWith(
      '# Outputs Index\n\n**3 deliverables, newest first.** Generated from `outputs/ledger.jsonl` by `scripts/outputs-ledger.js` - never hand-edit. Regenerate: `node scripts/outputs-ledger.js render`. Last generated: '
    )
  );
  assert.ok(
    index.includes(
      '| Date | Project | Kind | What it is | Path | Links |\n|---|---|---|---|---|---|\n| 2026-09-22 | prompting | md | prompt | `outputs/prompting/2026-09-22/prompt.md` |  |'
    )
  );
  const vaultIndex = readFile(root, 'vault/outputs-index.md');
  assert.ok(vaultIndex.startsWith('---\ntags: [index, outputs, generated]\nupdated: '));
  assert.ok(vaultIndex.includes('# Outputs Index (deliverables ledger)'));
  assert.equal(ledger(root, ['render']).lines.at(-1), 'render: 3 rows.');
});

test('validate crashes loudly on a manifest that is not JSON - readJsonHeaderless is a drop-in for a raw JSON.parse(readFileSync(...)), and a bad manifest must still throw, never read as an empty registry', () => {
  const root = ledgerTree();
  put(root, 'system/manifest.json', '{not json');
  const v = ledger(root, ['validate']);
  assert.equal(v.status, 1);
  assert.equal(v.stdout, '');
  assert.match(v.stderr, /SyntaxError/);
  assert.match(v.stderr, /at manifestNames/);
});

test('the ledger: add, its refusals, update-desc superseding a row, links rendered as code in outputs and as wiki links in the vault, and a row whose file is gone dropping out of the INDEX', () => {
  const root = ledgerTree();
  ledger(root, ['reconcile']);
  assert.deepEqual(
    ledger(root, ['add', '--project', 'radar', '--path', 'outputs/radar/2026-09-20/brief.md', '--desc', 'again']).lines,
    ['add: already ledgered: outputs/radar/2026-09-20/brief.md (use update-desc to revise)']
  );
  const missing = ledger(root, [
    'add',
    '--project',
    'radar',
    '--path',
    'outputs/radar/2026-09-30/missing.md',
    '--desc',
    'x'
  ]);
  assert.deepEqual([missing.status, missing.stderr], [1, 'add: file not found: outputs/radar/2026-09-30/missing.md\n']);
  const noDesc = ledger(root, ['add', '--project', 'radar', '--path', 'outputs/radar/2026-09-20/brief.md']);
  assert.deepEqual(
    [noDesc.status, noDesc.stderr],
    [1, 'usage: add --project X --path outputs/... --desc "..." [--link a.md,b]\n']
  );
  put(root, 'outputs/radar/2026-09-23/new.md', 'new\n');
  const add = ledger(root, [
    'add',
    '--project',
    'radar',
    '--path',
    'outputs/radar/2026-09-23/new.md',
    '--desc',
    'the new one',
    '--link',
    'vault/me/goals.md, https://example.invalid/x ,'
  ]);
  assert.deepEqual(add.lines, ['add: 2026-09-23 radar outputs/radar/2026-09-23/new.md +2 link(s)']);
  assert.deepEqual(
    rows(root).at(-1).links,
    ['vault/me/goals.md', 'https://example.invalid/x'],
    'an empty trailing entry is dropped'
  );
  const tick = String.fromCharCode(96);
  assert.ok(
    readFile(root, 'outputs/INDEX.md').includes(
      `| ${tick}vault/me/goals.md${tick} ${DOT} ${tick}https://example.invalid/x${tick} |`
    )
  );
  assert.ok(
    readFile(root, 'vault/outputs-index.md').includes(`| [[me/goals]] ${DOT} https://example.invalid/x |`),
    'a vault .md link becomes a wiki link, anything else is left alone'
  );
  const upd = ledger(root, [
    'update-desc',
    '--path',
    'outputs/radar/2026-09-20/brief.md',
    '--desc',
    'the weekly brief'
  ]);
  assert.deepEqual(upd.lines, ['update-desc: outputs/radar/2026-09-20/brief.md desc revised']);
  assert.deepEqual(
    [rows(root).at(-1).desc, rows(root).at(-1).added],
    ['the weekly brief', 'update'],
    'append-only: a superseding row, never an edit'
  );
  assert.ok(
    readFile(root, 'outputs/INDEX.md').includes('| the weekly brief |'),
    'render shows the latest row per path'
  );
  assert.ok(!readFile(root, 'outputs/INDEX.md').includes('| brief |'));
  const none = ledger(root, ['update-desc', '--path', 'outputs/radar/2026-09-14/none.md', '--desc', 'x']);
  assert.deepEqual(
    [none.status, none.stderr],
    [1, 'update-desc: no ledger row for outputs/radar/2026-09-14/none.md - add it first\n']
  );
  const bare = ledger(root, ['update-desc', '--path', 'outputs/radar/2026-09-20/brief.md']);
  assert.deepEqual(
    [bare.status, bare.stderr],
    [1, 'usage: update-desc --path outputs/... [--desc "..."] [--link a.md,b]\n']
  );
  fs.rmSync(path.join(root, 'outputs', 'radar', '2026-09-23', 'new.md'));
  assert.equal(
    ledger(root, ['render']).lines.at(-1),
    'render: 3 rows.',
    'a row whose file is gone is not rendered, and the ledger line stays'
  );
  assert.equal(rows(root).length, 5);
});

test('the ledger: an unknown command and no command are exit 1 with the usage line; validate names every offending folder in one sorted sentence', () => {
  const root = ledgerTree();
  for (const args of [[], ['bogus']]) {
    const r = ledger(root, args);
    assert.deepEqual(
      [r.status, r.stderr],
      [1, 'usage: outputs-ledger.js <add|update-desc|reconcile|validate|render>\n'],
      args.join(' ') || '(none)'
    );
  }
  put(root, 'outputs/zz-not-a-project/a.md', 'x\n');
  put(root, 'outputs/aa-another/a.md', 'x\n');
  const v = ledger(root, ['validate']);
  assert.equal(v.status, 2);
  assert.deepEqual(v.lines, [
    'VALIDATE FAIL: outputs/ top-level dir(s) not a manifest key or declared exemption: aa-another, zz-not-a-project',
    'Fix: rename to the registry name, or (one-offs) move under outputs/sessions/, or add a justified exemption in scripts/outputs-ledger.js.'
  ]);
});

test('validate accepts a manifest project, an unnumbered project and every declared exemption', () => {
  const root = ledgerTree();
  for (const d of ['logs', 'voice', 'typed', 'sessions', 'radar', 'prompting']) {
    put(root, `outputs/${d}/a.md`, 'x\n');
  }
  assert.deepEqual(
    [ledger(root, ['validate']).status, ledger(root, ['validate']).lines],
    [0, ['validate: outputs/ top-level naming clean.']]
  );
});

test('validate fails on donor folders no Kit command writes: none of them is a declared exemption', () => {
  const root = ledgerTree();
  for (const d of ['cv', 'reports', 'brand', 'architecture', 'building-alex', 'prompting-scheduled', 'explainer']) {
    put(root, `outputs/${d}/a.md`, 'x\n');
  }
  const v = ledger(root, ['validate']);
  assert.equal(v.status, 2);
  assert.equal(
    v.lines[0],
    'VALIDATE FAIL: outputs/ top-level dir(s) not a manifest key or declared exemption: architecture, brand, building-alex, cv, explainer, prompting-scheduled, reports'
  );
});

test("PINNED DEFECT R8-5: the Kit's OWN commands write outputs/ folders validate rejects, so C12 turns amber from the owner's first support bundle", () => {
  const root = ledgerTree();
  put(root, 'outputs/support/2026-09-28.md', 'support page\n');
  put(root, 'outputs/deep-audit/2026-09-28/report.md', 'audit\n');
  put(root, 'outputs/validate-business/2026-09-28/report.md', 'business\n');
  const v = ledger(root, ['validate']);
  assert.equal(v.status, 2);
  assert.equal(
    v.lines[0],
    'VALIDATE FAIL: outputs/ top-level dir(s) not a manifest key or declared exemption: deep-audit, support, validate-business'
  );
  for (const cmd of ['support-bundle.md', 'deep-audit.md']) {
    const f = path.join(KIT, '.claude', 'commands', cmd);
    if (fs.existsSync(f))
      assert.match(fs.readFileSync(f, 'utf8'), /outputs\/(support|deep-audit)\//, `${cmd} still writes that folder`);
  }
});

test('PINNED DEFECT R8-6: one torn ledger line bricks add, reconcile and render (exit 1, a raw SyntaxError), while validate, which never reads the ledger, still answers', () => {
  const root = ledgerTree();
  ledger(root, ['reconcile']);
  const good = fs.readFileSync(path.join(root, 'outputs', 'ledger.jsonl'), 'utf8');
  put(root, 'outputs/ledger.jsonl', good.trimEnd().split('\n').slice(0, 1).join('')); // a last line with no newline
  put(root, 'outputs/radar/2026-09-20/b.md', 'b\n');
  const add = ledger(root, ['add', '--project', 'radar', '--path', 'outputs/radar/2026-09-20/b.md', '--desc', 'b']);
  assert.equal(
    add.status,
    1,
    'the append succeeds, then the render inside the same command dies on the line it just created'
  );
  assert.match(add.stderr, /SyntaxError: Unexpected non-whitespace character after JSON at position \d+/);
  assert.equal(
    fs
      .readFileSync(path.join(root, 'outputs', 'ledger.jsonl'), 'utf8')
      .trimEnd()
      .split('\n').length,
    1,
    'two rows glued onto one line'
  );
  for (const cmd of ['add', 'reconcile', 'render']) {
    const args =
      cmd === 'add' ? ['add', '--project', 'radar', '--path', 'outputs/radar/2026-09-20/b.md', '--desc', 'b'] : [cmd];
    const r = ledger(root, args);
    assert.equal(r.status, 1, cmd);
    assert.match(r.stderr, /SyntaxError: Unexpected non-whitespace character after JSON at position \d+/, cmd);
  }
  assert.equal(ledger(root, ['validate']).status, 0);
});

test('PINNED DEFECT R8-22: add accepts a path OUTSIDE outputs/ (a vault page is then rendered into the committed INDEX) and an unescaped pipe in a desc breaks the table row', () => {
  const root = ledgerTree();
  ledger(root, ['reconcile']);
  put(root, 'vault/secret-2026-09-14.md', 'a private page\n');
  const r = ledger(root, [
    'add',
    '--project',
    'radar',
    '--path',
    'vault/secret-2026-09-14.md',
    '--desc',
    'a | pipe desc'
  ]);
  assert.deepEqual([r.status, r.lines], [0, ['add: 2026-09-14 radar vault/secret-2026-09-14.md']]);
  const index = readFile(root, 'outputs/INDEX.md');
  assert.ok(
    index.includes('| 2026-09-14 | radar | md | a | pipe desc | `vault/secret-2026-09-14.md` |  |'),
    'the path outside outputs/ and the extra column both land in the generated table'
  );
  assert.ok(readFile(root, 'vault/outputs-index.md').includes('vault/secret-2026-09-14.md'));
});

test('PINNED DEFECT R8-22: validate, render and reconcile all crash with a raw ENOENT when outputs/ does not exist (online the close-out and check.mjs shield them)', () => {
  const root = path.join(TMP, `l${++n}`);
  fs.mkdirSync(path.join(root, 'scripts', 'lib'), { recursive: true });
  fs.copyFileSync(path.join(KIT, 'scripts', 'outputs-ledger.js'), path.join(root, 'scripts', 'outputs-ledger.js'));
  for (const lib of ['args.js', 'errors.js', 'exit-codes.js', 'json-writer.js']) {
    fs.copyFileSync(path.join(KIT, 'scripts', 'lib', lib), path.join(root, 'scripts', 'lib', lib));
  }
  put(root, 'system/manifest.json', JSON.stringify({ meta: {}, projects: [] }));
  for (const cmd of ['validate', 'render', 'reconcile']) {
    const r = ledger(root, [cmd]);
    assert.equal(r.status, 1, cmd);
    assert.match(r.stderr, /Error: ENOENT: no such file or directory/, cmd);
  }
});

test('an unknown flag warns on stderr and every command carries on exactly as it would without it (a Routine edge never refuses one)', () => {
  const root = ledgerTree();
  const reconcileClean = ledger(root, ['reconcile']);
  const secondRoot = ledgerTree();
  const reconcileWarned = ledger(secondRoot, ['reconcile', '--typo']);
  assert.equal(reconcileWarned.status, 0);
  assert.equal(
    reconcileWarned.stderr,
    'outputs-ledger: WARNING - ignored --typo: unknown flag --typo\n',
    'exactly one warning, not one per reconcile() and one per its internal render() call'
  );
  assert.deepEqual(reconcileWarned.lines, reconcileClean.lines);
  const validateClean = ledger(root, ['validate']);
  const validateWarned = ledger(root, ['validate', '--typo']);
  assert.equal(validateWarned.stderr, 'outputs-ledger: WARNING - ignored --typo: unknown flag --typo\n');
  assert.deepEqual(validateWarned.lines, validateClean.lines);
  const renderClean = ledger(root, ['render']);
  const renderWarned = ledger(root, ['render', '--typo']);
  assert.equal(renderWarned.stderr, 'outputs-ledger: WARNING - ignored --typo: unknown flag --typo\n');
  assert.deepEqual(renderWarned.lines, renderClean.lines);
  const addArgs = ['add', '--project', 'radar', '--path', 'outputs/radar/2026-09-20/brief.md', '--desc', 'brief'];
  const addRoot = ledgerTree();
  const addClean = ledger(addRoot, addArgs);
  const addWarnedRoot = ledgerTree();
  const addWarned = ledger(addWarnedRoot, [...addArgs, '--typo']);
  assert.equal(addWarned.status, 0);
  assert.equal(addWarned.stderr, 'outputs-ledger: WARNING - ignored --typo: unknown flag --typo\n');
  assert.deepEqual(addWarned.lines, addClean.lines);
  const updateArgs = ['update-desc', '--path', 'outputs/radar/2026-09-20/brief.md', '--desc', 'revised'];
  const updateClean = ledger(addRoot, updateArgs);
  const updateWarned = ledger(addWarnedRoot, [...updateArgs, '--typo']);
  assert.equal(updateWarned.status, 0);
  assert.equal(updateWarned.stderr, 'outputs-ledger: WARNING - ignored --typo: unknown flag --typo\n');
  assert.deepEqual(updateWarned.lines, updateClean.lines);
});

test('outputs-ledger.js: every flag the Usage: header documents is a key of ADD_FLAGS or UPDATE_DESC_FLAGS, and every key of those tables is documented in Usage', () => {
  const source = fs.readFileSync(path.join(KIT, 'scripts', 'outputs-ledger.js'), 'utf8');
  const usageBlock = source.slice(source.indexOf('// Usage:'), source.indexOf('// Exit:'));
  const usageFlags = new Set([...usageBlock.matchAll(/--([a-z][a-z-]*)\b/g)].map((m) => m[1]));
  const tableFlags = new Set(
    [...source.matchAll(/const (?:ADD|UPDATE_DESC)_FLAGS = (\{[\s\S]*?\};)/g)]
      .flatMap((m) => [...m[1].matchAll(/(\w+): \{ type:/g)])
      .map((m) => m[1])
  );
  assert.deepEqual([...usageFlags].sort(), [...tableFlags].sort());
});
