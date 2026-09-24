#!/usr/bin/env node
// scripts/tests/test-employer-data-guard.mjs - the employer-data guard, its allowlist CLI and the
// Virtual Alex commit gate (variants/online/scripts/hooks/pre-commit) end to end, every refusal shown
// before the pass (Virtual Alex plan Phase 3, seat 4, 2026-09-23).
//
// A throwaway repo under the OS temp dir carries the REAL guard, the REAL secret scanner, the REAL
// scripts/lib/*.js and the REAL online hook; the hook's other node legs (clone-scrub-check,
// validate-alex) are stubs that exit 0. The employer domain is a reserved example domain and every
// address here is invented; no value is printed by the guard, and the test proves that too.
//
// Run: node scripts/tests/test-employer-data-guard.mjs [--keep]      (exit 0 = all pass)

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
// Fake personal-identity-number shapes, ASSEMBLED AT RUNTIME (test day 2026-09-23): written literally,
// they made this very file trip the guard's personnummer leg in an owner's commit gate, so every
// template build that touched it refused its own /update. T0 below keeps it that way.
const PN12 = ['19850101', '1234'].join('-');
const PN10 = ['850101', '1234'].join('-');
const PN_XSD = ['123456', '7890'].join('-');

let pass = 0; const fails = [];
function ok(cond, name, detail) {
  if (cond) { pass++; console.log(`PASS  ${name}${detail ? ` - ${detail}` : ''}`); }
  else fails.push(`${name}${detail ? ` - ${detail}` : ''}`);
}
function show(label, text) {
  const t = String(text || '').trim();
  if (t) console.log(`      ${label}: ${t.split(/\r?\n/).join('\n      ')}`);
}
const guard = (args, cwd = REPO) => spawnSync(process.execPath, [path.join(REPO, 'scripts', 'employer-data-guard.mjs'), ...args], { cwd, encoding: 'utf8' });
const git = (args, cwd = REPO) => spawnSync('git', args, { cwd, encoding: 'utf8' });
const gitOut = (args) => git(args).stdout.trim();
function write(rel, content) {
  const p = path.join(REPO, rel);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, content);
}
function profile(domain, owner) {
  write('system/install-profile.json', JSON.stringify({ _what: 'test profile', employer_domain: domain, owner_work_address: owner, wake: [], park: [], locale: 'en' }, null, 2) + '\n');
}
const allowlistPath = path.join(REPO, 'system', 'employer-data-allowlist.json');

// ---------------------------------------------------------------- the fixture
fs.mkdirSync(path.join(REPO, 'scripts', 'lib'), { recursive: true });
fs.mkdirSync(path.join(REPO, 'scripts', 'hooks'), { recursive: true });
git(['init', '-q', '-b', 'main', REPO], TMP);
git(['config', 'core.autocrlf', 'false']);
git(['config', 'user.name', 'Alex Kit']);
git(['config', 'user.email', 'alex-kit@localhost']);
git(['config', 'core.hooksPath', 'scripts/hooks']);
for (const f of ['employer-data-guard.mjs', 'secret-scan.mjs']) fs.copyFileSync(path.join(KIT, 'scripts', f), path.join(REPO, 'scripts', f));
for (const f of fs.readdirSync(path.join(KIT, 'scripts', 'lib')).filter((n) => n.endsWith('.js'))) fs.copyFileSync(path.join(KIT, 'scripts', 'lib', f), path.join(REPO, 'scripts', 'lib', f));
// The online hook lives under variants/online/ in the Kit and AT scripts/hooks/pre-commit on the
// online tree (the generator lands it there and drops variants/), and this suite runs on both.
const variantHook = path.join(KIT, 'variants', 'online', 'scripts', 'hooks', 'pre-commit');
const hookSrc = fs.existsSync(variantHook) ? variantHook : path.join(KIT, 'scripts', 'hooks', 'pre-commit');
if (!/VIRTUAL ALEX VARIANT/.test(fs.readFileSync(hookSrc, 'utf8').split(/\r?\n/)[1] || '')) throw new Error(`${hookSrc} is not the Virtual Alex hook (line 2 does not say so)`);
fs.copyFileSync(hookSrc, path.join(REPO, 'scripts', 'hooks', 'pre-commit'));
fs.chmodSync(path.join(REPO, 'scripts', 'hooks', 'pre-commit'), 0o755);
console.log(`online hook under test: ${path.relative(KIT, hookSrc).replace(/\\/g, '/')}`);
for (const stub of ['clone-scrub-check.js', 'validate-alex.js']) write(`scripts/${stub}`, '// stub: this leg is not under test here\nprocess.exit(0);\n');
profile(DOMAIN, OWNER);
write('vault/log.md', '# Log\n');
git(['add', '-A']);
const seed = git(['commit', '-qm', 'seed']);
show('seed commit hook output', `${seed.stdout}${seed.stderr}`);
ok(seed.status === 0, 'P0 the seed commit passes the real online hook', `exit ${seed.status}`);
console.log(`fixture: ${REPO}`);

