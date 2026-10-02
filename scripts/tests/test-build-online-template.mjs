#!/usr/bin/env node
// scripts/tests/test-build-online-template.mjs - the guards of the Virtual Alex template generator,
// each shown REFUSING a synthetic violation before the pass.
//
// WHAT. A guard that passes because it tests nothing is indistinguishable from one that passes because
// the tree is healthy; the cases below are what tell them apart. Deleted, this file would let the
// builder ship an unclaimed path, a settings change with no changelog flag, a carriage return, or a
// generated tree that drifts from what the Kit's own manifest and INSTALL-ONLINE.md promise, all with
// every other test green.
//
//   N1-N4  a manifest row with no online value, or one outside ship|drop|variant, or an unclaimed or
//          doubly-claimed tracked path, each refuses
//   N5-N8  a variants/online file claimed ship, an empty or incomplete flagged list on a privileged
//          diff, and --seed against the generic remote, each refuses
//   N9-N10 a seed's INSTALL-<NAME>.md never lands (INSTALL-ONLINE.md ships instead), and a seed with no
//          starter/ refuses
//   P1-P5  claim resolution (the exact claim beats the directory claim, drop rows drop, a variant lands
//          at its real path), flaggedOf/assertFlagged, a symlink skipped, the REAL manifest claiming
//          every tracked path of this Kit, and a seed shipping starter/** plus its two owner docs only
//   P6  the online command set: /cron-setup dropped by its manifest row, /alex-status added (the laptop
//       side of P6, and the B0-B6 end-to-end build legs, are test-build-online-template-kit.mjs's: a
//       generated tree has no donor scanner and no laptop cron-setup.md to read, so those legs cannot
//       run there by design)
//   P7  no online-authored surface tells an owner to type /status, which the web page swallows
//   P8  online, the triage's memory is kept, its credentials folder and raw drafts are not, and in a
//       cloud session an approved sender rule goes to rules.md, never to config/
//   P9  every "section N" in INSTALL-ONLINE.md points at the heading it means, never merely one that
//       exists, and a reference no row declares fails too
//
// HOW. Pure calls (resolveRows, claimFor, classify, planTree, flaggedOf, assertFlagged, parseArgs) for
// the N and most P cases; a few P cases run the real script as a child process against a throwaway clone
// or a miniature fixture Kit, never the Kit this test runs in.
//
// NEVER. Writes inside the repository it runs in, or reaches the network.
//
// Usage: node scripts/tests/test-build-online-template.mjs
// Exit: 0 all pass - 1 any failure

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import {
  Refusal,
  resolveRows,
  claimFor,
  classify,
  planTree,
  flaggedOf,
  assertFlagged,
  parseArgs,
  loadManifest,
  trackedEntries,
  rowText,
  changelogRow,
  seedFiles,
  nextBuild,
  KIT,
  DEFAULT_REMOTE
} from '../build-online-template.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));

// THIS FILE SHIPS INTO THE GENERATED TEMPLATE AND RUNS IN ITS CI TOO. Nearly all of it is fixture
// work that holds in any tree, but P7 asks a different floor and a different source .gitignore
// depending on whether the directory the variants are read from exists. In the generated tree it does
// not, and false there is the generator having done its job, not a defect. `variants/` is a drop row,
// so its absence is the marker.
const IS_KIT = fs.existsSync(path.join(path.resolve(HERE, '..', '..'), 'variants', 'online'));

/**
 * Runs fn and returns whatever it threw (a Refusal or anything else), or null if it did not throw.
 * @param {() => unknown} fn
 */
function caught(fn) {
  try {
    fn();
    return null;
  } catch (e) {
    return e;
  }
}
/**
 * fn() must throw a Refusal, optionally naming mustMention in its message.
 * @param {() => unknown} fn
 * @param {string} [mustMention]
 */
function refused(fn, mustMention) {
  assert.throws(fn, (/** @type {any} */ e) => {
    assert.ok(e instanceof Refusal, `threw a non-Refusal: ${e?.message}`);
    if (mustMention) {
      assert.ok(
        e.message.includes(mustMention),
        `REFUSED (exit ${e.exitCode}) but did not mention ${JSON.stringify(mustMention)}: ${e.message}`
      );
    }
    return true;
  });
}

const manifest = (rows) => ({ components: rows });
const row = (id, paths, online) => (online === undefined ? { id, paths } : { id, paths, online });

