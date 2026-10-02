#!/usr/bin/env node
// scripts/tests/test-check-mjs-legs.mjs - characterization of work/18-recovery-layer/check.mjs, the
// Virtual Alex sweep, beyond test-check-mjs.mjs.
//
// WHAT. The legs and paths test-check-mjs.mjs never reaches (S, C11, R1 with no run log, R3 with no
// model, C23 missing or unstamped, N by *.key and by exact path, M by a MEMORY.md, the unreadable
// registry, the sweep row's reason and its failure lines), the fixed leg order the housekeeping Routine
// quotes, an unknown CLI flag, and known defects, each pinned as it behaves today. Deleted, a leg's
// wording or threshold could silently drift with nothing to catch it.
//
// HOW. A throwaway git repository per case carries the REAL check.mjs, run-log.mjs, json-writer.js and
// outputs-ledger.js and a small vault; rows are stamped from the real clock minus fixed offsets, or
// far in the future, so no assertion depends on the hour the test runs. Git runs with no system or
// global config. Nothing reaches a network.
//
// NEVER. Touches the checkout: every fixture lives in its own throwaway git repository under the OS
// temp folder. Reaches a network. Flips a PINNED DEFECT assertion on its own: each pins today's
// behaviour, and only a FIX row in the ratchet flips one. CK-D1: a snapshot row that says RED (the
// backup did not land) is reported AMBER. CK-D2: the S leg calls a PARTIAL skills row (the WARN row)
// GREEN. CK-D3: R1 accepts a future-dated row as fresh for ever. CK-D4: N flags a tracked .env.example
// as a secret (RED). CK-D5: any non-empty ALEX_ROUTINE, 0 included, turns an absent run log RED. CK-D6:
// a missing high-water mark is written as 0, so the next run never says "baseline recorded". CK-D7: C6
// resolves [[X]] against the root by the file system's case rule (GREEN on a case-insensitive disk,
// AMBER on the Linux VM). CK-D8: C11 matches the index by substring. CK-D9: an unknown flag is ignored
// (--dryrun writes a report and a row). CK-D10: a row's at is compared as a string, so a non-date at
// wins "newest". CK-D11: an exception inside a leg loses the whole report and the sweep row. CK-D13: a
// Routine row with no model (the prompts allow leaving --model out) is R3 drift. CK-D14: one stale
// snapshot is counted twice (R1 and R2).
//
// Usage: node scripts/tests/test-check-mjs-legs.mjs
// Exit: 0 every test passed - 1 a test failed

import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const KIT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'alex-check-legs-'));
after(() => fs.rmSync(TMP, { recursive: true, force: true, maxRetries: 5 }));

const GITCONFIG = path.join(TMP, 'empty-gitconfig');
fs.writeFileSync(GITCONFIG, '');
const ENV = {
  ...process.env,
  GIT_CONFIG_NOSYSTEM: '1',
  GIT_CONFIG_GLOBAL: GITCONFIG,
  GIT_AUTHOR_NAME: 'Owner',
  GIT_AUTHOR_EMAIL: 'owner@example.invalid',
  GIT_COMMITTER_NAME: 'Owner',
  GIT_COMMITTER_EMAIL: 'owner@example.invalid',
  ALEX_ROUTINE: '',
  ALEX_UNTRUSTED_LANE: '',
  CLAUDE_CODE_REMOTE: ''
};

const KIT_MANIFEST = JSON.parse(fs.readFileSync(path.join(KIT, 'system', 'manifest.json'), 'utf8'));
const ROUTINES = KIT_MANIFEST.routines;
const MODEL = KIT_MANIFEST.meta.model_routing.default;
const iso = (ms) => new Date(ms).toISOString().replace(/\.\d{3}Z$/, 'Z');
const hoursAgo = (h) => iso(Date.now() - h * 3600000);