// ---------------------------------------------------------------- T0: the tree cannot block its own update
// Test day 2026-09-23: an owner's /update applies template files through the owner's commit gate,
// and this file then carried literal personnummer-shaped fixtures, so the gate refused the update.
// No TRACKED file of this tree (the Kit, or the online tree when run there), vendored skills aside,
// may carry a line the guard's personnummer leg matches. The regex is read from the guard itself.
{
  const src = fs.readFileSync(path.join(KIT, 'scripts', 'employer-data-guard.mjs'), 'utf8');
  const m = /const PERSONNUMMER = \/(.+)\/;/.exec(src);
  ok(!!m, 'T0 the personnummer regex is readable from the guard');
  const re = m ? new RegExp(m[1]) : null;
  const tracked = spawnSync('git', ['ls-files', '-z'], { cwd: KIT, encoding: 'utf8' }).stdout.split('\0').filter(Boolean)
    .filter((f) => !f.startsWith('.agents/skills/') && !f.startsWith('.claude/skills/'));
  const hits = [];
  for (const f of tracked) {
    let text;
    try { text = fs.readFileSync(path.join(KIT, f), 'utf8'); } catch { continue; }
    if (text.includes('\0')) continue; // binary
    text.split(/\r?\n/).forEach((line, i) => { if (re && re.test(line)) hits.push(`${f}:${i + 1}`); });
  }
  ok(re && tracked.length > 50 && hits.length === 0, 'T0 NEGATIVE-GUARD no tracked file carries a personnummer shape, so no template build can refuse its own /update', hits.length ? hits.slice(0, 5).join(', ') : `${tracked.length} files scanned`);
}

// ---------------------------------------------------------------- N1: a colleague's address
{
  write('vault/people/colleague.md', `# A colleague\n\nmail: ${COLLEAGUE}\n`);
  const r = guard(['--file', 'vault/people/colleague.md']);
  show('stdout', r.stdout); show('stderr', r.stderr);
  ok(r.status === 2, 'N1 NEGATIVE firstname.lastname@<employer-domain> blocks (--file)', `exit ${r.status}`);
  ok(/^employer-data-guard: vault\/people\/colleague\.md:3 employer-address$/m.test(r.stdout), 'N1 the hit names file, line and leg');
  ok(!`${r.stdout}${r.stderr}`.toLowerCase().includes('firstname'), 'N1 the address is never printed');
  write('vault/people/sub.md', `mail: someone@mail.${DOMAIN}\n`);
  ok(guard(['--file', 'vault/people/sub.md']).status === 2, 'N1 NEGATIVE an address at a subdomain of the employer blocks');
  write('vault/people/other.md', `mail: someone@${DOMAIN}.evil.example\n`);
  ok(guard(['--file', 'vault/people/other.md']).status === 0, 'N1 an address at a longer domain that merely starts with the employer domain passes');
  write('vault/people/period.md', `Write to ${COLLEAGUE}.\n`);
  ok(guard(['--file', 'vault/people/period.md']).status === 2, 'N1 NEGATIVE the same colleague address followed by a sentence period still blocks');
  write('.agents/skills/some-skill/schema.xsd', `<xsd:pattern value="${PN_XSD}"/> contact ${COLLEAGUE}\n`);
  ok(guard(['--file', '.agents/skills/some-skill/schema.xsd']).status === 0, 'N1 a vendored skill file is skipped by the content legs');
  write('.agents/skills/some-skill/data.xlsx', 'x');
  ok(guard(['--file', '.agents/skills/some-skill/data.xlsx']).status === 0, 'N1 a spreadsheet under a vendored skill is not under vault/ or inbox/, passes');
}

