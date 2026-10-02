#!/usr/bin/env node
// scripts/tests/test-routine-prompt-commands.mjs - every command the five Routine prompts
// (scheduler/routines/*.md) tell a model to run against the Routines runtime.
//
// WHAT. Every command line frozen WORD FOR WORD as the prompts carry it at this build, run through bash
// the way the model's Bash tool runs it, with the line or exit code each prompt reads back asserted
// exactly. An owner's Routine is a copy of the prompt text taken at the build they installed; a later
// build ships new code under that old text, so the lines below must keep working whatever the prompts say
// tomorrow. Deleted, it would let a Routine's own command line stop working with nothing in CI noticing
// until an owner's actual scheduled run failed.
//
// HOW. Two separate claims, two separate tests: every FROZEN line still runs and reads back what its
// prompt expects (must hold for ever), and today's prompts carry exactly these lines (a drift check: when
// a prompt is reworded on purpose, that test fails, the old line STAYS in FROZEN, and the new one is added
// beside it). Placeholders (<job>, <COMPLETE|PARTIAL|BLOCKED>, <id>, <N>, ...) are filled the way a model
// fills them; each option of a <A|B|C> list is run. A close-out line whose placeholder VALUE is deleted
// but whose flag is kept (`--model` with no id, `--missed` with no number, an unknown flag altogether)
// warns on stderr, drops that one flag, and every other step and the save still run; only --job and
// --status refuse (close-out-online.sh, test-close-out-online.mjs). The fixture is a throwaway git
// repository with the real runtime copied in and a bare origin, in a temp folder this file deletes. Git
// runs with no system or global config. Nothing reaches a network.
//
// NEVER. Touches the checkout: every fixture lives in the one temp folder this file removes at the end.
// Reaches a network, or edits a FROZEN line in place - a reworded prompt adds a line, it never replaces one.
//
// Usage: node scripts/tests/test-routine-prompt-commands.mjs
// Exit: 0 every test passed - 1 a test failed

import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { findBash } from './fixtures/find-bash.mjs';

const KIT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'alex-routine-cmds-'));
after(() => fs.rmSync(TMP, { recursive: true, force: true, maxRetries: 5 }));

// ---------------------------------------------------------------- the frozen lines
const FROZEN = [
  ['brief.md', 'node scripts/run-log.mjs last brief'],
  ['brief.md', 'node scripts/run-log.mjs last'],
  [
    'brief.md',
    'bash scripts/close-out-online.sh --job brief --status <COMPLETE|PARTIAL|BLOCKED> --canary <ok|missing> --missed <N> --model <id> --lesson "L: none"'
  ],
  ['brief.md', '--status BLOCKED --reason "hooks did not load"'],
  ['housekeeping.md', 'node scripts/run-log.mjs last housekeeping'],
  ['housekeeping.md', 'node work/18-recovery-layer/check.mjs'],
  ['housekeeping.md', 'bash scripts/autosave.sh'],
  ['housekeeping.md', 'node scripts/run-log.mjs last self-review'],
  [
    'housekeeping.md',
    'node scripts/run-log.mjs append --job self-review --status <COMPLETE|PARTIAL> --reason "<one line: what it proposed, or why partial>"'
  ],
  [
    'housekeeping.md',
    'node scripts/run-log.mjs append --job self-review --status SKIPPED --reason "last run <its date>, <D> days ago, the gate is 28 days"'
  ],
  ['housekeeping.md', 'node scripts/run-log.mjs last skills'],
  ['housekeeping.md', '--job skills --status COMPLETE --reason "claude.ai sync: <the list, comma-separated, or none>"'],
  [
    'housekeeping.md',
    '--job skills --status PARTIAL --reason "claude.ai sync changed: was <old list>; now <new list>"'
  ],
  ['housekeeping.md', '--job skills --status BLOCKED --reason "/skills unreadable in this session: <what happened>"'],
  [
    'housekeeping.md',
    'bash scripts/close-out-online.sh --job housekeeping --status <COMPLETE|PARTIAL|BLOCKED> --canary <ok|missing> --missed <N> --model <id> --lesson "L: none"'
  ],
  ['radar.md', 'node scripts/run-log.mjs last radar'],
  [
    'radar.md',
    'bash scripts/close-out-online.sh --job radar --status <COMPLETE|PARTIAL|BLOCKED> --canary <ok|missing> --missed <N> --model <id> --lesson "L: none"'
  ],
  ['snapshot.md', 'node scripts/run-log.mjs last snapshot'],
  ['snapshot.md', 'CLAUDE_PROJECT_DIR=. bash scripts/lib/session-branch.sh'],
  [
    'snapshot.md',
    'node scripts/run-log.mjs append --job snapshot --status <COMPLETE|BLOCKED|RED> --canary missing --missed <N> --model <id> --reason "<the branch that landed, or why not>" --repo <backup_repo> --sha <sha>'
  ],
  ['triage.md', 'node scripts/run-log.mjs last triage'],
  [
    'triage.md',
    'bash scripts/close-out-online.sh --job triage --status <COMPLETE|PARTIAL|BLOCKED> --canary <ok|missing> --missed <N> --model <id> --lesson "L: none"'
  ]
];
const line = (file, start) =>
  (FROZEN.find(([f, t]) => f === file && t === start) || FROZEN.find(([f, t]) => f === file && t.startsWith(start)))[1];

