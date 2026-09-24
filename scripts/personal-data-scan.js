#!/usr/bin/env node
/*
 * personal-data-scan.js - the PUBLIC-repo personal-data conscience (security-sweep S9, 2026-07-20).
 *
 * WHY: gitleaks (S1) catches SECRETS, but nothing scanned for PERSONAL DATA. On 2026-07-20 two state
 * files, a cached dashboard metrics dump, and a spreadsheet builder that hard-coded real personal
 * figures sat public on GitHub. The privacy policy: the public repo gets the FUNCTIONAL system + the owner's name
 * only; other people's names, financial figures, health values and contact info stay local (gitignored).
 * This is the level-triggered monthly re-check for that policy, a sibling of the V11 forced-add guard.
 *
 * DETECT-ONLY. Greps only the git-TRACKED files (git grep, so gitignored/local files are never scanned).
 *   - NAMES: derived at runtime from vault/people/ basenames (gitignored, always current) - never stored
 *     here, so this script carries no personal data itself.
 *   - PATTERNS: built-in (financial amounts, health data values, SE phone) - functional, no personal data.
 *   - ALLOWLIST: reviewed-OK exceptions in system/personal-data-allowlist.json (gitignored, optional) -
 *     mirrors the .gitleaks.toml allowlist workflow (a reviewed false positive is suppressed by hand).
 *
 * --staged (2026-07-25, stress-test fix F-03): the COMMIT-TIME twin. The monthly sweep above is
 * level-triggered, so a new personal-data file could be committed, pushed at 21:30, and sit public for
 * up to a MONTH before S9 noticed - which is exactly how four real leaks reached the public repo on
 * 2026-07-20 (CRM state, dashboard data JSONs, a metrics dump, a builder with real personal figures).
 * The commit-time chain guarded secrets (gitleaks), forced-adds of ignored paths (V11) and protected
 * files (V10); the personal-DATA class had policy ("gitignore-cover every new state/ dir before its
 * first commit") and no machine. This mode is that machine: it scans ONLY the paths this commit adds
 * or modifies (via `git grep --cached` over the index), so it is fast, and a pre-existing allowlisted
 * hit can never wedge every future commit. Wired into scripts/hooks/pre-commit.
 *
 * Exit 0 = clean, 2 = hit(s) found, 1 = scan error. `--json` prints a machine-readable summary.
 * Run: node scripts/personal-data-scan.js [--json] [--staged]
 */

const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const PEOPLE = path.join(ROOT, 'vault', 'people');
const ALLOWLIST_FILE = path.join(ROOT, 'system', 'personal-data-allowlist.json');
const JSON_OUT = process.argv.includes('--json');
const STAGED = process.argv.includes('--staged');
const HIT_CAP = 80;

// ---- built-in detection patterns (functional; carry no personal data) ----
// High precision by design: financial requires an explicit SEK/kr currency next to the number (a bare
// comma-grouped number matches CSS rgba, word counts and dollar examples - all noise). Money in this
// repo is Swedish, so currency-adjacency is the discriminator.
// CORRECTED 2026-07-25 (found while building --staged, stress-test F-03): the financial and contact
// patterns used `\s` INSIDE a bracket expression. git grep runs POSIX ERE, where `[0-9.,\s]` means the
// literal chars 0-9 . , \ s - a SPACE is NOT in the class. So the two most common Swedish formats,
// "35 000 kr" (space thousands separator) and "+46 70 123 45 67" (spaced phone), could never match:
// the guard was blind to the exact shapes it existed to catch, and the "CLEAN baseline" was partly
// vacuous. Both now use the POSIX class [[:space:]], verified matching against both formats.
const PATTERNS = [
  { cat: 'financial', re: '\\b[0-9][0-9.,[:space:]]*(kr|sek)\\b' },          // an amount with kr/SEK adjacency, spaces allowed
  { cat: 'health',    re: '"(steps|sleep[_-]?score|sleepScore|sleep[_-]?hours|sleepHours)"\\s*:\\s*[0-9.]+' }, // health values in a JSON data blob
  { cat: 'contact',   re: '\\+46[[:space:]0-9]{7,}' },                      // a Swedish phone number, spaced or not
  // infra-secret-path (F-04, 2026-07-21): a LOCAL secret-file storage path must never live in a tracked
  // (world-readable) file - it hands an attacker the exact on-disk location of a credential. The canonical
  // case is the vault-backup gpg passphrase; its path lives ONLY in the gitignored credentials ledger (read
  // at runtime). This terminates the class - the concrete secret-location tokens are matched below; add a
  // token here when a new local secret gets a fixed name. Live URLs (box host, MCP endpoint) are unavoidably
  // public and deliberately NOT matched (only on-disk secret LOCATIONS are). Precise by design: a generic
  // ".pass" extension false-matches PowerShell ".Pass" property access under the scanner's -i flag.
  { cat: 'infra-secret-path', re: '\\.alex-secrets|vault-backup\\.pass' },
];