/**
 * A git child confined under `home`: no inherited GIT_* redirection, no system or global config.
 * @param {string} home
 */
function gitEnv(home) {
  const cfg = path.join(home, '.alex-test-gitconfig');
  if (!fs.existsSync(cfg)) fs.writeFileSync(cfg, '');
  const env = { ...process.env };
  for (const k of Object.keys(env)) if (/^GIT_/.test(k)) delete env[k];
  return { ...env, GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: cfg, GIT_CEILING_DIRECTORIES: home };
}

describe('negatives', () => {
  test('N1-N2 an online value that is missing or outside the three refuses', () => {
    refused(
      () => resolveRows(manifest([row('constitution', ['CLAUDE.md'], 'variant'), row('docs', ['docs/'])])),
      'row "docs" has no online value'
    ); // N1 a row stripped of online refuses
    refused(() => resolveRows(manifest([row('docs', ['docs/'], 'maybe')])), 'row "docs" has no online value'); // N2 an online value outside the three refuses
  });

  test('N3 a tracked path no row claims refuses', () => {
    const claims = resolveRows(manifest([row('docs', ['docs/'], 'ship')]));
    refused(() => classify(['docs/a.md', 'zzz/unclaimed.md'], claims), 'zzz/unclaimed.md');
  });

  test('N4 a path two rows name refuses', () => {
    refused(
      () => resolveRows(manifest([row('a', ['scripts/x.ps1'], 'drop'), row('b', ['scripts/x.ps1'], 'ship')])),
      'claimed by both "a" and "b"'
    );
  });

  test('N5 a variants/online file whose row is ship refuses', () => {
    const claims = resolveRows(
      manifest([row('scripts', ['scripts/'], 'ship'), row('variants', ['variants/'], 'drop')])
    );
    const entries = [
      { mode: '100644', path: 'scripts/hooks/pre-commit' },
      { mode: '100644', path: 'variants/online/scripts/hooks/pre-commit' }
    ];
    refused(() => planTree(entries, claims, '/kit'), 'its row "scripts" is ship');
  });

  test('N6-N7 assertFlagged refuses an empty list and a list that leaves out a privileged path', () => {
    // N6 a diff touching .claude/settings.json with an EMPTY flagged list refuses
    refused(() => assertFlagged(['.claude/settings.json', 'docs/x.md'], []), 'flags NOTHING');
    // N7 a flagged list that leaves out a privileged path refuses
    refused(() => assertFlagged(['scripts/hooks/pre-commit', 'CLAUDE.md'], ['CLAUDE.md']), 'scripts/hooks/pre-commit');
  });

  test('N8 --seed against the generic remote refuses', () => {
    refused(() => parseArgs(['--push', '--seed', '/somewhere/alex-someone']), 'never goes to the generic template');
  });
});

