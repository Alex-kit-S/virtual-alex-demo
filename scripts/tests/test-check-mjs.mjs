#!/usr/bin/env node
// scripts/tests/test-check-mjs.mjs - the Virtual Alex sweep (work/18-recovery-layer/check.mjs):
// every guard-class leg shown failing before the pass.
//
// WHAT. Holds check.mjs's thirteen legs to their exact wording, their exit codes and the order they run
// and print in. Deleted, it would let a leg's finding text, its GREEN/AMBER/RED threshold, its exit code
// or the run-log read it depends on drift with nothing in CI noticing.
//
// HOW. A throwaway git repository under the OS temp dir carries the REAL check.mjs, run-log.mjs, the
// JSON writer and outputs-ledger.js, a small vault, a soul.md with its card, a registry with the
// five routines[] rows, fresh run-log rows for every Routine, and a local bare "mirror" holding a
// claude/backup-<today> branch. The baseline run is CLEAN (exit 0). Then, one defect at a time:
//   N1 a shrunk vault/log.md              -> RED C9, exit 1
//   N2 a run-log row older than cadence   -> AMBER R1, exit 2 (and R3 on a row off the default model)
//   N3 a planted, tracked .env            -> RED N,  exit 1
//   N4 core.hooksPath unset               -> RED H,  exit 1
//   N5 a .claude/memory/ directory        -> RED M,  exit 1
//   N6 the snapshot row BLOCKED, stale or absent -> AMBER R2; an UNREACHABLE mirror stays GREEN
//      NEGATIVE a COMPLETE row naming another repository than backup_repo -> AMBER R2
//   N7 a shrunk soul.md                   -> RED C22 (and AMBER C23: the card is stale), exit 1
//   N8 a dangling [[wiki link]]           -> AMBER C6, exit 2
//   N9 a rogue outputs/ top-level dir     -> AMBER C12, exit 2
//   N10 a BOM-padded run-log row          -> read exactly as before: neither a row nor a warning
// each restored and shown passing again. --dry-run writes nothing. --keep leaves the fixture.
//
// NEVER. Touches the real checkout: every fixture lives in one throwaway git repository under the OS
// temp folder. Reaches a real network: the "mirror" is a local bare repository.
//
// Usage: node scripts/tests/test-check-mjs.mjs [--keep]
// Exit: 0 every check passed - 1 a check failed

import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, before, describe, test } from 'node:test';
import { fileURLToPath } from 'node:url';

const KIT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const KEEP = process.argv.includes('--keep');
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'alex-check-mjs-'));
const REPO = path.join(TMP, 'repo');
const BARE = path.join(TMP, 'mirror.git');
const W = (rel, text) => {
  const p = path.join(REPO, ...rel.split('/'));
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, text, 'utf8');
};
const R = (rel) => fs.readFileSync(path.join(REPO, ...rel.split('/')), 'utf8');
// Pinned the way test-git.mjs's own CHILD_ENV is (inherited GIT_* stripped, GIT_CONFIG_NOSYSTEM=1,
// GIT_CONFIG_GLOBAL an empty file in the temp folder, GIT_CEILING_DIRECTORIES): a developer's own
// global config (commit.gpgsign=true with no gpg installed, say) must not reach these commits.
const GIT_GITCONFIG = path.join(TMP, 'empty-gitconfig');
fs.writeFileSync(GIT_GITCONFIG, '');
const GIT_ENV = { ...process.env };
for (const k of Object.keys(GIT_ENV)) if (/^GIT_/.test(k)) delete GIT_ENV[k];
Object.assign(GIT_ENV, { GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: GIT_GITCONFIG, GIT_CEILING_DIRECTORIES: TMP });
const git = (...a) => {
  const r = spawnSync('git', ['-C', REPO, ...a], { encoding: 'utf8', env: GIT_ENV });
  if (r.status !== 0) throw new Error(`git ${a.join(' ')}: ${r.stderr}`);
  return r.stdout;
};
const copy = (rel) => {
  const s = path.join(KIT, ...rel.split('/'));
  const d = path.join(REPO, ...rel.split('/'));
  fs.mkdirSync(path.dirname(d), { recursive: true });
  fs.copyFileSync(s, d);
};
function sweep(...extra) {
  const r = spawnSync(process.execPath, [path.join(REPO, 'work', '18-recovery-layer', 'check.mjs'), ...extra], {
    cwd: REPO,
    encoding: 'utf8',
    env: { ...process.env, ALEX_ROUTINE: '' }
  });
  return { code: r.status, out: `${r.stdout || ''}${r.stderr || ''}` };
}
const legLine = (out, id) => out.split(/\r?\n/).find((l) => new RegExp(`^${id}\\s`).test(l)) || '';
const show = (label, out, ids) => {
  for (const id of ids) {
    const l = legLine(out, id);
    if (l) console.log(`      ${label}: ${l.slice(0, 200)}`);
  }
};
const today = new Date().toISOString().slice(0, 10);
const soul = (n) =>
  `${['# Soul', '', '## My Words', '', ...Array.from({ length: n }, (_, i) => `### Harvested 2026-09-${String(10 + i).padStart(2, '0')} (typed)\n- "line ${i}"\n`)].join('\n')}\n`;