// ---------------------------------------------------------------- the fixture
const BASH = findBash();
const GITCONFIG = path.join(TMP, 'empty-gitconfig');
fs.writeFileSync(GITCONFIG, '');
const ENV = {
  ...process.env,
  GIT_CONFIG_NOSYSTEM: '1',
  GIT_CONFIG_GLOBAL: GITCONFIG,
  GIT_TERMINAL_PROMPT: '0',
  GIT_AUTHOR_NAME: 'Owner',
  GIT_AUTHOR_EMAIL: 'owner@example.invalid',
  GIT_COMMITTER_NAME: 'Owner',
  GIT_COMMITTER_EMAIL: 'owner@example.invalid',
  CLAUDE_CODE_REMOTE: 'true',
  ALEX_ROUTINE: '1',
  ALEX_UNTRUSTED_LANE: ''
};
function git(cwd, args) {
  const r = spawnSync('git', args, { cwd, encoding: 'utf8', env: ENV });
  if (r.status !== 0) throw new Error(`git ${args.join(' ')} failed: ${r.stderr}`);
  return (r.stdout || '').trim();
}
const RUNTIME = [
  'scripts/close-out-online.sh',
  'scripts/status-rotate.js',
  'scripts/lib/write-lock.js',
  'scripts/outputs-ledger.js',
  'scripts/run-log.mjs',
  'scripts/lib/json-writer.js',
  'scripts/lib/run-log-read.js',
  'scripts/lib/args.js',
  'scripts/lib/errors.js',
  'scripts/lib/exit-codes.js',
  'system/recall/lib/lessons.js',
  'scripts/autosave.sh',
  'scripts/untrusted-lane-guard.js',
  'scripts/lib/session-branch.sh',
  'work/18-recovery-layer/check.mjs',
  'system/manifest.json',
  '.gitattributes'
];
const ONLINE_GITIGNORE = [path.join(KIT, 'variants', 'online', '.gitignore'), path.join(KIT, '.gitignore')].find((p) =>
  fs.existsSync(p)
);
let n = 0;
function tree() {
  const base = path.join(TMP, `t${++n}`);
  const dir = path.join(base, 'work');
  const bare = path.join(base, 'origin.git');
  fs.mkdirSync(base);
  git(base, ['init', '-q', '--bare', '-b', 'main', bare]);
  git(base, ['init', '-q', '-b', 'main', dir]);
  for (const rel of RUNTIME) {
    const d = path.join(dir, ...rel.split('/'));
    fs.mkdirSync(path.dirname(d), { recursive: true });
    fs.copyFileSync(path.join(KIT, ...rel.split('/')), d);
  }
  fs.copyFileSync(ONLINE_GITIGNORE, path.join(dir, '.gitignore'));
  git(dir, ['add', '-A']);
  git(dir, ['commit', '-qm', 'seed']);
  git(dir, ['remote', 'add', 'origin', bare]);
  git(dir, ['push', '-q', '-u', 'origin', 'main']);
  git(dir, ['config', 'core.hooksPath', 'scripts/hooks']);
  return dir;
}
// the model's Bash tool: the line as typed, under bash, from the repository root
function typed(dir, commandLine, env = {}) {
  const r = spawnSync(BASH, ['-c', commandLine], {
    cwd: dir,
    encoding: 'utf8',
    env: { ...ENV, ...env },
    timeout: 180000
  });
  return { code: r.status, stdout: r.stdout || '', stderr: r.stderr || '' };
}
const lastLine = (s) => s.trimEnd().split('\n').pop();
const FILL = { '<ok|missing>': 'ok', '<N>': '0', '<id>': 'claude-sonnet-4-6' };
const fill = (text, extra = {}) =>
  Object.entries({ ...FILL, ...extra }).reduce((t, [k, v]) => t.split(k).join(v), text);