// Vendored / generated / self trees to skip: third-party skills carry their own example names + word
// counts (not the owner's data), and the sweep's own report/this scanner would self-match.
const EXCLUDE = [
  ':(exclude).agents/skills', ':(exclude).claude/skills',
  ':(exclude)scripts/personal-data-scan.js',
  ':(exclude)vault/projects/recovery/last-security-sweep.md',
];

// Basename tokens that are NOT real names.
// The People Intake convention deliberately encodes CONTEXT in the filename (`firstname-context`, e.g.
// `lena-hr`, `jordan-casey-select-tech`), so the trailing tokens are org/role words, not names.
// Watching them as names is what produced 101 false hits on 2026-07-25 (a contact named
// `...-select-tech` made "select" a watched name, matching every `Select-Object` and SQL `SELECT` in
// the repo). Generic context vocabulary is stopped here so the class cannot come back with the next
// company-suffixed contact page.
const NAME_STOP = new Set([
  'example', 'contact', 'inbox', 'index', 'test', 'template', 'self',
  // org / role / industry context words that appear in people filenames by convention
  'select', 'tech', 'core', 'data', 'media', 'group', 'agency', 'agencies', 'consulting', 'consultant',
  'partners', 'partner', 'solutions', 'digital', 'labs', 'studio', 'bank', 'insurance', 'union',
  'recruiter', 'recruiting', 'talent', 'staffing', 'search', 'people', 'human', 'resources',
  'engineering', 'systems', 'software', 'services', 'global', 'nordic', 'sweden', 'stockholm',
  'friend', 'family', 'colleague', 'client', 'prospect', 'network', 'company', 'corp', 'group',
  'analytics', 'intelligence', 'consult', 'career', 'careers', 'apps', 'labs',
]);

function loadAllowlist() {
  const a = { names: [], substrings: [], files: [] };
  try {
    const j = JSON.parse(fs.readFileSync(ALLOWLIST_FILE, 'utf8'));
    for (const k of ['names', 'substrings', 'files']) if (Array.isArray(j[k])) a[k] = j[k].map(String);
  } catch (_) { /* optional; absent = no suppressions */ }
  return a;
}

// Build the NAME watch-list from vault/people/ basenames (local, gitignored, always current).
// Two CONFIDENCE tiers, because they behave very differently in practice (2026-07-25):
//   phrases  - the multi-token full name ("firstname lastname"). HIGH precision: it does not occur in
//              code or generic prose, so a hit is a real name leak.
//   tokens   - a single name token. LOWER precision by nature (a first name can be an English word),
//              which is why the pre-commit gate reports them without blocking while the monthly sweep
//              still lists them for human review.
function deriveNames() {
  const phrases = new Set();
  const tokens = new Set();
  let dirs = [];
  try { dirs = fs.readdirSync(PEOPLE, { withFileTypes: true }); } catch (_) { return { phrases: [], tokens: [], hadPeople: false }; }
  for (const d of dirs) {
    if (!d.isDirectory()) continue;
    let files = [];
    try { files = fs.readdirSync(path.join(PEOPLE, d.name)); } catch (_) { continue; }
    for (const f of files) {
      if (!f.endsWith('.md') || f.startsWith('_') || f === 'index.md') continue;
      const base = f.replace(/\.md$/, '');
      const phrase = base.replace(/-/g, ' ').trim();
      if (phrase.split(' ').length > 1 && phrase.length >= 5) phrases.add(phrase);
      for (const tok of base.split('-')) {
        const t = tok.toLowerCase();
        if (t.length >= 4 && /^[a-z]+$/.test(t) && !NAME_STOP.has(t)) tokens.add(t);
      }
    }
  }
  return { phrases: [...phrases], tokens: [...tokens], hadPeople: true };
}

