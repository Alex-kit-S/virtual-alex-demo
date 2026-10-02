#!/usr/bin/env node
// scripts/tests/test-employer-data-guard.mjs - the employer-data guard, its allowlist CLI and the
// Virtual Alex commit gate (variants/online/scripts/hooks/pre-commit) end to end.
//
// WHAT. Proves scripts/employer-data-guard.mjs and the online commit gate it sits in, every refusal
// shown before the pass, inside a throwaway repository under the OS temp folder that carries the REAL
// guard, the REAL secret scanner, the REAL scripts/lib/*.js and the REAL online hook; the hook's only
// other node leg, validate-alex, is a stub that exits 0 (clone-scrub-check.js is written as a stub too,
// though the online hook never calls it, which P4 below proves). Deleted, it would let employer
// data reach a commit with nothing catching it, and let the hook's wiring around the guard drift
// unnoticed. The employer domain is a reserved example domain and every address here is invented; no
// value is printed by the guard, and this file proves that too.
//
// HOW. Fake personal-identity-number shapes are ASSEMBLED AT RUNTIME: written literally, they would
// make this very file trip the guard's own personnummer leg in an owner's commit gate, so a template
// build touching it would refuse its own /update. T0 below keeps every tracked file honest about that.
// The fixture (one throwaway repository) is built ONCE, synchronously, at module load, and every
// section below runs its git/guard calls in the order they are written, against that same shared
// repository; the describe() blocks below (one per section) run their bodies immediately to register
// their tests, so the interleaving of writes, commits and resets is unchanged from a plain script.
//
// NEVER. Writes outside its own temp folder; the folder is kept only when run with --keep.
//
// Usage: node scripts/tests/test-employer-data-guard.mjs [--keep]
// Exit: 0 every assertion held - 1 one failed

import { test, describe, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const KIT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const KEEP = process.argv.includes('--keep');
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'alex-employer-guard-'));
const REPO = path.join(TMP, 'repo');
const DOMAIN = 'acme.example';
const OWNER = 'Robin.Owner@acme.example';
const COLLEAGUE = 'firstname.lastname@acme.example';
const MAX = 10485760;
const PN12 = ['19850101', '1234'].join('-');
const PN10 = ['850101', '1234'].join('-');
const PN_XSD = ['123456', '7890'].join('-');

after(() => {
  if (!KEEP) fs.rmSync(TMP, { recursive: true, force: true });
});

// Inherited GIT_* vars and the machine's own global or system git config (a signing key, autocrlf, a
// hook path) must never reach a test's git calls: standard section 6. GIT_CONFIG_GLOBAL names an empty
// file in TMP, not /dev/null, because git treats a path it cannot open as an error, not as "no file".
const GITCFG = path.join(TMP, 'gitconfig');
fs.writeFileSync(GITCFG, '');
function gitEnv() {
  const env = {};
  for (const [k, v] of Object.entries(process.env)) if (!/^GIT_/.test(k)) env[k] = v;
  return { ...env, GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: GITCFG, GIT_CEILING_DIRECTORIES: TMP };
}

/** @param {boolean} cond @param {string} name @param {string} [detail] */
function ok(cond, name, detail) {
  test(`${name}${detail ? ` - ${detail}` : ''}`, () => {
    assert.ok(cond);
  });
}
function show(label, text) {
  const t = String(text || '').trim();
  if (t) console.log(`      ${label}: ${t.split(/\r?\n/).join('\n      ')}`);
}
const guard = (args, cwd = REPO) =>
  spawnSync(process.execPath, [path.join(REPO, 'scripts', 'employer-data-guard.mjs'), ...args], {
    cwd,
    env: gitEnv(),
    encoding: 'utf8'
  });
const git = (args, cwd = REPO) => spawnSync('git', args, { cwd, env: gitEnv(), encoding: 'utf8' });
const gitOut = (args) => git(args).stdout.trim();
function write(rel, content) {
  const p = path.join(REPO, rel);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, content);
}
function profile(domain, owner) {
  write(
    'system/install-profile.json',
    JSON.stringify(
      { _what: 'test profile', employer_domain: domain, owner_work_address: owner, wake: [], park: [], locale: 'en' },
      null,
      2
    ) + '\n'
  );
}
const allowlistPath = path.join(REPO, 'system', 'employer-data-allowlist.json');