const ROW_KEYS = ['at', 'canary', 'job', 'missed', 'model', 'reason', 'repo', 'session_url', 'sha', 'status'];

test("drift: today's Routine prompts carry every frozen line verbatim, in backticks", () => {
  for (const [file, text] of FROZEN) {
    const prompt = fs.readFileSync(path.join(KIT, 'scheduler', 'routines', file), 'utf8');
    assert.ok(
      prompt.includes('`' + text + '`'),
      `${file} no longer carries \`${text}\`. An owner on an older build still runs it: keep it in FROZEN and add the new wording beside it`
    );
  }
});

test('the Missed-N opener on a fresh tree: every `last <job>` prints exactly "none", and the health board prints nothing', () => {
  const dir = tree();
  for (const [, text] of FROZEN.filter(([, t]) => /^node scripts\/run-log\.mjs last \S+$/.test(t))) {
    assert.deepEqual(typed(dir, text), { code: 0, stdout: 'none\n', stderr: '' }, text);
  }
  assert.deepEqual(typed(dir, line('brief.md', 'node scripts/run-log.mjs last')), { code: 0, stdout: '', stderr: '' });
});

test('the housekeeping appends, as typed: each exits 0 and the next Missed-N read returns the row, at in UTC seconds', () => {
  const dir = tree();
  const appends = [
    fill(line('housekeeping.md', 'node scripts/run-log.mjs append --job self-review --status <COMPLETE'), {
      '<COMPLETE|PARTIAL>': 'COMPLETE',
      '<one line: what it proposed, or why partial>': 'proposed two rule changes'
    }),
    fill(line('housekeeping.md', 'node scripts/run-log.mjs append --job self-review --status <COMPLETE'), {
      '<COMPLETE|PARTIAL>': 'PARTIAL',
      '<one line: what it proposed, or why partial>': 'the diagnose step failed'
    }),
    fill(line('housekeeping.md', 'node scripts/run-log.mjs append --job self-review --status SKIPPED'), {
      '<its date>': '2026-09-01',
      '<D>': '23'
    }),
    'node scripts/run-log.mjs append ' +
      fill(line('housekeeping.md', '--job skills --status COMPLETE'), {
        '<the list, comma-separated, or none>': 'none'
      }),
    'node scripts/run-log.mjs append ' +
      fill(line('housekeeping.md', '--job skills --status PARTIAL'), { '<old list>': 'none', '<new list>': 'pdf' }),
    'node scripts/run-log.mjs append ' +
      fill(line('housekeeping.md', '--job skills --status BLOCKED'), { '<what happened>': 'the menu did not open' })
  ];
  for (const cmd of appends) {
    const r = typed(dir, cmd);
    assert.equal(r.code, 0, `${cmd}\n${r.stderr}`);
    assert.match(r.stdout, /^run-log: appended \{.*\}\n$/, cmd);
    assert.equal(r.stderr, '');
  }
  const selfReview = JSON.parse(
    typed(dir, line('housekeeping.md', 'node scripts/run-log.mjs last self-review')).stdout
  );
  assert.deepEqual(Object.keys(selfReview), ROW_KEYS);
  assert.match(selfReview.at, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/);
  assert.equal(selfReview.status, 'SKIPPED');
  assert.equal(selfReview.reason, 'last run 2026-09-01, 23 days ago, the gate is 28 days');
  const skills = JSON.parse(typed(dir, line('housekeeping.md', 'node scripts/run-log.mjs last skills')).stdout);
  assert.deepEqual(
    [skills.status, skills.reason],
    ['BLOCKED', '/skills unreadable in this session: the menu did not open']
  );
});