let n = 0;
function repo({ vault = true, rows = true, routines = ROUTINES, model = MODEL, hooks = true } = {}) {
  const dir = path.join(TMP, `repo-${++n}`);
  const W = (rel, text) => {
    const p = path.join(dir, ...rel.split('/'));
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, text);
  };
  fs.mkdirSync(dir);
  const g = (...a) => {
    const r = spawnSync('git', ['-C', dir, ...a], { encoding: 'utf8', env: ENV });
    if (r.status !== 0) throw new Error(r.stderr);
    return r.stdout;
  };
  g('init', '-q', '-b', 'main', '.');
  if (hooks) g('config', 'core.hooksPath', 'scripts/hooks');
  for (const rel of [
    'work/18-recovery-layer/check.mjs',
    'scripts/run-log.mjs',
    'scripts/lib/json-writer.js',
    'scripts/outputs-ledger.js',
    'scripts/lib/run-log-read.js',
    'scripts/lib/args.js',
    'scripts/lib/errors.js',
    'scripts/lib/exit-codes.js'
  ]) {
    const d = path.join(dir, ...rel.split('/'));
    fs.mkdirSync(path.dirname(d), { recursive: true });
    fs.copyFileSync(path.join(KIT, ...rel.split('/')), d);
  }
  const meta = { unnumbered: [], utility_commands: [] };
  if (model) meta.model_routing = { default: model };
  W(
    'system/manifest.json',
    JSON.stringify(
      {
        meta,
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
        routines
      },
      null,
      2
    ) + '\n'
  );
  if (vault) {
    W('vault/index.md', '# Index\n\n- [[projects/radar/status]]\n- [[projects/recovery/status]]\n');
    W('vault/log.md', '# Log\n\n## [2026-09-01 08:00] run | one\n');
    W('vault/projects/radar/status.md', '# Radar\n');
    W('vault/projects/recovery/status.md', '---\nbackup_repo: owner/backup\n---\n# Recovery\n');
    W('soul.md', '# Soul\n\n## My Words\n\n### Harvested 2026-09-10 (typed)\n- "one"\n');
    const sha = crypto
      .createHash('sha256')
      .update(fs.readFileSync(path.join(dir, 'soul.md')))
      .digest('hex');
    W(
      'soul-core.md',
      `# card\nSOUL-CORE-STAMP: source-sha256=${sha} pins-sha256=e3b0c442 generated-at=2026-09-10T00:00:00.000Z entries=1 pinned=0 token-count=2`
    );
  }
  if (rows) {
    const text = routines
      .map((r) =>
        JSON.stringify({
          at: hoursAgo(1),
          canary: 'ok',
          job: r.name,
          missed: 0,
          model: MODEL,
          reason: null,
          ...(r.name === 'snapshot' ? { repo: 'owner/backup', sha: 'a'.repeat(40) } : {}),
          status: 'COMPLETE'
        })
      )
      .join('\n');
    W('system/run-log.jsonl', text + '\n');
  }
  g('add', '-A');
  g('commit', '-qm', 'fixture');
  return { dir, W, g, read: (rel) => fs.readFileSync(path.join(dir, ...rel.split('/')), 'utf8') };
}
function sweep(r, args = [], env = {}, cwd = r.dir) {
  const p = spawnSync(process.execPath, [path.join(r.dir, 'work', '18-recovery-layer', 'check.mjs'), ...args], {
    cwd,
    encoding: 'utf8',
    env: { ...ENV, ...env }
  });
  return { code: p.status, stdout: p.stdout || '', stderr: p.stderr || '' };
}
const leg = (out, id) => out.split('\n').find((l) => new RegExp(`^${id}\\s`).test(l)) || '';
const legRe = (id, level, text) => new RegExp(`^${id}\\s+${level}\\s+${text}`, 'm');
const lastRow = (r) => {
  const t = r.read('system/run-log.jsonl').trim().split('\n');
  return JSON.parse(t[t.length - 1]);
};
const replaceRow = (r, job, patch) => {
  const rows = r
    .read('system/run-log.jsonl')
    .trim()
    .split('\n')
    .map((l) => JSON.parse(l));
  r.W(
    'system/run-log.jsonl',
    rows.map((x) => JSON.stringify(x.job === job ? { ...x, ...patch } : x)).join('\n') + '\n'
  );
};