describe('the fixture', () => {
  fs.mkdirSync(path.join(REPO, 'scripts', 'lib'), { recursive: true });
  fs.mkdirSync(path.join(REPO, 'scripts', 'hooks'), { recursive: true });
  git(['init', '-q', '-b', 'main', REPO], TMP);
  git(['config', 'core.autocrlf', 'false']);
  git(['config', 'user.name', 'Alex Kit']);
  git(['config', 'user.email', 'alex-kit@localhost']);
  git(['config', 'core.hooksPath', 'scripts/hooks']);
  for (const f of ['employer-data-guard.mjs', 'secret-scan.mjs'])
    fs.copyFileSync(path.join(KIT, 'scripts', f), path.join(REPO, 'scripts', f));
  for (const f of fs.readdirSync(path.join(KIT, 'scripts', 'lib')).filter((n) => n.endsWith('.js')))
    fs.copyFileSync(path.join(KIT, 'scripts', 'lib', f), path.join(REPO, 'scripts', 'lib', f));
  // The online hook lives under variants/online/ in the Kit and AT scripts/hooks/pre-commit on the
  // online tree (the generator lands it there and drops variants/), and this suite runs on both.
  const variantHook = path.join(KIT, 'variants', 'online', 'scripts', 'hooks', 'pre-commit');
  const hookSrc = fs.existsSync(variantHook) ? variantHook : path.join(KIT, 'scripts', 'hooks', 'pre-commit');
  if (!/VIRTUAL ALEX VARIANT/.test(fs.readFileSync(hookSrc, 'utf8').split(/\r?\n/)[1] || ''))
    throw new Error(`${hookSrc} is not the Virtual Alex hook (line 2 does not say so)`);
  fs.copyFileSync(hookSrc, path.join(REPO, 'scripts', 'hooks', 'pre-commit'));
  fs.chmodSync(path.join(REPO, 'scripts', 'hooks', 'pre-commit'), 0o755);
  console.log(`online hook under test: ${path.relative(KIT, hookSrc).replace(/\\/g, '/')}`);
  for (const stub of ['clone-scrub-check.js', 'validate-alex.js'])
    write(`scripts/${stub}`, '// stub: this leg is not under test here\nprocess.exit(0);\n');
  profile(DOMAIN, OWNER);
  write('vault/log.md', '# Log\n');
  git(['add', '-A']);
  const seed = git(['commit', '-qm', 'seed']);
  show('seed commit hook output', `${seed.stdout}${seed.stderr}`);
  ok(seed.status === 0, 'P0 the seed commit passes the real online hook', `exit ${seed.status}`);
  console.log(`fixture: ${REPO}`);
});

// ---------------------------------------------------------------- T0: the tree cannot block its own update
// An owner's /update applies template files through the owner's commit gate, so if this file (or any
// other tracked file) carried a literal personnummer-shaped fixture, the gate would refuse the update.
// No TRACKED file of this tree (the Kit, or the online tree when run there), vendored skills aside,
// may carry a line the guard's personnummer leg matches. The regex is read from the guard itself.
describe('T0: the tree cannot block its own update', () => {
  const src = fs.readFileSync(path.join(KIT, 'scripts', 'employer-data-guard.mjs'), 'utf8');
  const m = /const PERSONNUMMER = \/(.+)\/;/.exec(src);
  ok(!!m, 'T0 the personnummer regex is readable from the guard');
  const re = m ? new RegExp(m[1]) : null;
  const tracked = spawnSync('git', ['ls-files', '-z'], { cwd: KIT, encoding: 'utf8' })
    .stdout.split('\0')
    .filter(Boolean)
    .filter((f) => !f.startsWith('.agents/skills/') && !f.startsWith('.claude/skills/'));
  const hits = [];
  for (const f of tracked) {
    let text;
    try {
      text = fs.readFileSync(path.join(KIT, f), 'utf8');
    } catch {
      continue;
    }
    if (text.includes('\0')) continue; // binary
    text.split(/\r?\n/).forEach((line, i) => {
      if (re?.test(line)) hits.push(`${f}:${i + 1}`);
    });
  }
  ok(
    re && tracked.length > 50 && hits.length === 0,
    'T0 NEGATIVE-GUARD no tracked file carries a personnummer shape, so no template build can refuse its own /update',
    hits.length ? hits.slice(0, 5).join(', ') : `${tracked.length} files scanned`
  );
});

