#!/usr/bin/env node
// @ts-check
// scripts/tests/test-migrations-frozen.mjs - holds migrations 001 and 002 as immutable history.
//
// WHAT. A migration's id lives in every owner's system/migrations-applied.json for ever, and a machine where it
// is still pending receives exactly the bytes the migration writes today. So nothing a shipped migration does
// may change: its file name, its id, its marker, its anchors, the bytes it writes into soul.md, its outcomes
// and the sentences the runner prints for them. This file freezes all of it, byte for byte, against the
// eight documented soul.md shapes and every branch of 002. Deleted, it would let a rewrite change what a
// pending owner's soul.md receives, or rename a migration so that it runs a second time, with nothing in CI
// noticing. A fix to a defect below comes as a new migration or a runner change, never an edit of 001 or 002.
//
// HOW. Each shape is a throwaway root in the OS temp directory; the migrations are required from this checkout
// and run in-process with a recording log. 002's git calls run against fixture repositories (one of them
// SHA-256, for the "unexpected answer" branch), with this machine's git config and redirections removed. A
// test named "PINNED DEFECT <id>" asserts behaviour known to be wrong; its fix flips exactly that test.
//
// NEVER. Reads or writes this checkout's soul.md or install record. Fixes a defect it pins: a soul.md whose
// voice rules end the file can never get the rule (R4-9); an empty install record {} makes 002 skip, recorded
// as done with no version recorded (R4-12); the frozen rule cites writing-style.md sections 1.9 to 1.17 for
// eleven tells, which hold nine (R4-13); a bold line inside the Detection-proofing list splits it (R4-L12); a
// CRLF soul.md comes back with mixed line endings (R4-L13); three tell names anywhere in soul.md, a quote in
// My Words included, read as "already present" (C3-N1). The Kit's /setup text wrapping "importance puffery"
// across a line (C3-N2, harmless while the threshold is three) is test-migrations-frozen-kit.mjs's, split out
// when a generated online tree has no separate Kit copy of setup.md to compare against.
//
// Usage: node scripts/tests/test-migrations-frozen.mjs
// Exit: 0 every test passed - 1 a test failed

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const DIR = path.join(ROOT, 'scripts', 'migrations');
const m001 = require(path.join(DIR, '001-structural-voice-tells.js'));
const m002 = require(path.join(DIR, '002-install-state-seed.js'));
const RECORD_REL = require(path.join(ROOT, 'scripts', 'lib', 'install-state.js')).REL;

// git in this process (002 calls it) must not inherit a redirection or this machine's config.
const CFG = path.join(fs.realpathSync(os.tmpdir()), `c3-mig-gitconfig-${process.pid}`);
fs.writeFileSync(CFG, '[user]\n\tname = T\n\temail = t@example.invalid\n[core]\n\tautocrlf = false\n');
process.on('exit', () => fs.rmSync(CFG, { force: true }));
for (const k of Object.keys(process.env)) if (/^GIT_/.test(k)) delete process.env[k];
Object.assign(process.env, { GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: CFG });
delete process.env.CLAUDE_CODE_REMOTE;