test('a healthy fixture is CLEAN: thirteen legs in the fixed order the housekeeping Routine quotes, exit 0', () => {
  const r = repo();
  const s = sweep(r);
  assert.equal(s.code, 0, s.stdout);
  const legLines = s.stdout.split('\n').slice(0, 13);
  assert.deepEqual(
    legLines.map((l) => l.slice(0, 4).trim()),
    ['C6', 'C9', 'C11', 'C12', 'C22', 'C23', 'R1', 'R2', 'R3', 'N', 'H', 'M', 'S']
  );
  for (const l of legLines) assert.match(l, /^[A-Z0-9]{1,3}\s+GREEN\s/, l);
  assert.equal(s.stdout.split('\n')[13], 'check.mjs: CLEAN - 13 green, 0 amber, 0 red (13 legs)');
  assert.equal(s.stdout.split('\n')[14], 'report: vault/projects/recovery/last-sweep.md');
  assert.match(
    s.stdout.split('\n')[15],
    /^run-log: appended \{.*"job":"sweep".*"reason":"13 green, 0 amber, 0 red".*"status":"COMPLETE"\}$/
  );
  assert.match(s.stdout, legRe('C9', 'GREEN', 'vault/log\\.md baseline recorded: 3 lines$'));
  assert.match(s.stdout, legRe('C22', 'GREEN', 'soul\\.md baseline recorded: 1 dated entries, 6 lines$'));
  assert.match(
    s.stdout,
    legRe('S', 'GREEN', 'no skills snapshot row yet \\(the housekeeping skills leg runs after this sweep\\)$')
  );
  assert.match(s.stdout, legRe('C12', 'GREEN', 'no outputs/ directory yet; nothing to name$'));
  assert.equal(s.stderr, '');
});

test('it checks the tree it lives in, whatever the cwd', () => {
  const r = repo();
  const s = sweep(r, ['--dry-run'], {}, os.tmpdir());
  assert.equal(s.code, 0);
  assert.match(s.stdout, /check\.mjs: CLEAN - 13 green, 0 amber, 0 red \(13 legs\) \[dry-run: nothing written\]/);
});

test('a bare tree (no vault, no soul, no run log): the not-yet wording on every leg, and an unset hooksPath is RED', () => {
  const r = repo({ vault: false, rows: false, hooks: false });
  const s = sweep(r);
  assert.equal(s.code, 1);
  assert.match(s.stdout, legRe('C6', 'AMBER', 'vault/ not created yet \\(run /setup\\); no links to check$'));
  assert.match(
    s.stdout,
    legRe('C9', 'AMBER', 'vault/log\\.md does not exist yet \\(run /setup\\); nothing to compare$')
  );
  assert.match(
    s.stdout,
    legRe('C11', 'AMBER', 'vault/index\\.md does not exist yet \\(run /setup\\); nothing to compare$')
  );
  assert.match(s.stdout, legRe('C22', 'AMBER', 'soul\\.md does not exist, so Alex has no voice loaded; '));
  assert.match(s.stdout, legRe('C23', 'AMBER', 'no soul\\.md, so there is no card to be fresh against$'));
  assert.match(
    s.stdout,
    legRe(
      'R1',
      'AMBER',
      'system/run-log\\.jsonl does not exist yet: no Routine has written a row \\(expected before the first Run now\\)$'
    )
  );
  assert.match(
    s.stdout,
    legRe('R2', 'AMBER', 'no backup_repo in the frontmatter of vault/projects/recovery/status\\.md yet ')
  );
  assert.match(s.stdout, legRe('R3', 'GREEN', 'no run-log rows yet to compare with the default model$'));
  assert.match(s.stdout, legRe('H', 'RED', 'core\\.hooksPath is unset: the commit gate'));
  assert.match(s.stdout, /check\.mjs: RED - 5 green, 7 amber, 1 red \(13 legs\)/);
});

test('R1 with no run log is RED inside a Routine session', () => {
  const r = repo({ rows: false });
  const s = sweep(r, ['--dry-run'], { ALEX_ROUTINE: '1' });
  assert.match(
    s.stdout,
    legRe(
      'R1',
      'RED',
      'system/run-log\\.jsonl is absent inside a Routine session: at least one Routine has run \\(this one\\)'
    )
  );
  assert.equal(s.code, 1);
});

test('PINNED DEFECT CK-D5: ALEX_ROUTINE=0 counts as a Routine', () => {
  const r = repo({ rows: false });
  for (const value of ['1', '0']) {
    const s = sweep(r, ['--dry-run'], { ALEX_ROUTINE: value });
    assert.match(
      s.stdout,
      legRe(
        'R1',
        'RED',
        'system/run-log\\.jsonl is absent inside a Routine session: at least one Routine has run \\(this one\\)'
      ),
      `ALEX_ROUTINE=${value}`
    );
    assert.equal(s.code, 1);
  }
});