// ---------------------------------------------------------------- N1: a colleague's address
describe("N1: a colleague's address", () => {
  write('vault/people/colleague.md', `# A colleague\n\nmail: ${COLLEAGUE}\n`);
  const r = guard(['--file', 'vault/people/colleague.md']);
  show('stdout', r.stdout);
  show('stderr', r.stderr);
  ok(r.status === 2, 'N1 NEGATIVE firstname.lastname@<employer-domain> blocks (--file)', `exit ${r.status}`);
  ok(
    /^employer-data-guard: vault\/people\/colleague\.md:3 employer-address$/m.test(r.stdout),
    'N1 the hit names file, line and leg'
  );
  ok(!`${r.stdout}${r.stderr}`.toLowerCase().includes('firstname'), 'N1 the address is never printed');
  write('vault/people/sub.md', `mail: someone@mail.${DOMAIN}\n`);
  ok(
    guard(['--file', 'vault/people/sub.md']).status === 2,
    'N1 NEGATIVE an address at a subdomain of the employer blocks'
  );
  write('vault/people/other.md', `mail: someone@${DOMAIN}.evil.example\n`);
  ok(
    guard(['--file', 'vault/people/other.md']).status === 0,
    'N1 an address at a longer domain that merely starts with the employer domain passes'
  );
  write('vault/people/period.md', `Write to ${COLLEAGUE}.\n`);
  ok(
    guard(['--file', 'vault/people/period.md']).status === 2,
    'N1 NEGATIVE the same colleague address followed by a sentence period still blocks'
  );
  write('.agents/skills/some-skill/schema.xsd', `<xsd:pattern value="${PN_XSD}"/> contact ${COLLEAGUE}\n`);
  ok(
    guard(['--file', '.agents/skills/some-skill/schema.xsd']).status === 0,
    'N1 a vendored skill file is skipped by the content legs'
  );
  write('.agents/skills/some-skill/data.xlsx', 'x');
  ok(
    guard(['--file', '.agents/skills/some-skill/data.xlsx']).status === 0,
    'N1 a spreadsheet under a vendored skill is not under vault/ or inbox/, passes'
  );
});

// ---------------------------------------------------------------- N2: a personnummer
describe('N2: a personnummer', () => {
  write('vault/me/hr.md', `# HR\n\nid ${PN12}\n`);
  const r = guard(['--file', 'vault/me/hr.md']);
  show('stdout', r.stdout);
  ok(
    r.status === 2 && /hr\.md:3 personnummer/.test(r.stdout),
    'N2 NEGATIVE the twelve-digit shape blocks',
    `exit ${r.status}`
  );
  ok(!`${r.stdout}${r.stderr}`.includes('1985'), 'N2 the number is never printed');
  write('vault/me/hr2.md', `id ${PN10}\n`);
  ok(guard(['--file', 'vault/me/hr2.md']).status === 2, 'N2 NEGATIVE the ten-digit shape blocks too');
  write('vault/me/dates.md', 'from 2026-09-23 to 2026-10-05, run 20260922T220705Z, phone 070-123 45 67\n');
  ok(guard(['--file', 'vault/me/dates.md']).status === 0, 'N2 dates, a run stamp and a phone number pass');
});