// ------------------------------------------------------------------ the frozen RULE block
const RULE =
  [
    '6. **Kill the structural AI tells, not just the banned words** (added 2026-08-21). Rule 3 catches',
    '   vocabulary. These are SHAPES, and they slip straight past a word filter. Each one is defined with',
    '   an example in `brand/config/writing-style.md` sections 1.9 to 1.17; read that file when one needs',
    '   judging, and use the `no-ai-slop` skill in DETECT mode to scan a draft on demand.',
    '   - **Colon reveals:** a noun phrase, a colon, then a dramatic lowercase reveal ("The best part: it',
    '     learns"). Write the plain sentence. Colons are for lists, labels and quotes.',
    '   - **Faux-insight setups:** "what nobody tells you", "the part everyone misses". Cut the setup, let',
    '     the claim stand alone.',
    '   - **Superficial analysis:** trailing -ing clauses that pretend to explain ("highlighting their',
    '     commitment", "underscoring the shift"). Replace with the actual consequence.',
    '   - **Importance puffery:** "marks a pivotal moment", "stands as a testament". State the fact.',
    '   - **Weasel attribution:** "experts agree", "studies show". Name the source or cut the claim.',
    '   - **Synonym cycling:** rotating agent, assistant, tool for one thing. Repeat the clear word.',
    '   - **Interpretive metadiscourse:** "the key point is", "as you can see", a redundant "in other',
    '     words". If the point is clear, delete the aside.',
    '   - **Fake-strong verbs:** "serves as a centralized hub for". Prefer is and has when clearer.',
    '   - **Summary-recap endings:** "in conclusion", "overall", a last paragraph restating the piece.',
    '   - **Fake-profound kickers:** the closing cute metaphor. Delete it, do not rewrite it better.',
    '   - **Formatting slop:** emoji headings, mid-sentence bold, bullets where prose reads better.',
    '   **Carve-out:** if you have locked a recurring format that deliberately uses one of these (a post',
    '   template, a client letter shape), that format wins inside that format and this rule is ignored',
    '   there. Everywhere else the list applies.',
    ''
  ].join('\n') + '\n';
const RULE_SHA256 = 'c30f54db978ae3cfba9627aa54526f48de1450aee73faee6b21ea0332bc728fd';

/** @type {Record<string, string>} */
const MSG = {
  applied: 'Alex learned eleven new writing rules.',
  skipped: 'the writing rules are already there.',
  noSoul: 'no soul.md yet, so there is nothing to add to. Run /setup first, which writes this rule in from the start.',
  noAnchor: 'could not find the voice rules section in soul.md, so nothing was changed. The file is exactly as it was.'
};

const HEAD =
  '# Soul - Who I Am\n\n## My Role\nA bookbinder in a harbour town.\n\n## Voice Rules (always active)\n- Never sound like a machine.\n- No em-dashes, no filler.\n\n';
const NEVER = '## Things I Never Want\nFlattery I did not earn.\n';
// Eight soul.md shapes and what 001 makes of each.
/** @type {Record<string, { soul: string, status: string, after?: string, message?: string }>} */
const SHAPES = {
  'a-numbered-then-bold': {
    soul: `${HEAD}### Detection-proofing\n1. Keep my real phrasing.\n2. Vary sentence length.\n\n**Register calibration**\nPrivate and public registers differ.\n\n${NEVER}`,
    status: 'applied',
    after: `${HEAD}### Detection-proofing\n1. Keep my real phrasing.\n2. Vary sentence length.\n\n${RULE}**Register calibration**\nPrivate and public registers differ.\n\n${NEVER}`
  },
  'b-kit-setup-short': {
    soul: `${HEAD}### Detection-proofing\n- Keep my real phrasing, dropped articles and all.\n- Vary sentence length hard.\n- Kill the word-level tells: moreover, furthermore, in conclusion, delve, leverage.\n- Present tense, direct statements, vocabulary from My Words.\n- My simple direct register beats correct formal English.\n- Kill the shapes a word list cannot catch: colon reveals, faux-insight setups, superficial -ing\n  analysis, importance puffery, weasel attribution, synonym cycling, interpretive metadiscourse,\n  fake-strong verbs, summary-recap endings, fake-profound kickers, formatting slop. Each one is\n  defined with an example in \`brand/config/writing-style.md\` sections 1.9 to 1.17.\n\n${NEVER}`,
    status: 'skipped'
  },
  'c-online-setup-short': {
    soul: `${HEAD}### Detection-proofing\nPreserve my real phrasing and its imperfections; vary sentence length hard; kill the word-level tells (hedges, stock transitions, delve, leverage, underscore); present tense, direct statements, vocabulary from My Words; my simple direct register beats correct formal English; and the structural tells a word list cannot catch (colon reveals, faux-insight setups, importance puffery, weasel attribution, summary-recap endings, fake-profound kickers, formatting slop). The long form with examples is in \`brand/config/writing-style.md\` sections 1.9 to 1.17.\n\n${NEVER}`,
    status: 'skipped'
  },
  'd-already-applied': {
    soul: `${HEAD}### Detection-proofing\n1. Keep.\n6. **Kill the structural AI tells, not just the banned words** (an older copy).\n\n${NEVER}`,
    status: 'skipped'
  },
  'e-no-anchor': { soul: '# Soul\n\n## My Role\nA translator.\n', status: 'declined', message: MSG.noAnchor },
  'h-vr-then-section': {
    soul: '# Soul\n\n## Voice Rules\n- Plain words.\n\n## Things I Never Want\nFlattery.\n',
    status: 'applied',
    after: `# Soul\n\n## Voice Rules\n- Plain words.\n\n${RULE}## Things I Never Want\nFlattery.\n`
  },
  'k-two-names-only': {
    soul: `${HEAD}### Detection-proofing\n1. No colon reveals, no formatting slop.\n\n${NEVER}`,
    status: 'applied',
    after: `${HEAD}### Detection-proofing\n1. No colon reveals, no formatting slop.\n\n${RULE}${NEVER}`
  },
  'm-empty-file': { soul: '', status: 'declined', message: MSG.noAnchor }
};