describe('positives: resolveRows, claimFor, planTree (P1)', () => {
  test('P1a-i the exact claim beats the directory claim; drop rows drop; a variant lands at its real path', () => {
    const claims = resolveRows(
      manifest([
        row('constitution', ['CLAUDE.md'], 'variant'),
        row('scripts', ['scripts/'], 'ship'),
        row('wrappers', ['scripts/run-job.mjs', 'launchd/'], 'drop'),
        row('launchers', ['Install-Alex.cmd'], 'drop'),
        row('variants', ['variants/'], 'drop'),
        row('online-install', ['INSTALL-ONLINE.md'], 'ship')
      ])
    );
    assert.equal(
      claimFor('scripts/lib/x.js', claims).id,
      'scripts',
      'P1a a file under a directory row resolves to that row'
    );
    assert.equal(
      claimFor('scripts/run-job.mjs', claims).id,
      'wrappers',
      'P1b the exact claim beats the directory claim'
    );
    assert.equal(claimFor('nothing/here.md', claims), null, 'P1c an unclaimed path resolves to null');
    assert.equal(
      claimFor('nonscripts/x.js', claims),
      null,
      'P1i a directory claim is a true PREFIX match, never a substring: "nonscripts/x.js" merely contains "scripts/" past its own start'
    );
    const entries = [
      { mode: '100644', path: 'CLAUDE.md' },
      { mode: '100644', path: 'variants/online/CLAUDE.md' },
      { mode: '100644', path: 'scripts/lib/x.js' },
      { mode: '100755', path: 'scripts/hooks/pre-commit' },
      { mode: '100644', path: 'scripts/run-job.mjs' },
      { mode: '100644', path: 'Install-Alex.cmd' }
    ];
    const plan = planTree(entries, claims, '/kit');
    const dsts = plan.files.map((f) => f.dst).sort();
    assert.equal(
      JSON.stringify(dsts),
      JSON.stringify(['CLAUDE.md', 'scripts/hooks/pre-commit', 'scripts/lib/x.js']),
      `P1d ship files copy, drop files vanish, the variant lands at its real path - ${dsts.join(', ')}`
    );
    const variant = plan.files.find((f) => f.dst === 'CLAUDE.md');
    assert.ok(
      variant?.src.replace(/\\/g, '/').endsWith('/variants/online/CLAUDE.md'),
      `P1e the variant is read from variants/online/, not from the Kit - ${variant?.src}`
    );
    const hook = plan.files.find((f) => f.dst === 'scripts/hooks/pre-commit');
    assert.equal(hook?.mode, '100755', 'P1f the executable bit rides with the file');
    assert.ok(
      plan.counts.ship === 2 && plan.counts.variant === 1 && plan.counts.drop === 2,
      `P1g the counts say what happened - ${JSON.stringify(plan.counts)}`
    );
    const absent = plan.reports.filter((r) => r.startsWith('ABSENT'));
    assert.ok(
      absent.length === 2 &&
        absent.some((r) => r.includes('INSTALL-ONLINE.md')) &&
        absent.some((r) => r.includes('launchd/')),
      `P1h a listed path that is absent is reported, not fatal - ${absent.join(' | ')}`
    );
  });
});

describe('positives: flaggedOf, assertFlagged, the changelog row (P2)', () => {
  test('P2a-g flaggedOf, a passing flagged list, and the explicit build number', () => {
    const f = flaggedOf([
      'docs/x.md',
      '.claude/settings.json',
      'scripts/lib/a.js',
      'scripts/x.js',
      'scheduler/routines/brief.md'
    ]);
    assert.equal(
      JSON.stringify(f),
      JSON.stringify(['.claude/settings.json', 'scheduler/routines/brief.md', 'scripts/lib/a.js']),
      `P2a flaggedOf keeps only the privileged paths, sorted - ${f.join(', ')}`
    );
    assert.equal(
      caught(() => assertFlagged(['.claude/settings.json', 'docs/x.md'], ['.claude/settings.json'])),
      null,
      'P2b a flagged list that covers the diff passes'
    );
    assert.equal(
      caught(() => assertFlagged(['docs/x.md', 'vault/y.md'], [])),
      null,
      'P2c no privileged change and an empty list passes'
    );
    const r = changelogRow({
      kitCommit: 'abc',
      kitDirty: false,
      previous: null,
      files: 3,
      changed: ['a', 'b'],
      flagged: ['CLAUDE.md']
    });
    const line = rowText(r);
    assert.ok(
      !line.includes('\n') &&
        line.startsWith('{"at":') &&
        line.includes('"kit_commit":"abc"') &&
        line.includes('"previous_template_commit":null'),
      `P2d the changelog row is one line in the JSON writer's key order - ${line}`
    );

    // P2e-P2g, the explicit build number: each row carries its own, and a row that does not sit at its
    // position refuses the next push, so a shifted history stops the writer instead of mislabelling
    // every build after it. A legacy row with no build number at all still counts by its position.
    const legacy = `${['{"at":"2026-01-01T00:00:00Z"}', '{"at":"2026-01-02T00:00:00Z"}'].join('\n')}\n`;
    const shifted = caught(() => nextBuild(`${legacy}{"at":"2026-01-03T00:00:00Z","build":4}\n`));
    assert.ok(
      shifted instanceof Refusal && /row 3 says build 4/.test(shifted.message),
      `P2e NEGATIVE a row whose build is not its position refuses the next push - ${shifted ? shifted.message : 'no refusal'}`
    );
    let n = null;
    try {
      n = nextBuild(`${legacy}{"at":"2026-01-03T00:00:00Z","build":3}\n`);
    } catch (e) {
      n = e.message;
    }
    assert.equal(n, 4, 'P2f legacy rows count by position and an explicit build is honoured: the next build is 4');
    const r2 = changelogRow({
      kitCommit: 'abc',
      kitDirty: false,
      previous: null,
      files: 3,
      changed: [],
      flagged: [],
      build: 24
    });
    const line2 = rowText(r2);
    assert.ok(
      line2.startsWith('{"at":') && line2.includes('"build":24'),
      `P2g the row carries its build, and "at" stays first for /update's sed - ${line2}`
    );
  });
});