// ---------------------------------------------------------------- N2b: a personnummer with no dash
// Payroll and HR exports store the number with no separator, twelve digits or ten, and a person
// over 100 carries a + where the dash goes. With no separator a digit run is a hit only when its date
// is plausible and its check digit holds, so an ordinary long number, a phone number written without
// spaces and a date-shaped number with a wrong check digit pass. The fixtures are the public test
// person's number (twelve twelves, a valid check digit) and a coordination number (the day plus 60),
// assembled so no source line carries the shape.
describe('N2b: a personnummer with no dash', () => {
  const PN12N = ['1912', '1212', '1212'].join('');
  const PN10N = ['1212', '1212', '12'].join('');
  const PNPLUS = ['121212', '1212'].join('+');
  const SAMN = ['121272', '1219'].join('');
  const WRONG_CHECK = ['1912', '1212', '1213'].join('');
  const PHONE = ['070', '1234567'].join('');
  write('vault/me/export.md', `# Payroll\n\nid ${PN12N}\n`);
  const r = guard(['--file', 'vault/me/export.md']);
  show('stdout', r.stdout);
  ok(
    r.status === 2 && /^employer-data-guard: vault\/me\/export\.md:3 personnummer$/m.test(r.stdout),
    'N2b NEGATIVE the twelve-digit shape with no dash blocks',
    `exit ${r.status}`
  );
  ok(!`${r.stdout}${r.stderr}`.includes(PN12N.slice(0, 8)), 'N2b the number is never printed');
  write('vault/me/export2.md', `name;${PN12N};dept\n`);
  ok(
    guard(['--file', 'vault/me/export2.md']).status === 2,
    'N2b NEGATIVE a payroll row carrying the twelve digits blocks'
  );
  write('vault/me/export3.md', `id ${PN10N}\n`);
  ok(guard(['--file', 'vault/me/export3.md']).status === 2, 'N2b NEGATIVE the ten-digit shape with no dash blocks');
  write('vault/me/export4.md', `id ${PNPLUS}\n`);
  ok(guard(['--file', 'vault/me/export4.md']).status === 2, 'N2b NEGATIVE the + separator (a person over 100) blocks');
  write('vault/me/export5.md', `id ${SAMN}\n`);
  ok(guard(['--file', 'vault/me/export5.md']).status === 2, 'N2b NEGATIVE a coordination number with no dash blocks');
  write('vault/me/numbers.md', `order 1234567890, invoice 123456789012, ref ${WRONG_CHECK}, phone ${PHONE}\n`);
  const p = guard(['--file', 'vault/me/numbers.md']);
  show('stdout', p.stdout);
  ok(
    p.status === 0,
    'N2b an order number, a twelve-digit invoice, a wrong check digit and an unspaced phone number pass',
    `exit ${p.status}`
  );
});

// ---------------------------------------------------------------- N2c: a staged path literally named
// "0:<name>", the same hole as secret-scan.mjs's N2b (test-secret-scan.mjs):
// `git show :<path>` reads `:0:name` as "stage 0 of name", not "stage 0 of the path literally named
// 0:name", so a staged 0:name holding a personnummer beside a clean name would be read as name's clean
// content. The guard reads `git show :0:<path>` instead. This only bites when the "0:" is the FIRST thing
// git's revision parser sees after the leading colon - a REPO-ROOT path, not one nested under a
// directory (there, "vault/me/0:x" does not start with a stage-number-looking prefix and reads
// correctly either way, which is not a proof of the fix). Windows git refuses a colon in a path even
// through --cacheinfo (no working-tree file is ever created), so this is built with a harmless probe
// first and skipped, one line, not counted as a failure, when it is refused - exactly as it would be on
// any Windows checkout.
describe('N2c: a staged path literally named "0:<name>"', () => {
  write('n2c-clean.md', '# N2c\n\nnothing here.\n');
  const blob = spawnSync('git', ['hash-object', '-w', '--stdin'], {
    cwd: REPO,
    input: `# Notes\n\nid ${PN12}\n`,
    encoding: 'utf8'
  }).stdout.trim();
  const probe = git([
    '-c',
    'core.protectNTFS=false',
    'update-index',
    '--add',
    '--cacheinfo',
    `100644,${blob},0:n2c-clean.md`
  ]);
  if (probe.status !== 0) {
    console.log(
      'SKIP  N2c a staged path literally named "0:<name>" (Windows git refuses the colon in a path, even through --cacheinfo; the case runs on macOS and Linux only)'
    );
  } else {
    git(['add', 'n2c-clean.md']);
    const r = guard(['--staged']);
    show('stdout (N2c)', r.stdout);
    show('stderr (N2c)', r.stderr);
    ok(
      r.status === 2,
      'N2c NEGATIVE the staged 0:n2c-clean.md (holding a real personnummer) is caught, not read as the clean file',
      `exit ${r.status}`
    );
    ok(
      /^employer-data-guard: 0:n2c-clean\.md:3 personnummer$/m.test(r.stdout),
      'N2c the hit is attributed to the path literally named 0:n2c-clean.md',
      r.stdout
    );
    ok(
      !/^employer-data-guard: n2c-clean\.md:/m.test(r.stdout),
      'N2c NEGATIVE the clean file itself reports no hit',
      r.stdout
    );
    git(['reset', '-q']);
  }
  fs.rmSync(path.join(REPO, 'n2c-clean.md'), { force: true });
});