// The paths this commit adds/modifies (--staged mode). ACMR: added, copied, modified, renamed - a
// DELETION cannot leak anything, so it is deliberately excluded.
function stagedPaths() {
  let out = '';
  try {
    out = execFileSync('git', ['diff', '--cached', '--name-only', '--diff-filter=ACMR', '-z'],
      { cwd: ROOT, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 });
  } catch (e) {
    throw new Error(`git diff --cached failed (exit ${e.status}): ${String(e.stderr || e.message).slice(0, 200)}`);
  }
  return out.split('\0').map(s => s.trim()).filter(Boolean);
}

// git grep for one ERE; returns [{file, line, text}] (empty on no match). Default scope = the whole
// TRACKED tree (the monthly sweep). In --staged mode the scope is the INDEX (`--cached`) narrowed to
// the paths of this commit, so the check answers "does what I am about to publish leak?".
function gitGrep(re, scopePaths) {
  let out = '';
  const args = ['grep', '-I', '-n', '-i', '-E'];
  if (STAGED) args.push('--cached');
  args.push('-e', re, '--');
  args.push(...(STAGED ? scopePaths : ['.']), ...EXCLUDE);
  try {
    out = execFileSync('git', args, { cwd: ROOT, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 });
  } catch (e) {
    if (e.status === 1) return [];            // git grep: exit 1 = no matches (not an error)
    throw new Error(`git grep failed (exit ${e.status}): ${String(e.stderr || e.message).slice(0, 200)}`);
  }
  const hits = [];
  // Split on CR?LF, not LF alone. git grep emits each file's own line endings, so on Windows a
  // line from a CRLF-checked-out file arrives with a trailing carriage return - and in JavaScript
  // `.` does NOT match a carriage return, because it counts as a line terminator. So `(.*)$`
  // silently failed on every CRLF file: the grep found the hit, the parser dropped it, and the
  // scan reported CLEAN over files it had actually searched and matched. Measured on 2026-08-17:
  // 366 of 378 real hits were being discarded this way. Same class as the POSIX
  // bracket-expression bug already on record for this scanner family, and the same lesson: a
  // check that runs, finds something, and throws it away is the most dangerous shape a check has.
  for (const line of out.split(/\r?\n/)) {
    const m = line.match(/^([^:]+):(\d+):([\s\S]*)$/);
    if (m) hits.push({ file: m[1].replace(/\\/g, '/'), line: +m[2], text: m[3] });
  }
  return hits;
}