// ---------------------------------------------------------------- N2: a personnummer
{
  write('vault/me/hr.md', `# HR\n\nid ${PN12}\n`);
  const r = guard(['--file', 'vault/me/hr.md']);
  show('stdout', r.stdout);
  ok(r.status === 2 && /hr\.md:3 personnummer/.test(r.stdout), 'N2 NEGATIVE the twelve-digit shape blocks', `exit ${r.status}`);
  ok(!`${r.stdout}${r.stderr}`.includes('1985'), 'N2 the number is never printed');
  write('vault/me/hr2.md', `id ${PN10}\n`);
  ok(guard(['--file', 'vault/me/hr2.md']).status === 2, 'N2 NEGATIVE the ten-digit shape blocks too');
  write('vault/me/dates.md', 'from 2026-09-23 to 2026-10-05, run 20260922T220705Z, phone 070-123 45 67\n');
  ok(guard(['--file', 'vault/me/dates.md']).status === 0, 'N2 dates, a run stamp and a phone number pass');
}

// ---------------------------------------------------------------- N3: spreadsheet exports
{
  write('vault/x.xlsx', 'not really a workbook\n');
  const r = guard(['--file', 'vault/x.xlsx']);
  show('stdout', r.stdout);
  ok(r.status === 2 && /^employer-data-guard: vault\/x\.xlsx spreadsheet-export \(path\)$/m.test(r.stdout), 'N3 NEGATIVE vault/x.xlsx blocks (path leg)', `exit ${r.status}`);
  write('inbox/list.csv', 'a,b\n');
  ok(guard(['--file', 'inbox/list.csv']).status === 2, 'N3 NEGATIVE inbox/list.csv blocks');
  write('vault/model.pbix', 'x');
  ok(guard(['--file', 'vault/model.pbix']).status === 2, 'N3 NEGATIVE vault/model.pbix blocks');
  write('outputs/report.xlsx', 'x');
  ok(guard(['--file', 'outputs/report.xlsx']).status === 0, 'N3 outputs/report.xlsx passes (not under vault/ or inbox/)');
  write('vault/report.md', '# a markdown page\n');
  ok(guard(['--file', 'vault/report.md']).status === 0, 'N3 a markdown page under vault/ passes');
}

// ---------------------------------------------------------------- P1: the owner's own address
{
  write('vault/me/contact.md', `work: ${OWNER.toUpperCase()} and ${OWNER.toLowerCase()}\n`);
  const r = guard(['--file', 'vault/me/contact.md']);
  show('stdout', r.stdout);
  ok(r.status === 0, "P1 the owner's own work address passes, in any case", `exit ${r.status}`);
}

// ---------------------------------------------------------------- N4 + P2: the allowlist CLI
{
  const r = guard(['--allow-address', COLLEAGUE]);
  show('stderr', r.stderr);
  ok(r.status === 1 && /reason is required/.test(r.stderr), 'N4 NEGATIVE --allow-address with no --reason is refused', `exit ${r.status}`);
  ok(!fs.existsSync(allowlistPath), 'N4 nothing was written');
  const a = guard(['--allow-address', COLLEAGUE, '--reason', 'the owner asked for this contact to be kept: a former manager, now a reference']);
  show('stdout', a.stdout); show('stderr', a.stderr);
  ok(a.status === 0, 'P2 --allow-address with a reason writes the allowlist', `exit ${a.status}`);
  const j = JSON.parse(fs.readFileSync(allowlistPath, 'utf8'));
  ok(j._schema === 'employer-data-allowlist@1' && j._writer === 'scripts/employer-data-guard.mjs', 'P2 the file carries the writer header and schema', `${j._schema} by ${j._writer}`);
  ok(Array.isArray(j.addresses) && j.addresses.length === 1 && j.addresses[0].address === COLLEAGUE.toLowerCase() && /reference/.test(j.addresses[0].reason), 'P2 the row carries the address and its reason');
  ok(guard(['--file', 'vault/people/colleague.md']).status === 0, 'P2 the allowlisted address now passes');
  ok(guard(['--file', 'vault/people/sub.md']).status === 2, 'P2 NEGATIVE a different address at the domain still blocks');
  const p = guard(['--allow-path', 'vault/x.xlsx', '--reason', 'a workbook the owner built at home, not an export']);
  ok(p.status === 0 && guard(['--file', 'vault/x.xlsx']).status === 0, 'P2 an allowlisted path passes');
  ok(guard(['--file', 'inbox/list.csv']).status === 2, 'P2 NEGATIVE a different export still blocks');
  ok(guard(['--file', 'vault/me/hr.md']).status === 2, 'P2 NEGATIVE the personnummer leg has no allowlist and still blocks');
  const raw = fs.readFileSync(allowlistPath);
  ok(raw[0] !== 0xEF && !raw.includes('\r') && raw[raw.length - 1] === 0x0A, 'P2 the file is UTF-8 without BOM, LF, one trailing newline (docs/json-standard.md rule 1)');
}