describe('P3: a symlink entry is skipped, never written', () => {
  test('a .claude/skills/ link is never written', () => {
    const claims = resolveRows(manifest([row('skills', ['.claude/'], 'ship')]));
    const plan = planTree(
      [
        { mode: '120000', path: '.claude/skills/xlsx' },
        { mode: '100644', path: '.claude/commands/x.md' }
      ],
      claims,
      '/kit'
    );
    assert.ok(
      plan.files.length === 1 && plan.files[0].dst === '.claude/commands/x.md',
      `P3 a .claude/skills/ link is never written - ${JSON.stringify(plan.files.map((f) => f.dst))}`
    );
  });
});

describe('P4: the real manifest resolves and every tracked path of this Kit is claimed', () => {
  test('the live proof', () => {
    let liveOk = false;
    let detail = '';
    try {
      const claims = resolveRows(loadManifest());
      const entries = trackedEntries(KIT);
      const plan = planTree(entries, claims);
      liveOk = plan.files.length > 0;
      detail = `${entries.length} tracked path(s) all claimed; ${plan.counts.ship} ship, ${plan.counts.variant} variant, ${plan.counts.drop} dropped, ${plan.reports.filter((r) => r.startsWith('ABSENT')).length} absent`;
    } catch (e) {
      detail = e.message;
    }
    assert.ok(liveOk, `P4 the real manifest claims every tracked path of this Kit - ${detail}`);
    assert.ok(
      DEFAULT_REMOTE.startsWith('https://github.com/'),
      `P4b the default remote is a GitHub url - ${DEFAULT_REMOTE}`
    );
  });
});

// P6: the online command set. What an owner can type is part of the product, so it is pinned rather than
// left to whichever row happens to claim a path. A command the online lane cannot run must not be
// offered there: every one of its paths fails, and the owner has no way to know that before typing it.
describe('P6: the online command set', () => {
  const onlineCommands = () => {
    const plan = planTree(trackedEntries(), resolveRows(loadManifest()));
    return plan.files
      .map((f) => f.dst)
      .filter((p) => p.startsWith('.claude/commands/'))
      .map((p) => p.slice('.claude/commands/'.length));
  };

  test('/cron-setup is absent from the online tree, and status.md ships', () => {
    // /cron-setup registers a local scheduler job: Windows Task Scheduler, launchd or systemd. A
    // cloud session has none of the three. The online schedule is Routines created by hand in the
    // claude.ai app from docs/ROUTINES-FORMS.md.
    const online = onlineCommands();
    assert.ok(
      !online.includes('cron-setup.md'),
      `P6 /cron-setup is absent from the online tree (no Task Scheduler, no launchd, no systemd there) - ${
        online.includes('cron-setup.md') ? 'it still ships' : `${online.length} commands online`
      }`
    );
    assert.ok(
      online.includes('status.md'),
      'P6 and status.md ships too: it is where the behaviour is written, in one copy, and alex-status.md sends the reader to it'
    );
  });
});