// ---------------------------------------------------------------- N3: spreadsheet exports
describe('N3: spreadsheet exports', () => {
  write('vault/x.xlsx', 'not really a workbook\n');
  const r = guard(['--file', 'vault/x.xlsx']);
  show('stdout', r.stdout);
  ok(
    r.status === 2 && /^employer-data-guard: vault\/x\.xlsx spreadsheet-export \(path\)$/m.test(r.stdout),
    'N3 NEGATIVE vault/x.xlsx blocks (path leg)',
    `exit ${r.status}`
  );
  write('inbox/list.csv', 'a,b\n');
  ok(guard(['--file', 'inbox/list.csv']).status === 2, 'N3 NEGATIVE inbox/list.csv blocks');
  write('vault/model.pbix', 'x');
  ok(guard(['--file', 'vault/model.pbix']).status === 2, 'N3 NEGATIVE vault/model.pbix blocks');
  write('outputs/report.xlsx', 'x');
  ok(
    guard(['--file', 'outputs/report.xlsx']).status === 0,
    'N3 outputs/report.xlsx passes (not under vault/ or inbox/)'
  );
  write('vault/report.md', '# a markdown page\n');
  ok(guard(['--file', 'vault/report.md']).status === 0, 'N3 a markdown page under vault/ passes');
});

// ---------------------------------------------------------------- P1: the owner's own address
describe("P1: the owner's own address", () => {
  write('vault/me/contact.md', `work: ${OWNER.toUpperCase()} and ${OWNER.toLowerCase()}\n`);
  const r = guard(['--file', 'vault/me/contact.md']);
  show('stdout', r.stdout);
  ok(r.status === 0, "P1 the owner's own work address passes, in any case", `exit ${r.status}`);
});

