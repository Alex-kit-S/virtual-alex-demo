#!/usr/bin/env node
// scripts/tests/test-validate-v18-commands.mjs - validate-alex V18 resolves a command name against
// BOTH command trees.
//
// WHAT. V18 fails a document that names a slash command this system does not have, because telling an
// owner to type a command that does not exist produces "unknown command", and this product teaches its
// owners that "unknown command" means they opened the wrong folder. Since there are TWO command trees
// (the Kit's .claude/commands/, the laptop set, and variants/online/.claude/commands/, the online
// variant's), a tracked file in either lands at its real path in the generated template, so a name that
// resolves in either tree is a real command somewhere this product runs.
//   U1  NEGATIVE a name in NEITHER tree still FAILS V18 (the check has not been widened into a pass)
//   U2  the online-only /alex-status resolves, so a document may name it
//   U3  a laptop-only command still resolves, so nothing was traded away
//   U4  the live tree passes V18 with no dangling command
// test-validate-v18-commands-kit.mjs holds U5 to U7 (a laptop-only page naming an online-only command and
// the reverse, both FAIL; a page shipped to both worlds may name a command of either), split out when a
// generated online tree has one command set, so there is nothing to tell apart.
// Deleted, this file would let a document tell an owner to type a command their tree does not have, or
// let a page bleed a command from the world it does not ship to.
//
// HOW. Runs the REAL validator with a --staged overlay, so nothing in the working tree is touched.
//
// NEVER. The working tree is never touched, and no scheduler binary is reached: every real-validator
// spawn below loads the shared scheduler-stub fixture (scripts/tests/fixtures/scheduler-stub.cjs) with
// an empty C4_LIVE, so V2's live-scheduler leg is a clean, silent WARNING here - none of the V18
// assertions below read a V2 line.
//
// Usage: node scripts/tests/test-validate-v18-commands.mjs
// Exit: 0 all pass - 1 a failure

import { test, describe, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const KIT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const VALIDATOR = path.join(KIT, 'scripts', 'validate-alex.js');
const SCHED_STUB = path.join(KIT, 'scripts', 'tests', 'fixtures', 'scheduler-stub.cjs');
const ENV = { ...process.env, CLAUDE_CODE_REMOTE: '', C4_LIVE: '' };

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'alex-validate-v18-'));
after(() => fs.rmSync(TMP, { recursive: true, force: true, maxRetries: 5 }));

// Stage one command file carrying the given line. CLAUDE.md is one of the surfaces V18 scans, and
// .claude/commands/*.md is another; a staged command file is the smaller blast radius.
const VICTIM = '.claude/commands/lint.md';
function withLine(line) {
  const dir = fs.mkdtempSync(path.join(TMP, 'staged-'));
  const dst = path.join(dir, VICTIM);
  fs.mkdirSync(path.dirname(dst), { recursive: true });
  fs.writeFileSync(dst, `# /lint - staged for the V18 test\n\n${line}\n`);
  return dir;
}
function v18(stagedDir) {
  const r = spawnSync(
    process.execPath,
    ['-r', SCHED_STUB, VALIDATOR, '--context=pre-commit', `--staged=${stagedDir}`],
    { cwd: KIT, encoding: 'utf8', env: ENV }
  );
  return `${r.stdout || ''}\n${r.stderr || ''}`.split(/\r?\n/).filter((l) => /FAILED V18:/.test(l));
}

const HAS_VARIANTS = fs.existsSync(path.join(KIT, 'variants', 'online'));

describe('validate-alex V18: command names resolve against both command trees', () => {
  test('U1 NEGATIVE a command in neither tree still FAILS V18', () => {
    const lines = v18(withLine('Tell the owner to type `/not-a-real-command` when they are stuck.'));
    assert.ok(
      lines.some((l) => l.includes('/not-a-real-command')),
      lines.length ? 'refused' : 'it passed, which means the check was widened into a pass'
    );
  });

  test('U2 the online-only command resolves', () => {
    // Honest in both trees this file ships into: in the Kit the file sits under variants/online/ and
    // the Kit has none of its own; in the generated template the generator has landed it at its real
    // path and variants/ does not exist. The resolution is the claim; where the file sits is the
    // tree's shape.
    const lines = v18(withLine('Online the health command is `/alex-status`, never `/status`.'));
    assert.deepEqual(
      lines,
      [],
      `the online-only /alex-status resolves${HAS_VARIANTS ? ' against variants/online/' : ''}`
    );
    if (HAS_VARIANTS) {
      assert.ok(
        !fs.existsSync(path.join(KIT, '.claude', 'commands', 'alex-status.md')),
        'and it really is online-only: the Kit has no alex-status.md of its own'
      );
      assert.ok(
        fs.existsSync(path.join(KIT, 'variants', 'online', '.claude', 'commands', 'alex-status.md')),
        'it lives under variants/online/, which is what the widened lookup reads'
      );
    } else {
      assert.ok(
        fs.existsSync(path.join(KIT, '.claude', 'commands', 'alex-status.md')),
        'generated tree: the generator landed alex-status.md at its real path'
      );
    }
  });

  test('U3 a laptop-only command still resolves, so nothing was traded away', () => {
    const lines = v18(withLine('On a laptop the schedule is managed with `/cron-setup`.'));
    assert.deepEqual(lines, []);
  });

  test('U4 the live tree names no dangling command', () => {
    const r = spawnSync(process.execPath, ['-r', SCHED_STUB, VALIDATOR, '--context=generator'], {
      cwd: KIT,
      encoding: 'utf8',
      env: ENV
    });
    const lines = `${r.stdout || ''}\n${r.stderr || ''}`.split(/\r?\n/).filter((l) => /FAILED V18:/.test(l));
    assert.deepEqual(lines, []);
  });
});