// P7: no online-authored surface tells an owner to type /status. The rename is only worth anything if the
// documents moved with it. This scans the surfaces written FOR a cloud owner or read BY a cloud session.
// It deliberately does not scan the laptop install guides (docs/GETTING-STARTED.md, docs/UPDATING.md,
// docs/README.md, docs/ARCHITECTURE.md, docs/projects/, docs/constitution-annex/): they describe the
// laptop, where /status is the correct command, and rewriting them would make the laptop docs wrong. The
// online CLAUDE.md names that gap and tells the session what to do when an owner meets one of those pages.
describe('P7: no online-authored surface tells an owner to type /status', () => {
  test('the scan finds no live hit, and the pattern is held both ways on synthetic text', () => {
    const surfaces = [];
    const walk = (rel) => {
      const abs = path.join(KIT, rel);
      if (!fs.existsSync(abs)) return;
      if (fs.statSync(abs).isFile()) {
        surfaces.push(rel);
        return;
      }
      for (const e of fs.readdirSync(abs, { withFileTypes: true })) {
        walk(`${rel}/${e.name}`);
      }
    };
    [
      'variants/online',
      'INSTALL-ONLINE.md',
      'docs/ROUTINES-FORMS.md',
      '.claude/commands/update.md',
      'scheduler/routines',
      'scripts/autosave.sh',
      'docs/WHAT-IS-ALEX.md',
      'docs/ARCHITECTURE-ONLINE.md'
    ].forEach(walk);

    // /status as a COMMAND: not inside a path (no word char, slash, dot or dash before it) and not the
    // head of a longer name or path (a word char, dash or slash after it, or a dot FOLLOWED by a word
    // char, as in status.md). A dot followed by anything else ends a sentence, and "Type /status." is
    // the command.
    const asCommand = /(?<![\w/.-])\/status(?![\w/-]|\.\w)/;
    const hits = [];
    for (const rel of surfaces) {
      const lines = fs.readFileSync(path.join(KIT, rel), 'utf8').split(/\r?\n/);
      // A PARAGRAPH that names /alex-status as well is explaining the clash; one that names only
      // /status is sending the owner to a command the web page eats. The scope is the paragraph and
      // NOT the file, so no document gets a blanket pass: the alias command file has to keep giving
      // the right name beside every mention of the wrong one, and so does anything written later.
      let from = 0;
      for (let i = 0; i <= lines.length; i++) {
        if (i < lines.length && lines[i].trim() !== '') continue;
        const block = lines.slice(from, i);
        if (!block.some((l) => l.includes('/alex-status'))) {
          block.forEach((l, k) => {
            if (asCommand.test(l)) hits.push(`${rel}:${from + k + 1}`);
          });
        }
        from = i + 1;
      }
    }
    assert.equal(
      hits.length,
      0,
      `P7 no online-authored surface tells an owner to type /status - ${hits.length ? hits.join(', ') : `${surfaces.length} surfaces scanned, all clean`}`
    );
    // The pattern's lookahead must exclude only a dot followed by a word character, not any dot: "Stuck?
    // Type /status." is the command, "Type /status and read..." is too. Held on the pattern itself, both
    // ways, because no shipped line happens to carry the sentence-ending case today and a scan of clean
    // files cannot show the pattern can see it.
    const sentenceEnds = ['Stuck? Type /status.', 'type /status!', 'then /status?'];
    const filenames = [
      'vault/projects/x/status.md',
      'open /status.md first',
      'see /status-report',
      'the /status/ folder'
    ];
    assert.ok(
      sentenceEnds.every((s) => asCommand.test(s)),
      `P7 NEGATIVE a sentence that ends on /status is read as the command - ${sentenceEnds.filter((s) => !asCommand.test(s)).join(' | ') || 'all three'}`
    );
    assert.ok(
      !filenames.some((s) => asCommand.test(s)),
      `P7 a status.md filename, a /status- word and a /status/ path are not - ${filenames.filter((s) => asCommand.test(s)).join(' | ') || 'none matched'}`
    );
    // The floor differs by tree because the surface list does: the Kit adds all of variants/online,
    // which the generated tree does not have. The guard's job is the same in both, catch a scan that
    // silently found nothing and passed for that reason.
    const floor = IS_KIT ? 15 : 5;
    assert.ok(
      surfaces.length > floor,
      `P7 the scan actually found the surfaces - ${surfaces.length} files (floor ${floor}, ${IS_KIT ? 'Kit' : 'generated tree'})`
    );
  });
});