/**
 * A throwaway root, removed when the test ends, holding soul.md unless `soul` is null.
 * @param {import('node:test').TestContext} t
 * @param {string | null} soul
 * @returns {string}
 */
function root(t, soul) {
  const d = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'c3-mig-')));
  t.after(() => fs.rmSync(d, { recursive: true, force: true }));
  if (soul !== null) fs.writeFileSync(path.join(d, 'soul.md'), soul);
  return d;
}
/**
 * Run 001 in a fresh root over `soul`, and report what it returned, logged, left and backed up.
 * @param {import('node:test').TestContext} t
 * @param {string | null} soul
 */
function run001(t, soul) {
  const d = root(t, soul);
  /** @type {string[]} */
  const logs = [];
  const res = m001.run({ root: d, log: (/** @type {string} */ m) => logs.push(m) });
  const after = soul === null ? null : fs.readFileSync(path.join(d, 'soul.md'), 'utf8');
  const backups = fs.readdirSync(d).filter((f) => f.startsWith('soul.md.bak-'));
  return { d, res, logs, after, backups };
}

// ------------------------------------------------------------------ the ids and the file names
test('the two shipped migrations keep their file names, and every migration file is NNN-name.js', () => {
  const files = fs.readdirSync(DIR);
  assert.ok(files.includes('001-structural-voice-tells.js'));
  assert.ok(files.includes('002-install-state-seed.js'));
  assert.deepEqual(
    files.filter((f) => /^00[12]-/.test(f)).sort(),
    ['001-structural-voice-tells.js', '002-install-state-seed.js'],
    'no second 001 or 002'
  );
  for (const f of files) assert.match(f, /^\d{3}-.*\.js$/, `${f} is a migration file name the runner reads`);
});

test('each migration exports the id its file name gives the ledger, and a synchronous run({root, log})', () => {
  assert.deepEqual(Object.keys(m001).sort(), ['TELL_NAMES', 'id', 'run']);
  assert.deepEqual(Object.keys(m002).sort(), ['id', 'run']);
  assert.equal(m001.id, '001-structural-voice-tells');
  assert.equal(m002.id, '002-install-state-seed');
  assert.equal(m001.run.constructor.name, 'Function', 'not async');
  assert.equal(m002.run.constructor.name, 'Function', 'not async');
});

test('001 TELL_NAMES: the eleven patterns, exactly', () => {
  assert.deepEqual(m001.TELL_NAMES.map(String), [
    '/colon reveal/i',
    '/faux[-\\s]?insight/i',
    '/superficial[\\s`*_-]+(?:-?ing[\\s`*_-]+)?analysis/i',
    '/importance puffery/i',
    '/weasel attribution/i',
    '/synonym cycling/i',
    '/interpretive metadiscourse/i',
    '/fake[-\\s]?strong verb/i',
    '/summary[-\\s]?recap/i',
    '/fake[-\\s]?profound/i',
    '/formatting slop/i'
  ]);
});