test('R1 with no routines[] rows, and R3 with no default model, are AMBER', () => {
  const s1 = sweep(repo({ routines: [] }), ['--dry-run']);
  assert.match(
    s1.stdout,
    legRe('R1', 'AMBER', 'system/manifest\\.json has no routines\\[\\] rows, so there is no cadence to check against$')
  );
  const s2 = sweep(repo({ model: null }), ['--dry-run']);
  assert.match(
    s2.stdout,
    legRe(
      'R3',
      'AMBER',
      'system/manifest\\.json meta\\.model_routing\\.default is not set; no model to hold the rows to$'
    )
  );
});

test('PINNED DEFECT CK-D3: R1 takes a row dated in 2099 as fresh', () => {
  const r = repo();
  replaceRow(r, 'radar', { at: '2099-01-01T00:00:00Z' });
  const s = sweep(r, ['--dry-run']);
  assert.match(s.stdout, legRe('R1', 'GREEN', 'every Routine \\('));
});

test('PINNED DEFECT CK-D13: a Routine row with no model (the prompts say to leave --model out) is R3 AMBER', () => {
  const r = repo();
  replaceRow(r, 'brief', { model: null });
  const s = sweep(r, ['--dry-run']);
  assert.equal(s.code, 2);
  assert.match(
    s.stdout,
    legRe(
      'R3',
      'AMBER',
      `1 row\\(s\\) off the default model ${MODEL.replace(/\./g, '\\.')}: brief did not record its model `
    )
  );
});

test('PINNED DEFECT CK-D1: a snapshot row that says RED (the backup did not land) is reported AMBER, not RED', () => {
  const r = repo();
  replaceRow(r, 'snapshot', { status: 'RED', reason: 'backup branch not read back' });
  const s = sweep(r, ['--dry-run']);
  assert.match(
    s.stdout,
    legRe('R2', 'AMBER', 'the newest snapshot row is RED at [0-9T:-]+Z: backup branch not read back$')
  );
  assert.equal(s.code, 2, 'the verdict is AMBER, exit 2');
});

test('PINNED DEFECT CK-D10: a row whose at is not a date wins "newest" by string order and turns R1 and R2 AMBER beside a fresh row', () => {
  const r = repo();
  const rows = r.read('system/run-log.jsonl');
  r.W(
    'system/run-log.jsonl',
    rows + JSON.stringify({ at: 'last sunday', job: 'snapshot', status: 'COMPLETE', repo: 'owner/backup' }) + '\n'
  );
  const s = sweep(r, ['--dry-run']);
  assert.equal(
    leg(s.stdout, 'R1'),
    'R1   AMBER 1 Routine(s) past cadence: snapshot last row last sunday (unknown old, window 174h)'
  );
  assert.equal(leg(s.stdout, 'R2'), 'R2   AMBER the newest snapshot row has an unreadable timestamp (last sunday)');
});

test('PINNED DEFECT CK-D14: one nine-day-old snapshot is two AMBERs (R1 past cadence and R2 past eight days)', () => {
  const r = repo();
  replaceRow(r, 'snapshot', { at: hoursAgo(9 * 24 + 1) });
  const s = sweep(r, ['--dry-run']);
  assert.match(leg(s.stdout, 'R1'), /^R1\s+AMBER\s+1 Routine\(s\) past cadence: snapshot last row /);
  assert.match(
    leg(s.stdout, 'R2'),
    /^R2\s+AMBER\s+the newest COMPLETE snapshot row is .*, 9 days old \(window 8 days\); the snapshot Routine missed$/
  );
  assert.match(s.stdout, /check\.mjs: AMBER - 11 green, 2 amber, 0 red \(13 legs\)/);
});

test('the S leg: BLOCKED or an unreadable reason is AMBER, COMPLETE is GREEN', () => {
  const r = repo();
  const at = hoursAgo(2);
  const withSkills = (status, reason) => {
    const base = r
      .read('system/run-log.jsonl')
      .trim()
      .split('\n')
      .filter((l) => JSON.parse(l).job !== 'skills');
    r.W('system/run-log.jsonl', [...base, JSON.stringify({ at, job: 'skills', status, reason })].join('\n') + '\n');
    return leg(sweep(r, ['--dry-run']).stdout, 'S');
  };
  assert.equal(
    withSkills('BLOCKED', '/skills did not resolve'),
    `S    AMBER the housekeeping skills snapshot could not read /skills at ${at}: /skills did not resolve (mechanism-dependent; the claude.ai sync list is unverified this week)`
  );
  assert.equal(
    withSkills('COMPLETE', '/skills unreadable in this session'),
    `S    AMBER the housekeeping skills snapshot could not read /skills at ${at}: /skills unreadable in this session (mechanism-dependent; the claude.ai sync list is unverified this week)`
  );
  assert.equal(withSkills('COMPLETE', 'claude.ai sync: none'), `S    GREEN /skills readable at ${at}`);
});