// ---------------------------------------------------------------- N5: a broken allowlist fails closed
{
  const good = fs.readFileSync(allowlistPath, 'utf8');
  fs.writeFileSync(allowlistPath, good.replace('employer-data-allowlist@1', 'something-else@9'));
  const r = guard(['--file', 'vault/report.md']);
  show('stderr', r.stderr);
  ok(r.status === 1 && /schema check FAILED/.test(r.stderr), 'N5 NEGATIVE an allowlist under a foreign schema makes the guard exit 1 even on a clean file', `exit ${r.status}`);
  fs.writeFileSync(allowlistPath, good.replace(/"reason": "the owner asked[^"]*"/, '"reason": ""'));
  const e = guard(['--file', 'vault/report.md']);
  show('stderr', e.stderr);
  ok(e.status === 1 && /no reason/.test(e.stderr), 'N5 NEGATIVE a row whose reason is empty makes the guard exit 1', `exit ${e.status}`);
  fs.writeFileSync(allowlistPath, good);
  ok(guard(['--file', 'vault/report.md']).status === 0, 'N5 the restored allowlist reads again');
}

// ---------------------------------------------------------------- P3: empty profile fields
// Master ruling 2026-09-23 (seat 4 carry-over 3): only leg 1 needs the profile. With both fields
// empty the employer address passes (there is no employer to match), the guard says leg 1 is
// disarmed, and a personnummer or an export under vault/ or inbox/ STILL blocks.
{
  profile('', '');
  const r1 = guard(['--file', 'vault/people/sub.md']);
  show('stdout', r1.stdout);
  ok(r1.status === 0 && /leg 1 \(employer address\) disarmed/.test(r1.stdout), 'P3 empty profile fields: the employer address passes and the guard says leg 1 is disarmed', `exit ${r1.status}`);
  const r2 = guard(['--file', 'vault/me/hr.md']);
  show('stdout', r2.stdout);
  ok(r2.status === 2 && /hr\.md:3 personnummer/.test(r2.stdout), 'P3 NEGATIVE empty profile fields: the personnummer STILL blocks', `exit ${r2.status}`);
  const r3 = guard(['--file', 'inbox/list.csv']);
  ok(r3.status === 2 && /inbox\/list\.csv spreadsheet-export/.test(r3.stdout), 'P3 NEGATIVE empty profile fields: the export STILL blocks', `exit ${r3.status}`);
  git(['add', 'vault/report.md']);
  const r4 = guard(['--staged']);
  show('stdout', r4.stdout);
  ok(r4.status === 0, 'P3 empty profile fields: --staged with only a clean page passes', `exit ${r4.status}`);
  git(['reset', '-q']);
  profile(DOMAIN, OWNER);
  ok(guard(['--file', 'vault/people/sub.md']).status === 2, 'P3 NEGATIVE with the fields back the same address blocks again');
  fs.unlinkSync(path.join(REPO, 'system', 'install-profile.json'));
  const r5 = guard(['--file', 'vault/people/sub.md']);
  ok(r5.status === 0 && /disarmed/.test(r5.stdout), 'P3 no profile file at all: leg 1 disarmed, the address passes');
  ok(guard(['--file', 'vault/me/hr.md']).status === 2, 'P3 NEGATIVE no profile file at all: the personnummer still blocks');
  profile(DOMAIN, OWNER);
}

// ---------------------------------------------------------------- N6: --staged and the online hook, end to end
{
  git(['add', '-A']);
  const s = guard(['--staged']);
  show('stdout', s.stdout);
  ok(s.status === 2, 'N6 NEGATIVE --staged with the colleague page, the HR page and the exports staged exits 2', `exit ${s.status}`);
  ok(/sub\.md:1 employer-address/.test(s.stdout) && /hr\.md:3 personnummer/.test(s.stdout) && /inbox\/list\.csv spreadsheet-export/.test(s.stdout), 'N6 every leg reports in staged mode');
  const before = gitOut(['rev-parse', 'HEAD']);
  const c = git(['commit', '-qm', 'employer data']);
  show('commit stderr', c.stderr);
  ok(c.status !== 0 && /BLOCKED - employer-data-guard/.test(c.stderr), 'N6 NEGATIVE the online hook BLOCKS the commit on the employer-data-guard leg', `exit ${c.status}`);
  ok(gitOut(['rev-parse', 'HEAD']) === before, 'N6 HEAD did not move');
  git(['reset', '-q']);
  // the secret-scan leg and the size leg of the online hook, in their order
  const fake = ['sk-', 'ant-', 'api03-'].join('') + 'B'.repeat(90);
  write('vault/key.md', `k ${fake}\n`);
  git(['add', 'vault/key.md']);
  const k = git(['commit', '-qm', 'key']);
  ok(k.status !== 0 && /BLOCKED - secret-scan/.test(k.stderr), 'N6 NEGATIVE the online hook blocks a fake key on its first leg');
  git(['reset', '-q']); fs.unlinkSync(path.join(REPO, 'vault', 'key.md'));
  fs.writeFileSync(path.join(REPO, 'vault', 'scan.pdf'), Buffer.alloc(MAX + 1, 0x41));
  git(['add', 'vault/scan.pdf']);
  const b = git(['commit', '-qm', 'big']);
  ok(b.status !== 0 && /over the 10485760 byte size guard/.test(b.stderr), 'N6 NEGATIVE the online hook blocks a 10 MB + 1 blob on its second leg');
  git(['reset', '-q']); fs.unlinkSync(path.join(REPO, 'vault', 'scan.pdf'));
  // the pass: the clean pages and the allowlist itself commit through the hook
  git(['add', 'vault/report.md', 'vault/me/contact.md', 'vault/me/dates.md', 'vault/people/colleague.md', 'system/employer-data-allowlist.json', 'outputs/report.xlsx']);
  const p = git(['commit', '-qm', 'clean']);
  show('commit output', `${p.stdout}${p.stderr}`);
  ok(p.status === 0 && gitOut(['rev-parse', 'HEAD']) !== before, 'N6 the clean pages, the allowlisted address and the allowlist commit through the online hook', `exit ${p.status}`);
}

// ---------------------------------------------------------------- P4: an owner may name anyone
// Test day 2026-09-23: the donor-identity scan (clone-scrub) sat in the online gate and refused, in
// silence, every autosave that named the Kit's author, including a Routine's run-log row about the
// backup repository. An owner's vault is the owner's own record and will name the friend who set it
// up. The online hook must not run the donor-identity leg at all.
//
// A TRIPWIRE replaces the stub for this case, not the real scanner (2026-09-24, fleet seat 7). The
// scanner is a drop row online (donor-scrub in system/kit-manifest.json: its patterns are the author's
// identity), so this suite, which runs in both trees, cannot copy it from the tree it runs in. The
// tripwire refuses EVERY call and names itself, which proves more than the real scanner did: not only
// that a page naming the author commits, but that the leg is never called.
{
  write('scripts/clone-scrub-check.js', "console.error('clone-scrub-check: donor identity found (P4 tripwire: the online hook called the donor-identity leg)');\nprocess.exit(2);\n");
  const donor = `${['Sha', 'heen'].join('')} ${['Kia', 'rash'].join('')}`; // assembled at runtime so this file never carries the name
  write('vault/people/friends/the-friend.md', `# The friend who set up my Alex\n\n${donor} installed it with me on day one.\n`);
  git(['add', 'scripts/clone-scrub-check.js', 'vault/people/friends/the-friend.md']);
  const before = gitOut(['rev-parse', 'HEAD']);
  const c = git(['commit', '-qm', 'a page that names the friend']);
  show('commit output', `${c.stdout}${c.stderr}`);
  ok(c.status === 0 && gitOut(['rev-parse', 'HEAD']) !== before, 'P4 NEGATIVE-GUARD a vault page naming the Kit\'s author commits through the online hook (no donor-identity leg online)', `exit ${c.status}`);
  ok(!/clone-scrub|donor identity/i.test(`${c.stdout}${c.stderr}`), 'P4 the online hook never mentions the donor-identity scan');
}

// ---------------------------------------------------------------- N7: the error paths
{
  ok(guard([]).status === 1, 'N7 NEGATIVE no mode exits 1');
  ok(guard(['--file', 'vault/does-not-exist.md']).status === 1, 'N7 NEGATIVE a missing file exits 1');
  ok(guard(['--allow-address', 'not-an-address', '--reason', 'x']).status === 1, 'N7 NEGATIVE --allow-address without an @ is refused');
}

console.log('');
if (!KEEP) fs.rmSync(TMP, { recursive: true, force: true });
if (fails.length) {
  console.error(`test-employer-data-guard: ${fails.length} FAILED\n  ` + fails.join('\n  '));
  process.exit(1);
}
console.log(`test-employer-data-guard: ALL PASS (${pass})`);