test('the frozen RULE copy is 1944 bytes and its sha256 is pinned (c30f54db...)', () => {
  assert.equal(RULE.length, 1944);
  assert.equal((RULE.match(/\n/g) || []).length, 23);
  assert.equal(crypto.createHash('sha256').update(RULE).digest('hex'), RULE_SHA256);
});

// ------------------------------------------------------------------ 001 over every shape
for (const [name, s] of Object.entries(SHAPES)) {
  test(`001 on shape ${name}: ${s.status}, and soul.md is ${s.after ? 'the frozen bytes' : 'byte-identical'}`, (t) => {
    const r = run001(t, s.soul);
    assert.equal(r.res.status, s.status);
    assert.equal(r.res.message, s.message || MSG[s.status]);
    assert.deepEqual(Object.keys(r.res), ['status', 'message']);
    if (s.after) {
      assert.equal(r.after, s.after, 'the RULE inserted at the frozen anchor, byte for byte');
      assert.equal(r.backups.length, 1);
      assert.match(r.backups[0], /^soul\.md\.bak-\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}$/);
      assert.equal(fs.readFileSync(path.join(r.d, r.backups[0]), 'utf8'), s.soul, 'the backup is the original');
      assert.equal(r.logs[0], `backup written: ${r.backups[0]}`);
      assert.match(r.logs[1], /^soul card not rebuilt \(.+\); it refreshes on the next generator run$/s);
      assert.equal(r.logs.length, 2);
    } else {
      assert.equal(r.after, s.soul);
      assert.deepEqual(r.backups, []);
      assert.deepEqual(r.logs, []);
    }
  });
}

test('001 with no soul.md: declined, and nothing is created', (t) => {
  const r = run001(t, null);
  assert.deepEqual(r.res, { status: 'declined', message: MSG.noSoul });
  assert.deepEqual(fs.readdirSync(r.d), []);
});

test('001 rebuilds the soul card through <root>/scripts/lib/build-soul-core.js build({log}), and logs it', (t) => {
  const d = root(t, SHAPES['h-vr-then-section'].soul);
  fs.mkdirSync(path.join(d, 'scripts', 'lib'), { recursive: true });
  fs.writeFileSync(
    path.join(d, 'scripts', 'lib', 'build-soul-core.js'),
    "module.exports = { build: (opts) => { require('fs').writeFileSync(require('path').join(__dirname, 'called.json'), JSON.stringify(Object.keys(opts))); } };\n"
  );
  /** @type {string[]} */
  const logs = [];
  assert.equal(m001.run({ root: d, log: (/** @type {string} */ m) => logs.push(m) }).status, 'applied');
  assert.equal(logs[1], 'soul card rebuilt');
  assert.equal(fs.readFileSync(path.join(d, 'scripts', 'lib', 'called.json'), 'utf8'), '["log"]');
});

test('001 a second run over its own output is a skip, byte-identical', (t) => {
  const r = run001(t, SHAPES['h-vr-then-section'].soul);
  const again = m001.run({ root: r.d, log: () => {} });
  assert.deepEqual(again, { status: 'skipped', message: MSG.skipped });
  assert.equal(fs.readFileSync(path.join(r.d, 'soul.md'), 'utf8'), SHAPES['h-vr-then-section'].after);
});

test('PINNED DEFECT R4-9: a Detection-proofing list that ends the file is declined (no following block to anchor on)', (t) => {
  const soul = `${HEAD}### Detection-proofing\n1. Keep my real phrasing.\n2. Vary sentence length.\n`;
  const r = run001(t, soul);
  assert.deepEqual(r.res, { status: 'declined', message: MSG.noAnchor });
  assert.equal(r.after, soul);
});

test('PINNED DEFECT R4-9: a Voice Rules section that ends the file is declined too', (t) => {
  const soul = '# Soul\n\n## My Role\nA translator.\n\n## Voice Rules\n- Plain words.\n- Short lines.\n';
  const r = run001(t, soul);
  assert.deepEqual(r.res, { status: 'declined', message: MSG.noAnchor });
  assert.equal(r.after, soul);
});