function reEscapeAlt(items) {
  // word-boundaried alternation of literal terms (spaces allowed inside a phrase)
  const esc = items.map(s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  return '\\b(' + esc.join('|') + ')\\b';
}

function main() {
  const allow = loadAllowlist();
  const allowNames = new Set(allow.names.map(s => s.toLowerCase()));
  const { phrases, tokens, hadPeople } = deriveNames();
  const watchPhrases = phrases.filter(n => !allowNames.has(n.toLowerCase()));
  const watchTokens = tokens.filter(n => !allowNames.has(n.toLowerCase()));
  const watchNames = [...watchPhrases, ...watchTokens];

  // --staged: nothing staged = nothing to publish = clean, with no git grep at all.
  let scope = null;
  if (STAGED) {
    scope = stagedPaths();
    if (scope.length === 0) {
      if (JSON_OUT) console.log(JSON.stringify({ clean: true, total: 0, byCat: {}, staged: 0, mode: 'staged', hits: [] }));
      else console.log('personal-data-scan (staged): nothing staged - clean.');
      process.exit(0);
    }
  }

  const raw = [];
  // names, split by confidence tier (one grep each; skipped when the tier is empty)
  if (watchPhrases.length) {
    for (const h of gitGrep(reEscapeAlt(watchPhrases), scope)) raw.push({ cat: 'name', ...h });
  }
  if (watchTokens.length) {
    for (const h of gitGrep(reEscapeAlt(watchTokens), scope)) raw.push({ cat: 'name-token', ...h });
  }
  for (const p of PATTERNS) {
    for (const h of gitGrep(p.re, scope)) raw.push({ cat: p.cat, ...h });
  }

  // suppress allowlisted hits: by file path, or by any allowlisted substring in the line
  const subs = allow.substrings.map(s => s.toLowerCase());
  const files = allow.files.map(s => s.replace(/\\/g, '/'));
  const seen = new Set();
  const hits = [];
  for (const h of raw) {
    const key = `${h.cat}|${h.file}|${h.line}`;
    if (seen.has(key)) continue; seen.add(key);
    if (files.some(f => h.file === f || h.file.startsWith(f))) continue;
    const lc = h.text.toLowerCase();
    if (subs.some(s => s && lc.includes(s))) continue;
    hits.push(h);
  }

  const byCat = hits.reduce((a, h) => (a[h.cat] = (a[h.cat] || 0) + 1, a), {});

  // BLOCKING vs REPORTING (2026-07-25). The commit gate must never cry wolf: the day it blocks on
  // noise is the day it gets routed around with --no-verify, and then it guards nothing. So the
  // pre-commit gate blocks only on the HIGH-CONFIDENCE classes (an amount with currency, a health
  // value, a phone number, a secret file path, or a full-name PHRASE) and merely REPORTS lower-precision
  // single-token name hits. The monthly sweep is unchanged - it lists everything for human review,
  // which is what an amber conscience is for.
  const BLOCKING = new Set(['financial', 'health', 'contact', 'infra-secret-path', 'name']);
  const blocking = hits.filter(h => BLOCKING.has(h.cat));
  const reportOnly = hits.filter(h => !BLOCKING.has(h.cat));
  const clean = STAGED ? blocking.length === 0 : hits.length === 0;
  const mode = STAGED ? 'staged' : 'tracked-tree';
  const summary = { clean, total: hits.length, blocking: blocking.length, reportOnly: reportOnly.length,
    byCat, namesWatched: watchNames.length, phrasesWatched: watchPhrases.length, tokensWatched: watchTokens.length,
    hadPeople, mode, staged: scope ? scope.length : null,
    hits: (STAGED ? blocking.concat(reportOnly) : hits).slice(0, HIT_CAP)
      .map(h => ({ cat: h.cat, file: h.file, line: h.line, sample: h.text.trim().slice(0, 160) })) };

  if (JSON_OUT) { console.log(JSON.stringify(summary)); }
  else {
    if (!hadPeople) console.log('personal-data-scan: WARNING vault/people/ not found - name watch-list is empty (names not scanned).');
    if (clean) {
      console.log(STAGED
        ? `personal-data-scan (staged): CLEAN (0 blocking hits in ${scope.length} staged path(s); ${watchPhrases.length} name phrases + ${watchTokens.length} name tokens watched).`
        : `personal-data-scan: CLEAN (0 personal-data hits across tracked files; ${watchNames.length} names watched).`);
      if (STAGED && reportOnly.length) {
        console.log(`personal-data-scan (staged): ${reportOnly.length} low-precision name-token hit(s), reported not blocked:`);
        for (const h of reportOnly.slice(0, 10)) console.log(`  [${h.cat}] ${h.file}:${h.line}: ${h.text.trim().slice(0, 120)}`);
        if (reportOnly.length > 10) console.log(`  ... +${reportOnly.length - 10} more (monthly S9 lists them all)`);
      }
    } else {
      const shown = STAGED ? blocking : hits;
      console.log(`personal-data-scan${STAGED ? ' (staged)' : ''}: ${shown.length} hit(s) [${Object.entries(byCat).map(([k, v]) => `${k}:${v}`).join(' ')}]`);
      for (const h of shown.slice(0, HIT_CAP)) console.log(`  [${h.cat}] ${h.file}:${h.line}: ${h.text.trim().slice(0, 160)}`);
      if (shown.length > HIT_CAP) console.log(`  ... +${shown.length - HIT_CAP} more`);
      console.log('Fix: move the value/name to a gitignored vault page + pointer, OR add a reviewed exception to system/personal-data-allowlist.json.');
      if (STAGED) console.log('PUBLIC repo: this content would be world-visible at the next push. Unstage it (git restore --staged <path>) or gitignore it BEFORE committing.');
    }
  }
  process.exit(clean ? 0 : 2);
}

try { main(); }
catch (e) { console.error(`personal-data-scan: ERROR ${e.message}`); process.exit(1); }