// ---------------------------------------------------------------- N4 + P2: the allowlist CLI
describe('N4 + P2: the allowlist CLI', () => {
  const r = guard(['--allow-address', COLLEAGUE]);
  show('stderr', r.stderr);
  ok(
    r.status === 1 && /reason is required/.test(r.stderr),
    'N4 NEGATIVE --allow-address with no --reason is refused',
    `exit ${r.status}`
  );
  ok(!fs.existsSync(allowlistPath), 'N4 nothing was written');
  const a = guard([
    '--allow-address',
    COLLEAGUE,
    '--reason',
    'the owner asked for this contact to be kept: a former manager, now a reference'
  ]);
  show('stdout', a.stdout);
  show('stderr', a.stderr);
  ok(a.status === 0, 'P2 --allow-address with a reason writes the allowlist', `exit ${a.status}`);
  const j = JSON.parse(fs.readFileSync(allowlistPath, 'utf8'));
  ok(
    j._schema === 'employer-data-allowlist@1' && j._writer === 'scripts/employer-data-guard.mjs',
    'P2 the file carries the writer header and schema',
    `${j._schema} by ${j._writer}`
  );
  ok(
    Array.isArray(j.addresses) &&
      j.addresses.length === 1 &&
      j.addresses[0].address === COLLEAGUE.toLowerCase() &&
      /reference/.test(j.addresses[0].reason),
    'P2 the row carries the address and its reason'
  );
  ok(guard(['--file', 'vault/people/colleague.md']).status === 0, 'P2 the allowlisted address now passes');
  ok(
    guard(['--file', 'vault/people/sub.md']).status === 2,
    'P2 NEGATIVE a different address at the domain still blocks'
  );
  const p = guard(['--allow-path', 'vault/x.xlsx', '--reason', 'a workbook the owner built at home, not an export']);
  ok(p.status === 0 && guard(['--file', 'vault/x.xlsx']).status === 0, 'P2 an allowlisted path passes');
  ok(guard(['--file', 'inbox/list.csv']).status === 2, 'P2 NEGATIVE a different export still blocks');
  ok(
    guard(['--file', 'vault/me/hr.md']).status === 2,
    'P2 NEGATIVE the personnummer leg has no allowlist and still blocks'
  );
  const raw = fs.readFileSync(allowlistPath);
  ok(
    raw[0] !== 0xef && !raw.includes('\r') && raw[raw.length - 1] === 0x0a,
    'P2 the file is UTF-8 without BOM, LF, one trailing newline (docs/json-standard.md rule 1)'
  );
});