test('PINNED DEFECT CK-D2: PARTIAL (the WARN row) is GREEN', () => {
  const r = repo();
  const at = hoursAgo(2);
  const withSkills = (status, reason) => {
    const base = r
      .read('system/run-log.jsonl')
      .trim()
      .split('\n')
      .filter((l) => JSON.parse(l).job !== 'skills');
    r.W('system/run-log.jsonl', [...base, JSON.stringify({ at, job: 'skills', status, reason })].join('\n') + '\n');
    return leg(sweep(r, ['--dry-run']).stdout, 'S');
  };
  assert.equal(
    withSkills('PARTIAL', 'claude.ai sync changed: was none; now pdf'),
    `S    GREEN /skills readable at ${at} (the list changed; see the row)`
  );
});

test("PINNED DEFECT CK-D7: C6's last-resort probe of the repository root follows the file system's case rule", () => {
  // [[CLAUDE]] is lowercased to "claude" and resolved against the root, where the file is CLAUDE.md:
  // it resolves on a case-insensitive disk (Windows, a default macOS volume) and not on a
  // case-sensitive one (the Linux VM). The expectation is measured on this disk, not assumed.
  const r = repo();
  r.W('CLAUDE.md', '# rules\n');
  r.W('vault/me/notes.md', 'see [[CLAUDE]]\n');
  const probe = path.join(r.dir, 'Case-Probe.tmp');
  fs.writeFileSync(probe, 'x');
  const insensitive = fs.existsSync(path.join(r.dir, 'case-probe.tmp'));
  fs.rmSync(probe);
  const line = leg(sweep(r, ['--dry-run']).stdout, 'C6');
  if (insensitive) assert.match(line, /^C6\s+GREEN\s/);
  else assert.equal(line, 'C6   AMBER 1 unresolved [[wiki link]](s) across 1 distinct target(s): [[claude]] x1');
});

test('C11: a status page on disk that the index does not catalogue, and an index entry with no page, are AMBER', () => {
  const r = repo();
  r.W('vault/index.md', '# Index\n\n- [[projects/recovery/status]]\n- [[projects/gone/status]]\n');
  const s = sweep(r, ['--dry-run']);
  assert.equal(
    leg(s.stdout, 'C11'),
    'C11  AMBER status page(s) on disk but not catalogued: #15 radar (projects/radar/status) | index entries with no page on disk: projects/gone/status'
  );
});

test('PINNED DEFECT CK-D8: C11 matches by substring, so status-archive in the index hides a missing status page', () => {
  const r = repo();
  r.W('vault/projects/radar/status-archive.md', '# old\n');
  r.W('vault/index.md', '# Index\n\n- [[projects/radar/status-archive]]\n- [[projects/recovery/status]]\n');
  const s = sweep(r, ['--dry-run']);
  assert.equal(leg(s.stdout, 'C11'), 'C11  GREEN vault/index.md and the disk agree');
});

test('C23: a missing card and a card with no parseable stamp are AMBER', () => {
  const r = repo();
  fs.rmSync(path.join(r.dir, 'soul-core.md'));
  assert.equal(
    leg(sweep(r, ['--dry-run']).stdout, 'C23'),
    'C23  AMBER soul-core.md MISSING: sessions run on the full-soul fallback; rebuild with node scripts/lib/build-soul-core.js --force'
  );
  r.W('soul-core.md', '# card, hand-edited, no stamp\n');
  assert.equal(
    leg(sweep(r, ['--dry-run']).stdout, 'C23'),
    'C23  AMBER soul-core.md has no parseable SOUL-CORE-STAMP source-sha256 (hand-edited or truncated); rebuild with node scripts/lib/build-soul-core.js --force'
  );
});