test('PINNED DEFECT R4-L13: a CRLF soul.md gets the LF block, so it comes back with mixed line endings', (t) => {
  const crlf = SHAPES['a-numbered-then-bold'].soul.replace(/\n/g, '\r\n');
  const r = run001(t, crlf);
  assert.equal(r.res.status, 'applied');
  const i = crlf.indexOf('**Register calibration**');
  assert.equal(r.after, crlf.slice(0, i) + RULE + crlf.slice(i));
  assert.ok(/\r\n/.test(r.after) && /[^\r]\n/.test(r.after), 'both endings');
});

test('PINNED DEFECT R4-L12: a bold line inside the list splits it: the block lands after item 1', (t) => {
  const soul = `${HEAD}### Detection-proofing\n1. Keep.\n**Note:** my own aside inside the list\n2. Vary.\n\n${NEVER}`;
  const r = run001(t, soul);
  assert.equal(r.res.status, 'applied');
  assert.equal(
    r.after,
    `${HEAD}### Detection-proofing\n1. Keep.\n${RULE}**Note:** my own aside inside the list\n2. Vary.\n\n${NEVER}`
  );
});

test('PINNED DEFECT C3-N1: three tell names anywhere in soul.md (a quote in My Words) read as the rule, so it is never written', (t) => {
  const soul = `${HEAD}### Detection-proofing\n1. Keep.\n\n${NEVER}\n## My Words\n"I hate a colon reveal, weasel attribution and importance puffery."\n`;
  const r = run001(t, soul);
  assert.deepEqual(r.res, { status: 'skipped', message: MSG.skipped });
  assert.equal(r.after, soul);
  assert.ok(!r.after.includes('Kill the structural AI tells'));
});