test('the snapshot append in its three statuses: COMPLETE and RED with a repository and a sha, BLOCKED without them', () => {
  const dir = tree();
  const full = fill(line('snapshot.md', 'node scripts/run-log.mjs append --job snapshot'), {
    '<COMPLETE|BLOCKED|RED>': 'COMPLETE',
    '<the branch that landed, or why not>': 'claude/backup-2026-09-20 landed',
    '<backup_repo>': 'owner/backup',
    '<sha>': 'D'.repeat(40)
  });
  assert.equal(typed(dir, full).code, 0);
  const blocked =
    'node scripts/run-log.mjs append --job snapshot --status BLOCKED --canary missing --missed 0 --reason "no backup_repo in vault/projects/recovery/status.md"';
  assert.equal(typed(dir, blocked).code, 0);
  const red = fill(line('snapshot.md', 'node scripts/run-log.mjs append --job snapshot'), {
    '<COMPLETE|BLOCKED|RED>': 'RED',
    '<the branch that landed, or why not>': 'pushed but not read back',
    '<backup_repo>': 'owner/backup',
    '<sha>': 'e'.repeat(40)
  });
  assert.equal(typed(dir, red).code, 0);
  const rows = fs
    .readFileSync(path.join(dir, 'system', 'run-log.jsonl'), 'utf8')
    .trim()
    .split('\n')
    .map((l) => JSON.parse(l));
  assert.deepEqual(
    [rows[0].repo, rows[0].sha, rows[0].canary, rows[0].model],
    ['owner/backup', 'd'.repeat(40), 'missing', 'claude-sonnet-4-6']
  );
  assert.deepEqual([rows[1].status, rows[1].repo, rows[1].sha, rows[1].model], ['BLOCKED', null, null, null]);
  const board = typed(dir, line('brief.md', 'node scripts/run-log.mjs last')).stdout.trim().split('\n');
  assert.equal(board.length, 1, 'one line per job');
  assert.equal(JSON.parse(board[0]).status, 'RED', 'the newest snapshot row');
  assert.equal(rows.length, 3);
});

test("the snapshot's own branch step prints one BRANCH line on a clean main", () => {
  const dir = tree();
  assert.deepEqual(typed(dir, line('snapshot.md', 'CLAUDE_PROJECT_DIR=. bash scripts/lib/session-branch.sh')), {
    code: 0,
    stdout: 'BRANCH: main\n',
    stderr: ''
  });
});

test('every close-out line (each job, each status option, without --model, the hooks-did-not-load form): the quoted last line is COMPLETE', () => {
  // six runs cover every line and every option: the four lines differ only in --job, and the status
  // option only changes the row the run log records
  const dir = tree();
  const text = (job) => FROZEN.find(([, t]) => t.startsWith(`bash scripts/close-out-online.sh --job ${job} `))[1];
  const runs = [
    ['brief', fill(text('brief'), { '<COMPLETE|PARTIAL|BLOCKED>': 'COMPLETE' }), 'COMPLETE', null, 'claude-sonnet-4-6'],
    [
      'housekeeping',
      fill(text('housekeeping'), { '<COMPLETE|PARTIAL|BLOCKED>': 'PARTIAL' }) + ' --reason "self-review failed"',
      'PARTIAL',
      'self-review failed',
      'claude-sonnet-4-6'
    ],
    [
      'radar',
      fill(text('radar'), { '<COMPLETE|PARTIAL|BLOCKED>': 'BLOCKED' }) + ' --reason "no feeds"',
      'BLOCKED',
      'no feeds',
      'claude-sonnet-4-6'
    ],
    [
      'triage',
      fill(text('triage'), { '<COMPLETE|PARTIAL|BLOCKED>': 'COMPLETE' }),
      'COMPLETE',
      null,
      'claude-sonnet-4-6'
    ],
    [
      'brief',
      fill(text('brief'), { '<COMPLETE|PARTIAL|BLOCKED>': 'COMPLETE' }).replace(' --model claude-sonnet-4-6', ''),
      'COMPLETE',
      null,
      null
    ],
    [
      'triage',
      fill(text('triage'), { '<COMPLETE|PARTIAL|BLOCKED>': 'BLOCKED' }).replace(
        '--status BLOCKED',
        line('brief.md', '--status BLOCKED')
      ),
      'BLOCKED',
      'hooks did not load',
      'claude-sonnet-4-6'
    ]
  ];
  for (const [job, cmd, status, reason, model] of runs) {
    const r = typed(dir, cmd);
    assert.equal(r.code, 0, `${cmd}\n${r.stdout}`);
    assert.equal(lastLine(r.stdout), `close-out: COMPLETE for ${job}, every step ok`, cmd);
    const rows = fs
      .readFileSync(path.join(dir, 'system', 'run-log.jsonl'), 'utf8')
      .trim()
      .split('\n');
    const row = JSON.parse(rows[rows.length - 1]);
    assert.deepEqual(
      [row.job, row.status, row.reason, row.canary, row.missed, row.model],
      [job, status, reason, 'ok', 0, model],
      cmd
    );
  }
  assert.equal(
    git(dir, ['rev-parse', 'HEAD']),
    git(dir, ['ls-remote', 'origin', 'refs/heads/main']).split(/\s+/)[0],
    'every row was saved and read back'
  );
});