const stamp = () =>
  `SOUL-CORE-STAMP: source-sha256=${crypto
    .createHash('sha256')
    .update(fs.readFileSync(path.join(REPO, 'soul.md')))
    .digest('hex')} pins-sha256=e3b0c442 generated-at=${new Date().toISOString()} entries=3 pinned=0 token-count=2\n`;

/** @type {{ routines: unknown[] }} */
let manifest;

after(() => {
  if (KEEP) console.log(`kept: ${TMP}`);
  else fs.rmSync(TMP, { recursive: true, force: true });
});

before(() => {
  // ---------------------------------------------------------------- the fixture
  fs.mkdirSync(REPO, { recursive: true });
  git('init', '-q', '-b', 'main', '.');
  git('config', 'user.email', 'owner@example.invalid');
  git('config', 'user.name', 'Owner');
  git('config', 'core.hooksPath', 'scripts/hooks');
  for (const rel of [
    'work/18-recovery-layer/check.mjs',
    'scripts/run-log.mjs',
    'scripts/lib/json-writer.js',
    'scripts/outputs-ledger.js',
    'scripts/lib/run-log-read.js',
    'scripts/lib/args.js',
    'scripts/lib/errors.js',
    'scripts/lib/exit-codes.js'
  ])
    copy(rel);
  fs.mkdirSync(path.join(REPO, 'scripts', 'hooks'), { recursive: true });
  const kitManifest = JSON.parse(fs.readFileSync(path.join(KIT, 'system', 'manifest.json'), 'utf8'));
  const DEFAULT_MODEL = kitManifest.meta.model_routing.default;
  manifest = {
    meta: { model_routing: { default: DEFAULT_MODEL }, unnumbered: [], utility_commands: [] },
    projects: [
      {
        num: 15,
        name: 'radar',
        title: 'Radar',
        state: 'LIVE',
        status_md: 'vault/projects/radar/status.md',
        work_dir: 'work/15-radar'
      }
    ],
    routines: kitManifest.routines
  };
  W('system/manifest.json', `${JSON.stringify(manifest, null, 2)}\n`);
  W('vault/index.md', '# Index\n\n- [[projects/radar/status]]\n- [[projects/recovery/status]]\n');
  W(
    'vault/log.md',
    `${Array.from({ length: 10 }, (_, i) => `## [2026-09-${String(i + 1).padStart(2, '0')} 08:00] run | line ${i + 1}`).join('\n')}\n`
  );
  W('vault/projects/radar/status.md', '---\ncreated: 2026-09-20\n---\n# Radar\nSee [[projects/recovery/status]].\n');
  W(
    'vault/projects/recovery/status.md',
    `---\nbackup_repo: ${`file://${BARE.split(path.sep).join('/')}`}\n---\n# Recovery\n`
  );
  W('vault/me/notes.md', '# Notes\nA link to [[projects/radar/status]] and to [[soul]].\n');
  W('soul.md', soul(3));
  W('soul-core.md', `# card\n${stamp()}`);
  W('outputs/radar/2026-09-21/board.md', '# board\n');
  git('add', '-A');
  git('commit', '-q', '-m', 'fixture');
  // the mirror with a fresh backup branch
  spawnSync('git', ['init', '-q', '--bare', BARE], { encoding: 'utf8' });
  git('push', '-q', `file://${BARE.split(path.sep).join('/')}`, `main:refs/heads/claude/backup-${today}`);
  // fresh rows for every Routine, through the real writer
  for (const r of /** @type {{ name: string }[]} */ (manifest.routines)) {
    const a = spawnSync(
      process.execPath,
      [
        path.join(REPO, 'scripts', 'run-log.mjs'),
        'append',
        '--job',
        r.name,
        '--status',
        'COMPLETE',
        '--canary',
        'ok',
        '--model',
        DEFAULT_MODEL,
        '--missed',
        '0'
      ],
      { cwd: REPO, encoding: 'utf8' }
    );
    if (a.status !== 0) throw new Error(`fixture run-log append failed: ${a.stderr}`);
  }
  git('add', '-A');
  git('commit', '-q', '-m', 'rows');
  console.log(`fixture: ${REPO}`);
});