test('PINNED DEFECT R4-13: the frozen rule points at writing-style.md sections 1.9 to 1.17 for eleven tells; those sections hold nine', {
  skip:
    !fs.existsSync(path.join(ROOT, 'brand', 'config', 'writing-style.md')) &&
    'no brand/config/writing-style.md in this tree'
}, () => {
  assert.ok(RULE.includes('`brand/config/writing-style.md` sections 1.9 to 1.17'));
  const style = fs.readFileSync(path.join(ROOT, 'brand', 'config', 'writing-style.md'), 'utf8');
  const heads = [...style.matchAll(/^### 1\.(\d+) /gm)].map((x) => Number(x[1])).filter((n) => n >= 9 && n <= 17);
  assert.deepEqual(heads, [9, 10, 11, 12, 13, 14, 15, 16, 17], 'nine sections');
  assert.equal(/fake[-\s]?strong/i.test(style), false, '"fake-strong verbs" is defined nowhere in the file');
});

/**
 * The Detection-proofing passage of a /setup text, 2500 bytes from its heading.
 * @param {string} file
 */
function setupPassage(file) {
  const text = fs.readFileSync(file, 'utf8');
  const i = text.indexOf('### Detection-proofing');
  return text.slice(i, i + 2500);
}
/** @param {string} text */
const tellCount = (text) => m001.TELL_NAMES.filter((/** @type {RegExp} */ re) => re.test(text)).length;

test('the online /setup text names enough tells (three or more) for 001 to read a /setup-made soul.md as done: seven', () => {
  const online = path.join(
    ROOT,
    ...(fs.existsSync(path.join(ROOT, 'variants', 'online')) ? ['variants', 'online'] : []),
    '.claude',
    'commands',
    'setup.md'
  );
  assert.equal(tellCount(setupPassage(online)), 7);
});

// ------------------------------------------------------------------ 002
/**
 * A fixture git repository for 002: with or without a commit, in another object format, with a record.
 * @param {import('node:test').TestContext} t
 * @param {{ commit?: boolean, objectFormat?: string | null, record?: string | null }} [options]
 */
function repo(t, { commit = true, objectFormat = null, record = null } = {}) {
  const d = root(t, null);
  /** @param {...string} args */
  const g = (...args) => spawnSync('git', args, { cwd: d, encoding: 'utf8' });
  g('init', '-q', ...(objectFormat ? [`--object-format=${objectFormat}`] : []));
  if (commit) g('commit', '-q', '--allow-empty', '-m', 'a laptop checkout');
  // A planted fixture record, named through the library's own constant (test-install-state.mjs I7 scans every
  // tracked file for a line that writes the record by its literal name).
  if (record !== null) {
    fs.mkdirSync(path.join(d, 'system'));
    fs.writeFileSync(path.join(d, RECORD_REL), record);
  }
  return { d, head: commit ? g('rev-parse', 'HEAD').stdout.trim() : null };
}
/**
 * Run 002 in-process over `d`, online when `remote`, and restore the environment after.
 * @param {string} d
 * @param {boolean} [remote]
 */
const run002 = (d, remote = false) => {
  /** @type {string[]} */
  const logs = [];
  if (remote) process.env.CLAUDE_CODE_REMOTE = 'true';
  try {
    return { res: m002.run({ root: d, log: (/** @type {string} */ m) => logs.push(m) }), logs };
  } finally {
    delete process.env.CLAUDE_CODE_REMOTE;
  }
};

test('002 online: declined with the frozen sentence, and nothing written', (t) => {
  const { d } = repo(t);
  const r = run002(d, true);
  assert.deepEqual(r.res, {
    status: 'declined',
    message:
      "this is a cloud session, where the repository HEAD is the owner's own commit and not a template version; /update writes the real one."
  });
  assert.deepEqual(r.logs, []);
  assert.ok(!fs.existsSync(path.join(d, 'system')));
});

test('002 on a laptop with no record: applied, the log line, and a record stamped by 002 at HEAD', (t) => {
  const { d, head } = repo(t);
  const r = run002(d);
  assert.deepEqual(r.res, {
    status: 'applied',
    message: 'Alex can now answer "am I up to date?" without reading git.'
  });
  assert.deepEqual(r.logs, [`version record seeded at ${/** @type {string} */ (head).slice(0, 12)}`]);
  const rec = JSON.parse(fs.readFileSync(path.join(d, 'system', 'install-state.json'), 'utf8'));
  assert.deepEqual(
    [rec.stamped_by, rec.template_commit, rec.previous_template_commit, rec._schema],
    ['002-install-state-seed', head, null, 'install-state@1']
  );
  assert.match(rec.template_updated_at, /^\d{4}-\d{2}-\d{2}$/);
});

test('002 with a record already there: skipped with the frozen sentence, the record untouched', (t) => {
  const text = '{"template_commit":"abcdef1234567abcdef1234567abcdef12345678"}\n';
  const { d } = repo(t, { record: text });
  assert.deepEqual(run002(d).res, { status: 'skipped', message: 'version record already exists; nothing to seed.' });
  assert.equal(fs.readFileSync(path.join(d, 'system', 'install-state.json'), 'utf8'), text);
});

test('PINNED DEFECT R4-12: an EMPTY record {} counts as a record, so 002 skips and no version is ever recorded', (t) => {
  const { d } = repo(t, { record: '{}' });
  assert.deepEqual(run002(d).res, { status: 'skipped', message: 'version record already exists; nothing to seed.' });
  assert.equal(fs.readFileSync(path.join(d, 'system', 'install-state.json'), 'utf8'), '{}');
});

test('002 where git has no HEAD: declined "could not read the current version from git (...)", nothing written', (t) => {
  const { d } = repo(t, { commit: false });
  const r = run002(d);
  assert.equal(r.res.status, 'declined');
  assert.match(r.res.message, /^could not read the current version from git \(.+\); will retry next update\.$/s);
  assert.ok(!fs.existsSync(path.join(d, 'system')));
});

test('002 where git answers with something that is not 40 hex (a SHA-256 repository): declined "unexpected answer"', (t) => {
  const { d, head } = repo(t, { objectFormat: 'sha256' });
  if (!/^[0-9a-f]{64}$/.test(head || '')) {
    t.skip(`this git cannot make a SHA-256 repository (${head})`);
    return;
  }
  assert.deepEqual(run002(d).res, {
    status: 'declined',
    message: 'git gave an unexpected answer; will retry next update.'
  });
  assert.ok(!fs.existsSync(path.join(d, 'system')));
});