// ---------------------------------------------------------------- N5: a broken allowlist fails closed
describe('N5: a broken allowlist fails closed', () => {
  const good = fs.readFileSync(allowlistPath, 'utf8');
  fs.writeFileSync(allowlistPath, good.replace('employer-data-allowlist@1', 'something-else@9'));
  const r = guard(['--file', 'vault/report.md']);
  show('stderr', r.stderr);
  ok(
    r.status === 1 && /schema check FAILED/.test(r.stderr),
    'N5 NEGATIVE an allowlist under a foreign schema makes the guard exit 1 even on a clean file',
    `exit ${r.status}`
  );
  fs.writeFileSync(allowlistPath, good.replace(/"reason": "the owner asked[^"]*"/, '"reason": ""'));
  const e = guard(['--file', 'vault/report.md']);
  show('stderr', e.stderr);
  ok(
    e.status === 1 && /no reason/.test(e.stderr),
    'N5 NEGATIVE a row whose reason is empty makes the guard exit 1',
    `exit ${e.status}`
  );
  fs.writeFileSync(allowlistPath, good);
  ok(guard(['--file', 'vault/report.md']).status === 0, 'N5 the restored allowlist reads again');
});

// ---------------------------------------------------------------- P3: empty profile fields
// Only leg 1 needs the profile. With both fields empty the employer address passes (there is no
// employer to match), the guard says leg 1 is disarmed, and a personnummer or an export under vault/
// or inbox/ STILL blocks.
describe('P3: empty profile fields', () => {
  profile('', '');
  const r1 = guard(['--file', 'vault/people/sub.md']);
  show('stdout', r1.stdout);
  ok(
    r1.status === 0 && /leg 1 \(employer address\) disarmed/.test(r1.stdout),
    'P3 empty profile fields: the employer address passes and the guard says leg 1 is disarmed',
    `exit ${r1.status}`
  );
  const r2 = guard(['--file', 'vault/me/hr.md']);
  show('stdout', r2.stdout);
  ok(
    r2.status === 2 && /hr\.md:3 personnummer/.test(r2.stdout),
    'P3 NEGATIVE empty profile fields: the personnummer STILL blocks',
    `exit ${r2.status}`
  );
  const r3 = guard(['--file', 'inbox/list.csv']);
  ok(
    r3.status === 2 && /inbox\/list\.csv spreadsheet-export/.test(r3.stdout),
    'P3 NEGATIVE empty profile fields: the export STILL blocks',
    `exit ${r3.status}`
  );
  git(['add', 'vault/report.md']);
  const r4 = guard(['--staged']);
  show('stdout', r4.stdout);
  ok(r4.status === 0, 'P3 empty profile fields: --staged with only a clean page passes', `exit ${r4.status}`);
  git(['reset', '-q']);
  profile(DOMAIN, OWNER);
  ok(
    guard(['--file', 'vault/people/sub.md']).status === 2,
    'P3 NEGATIVE with the fields back the same address blocks again'
  );
  fs.unlinkSync(path.join(REPO, 'system', 'install-profile.json'));
  const r5 = guard(['--file', 'vault/people/sub.md']);
  ok(r5.status === 0 && /disarmed/.test(r5.stdout), 'P3 no profile file at all: leg 1 disarmed, the address passes');
  ok(
    guard(['--file', 'vault/me/hr.md']).status === 2,
    'P3 NEGATIVE no profile file at all: the personnummer still blocks'
  );
  profile(DOMAIN, OWNER);
});

// ---------------------------------------------------------------- N6: --staged and the online hook, end to end
describe('N6: --staged and the online hook, end to end', () => {
  git(['add', '-A']);
  const s = guard(['--staged']);
  show('stdout', s.stdout);
  ok(
    s.status === 2,
    'N6 NEGATIVE --staged with the colleague page, the HR page and the exports staged exits 2',
    `exit ${s.status}`
  );
  ok(
    /sub\.md:1 employer-address/.test(s.stdout) &&
      /hr\.md:3 personnummer/.test(s.stdout) &&
      /inbox\/list\.csv spreadsheet-export/.test(s.stdout),
    'N6 every leg reports in staged mode'
  );
  const before = gitOut(['rev-parse', 'HEAD']);
  const c = git(['commit', '-qm', 'employer data']);
  show('commit stderr', c.stderr);
  ok(
    c.status !== 0 && /BLOCKED - employer-data-guard/.test(c.stderr),
    'N6 NEGATIVE the online hook BLOCKS the commit on the employer-data-guard leg',
    `exit ${c.status}`
  );
  ok(gitOut(['rev-parse', 'HEAD']) === before, 'N6 HEAD did not move');
  git(['reset', '-q']);
  // the secret-scan leg and the size leg of the online hook, in their order
  const fake = ['sk-', 'ant-', 'api03-'].join('') + 'B'.repeat(90);
  write('vault/key.md', `k ${fake}\n`);
  git(['add', 'vault/key.md']);
  const k = git(['commit', '-qm', 'key']);
  ok(
    k.status !== 0 && /BLOCKED - secret-scan/.test(k.stderr),
    'N6 NEGATIVE the online hook blocks a fake key on its first leg'
  );
  git(['reset', '-q']);
  fs.unlinkSync(path.join(REPO, 'vault', 'key.md'));
  fs.writeFileSync(path.join(REPO, 'vault', 'scan.pdf'), Buffer.alloc(MAX + 1, 0x41));
  git(['add', 'vault/scan.pdf']);
  const b = git(['commit', '-qm', 'big']);
  ok(
    b.status !== 0 && /over the 10485760 byte size guard/.test(b.stderr),
    'N6 NEGATIVE the online hook blocks a 10 MB + 1 blob on its second leg'
  );
  git(['reset', '-q']);
  fs.unlinkSync(path.join(REPO, 'vault', 'scan.pdf'));
  // the pass: the clean pages and the allowlist itself commit through the hook
  git([
    'add',
    'vault/report.md',
    'vault/me/contact.md',
    'vault/me/dates.md',
    'vault/people/colleague.md',
    'system/employer-data-allowlist.json',
    'outputs/report.xlsx'
  ]);
  const p = git(['commit', '-qm', 'clean']);
  show('commit output', `${p.stdout}${p.stderr}`);
  ok(
    p.status === 0 && gitOut(['rev-parse', 'HEAD']) !== before,
    'N6 the clean pages, the allowlisted address and the allowlist commit through the online hook',
    `exit ${p.status}`
  );
});

// ---------------------------------------------------------------- P4: an owner may name anyone
// The online hook must not run a donor-identity scan (clone-scrub) at all: an owner's vault is the
// owner's own record and will name the friend who set it up, a colleague, anyone real, and a leg built
// to catch a donor's identity leaking into someone else's repository would refuse an owner's own
// autosave in silence over a name the vault is supposed to hold.
//
// A TRIPWIRE replaces the stub for this case, not the real scanner. The scanner is a drop row online
// (donor-scrub in system/kit-manifest.json: its patterns are the author's identity), so this suite,
// which runs in both trees, cannot copy it from the tree it runs in. The tripwire refuses EVERY call
// and names itself, which proves more than the real scanner did: not only that a page naming the
// author commits, but that the leg is never called. The name below is invented; the tripwire would
// refuse this commit on ANY name at all, which is the point - the real scanner is never called to care.
describe('P4: an owner may name anyone', () => {
  write(
    'scripts/clone-scrub-check.js',
    "console.error('clone-scrub-check: donor identity found (P4 tripwire: the online hook called the donor-identity leg)');\nprocess.exit(2);\n"
  );
  const donor = 'Robin Example';
  write(
    'vault/people/friends/the-friend.md',
    `# The friend who set up my Alex\n\n${donor} installed it with me on day one.\n`
  );
  git(['add', 'scripts/clone-scrub-check.js', 'vault/people/friends/the-friend.md']);
  const before = gitOut(['rev-parse', 'HEAD']);
  const c = git(['commit', '-qm', 'a page that names the friend']);
  show('commit output', `${c.stdout}${c.stderr}`);
  ok(
    c.status === 0 && gitOut(['rev-parse', 'HEAD']) !== before,
    "P4 NEGATIVE-GUARD a vault page naming the Kit's author commits through the online hook (no donor-identity leg online)",
    `exit ${c.status}`
  );
  ok(
    !/clone-scrub|donor identity/i.test(`${c.stdout}${c.stderr}`),
    'P4 the online hook never mentions the donor-identity scan'
  );
});

// ---------------------------------------------------------------- N7: the error paths
describe('N7: the error paths', () => {
  ok(guard([]).status === 1, 'N7 NEGATIVE no mode exits 1');
  ok(guard(['--file', 'vault/does-not-exist.md']).status === 1, 'N7 NEGATIVE a missing file exits 1');
  ok(
    guard(['--allow-address', 'not-an-address', '--reason', 'x']).status === 1,
    'N7 NEGATIVE --allow-address without an @ is refused'
  );
});

// ---------------------------------------------------------------- N8: an unknown flag refuses first
describe('N8: an unknown flag refuses before anything runs', () => {
  const before = fs.readFileSync(allowlistPath, 'utf8');
  const bad = guard(['--allow-adress', 'typo@acme.example', '--reason', 'x']);
  show('stderr', bad.stderr);
  ok(
    bad.status === 1 && /unknown flag --allow-adress/.test(bad.stderr),
    'N8 NEGATIVE a misspelled --allow-address flag refuses, exit 1, and names the flag on stderr',
    `exit ${bad.status}`
  );
  ok(fs.readFileSync(allowlistPath, 'utf8') === before, 'N8 nothing was written');
  const bad2 = guard(['--staged', '--bogus']);
  show('stderr', bad2.stderr);
  ok(
    bad2.status === 1 && /unknown flag --bogus/.test(bad2.stderr),
    'N8 NEGATIVE --staged with an unknown flag beside it refuses, exit 1, and names the flag on stderr',
    `exit ${bad2.status}`
  );
  ok(fs.readFileSync(allowlistPath, 'utf8') === before, 'N8 NEGATIVE still nothing was written');
  ok(guard(['--init-allowlist']).status === 0, 'N8 --init-allowlist still exits 0 unchanged');
  ok(guard(['--file', 'vault/report.md']).status === 0, 'N8 --file still exits 0 unchanged on a clean page');
  ok(guard(['--staged']).status === 0, 'N8 --staged alone still exits 0 unchanged with nothing staged');
});