test('N: a tracked *.key, a tracked .env.local and an exact never-list path are RED', () => {
  const r = repo();
  r.W('certs/deploy.key', 'not a real key\n');
  r.W('system/credentials-ledger.json', '{}\n');
  r.W('.env.local', 'X=1\n');
  r.g('add', '-A');
  const s = sweep(r, ['--dry-run']);
  assert.match(leg(s.stdout, 'N'), /^N\s+RED\s+3 never-list path\(s\) are TRACKED: /);
  for (const p of ['certs/deploy.key', 'system/credentials-ledger.json', '.env.local'])
    assert.ok(leg(s.stdout, 'N').includes(p), p);
});

test('PINNED DEFECT CK-D4: a tracked .env.example is RED too', () => {
  const r = repo();
  r.W('certs/deploy.key', 'not a real key\n');
  r.W('system/credentials-ledger.json', '{}\n');
  r.W('.env.local', 'X=1\n');
  r.W('.env.example', 'X=\n');
  r.g('add', '-A');
  const s = sweep(r, ['--dry-run']);
  assert.match(leg(s.stdout, 'N'), /^N\s+RED\s+4 never-list path\(s\) are TRACKED: /);
  for (const p of ['certs/deploy.key', 'system/credentials-ledger.json', '.env.local', '.env.example'])
    assert.ok(leg(s.stdout, 'N').includes(p), p);
});

