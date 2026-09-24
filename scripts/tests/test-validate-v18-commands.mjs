#!/usr/bin/env node
// scripts/tests/test-validate-v18-commands.mjs - validate-alex V18 resolves a command name against
// BOTH command trees. (2026-09-23, Virtual Alex fleet seat 1.)
//
// V18 fails a document that names a slash command this system does not have, because telling an
// owner to type a command that does not exist produces "unknown command", and this product teaches
// its owners that "unknown command" means they opened the wrong folder.
//
// Since 2026-09-23 there are TWO command trees. The Kit's .claude/commands/ is the laptop set, and
// variants/online/.claude/commands/ carries the online variant's: a tracked file there lands at its
// real path in the generated template, so a name that resolves in either tree is a real command
// somewhere this product runs. The first online-only command is /alex-status, which exists because
// the claude.ai web session has a built-in /status that swallows Alex's. Reading one tree made
// every mention of it read as a dangling command and failed the build.
//
// WHAT. V18 reads both command trees, and these legs prove it:
//   U1  NEGATIVE a name in NEITHER tree still FAILS V18 (the check has not been widened into a pass)
//   U2  the online-only /alex-status resolves, so a document may name it
//   U3  a laptop-only command still resolves, so nothing was traded away
//   U4  the live tree passes V18 with no dangling command
//   U5  NEGATIVE a laptop-only page (a drop row online) naming /alex-status FAILS (review finding F37)
//   U6  NEGATIVE an online-only page (variants/online/) naming /cron-setup FAILS; they were not read before
//   U7  a page shipped to both worlds may name a command of either
//
// HOW. Runs the REAL validator with a --staged overlay.
//   node scripts/tests/test-validate-v18-commands.mjs      (exit 0 = all pass)
//
// NEVER. The working tree is never touched.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const KIT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const VALIDATOR = path.join(KIT, 'scripts', 'validate-alex.js');

let failures = 0;
const ok = (cond, name, detail = '') => {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${detail ? ` - ${detail}` : ''}`);
  if (!cond) failures++;
};
const show = (label, lines) => { if (lines.length) console.log(`      ${label}: ${lines.join('\n      ')}`); };

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'alex-validate-v18-'));

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
  const r = spawnSync(process.execPath, [VALIDATOR, '--context=pre-commit', `--staged=${stagedDir}`], {
    cwd: KIT, encoding: 'utf8', env: { ...process.env, CLAUDE_CODE_REMOTE: '' },
  });
  return `${r.stdout || ''}\n${r.stderr || ''}`.split(/\r?\n/).filter((l) => /FAILED V18:/.test(l));
}

// --- U1 NEGATIVE: the check still fails on a name that exists nowhere -------------------------
{
  const lines = v18(withLine('Tell the owner to type `/not-a-real-command` when they are stuck.'));
  show('U1', lines);
  ok(lines.some((l) => l.includes('/not-a-real-command')),
    'U1 NEGATIVE a command in neither tree still FAILS V18',
    lines.length ? 'refused' : 'it passed, which means the check was widened into a pass');
}

// --- U2 the online-only command resolves ------------------------------------------------------
// Honest in both trees this file ships into (2026-09-23, fleet seat 3, found by running the online
// CI list inside a generated template): in the Kit the file sits under variants/online/ and the Kit
// has none of its own; in the generated template the generator has landed it at its real path and
// variants/ does not exist. The resolution is the claim; where the file sits is the tree's shape.
{
  const inKit = fs.existsSync(path.join(KIT, 'variants', 'online'));
  const lines = v18(withLine('Online the health command is `/alex-status`, never `/status`.'));
  ok(lines.length === 0, `U2 the online-only /alex-status resolves${inKit ? ' against variants/online/' : ''}`,
    lines.join(' | ') || 'no V18 line');
  if (inKit) {
    ok(!fs.existsSync(path.join(KIT, '.claude', 'commands', 'alex-status.md')),
      'U2 and it really is online-only: the Kit has no alex-status.md of its own');
    ok(fs.existsSync(path.join(KIT, 'variants', 'online', '.claude', 'commands', 'alex-status.md')),
      'U2 it lives under variants/online/, which is what the widened lookup reads');
  } else {
    ok(fs.existsSync(path.join(KIT, '.claude', 'commands', 'alex-status.md')),
      'U2 generated tree: the generator landed alex-status.md at its real path');
  }
}

// --- U3 a laptop-only command still resolves --------------------------------------------------
{
  const lines = v18(withLine('On a laptop the schedule is managed with `/cron-setup`.'));
  ok(lines.length === 0, 'U3 a laptop-only command still resolves, so nothing was traded away',
    lines.join(' | ') || 'no V18 line');
}

// --- U4 the live tree is clean ----------------------------------------------------------------
{
  const r = spawnSync(process.execPath, [VALIDATOR, '--context=generator'], {
    cwd: KIT, encoding: 'utf8', env: { ...process.env, CLAUDE_CODE_REMOTE: '' },
  });
  const lines = `${r.stdout || ''}\n${r.stderr || ''}`.split(/\r?\n/).filter((l) => /FAILED V18:/.test(l));
  ok(lines.length === 0, 'U4 the live tree names no dangling command', lines.join(' | ') || 'clean');
}

// --- U5-U7 each page against the commands of the world it ships to (review finding F37) --------
// The union let a laptop-only page name /alex-status (a laptop has no such command) and an online-
// only page name /cron-setup (dropped online), and both passed. A page that exists in one world only
// now resolves against that world; a page shipped to both keeps both, because it legitimately
// speaks to both (update.md tells a laptop owner to stop and double-click instead). Kit only: a
// generated tree has one command set, so there is nothing to tell apart.
if (fs.existsSync(path.join(KIT, 'variants', 'online'))) {
  const stageAt = (rel, line) => {
    const dir = fs.mkdtempSync(path.join(TMP, 'staged-'));
    fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
    fs.writeFileSync(path.join(dir, rel), `# staged for the V18 test\n\n${line}\n`);
    return dir;
  };
  const u5 = v18(stageAt('.claude/commands/cron-setup.md', 'When stuck, type `/alex-status`.'));
  ok(u5.some((l) => /cron-setup\.md.*\/alex-status/.test(l)), 'U5 NEGATIVE a laptop-only page (cron-setup, dropped online) naming /alex-status FAILS',
    u5.join(' | ') || 'it passed: the union let it through');
  const u6 = v18(stageAt('variants/online/.claude/commands/alex-status.md', 'To change the schedule, type `/cron-setup`.'));
  ok(u6.some((l) => /alex-status\.md.*\/cron-setup/.test(l)), 'U6 NEGATIVE an online-only page naming /cron-setup (no such command online) FAILS',
    u6.join(' | ') || 'it passed: online pages were not read, or read against the union');
  const u7 = v18(withLine('Online type `/alex-status`; on a laptop use `/cron-setup` for the schedule.'));
  ok(u7.length === 0, 'U7 a page shipped to both worlds may name a command of either', u7.join(' | ') || 'no V18 line');
} else {
  console.log('SKIP  U5-U7 this is a generated tree: one command set, nothing to tell apart');
}

fs.rmSync(TMP, { recursive: true, force: true, maxRetries: 5 });
console.log(failures === 0 ? '\ntest-validate-v18-commands: ALL PASS' : `\ntest-validate-v18-commands: ${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