// P8: the triage's memory survives a cloud session, and no secret does. Online the repository IS the
// disk: a path the online .gitignore swallows is gone when the session ends. The triage keeps non-secret
// state in five places and must find all five next session; its credentials folder and its raw draft text
// must never be committed. And the rules an owner approves (the noise killer's suppressions) went to
// work/07-email-triage/config/sender-rules.json, which the credential-folder rule once swallowed online
// too, so every approval evaporated there without a word. Asked of git itself, against the online
// .gitignore alone, with no global excludes.
describe('P8: the triage memory survives a cloud session, and no secret does', () => {
  test('kept paths stay, credentials and raw drafts leave, and the approval line names both', () => {
    const ignoreFile = IS_KIT ? path.join(KIT, 'variants', 'online', '.gitignore') : path.join(KIT, '.gitignore');
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'va-ignore-'));
    try {
      const env = gitEnv(tmp);
      const empty = path.join(tmp, 'no-excludes');
      fs.writeFileSync(empty, '');
      const repo = path.join(tmp, 'repo');
      fs.mkdirSync(repo);
      spawnSync('git', ['init', '-q'], { cwd: repo, env });
      fs.copyFileSync(ignoreFile, path.join(repo, '.gitignore'));
      const ignored = (p) =>
        spawnSync('git', ['-c', `core.excludesFile=${empty}`, 'check-ignore', '-q', '--no-index', p], {
          cwd: repo,
          env
        }).status === 0;
      const kept = [
        'work/07-email-triage/rules.md',
        'work/07-email-triage/state/sender-tally.json',
        'work/07-email-triage/state/job-threads.json',
        'system/waiting-on-them.jsonl',
        'vault/projects/email-triage/status.md',
        'vault/me/writing-style-notes.md'
      ];
      const out = ['work/07-email-triage/config/sender-rules.json', 'work/07-email-triage/state/staged-drafts.json'];
      const lost = kept.filter(ignored);
      const leaked = out.filter((p) => !ignored(p));
      assert.ok(
        lost.length === 0 && leaked.length === 0,
        `P8a online, the triage keeps its memory and drops its credentials folder and raw draft text - lost at session end: ${lost.join(', ') || 'none'}; would be committed: ${leaked.join(', ') || 'none'}`
      );
      const cmd = fs.readFileSync(path.join(KIT, '.claude', 'commands', 'email-triage.md'), 'utf8');
      const approval = cmd.split(/\r?\n/).find((l) => /on approval/i.test(l)) || '';
      assert.ok(
        /CLAUDE_CODE_REMOTE/.test(approval) && /rules\.md/.test(approval) && !ignored('work/07-email-triage/rules.md'),
        `P8b NEGATIVE in a cloud session an approved sender rule goes to rules.md, which the online tree keeps, not to config/, which it drops - ${approval.trim().slice(0, 150) || 'no approval line found'}`
      );
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });
});