describe('check.mjs: the Virtual Alex sweep', () => {
  test('P0 --dry-run writes nothing', () => {
    const r = sweep('--dry-run');
    assert.equal(
      fs.existsSync(path.join(REPO, 'vault', 'projects', 'recovery', 'last-sweep.md')),
      false,
      'P0 --dry-run writes no last-sweep.md'
    );
    const rows = R('system/run-log.jsonl').trim().split('\n').length;
    assert.equal(rows, manifest.routines.length, `P0 --dry-run appends no sweep row (${rows} rows)`);
    assert.equal(r.code, 0, `P0 the fixture is CLEAN on a dry run (exit ${r.code})`);
  });

  test('P1 the baseline run: thirteen legs GREEN, exit 0', () => {
    const r = sweep();
    show('P1', r.out, ['C6', 'C9', 'C11', 'C12', 'C22', 'C23', 'R1', 'R2', 'R3', 'N', 'H', 'M', 'S']);
    assert.equal(r.code, 0, `exit ${r.code}: ${r.out}`);
    assert.match(r.out, /check\.mjs: CLEAN - 13 green, 0 amber, 0 red \(13 legs\)/);
    const report = R('vault/projects/recovery/last-sweep.md');
    assert.match(
      report,
      /^---\n.*\nlog_lines: 10\n/s,
      'P1 last-sweep.md carries the high-water marks (log_lines 10, soul_entries 3)'
    );
    assert.match(report, /soul_entries: 3\n/);
    const rows = R('system/run-log.jsonl').trim().split('\n');
    const last = JSON.parse(rows[rows.length - 1]);
    assert.equal(last.job, 'sweep');
    assert.equal(last.status, 'COMPLETE');
    git('add', '-A');
    git('commit', '-q', '-m', 'sweep 1');
  });

  test('N1 NEGATIVE a shrunk vault/log.md exits 1 with a RED C9 line', () => {
    const full = R('vault/log.md');
    W('vault/log.md', `${full.split('\n').slice(0, 5).join('\n')}\n`);
    const r = sweep();
    show('N1', r.out, ['C9']);
    assert.equal(r.code, 1, `exit ${r.code}`);
    assert.match(r.out, /^C9\s+RED\s+vault\/log\.md SHRANK from 10 to 5 lines/m);
    assert.match(
      R('vault/projects/recovery/last-sweep.md'),
      /log_lines: 10\n/,
      'N1 the high-water mark stays at 10 after the shrink'
    );
    W('vault/log.md', `${full}## [2026-09-23 02:00] run | line 11\n`);
    const r2 = sweep();
    assert.equal(r2.code, 0, `restored and grown: exit ${r2.code}`);
    assert.match(r2.out, /^C9\s+GREEN\s+vault\/log\.md 11 lines \(high-water 10\)/m);
    git('add', '-A');
    git('commit', '-q', '-m', 'n1');
  });

  test('N2 NEGATIVE a stale row and an off-model row make R1 and R3 AMBER, exit 2', () => {
    const before_ = R('system/run-log.jsonl');
    const lines = before_
      .trim()
      .split('\n')
      .map((l) => JSON.parse(l));
    const oldAt = new Date(Date.now() - (168 + 6 + 5) * 3600000).toISOString().replace(/\.\d{3}Z$/, 'Z');
    const rewritten = lines.map((row) => {
      if (row.job === 'radar') return { ...row, at: oldAt };
      if (row.job === 'triage') return { ...row, model: 'claude-opus-5' };
      return row;
    });
    W('system/run-log.jsonl', `${rewritten.map((r) => JSON.stringify(r)).join('\n')}\n`);
    const r = sweep();
    show('N2', r.out, ['R1', 'R3']);
    assert.equal(r.code, 2, `exit ${r.code}`);
    assert.match(
      r.out,
      /^R1\s+AMBER\s+1 Routine\(s\) past cadence: radar last row /m,
      'N2 a radar row older than cadence + grace makes R1 AMBER'
    );
    assert.match(
      r.out,
      /^R3\s+AMBER\s+.*triage ran on claude-opus-5/m,
      'N2 a triage row on another model makes R3 AMBER'
    );
    assert.doesNotMatch(legLine(r.out, 'R1'), /RED/, 'N2 freshness is AMBER, never RED');
    W('system/run-log.jsonl', before_);
    const r2 = sweep();
    assert.equal(r2.code, 0, `restored: exit ${r2.code}`);
    assert.match(r2.out, /^R1\s+GREEN/m);
    assert.match(r2.out, /^R3\s+GREEN/m);
    git('add', '-A');
    git('commit', '-q', '-m', 'n2');
  });

  test('N3 NEGATIVE a planted, tracked .env turns the never-list leg RED, exit 1', () => {
    W('.env', 'NOT_A_REAL_VALUE=placeholder\n');
    git('add', '.env');
    const r = sweep();
    show('N3', r.out, ['N']);
    assert.equal(r.code, 1, `exit ${r.code}`);
    assert.match(r.out, /^N\s+RED\s+1 never-list path\(s\) are TRACKED: \.env/m);
    git('rm', '-q', '--cached', '.env');
    fs.rmSync(path.join(REPO, '.env'));
    const r2 = sweep();
    assert.equal(r2.code, 0, `removed from the index: exit ${r2.code}`);
    assert.match(r2.out, /^N\s+GREEN/m);
    git('add', '-A');
    git('commit', '-q', '-m', 'n3');
  });

  test('N4 NEGATIVE core.hooksPath unset (or wrong) is RED, exit 1', () => {
    git('config', '--unset', 'core.hooksPath');
    const r = sweep();
    show('N4', r.out, ['H']);
    assert.equal(r.code, 1, `exit ${r.code}`);
    assert.match(r.out, /^H\s+RED\s+core\.hooksPath is unset/m);
    git('config', 'core.hooksPath', 'elsewhere/hooks');
    const r15 = sweep();
    assert.equal(r15.code, 1, 'N4 a hooksPath pointing elsewhere is RED too');
    assert.match(r15.out, /^H\s+RED\s+core\.hooksPath is elsewhere\/hooks, expected scripts\/hooks/m);
    git('config', 'core.hooksPath', 'scripts/hooks');
    const r2 = sweep();
    assert.equal(r2.code, 0, `set back: exit ${r2.code}`);
    assert.match(r2.out, /^H\s+GREEN/m);
    git('add', '-A');
    git('commit', '-q', '-m', 'n4');
  });

  test('N5 NEGATIVE a .claude/memory/ directory in the clone is RED, exit 1', () => {
    W('.claude/memory/MEMORY.md', '# not ours\n');
    const r = sweep();
    show('N5', r.out, ['M']);
    assert.equal(r.code, 1, `exit ${r.code}`);
    assert.match(r.out, /^M\s+RED\s+auto-memory surface inside the clone: \.claude\/memory\//m);
    fs.rmSync(path.join(REPO, '.claude', 'memory'), { recursive: true, force: true });
    const r2 = sweep();
    assert.equal(r2.code, 0, `removed: exit ${r2.code}`);
    assert.match(r2.out, /^M\s+GREEN/m);
    git('add', '-A');
    git('commit', '-q', '-m', 'n5');
  });

  // R2 reads the snapshot Routine's own run-log row, not a probe of the backup repository. A direct probe
  // cannot work where this sweep runs: a cloud session's git credentials cover the repositories ATTACHED
  // to that session, and the housekeeping Routine has one, so a read of any other repository fails with
  // `could not read Username` on a perfectly healthy system. The snapshot Routine is the two-repository
  // session that pushes the copy AND reads the pushed ref back, so its row is the verification, made by
  // the only session that could make it.
  test('N6 snapshot freshness (R2): BLOCKED, stale, absent and mismatched rows are AMBER; unreachable is GREEN', () => {
    const rewriteSnapshot = (mutate) => {
      const rows = R('system/run-log.jsonl')
        .trim()
        .split('\n')
        .map((l) => JSON.parse(l));
      let seen = false;
      for (let i = rows.length - 1; i >= 0; i--) {
        if (rows[i].job !== 'snapshot' || seen) continue;
        seen = true;
        mutate(rows[i]);
      }
      W('system/run-log.jsonl', `${rows.map((r) => JSON.stringify(r)).join('\n')}\n`);
    };
    const fresh = R('system/run-log.jsonl');

    // NEGATIVE: the snapshot ran and did NOT finish.
    rewriteSnapshot((r) => {
      r.status = 'BLOCKED';
      r.reason = 'the backup repository refused the push';
    });
    const rB = sweep();
    show('N6', rB.out, ['R2']);
    assert.equal(rB.code, 2, `exit ${rB.code}`);
    assert.match(
      rB.out,
      /^R2\s+AMBER\s+the newest snapshot row is BLOCKED/m,
      'N6 a BLOCKED snapshot row makes R2 AMBER'
    );

    // NEGATIVE: it finished, nine days ago. Stamped nine days and one hour before now, never as a date
    // plus a fixed hour: `${daysAgo(9)}T04:15:00Z` is only 8 days and some hours old between 00:00 and
    // 04:15 UTC, so the sweep (which floors the real age) would say "8 days old" and this leg would fail
    // in that window every night, CI included.
    W('system/run-log.jsonl', fresh);
    rewriteSnapshot((r) => {
      r.at = new Date(Date.now() - (9 * 86400000 + 3600000)).toISOString().replace(/\.\d{3}Z$/, 'Z');
    });
    const rOld = sweep();
    assert.equal(rOld.code, 2, `exit ${rOld.code}`);
    assert.match(
      rOld.out,
      /^R2\s+AMBER\s+the newest COMPLETE snapshot row is .*9 days old/m,
      'N6 a nine-day-old COMPLETE snapshot row makes R2 AMBER'
    );

    // N6 AT ANY HOUR. The sweep floors a row's age, so the leg above runs again under a preloaded fake
    // clock at 02:30 and 14:30 UTC tomorrow, where a date-plus-hour stamp would read one day short; the
    // fixture is stamped from that same clock, and a control proves the hour sweep can see the old
    // shape: stamped as the date nine days ago plus 04:15, at 02:30 the sweep floors the real age and
    // reads 8. Only check.mjs sees the fake clock; the fresh rows around it are stamped by the real one,
    // which is why only R2's line is asserted.
    const CLOCK = path.join(TMP, 'fake-clock.cjs');
    fs.writeFileSync(
      CLOCK,
      [
        "'use strict';",
        'const NOW = Number(process.env.FAKE_NOW_MS);',
        'if (!Number.isFinite(NOW)) throw new Error("fake-clock: FAKE_NOW_MS is not a number");',
        'const RealDate = Date;',
        'class FakeDate extends RealDate {',
        '  constructor(...a) { if (a.length === 0) super(NOW); else super(...a); }',
        '  static now() { return NOW; }',
        '}',
        'globalThis.Date = FakeDate;',
        ''
      ].join('\n')
    );
    const sweepAt = (ms) => {
      const r = spawnSync(
        process.execPath,
        ['--require', CLOCK, path.join(REPO, 'work', '18-recovery-layer', 'check.mjs')],
        {
          cwd: REPO,
          encoding: 'utf8',
          env: { ...process.env, ALEX_ROUTINE: '', FAKE_NOW_MS: String(ms) }
        }
      );
      return `${r.stdout || ''}${r.stderr || ''}`;
    };
    const tomorrowAt = (h, m) => {
      const d = new Date();
      d.setUTCDate(d.getUTCDate() + 1);
      d.setUTCHours(h, m, 0, 0);
      return d.getTime();
    };
    const newShape = (now) => new Date(now - (9 * 86400000 + 3600000)).toISOString().replace(/\.\d{3}Z$/, 'Z');
    const oldShape = (now) => `${new Date(now - 9 * 86400000).toISOString().slice(0, 10)}T04:15:00Z`;
    for (const [h, m] of [
      [2, 30],
      [14, 30]
    ]) {
      const now = tomorrowAt(h, m);
      W('system/run-log.jsonl', fresh);
      rewriteSnapshot((r) => {
        r.at = newShape(now);
      });
      const line = legLine(sweepAt(now), 'R2');
      assert.match(
        line,
        /AMBER\s+the newest COMPLETE snapshot row is .*, 9 days old/,
        `N6 at a simulated ${String(h).padStart(2, '0')}:${m} UTC the nine-day row still reads "9 days old" (${line.slice(0, 140)})`
      );
    }
    {
      const now = tomorrowAt(2, 30);
      W('system/run-log.jsonl', fresh);
      rewriteSnapshot((r) => {
        r.at = oldShape(now);
      });
      const line = legLine(sweepAt(now), 'R2');
      assert.match(
        line,
        /, 8 days old/,
        'N6 control: at a simulated 02:30 UTC the OLD fixture shape reads "8 days old"'
      );
    }

    // NEGATIVE: no snapshot row at all.
    W(
      'system/run-log.jsonl',
      `${R('system/run-log.jsonl')
        .trim()
        .split('\n')
        .filter((l) => JSON.parse(l).job !== 'snapshot')
        .join('\n')}\n`
    );
    const rNone = sweep();
    assert.equal(rNone.code, 2, `exit ${rNone.code}`);
    assert.match(
      rNone.out,
      /^R2\s+AMBER\s+the snapshot Routine has no run-log row yet/m,
      'N6 no snapshot row at all makes R2 AMBER'
    );

    // the healthy case
    W('system/run-log.jsonl', fresh);
    const rOk = sweep();
    assert.equal(rOk.code, 0, `exit ${rOk.code}`);
    assert.match(
      rOk.out,
      /^R2\s+GREEN\s+the snapshot Routine landed a copy on .* 0 day\(s\) ago and read it back/m,
      'N6 a fresh COMPLETE snapshot row: R2 GREEN'
    );

    // THE POINT: the backup repository is gone, and R2 is still GREEN, because a one-repository
    // session cannot read any other repository.
    const stash = `${BARE}-moved-away`;
    fs.renameSync(BARE, stash);
    const rGone = sweep();
    show('N6 unreachable', rGone.out, ['R2']);
    assert.equal(rGone.code, 0, `exit ${rGone.code}`);
    assert.match(
      rGone.out,
      /^R2\s+GREEN/m,
      "N6 an UNREACHABLE backup repository leaves R2 GREEN: the evidence is the snapshot run's own read-back, never a probe from here"
    );
    fs.renameSync(stash, BARE);

    // The row is a model's own report, so R2 checks what it can: the repository the row says the copy
    // landed on must be the backup_repo, and a sha, when given, must be one.
    const mirror = (R('vault/projects/recovery/status.md').match(/^backup_repo:\s*(.+)$/m) || [])[1].trim();
    // Only the snapshot row is changed, so the sweep rows these runs append survive for P2.
    rewriteSnapshot((r) => {
      r.repo = 'someone-else/not-the-backup';
      r.sha = 'a'.repeat(40);
    });
    const rWrong = sweep();
    assert.equal(rWrong.code, 2, `exit ${rWrong.code}: ${(rWrong.out.match(/^R2.*$/m) || [''])[0].slice(0, 120)}`);
    assert.match(
      rWrong.out,
      /^R2\s+AMBER\s+.*someone-else\/not-the-backup.*not the backup_repo/m,
      'N6 a COMPLETE row that landed on another repository makes R2 AMBER'
    );
    rewriteSnapshot((r) => {
      r.repo = mirror.toUpperCase();
      r.sha = 'b'.repeat(40);
    });
    const rMatch = sweep();
    assert.equal(rMatch.code, 0, `exit ${rMatch.code}`);
    assert.match(
      rMatch.out,
      /^R2\s+GREEN\s+.*bbbbbbbbbbbb/m,
      'N6 a row naming the backup_repo (any case) and its read-back sha: R2 GREEN, naming the sha'
    );
    rewriteSnapshot((r) => {
      delete r.repo;
      delete r.sha;
    });
    const rLegacy = sweep();
    assert.equal(rLegacy.code, 0, `exit ${rLegacy.code}`);
    assert.match(
      rLegacy.out,
      /^R2\s+GREEN\s+.*does not name its repository/m,
      'N6 a row from before the field existed stays GREEN and says it named no repository'
    );

    // NEGATIVE: nowhere to back up to at all.
    const nomirror = R('vault/projects/recovery/status.md');
    W('vault/projects/recovery/status.md', '---\ncreated: 2026-09-23\n---\n# Recovery\n');
    const r3 = sweep();
    assert.equal(r3.code, 2, `exit ${r3.code}`);
    assert.match(
      r3.out,
      /^R2\s+AMBER\s+no backup_repo in the frontmatter/m,
      'N6 no backup_repo in the frontmatter: R2 AMBER'
    );
    W('vault/projects/recovery/status.md', nomirror);
    git('add', '-A');
    git('commit', '-q', '-m', 'n6');
  });

  test('N7 NEGATIVE a shrunk soul.md is RED C22, and the card built from it goes AMBER C23', () => {
    W('soul.md', soul(1));
    const r = sweep();
    show('N7', r.out, ['C22', 'C23']);
    assert.equal(r.code, 1, `exit ${r.code}`);
    assert.match(r.out, /^C22\s+RED\s+soul\.md SHRANK \(My Words entries 3 -> 1/m);
    assert.match(r.out, /^C23\s+AMBER\s+soul-core\.md STALE/m);
    W('soul.md', soul(3));
    W('soul-core.md', `# card\n${stamp()}`);
    const r2 = sweep();
    assert.equal(r2.code, 0, `restored and the card rebuilt: exit ${r2.code}`);
    assert.match(r2.out, /^C22\s+GREEN/m);
    assert.match(r2.out, /^C23\s+GREEN/m);
    git('add', '-A');
    git('commit', '-q', '-m', 'n7');
  });

  test('N8 NEGATIVE a dangling [[wiki link]] is AMBER C6, exit 2', () => {
    W('vault/me/notes.md', '# Notes\nA link to [[people/nobody-here]] twice: [[people/nobody-here]].\n');
    const r = sweep();
    show('N8', r.out, ['C6']);
    assert.equal(r.code, 2, `exit ${r.code}`);
    assert.match(
      r.out,
      /^C6\s+AMBER\s+2 unresolved \[\[wiki link\]\]\(s\) across 1 distinct target\(s\): \[\[people\/nobody-here\]\] x2/m
    );
    W('vault/me/notes.md', '# Notes\nA link to [[projects/radar/status]] and to [[soul]].\n');
    const r2 = sweep();
    assert.equal(r2.code, 0, `restored: exit ${r2.code}`);
    assert.match(r2.out, /^C6\s+GREEN/m);
    git('add', '-A');
    git('commit', '-q', '-m', 'n8');
  });

  test('N9 NEGATIVE a rogue outputs/ top-level dir is AMBER C12, exit 2', () => {
    W('outputs/not-a-project/x.md', 'x\n');
    const r = sweep();
    show('N9', r.out, ['C12']);
    assert.equal(r.code, 2, `exit ${r.code}`);
    assert.match(
      r.out,
      /^C12\s+AMBER\s+VALIDATE FAIL: outputs\/ top-level dir\(s\) not a manifest key or declared exemption: not-a-project/m
    );
    fs.rmSync(path.join(REPO, 'outputs', 'not-a-project'), { recursive: true, force: true });
    const r2 = sweep();
    assert.equal(r2.code, 0, `removed: exit ${r2.code}`);
    assert.match(r2.out, /^C12\s+GREEN/m);
  });

  // check.mjs's loadRunLog() reads the run log WITHOUT trim, unlike scripts/run-log.mjs's own `last`: a
  // line a BOM pads fails JSON.parse untrimmed and is silently not a row at all here, exactly as a torn
  // line would be (check.mjs reports drift, not read errors, and never names either kind of bad line). So
  // padding the radar row's line with a BOM must make R1 see radar as never having run - reading it WITH
  // trim (as scripts/run-log.mjs's `last` does) would parse it fine and leave R1 GREEN instead, which is
  // exactly the drift a KNOWN_FLAGS-style hand copy could introduce here with nothing to catch it.
  test('N10 NEGATIVE a BOM-padded run-log row is silently not a row: R1 sees radar as never having run', () => {
    const before_ = R('system/run-log.jsonl');
    const lines = before_
      .trim()
      .split('\n')
      .map((l) => JSON.parse(l));
    const idx = lines.findIndex((row) => row.job === 'radar');
    const padded = `${lines.map((row, i) => (i === idx ? `\uFEFF${JSON.stringify(row)}` : JSON.stringify(row))).join('\n')}\n`;
    W('system/run-log.jsonl', padded);
    const r = sweep();
    show('N10', r.out, ['R1']);
    assert.equal(r.code, 2, `exit ${r.code}`);
    assert.match(r.out, /^R1\s+AMBER\s+1 Routine\(s\) past cadence: radar never ran/m);
    assert.doesNotMatch(r.out, /\uFEFF|bom/i, 'N10 no warning names the bad line either');
    W('system/run-log.jsonl', before_);
    const r2 = sweep();
    assert.equal(r2.code, 0, `restored: exit ${r2.code}`);
    assert.match(r2.out, /^R1\s+GREEN/m);
  });

  test('P2 the row count and the report survive every run', () => {
    const rows = R('system/run-log.jsonl')
      .trim()
      .split('\n')
      .map((l) => JSON.parse(l));
    const sweeps = rows.filter((r) => r.job === 'sweep');
    assert.ok(sweeps.length >= 20, `${sweeps.length} sweep rows`);
    assert.ok(
      sweeps.some((r) => r.status === 'RED') &&
        sweeps.some((r) => r.status === 'PARTIAL') &&
        sweeps.some((r) => r.status === 'COMPLETE'),
      'P2 every non-dry run appended a sweep row (RED, PARTIAL and COMPLETE all seen)'
    );
    const report = R('vault/projects/recovery/last-sweep.md');
    assert.match(report, /^verdict: CLEAN$/m);
    assert.match(report, /\| C9 \| GREEN \|/);
  });
});