test('the housekeeping sweep and its save, as typed: exit 0, 2 or 1 matching the summary line, then one autosave line', () => {
  const dir = tree();
  const s = typed(dir, line('housekeeping.md', 'node work/18-recovery-layer/check.mjs'));
  const m = /^check\.mjs: (CLEAN|AMBER|RED) - \d+ green, \d+ amber, \d+ red \(13 legs\)$/m.exec(s.stdout);
  assert.ok(m, s.stdout);
  assert.equal(s.code, { CLEAN: 0, AMBER: 2, RED: 1 }[m[1]]);
  const save = typed(dir, line('housekeeping.md', 'bash scripts/autosave.sh'));
  assert.equal(save.code, 0);
  assert.match(save.stdout, /^autosave: committed [0-9a-f]+; main at [0-9a-f]+ pushed to origin\/main\n$/);
  assert.match(git(dir, ['show', '--name-only', '--format=', 'HEAD']), /vault\/projects\/recovery\/last-sweep\.md/);
});

test('a close-out line that keeps --model with no value warns and still saves, dropping only that one flag from the row', () => {
  const dir = tree();
  const text = line('triage.md', 'bash scripts/close-out-online.sh');
  const noId = fill(text, { '<COMPLETE|PARTIAL|BLOCKED>': 'COMPLETE' }).replace('--model claude-sonnet-4-6', '--model');
  const rNoId = typed(dir, noId);
  assert.equal(rNoId.code, 0, rNoId.stdout);
  assert.equal(
    rNoId.stderr,
    'close-out: WARNING - ignored --model: no value given (the next argument, --lesson, is a flag)\n'
  );
  assert.equal(lastLine(rNoId.stdout), 'close-out: COMPLETE for triage, every step ok');
  let rows = fs
    .readFileSync(path.join(dir, 'system', 'run-log.jsonl'), 'utf8')
    .trim()
    .split('\n')
    .map((l) => JSON.parse(l));
  assert.deepEqual(
    [rows[0].job, rows[0].status, rows[0].canary, rows[0].missed, rows[0].model],
    ['triage', 'COMPLETE', 'ok', 0, null],
    'model dropped, everything else forwarded'
  );

  const noN = fill(text, { '<COMPLETE|PARTIAL|BLOCKED>': 'COMPLETE' }).replace('--missed 0', '--missed');
  const rNoN = typed(dir, noN);
  assert.equal(rNoN.code, 0, rNoN.stdout);
  assert.equal(
    rNoN.stderr,
    'close-out: WARNING - ignored --missed: no value given (the next argument, --model, is a flag)\n'
  );
  assert.equal(lastLine(rNoN.stdout), 'close-out: COMPLETE for triage, every step ok');
  rows = fs
    .readFileSync(path.join(dir, 'system', 'run-log.jsonl'), 'utf8')
    .trim()
    .split('\n')
    .map((l) => JSON.parse(l));
  const last = rows[rows.length - 1];
  assert.deepEqual(
    [last.job, last.status, last.canary, last.missed, last.model],
    ['triage', 'COMPLETE', 'ok', null, 'claude-sonnet-4-6'],
    "missed dropped, model still forwarded since it was never consumed as --missed's value"
  );
});