// P9: every "section N" in INSTALL-ONLINE.md points at the heading it means. Two references in the
// install guide once pointed at the wrong heading after a renumbering ("section 11" for Pro or Max, which
// is 12, and "section 8" for updates, which is 7), and both wrong numbers still named a heading that
// EXISTED. A check that only asks "does heading N exist" passes that page. So each reference is pinned to
// the TITLE it means, found by a phrase right next to it, and the page's own numbering has to agree. A
// reference no row declares fails too: a new one is declared here, never guessed. The NEGATIVE legs
// renumber the headings in memory, the exact way the two defects were made, and add an undeclared
// reference; both must fail.
describe('P9: every "section N" in INSTALL-ONLINE.md points at the heading it means', () => {
  const SECTION_REFS = [
    // [a phrase within 40 characters of the reference, the title of the heading it means]
    ['says when Max is worth it', 'Pro or Max'],
    ['says who else can read them', 'Who can read your notes'],
    ['your repository at all.', 'The rule about who writes in your repository'],
    ['which is what step 4 and', 'Your copies, and the one thing that was lost'],
    ['says what each one does', 'Who can read your notes'],
    ['says what to send instead', 'When something goes wrong'],
    ['accept each one with a yes', 'Getting updates later'],
    ['why support works the way', 'When something goes wrong'],
    ['text you copy out', 'When something goes wrong'],
    ['share link as support', 'Who can read your notes'],
    ['is for); same-day help', 'Your copies, and the one thing that was lost']
  ];
  const sectionRefFailures = (text) => {
    const headings = new Map();
    for (const m of text.matchAll(/^## (\d+)\. (.+)$/gm)) headings.set(Number(m[1]), m[2].trim());
    const flat = text.replace(/\s+/g, ' ');
    const bad = [];
    const used = new Set();
    let refs = 0;
    for (const m of flat.matchAll(/\bsection (\d+)\b/gi)) {
      refs++;
      const n = Number(m[1]);
      const around = flat.slice(Math.max(0, m.index - 40), m.index + m[0].length + 40);
      const where = `"...${flat.slice(Math.max(0, m.index - 25), m.index + m[0].length + 25).trim()}..."`;
      const rows = SECTION_REFS.filter(([near]) => around.includes(near));
      if (rows.length !== 1) {
        bad.push(
          `${where}: ${rows.length ? `${rows.length} rows claim it` : 'no row in P9 declares which heading it means'}`
        );
        continue;
      }
      used.add(rows[0][0]);
      const title = headings.get(n);
      if (title !== rows[0][1])
        bad.push(`${where}: means "${rows[0][1]}", but section ${n} is ${title ? `"${title}"` : 'not a heading'}`);
    }
    for (const [near] of SECTION_REFS)
      if (!used.has(near)) bad.push(`the row "${near}" matched no reference (reworded? move the row with it)`);
    return { bad, refs, headings: headings.size };
  };
  const guide = path.join(KIT, 'INSTALL-ONLINE.md');
  const text = fs.readFileSync(guide, 'utf8');

  test('every reference agrees with the page as it ships, and the scan found them', () => {
    const live = sectionRefFailures(text);
    assert.equal(
      live.bad.length,
      0,
      `P9 every "section N" in INSTALL-ONLINE.md points at the heading it means - ${live.bad.length ? live.bad.join(' | ') : `${live.refs} references, ${live.headings} numbered headings, all agree`}`
    );
    assert.ok(
      live.refs >= SECTION_REFS.length && live.headings >= 10,
      `P9 the scan actually found the references and the headings - ${live.refs} references (floor ${SECTION_REFS.length}), ${live.headings} headings (floor 10)`
    );
  });

  test('NEGATIVE renumbered headings, and an undeclared reference, both fail', () => {
    // A section inserted above section 5 shifts every later number by one: the class that made both
    // defects. Every reference in the page points at 5 or later, so every one must now fail.
    const shifted = text.replace(/^## (\d+)\. /gm, (m, n) => (Number(n) >= 5 ? `## ${Number(n) + 1}. ` : m));
    const neg = sectionRefFailures(shifted);
    assert.ok(
      shifted !== text && neg.bad.length >= 2 && neg.bad.some((b) => b.includes('"Pro or Max"')),
      `P9 NEGATIVE the headings renumbered in memory: the references that now point at the wrong heading fail - ${neg.bad.length} failure(s): ${neg.bad.slice(0, 2).join(' | ')}`
    );
    const undeclared = sectionRefFailures(`${text}\n\nThe steps are in section 3.\n`);
    assert.ok(
      undeclared.bad.some((b) => b.includes('no row in P9 declares')),
      `P9 NEGATIVE a reference no row declares fails, even though section 3 exists - ${undeclared.bad.join(' | ') || 'nothing failed'}`
    );
  });
});

// The seed. A per-person seed is an install directory: starter/ plus the owner docs Install-Alex left
// beside it. INSTALL-<NAME>.md is the USB-and-Terminal laptop guide; the online tree carries
// INSTALL-ONLINE.md, and a seed that shipped both would mislead its owner on the first page.
describe('N9/N10/P5: the seed', () => {
  test('a seed carries starter/** and the two owner docs, never the laptop install guide', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'va-seed-'));
    try {
      fs.mkdirSync(path.join(dir, 'starter'));
      for (const [rel, text] of [
        ['starter/ABOUT-X.md', '# About X\n'],
        ['INSTALL-X.md', '# Installing Alex on a laptop\n'],
        ['HOW-SHARING-WORKS.md', '# Sharing\n'],
        ['WHAT-ALEX-CAN-DO.md', '# Inventory\n']
      ])
        fs.writeFileSync(path.join(dir, rel), text);
      const s = seedFiles(dir);
      const dsts = s.files.map((f) => f.dst).sort();
      assert.ok(
        !dsts.includes('INSTALL-X.md'),
        `N9 a seed source's INSTALL-<NAME>.md never lands in the online tree (it carries INSTALL-ONLINE.md) - ${dsts.join(', ')}`
      );
      assert.equal(
        JSON.stringify(dsts),
        JSON.stringify(['HOW-SHARING-WORKS.md', 'WHAT-ALEX-CAN-DO.md', 'starter/ABOUT-X.md']),
        `P5 a seed carries starter/** and the two owner docs, and nothing else - ${dsts.join(', ')}`
      );
      assert.equal(
        JSON.stringify(s.docs),
        JSON.stringify(['HOW-SHARING-WORKS.md', 'WHAT-ALEX-CAN-DO.md']),
        `P5b the docs list names the two owner docs - ${s.docs.join(', ')}`
      );
      fs.rmSync(path.join(dir, 'starter'), { recursive: true, force: true });
      refused(() => seedFiles(dir), 'no starter/ directory'); // N10 a seed source without starter/ refuses
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