test('M: a MEMORY.md anywhere under .claude/ (skills excepted) and a tracked .claude/projects file are RED', () => {
  const r = repo();
  r.W('.claude/skills/some-skill/MEMORY.md', '# a skill document, not a memory\n');
  assert.match(leg(sweep(r, ['--dry-run']).stdout, 'M'), /^M\s+GREEN\s/);
  r.W('.claude/agents/MEMORY.md', '# a memory\n');
  assert.match(
    leg(sweep(r, ['--dry-run']).stdout, 'M'),
    /^M\s+RED\s+auto-memory surface inside the clone: \.claude\/agents\/MEMORY\.md \(/
  );
  fs.rmSync(path.join(r.dir, '.claude', 'agents'), { recursive: true });
  r.W('.claude/projects/x.md', '# tracked memory\n');
  r.g('add', '-A');
  assert.match(
    leg(sweep(r, ['--dry-run']).stdout, 'M'),
    /^M\s+RED\s+auto-memory surface inside the clone: \.claude\/projects\/ \(/
  );
});

test('C12: outputs/ present but no outputs-ledger.js is AMBER', () => {
  const r = repo();
  r.W('outputs/radar/2026-09-21/board.md', '# board\n');
  fs.rmSync(path.join(r.dir, 'scripts', 'outputs-ledger.js'));
  assert.equal(
    leg(sweep(r, ['--dry-run']).stdout, 'C12'),
    'C12  AMBER scripts/outputs-ledger.js is missing, so outputs/ naming could not be validated'
  );
});

test('an unreadable registry: exit 1, one checker ERROR line on stderr, no report and no sweep row', () => {
  const r = repo();
  fs.rmSync(path.join(r.dir, 'system', 'manifest.json'));
  const before = r.read('system/run-log.jsonl');
  const s = sweep(r);
  assert.equal(s.code, 1);
  assert.equal(s.stdout, '');
  assert.match(s.stderr, /^check\.mjs: checker ERROR \(exit 1\): system\/manifest\.json could not be read - ENOENT/);
  assert.equal(fs.existsSync(path.join(r.dir, 'vault', 'projects', 'recovery', 'last-sweep.md')), false);
  assert.equal(r.read('system/run-log.jsonl'), before);
});

test('the sweep row mirrors the verdict (RED, PARTIAL, COMPLETE) and its reason names the first red or amber leg', () => {
  const r = repo();
  sweep(r);
  assert.deepEqual([lastRow(r).status, lastRow(r).reason], ['COMPLETE', '13 green, 0 amber, 0 red']);
  r.W('vault/me/notes.md', 'a link to [[people/nobody]]\n');
  sweep(r);
  assert.deepEqual(
    [lastRow(r).status, lastRow(r).reason],
    [
      'PARTIAL',
      '12 green, 1 amber, 0 red; C6: 1 unresolved [[wiki link]](s) across 1 distinct target(s): [[people/nobody]] x1'
    ]
  );
  r.g('config', '--unset', 'core.hooksPath');
  sweep(r);
  assert.equal(lastRow(r).status, 'RED');
  assert.match(lastRow(r).reason, /^11 green, 1 amber, 1 red; H: core\.hooksPath is unset: the commit gate/);
  assert.ok(
    lastRow(r).reason.length <= '11 green, 1 amber, 1 red; H: '.length + 160,
    'the leg text is cut at 160 characters'
  );
});

test('the sweep row failing or missing is a WARN line, and never changes the exit code', () => {
  const r = repo();
  r.W('system/run-log.jsonl', r.read('system/run-log.jsonl').trimEnd()); // no trailing newline: run-log's verify fails
  const s = sweep(r);
  assert.equal(s.code, 0);
  assert.equal(
    s.stdout.trim().split('\n').pop(),
    'check.mjs: WARN the sweep row was not written (run-log exit 1): run-log: WRITE VERIFY FAILED - the last line of ' +
      ['system', 'run-log.jsonl'].join(path.sep) +
      ' is not the row just appended'
  );
  const r2 = repo();
  fs.rmSync(path.join(r2.dir, 'scripts', 'run-log.mjs'));
  const s2 = sweep(r2);
  assert.equal(s2.code, 0);
  assert.equal(
    s2.stdout.trim().split('\n').pop(),
    'check.mjs: WARN scripts/run-log.mjs is missing; no sweep row written'
  );
});

test('the report frontmatter carries the verdict, the counts and the three high-water marks', () => {
  const r = repo();
  sweep(r);
  const fm = /^---\n([\s\S]*?)\n---\n/.exec(r.read('vault/projects/recovery/last-sweep.md'))[1].split('\n');
  assert.deepEqual(
    fm.map((l) => l.split(':')[0]),
    ['at', 'verdict', 'green', 'amber', 'red', 'log_lines', 'soul_entries', 'soul_lines']
  );
  assert.deepEqual(fm.slice(1), [
    'verdict: CLEAN',
    'green: 13',
    'amber: 0',
    'red: 0',
    'log_lines: 3',
    'soul_entries: 1',
    'soul_lines: 6'
  ]);
});

test('PINNED DEFECT CK-D6: a missing mark is written as 0, so the next run reads "high-water 0", never "baseline recorded"', () => {
  const r = repo();
  fs.rmSync(path.join(r.dir, 'vault', 'log.md'));
  sweep(r);
  assert.match(r.read('vault/projects/recovery/last-sweep.md'), /\nlog_lines: 0\n/);
  r.W('vault/log.md', 'a\nb\nc\n');
  assert.equal(leg(sweep(r).stdout, 'C9'), 'C9   GREEN vault/log.md 3 lines (high-water 0)');
});

test('PINNED DEFECT CK-D9: an unknown flag is ignored, so --dryrun writes the report and appends a row', () => {
  const r = repo();
  const before = r.read('system/run-log.jsonl').trim().split('\n').length;
  const s = sweep(r, ['--dryrun']);
  assert.doesNotMatch(s.stdout, /dry-run/);
  assert.equal(fs.existsSync(path.join(r.dir, 'vault', 'projects', 'recovery', 'last-sweep.md')), true);
  assert.equal(r.read('system/run-log.jsonl').trim().split('\n').length, before + 1);
});

test('an unknown flag warns on stderr by name, without changing whether the sweep writes', () => {
  const r = repo();
  const s = sweep(r, ['--dryrun']);
  assert.equal(s.stderr, 'check.mjs: WARNING - ignored --dryrun: unknown flag --dryrun\n');
  assert.equal(s.code, 0);
});

test('PINNED DEFECT CK-D11: an exception inside a leg (soul.md is a directory) loses the report and the row: exit 1, a stack', () => {
  const r = repo();
  fs.rmSync(path.join(r.dir, 'soul.md'));
  fs.mkdirSync(path.join(r.dir, 'soul.md'));
  const before = r.read('system/run-log.jsonl');
  const s = sweep(r);
  assert.equal(s.code, 1);
  assert.equal(s.stdout, '', 'not even the legs before it print: the lines are printed at the end');
  assert.match(s.stderr, /EISDIR/);
  assert.doesNotMatch(s.stderr, /check\.mjs: checker ERROR/, "no line of its own, only Node's stack");
  assert.equal(fs.existsSync(path.join(r.dir, 'vault', 'projects', 'recovery', 'last-sweep.md')), false);
  assert.equal(r.read('system/run-log.jsonl'), before);
});
