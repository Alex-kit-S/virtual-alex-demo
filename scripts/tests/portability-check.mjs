#!/usr/bin/env node
// scripts/tests/portability-check.mjs
// The permanent cross-platform guard. Transplanted 2026-08-31 from
// personal-os/scripts/tests/portability-check.mjs (bash migration Phase 1, 2026-08-05) for the
// macOS port, with ONE semantic change: the donor's P4 says "the migration is finished, zero
// Windows files exist"; the Kit is MID-migration with a legitimate Windows layer, so its P4 says
// "no NEW Windows files" - the allowlist below is the frozen 2026-08-31 inventory and files LEAVE
// it as they are ported. It has grown exactly once, deliberately and with the reasoning written
// beside the row (see the P4 block). "It never grows" was the original wording and it is no longer
// true, so it does not stay here pretending: a rule that quietly stops matching its own list is
// worse than one that records its exception.
//
//   P1 CASE      every repo path literal resolves with EXACT case (breaks on Linux otherwise).
//   P2 BSD/GNU   no GNU-only command spelling inside a .sh file (sed -i, date -d, readlink -f...).
//   P3 BASH32    no bash 4+ construct inside a .sh file (macOS ships bash 3.2.57).
//   P4 NOPS      no .ps1/.cmd/.bat outside the frozen baseline below.
//   P5 NOWINPATH no quoted, extension-shaped Windows drive-letter path literal in portable code.
//   P6 DEADCALL  no `node scripts/<x>.js` call to a file this tree does not hold.
//   P7 INVISIBLE no literal U+FEFF or zero-width character inside code (write the escape).
//
// Exit 0 = clean. Exit 1 = findings (prints every one, grouped, with file:line).
// Run: node scripts/tests/portability-check.mjs

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

const SKIP_DIRS = new Set([
  '.git', 'node_modules', '.next', 'venv', '.venv', '__pycache__', '.obsidian',
  'outputs', '.agents', '.claude', 'vault', 'launchd',
]);

const findings = [];
const add = (check, file, line, msg) =>
  findings.push({ check, file: path.relative(ROOT, file), line, msg });

// ---------------------------------------------------------------- walk
function walk(dir, out = []) {
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const e of entries) {
    if (SKIP_DIRS.has(e.name)) continue;
    const full = path.join(dir, e.name);
    if (e.isDirectory()) walk(full, out);
    else out.push(full);
  }
  return out;
}

// ---------------------------------------------------------------- P1: exact-case path resolution
const dirCache = new Map();
function realEntries(dir) {
  if (dirCache.has(dir)) return dirCache.get(dir);
  let set;
  try {
    set = new Set(fs.readdirSync(dir));
  } catch {
    set = null;
  }
  dirCache.set(dir, set);
  return set;
}

function resolveExact(relPath) {
  const parts = relPath.split('/').filter((p) => p && p !== '.');
  let cur = ROOT;
  const rebuilt = [];
  for (const part of parts) {
    const entries = realEntries(cur);
    if (!entries) return 'missing';
    if (entries.has(part)) {
      rebuilt.push(part);
      cur = path.join(cur, part);
      continue;
    }
    const lower = part.toLowerCase();
    let hit = null;
    for (const e of entries) {
      if (e.toLowerCase() === lower) {
        hit = e;
        break;
      }
    }
    if (hit) {
      rebuilt.push(hit);
      return `case:${rebuilt.join('/')}`;
    }
    return 'missing';
  }
  return 'ok';
}

const PATH_LITERAL = /['"`]([A-Za-z0-9_.\-/]+\.(?:js|mjs|cjs|py|ps1|sh|json|md|txt|jsonl|db|sql|html|css|xml|csv|docx|xlsx|command|plist))['"`]/g;
const REPO_TOP = new Set([
  'scripts', 'system', 'work', 'docs', 'brand', 'templates', 'scheduler', 'inbox', 'refactor',
]);

function checkCase(file, text) {
  const lines = text.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (/^\s*(#|\/\/|\*)/.test(line) && !/scripts\/|system\/|work\//.test(line)) continue;
    let m;
    PATH_LITERAL.lastIndex = 0;
    while ((m = PATH_LITERAL.exec(line)) !== null) {
      const lit = m[1];
      if (lit.startsWith('/') || lit.includes('://')) continue;
      const top = lit.split('/')[0];
      if (!REPO_TOP.has(top)) continue;
      const res = resolveExact(lit);
      if (res.startsWith('case:')) {
        add('P1 CASE', file, i + 1, `'${lit}' resolves only case-insensitively; on disk it is '${res.slice(5)}'. This breaks on Linux.`);
      }
      // 'missing' is NOT reported: gitignored per-install files (install-profile.json etc.)
      // legitimately do not exist in the template tree. Only wrong-CASE is a portability defect.
    }
  }
}

// ---------------------------------------------------------------- P2 + P3: shell portability
// Applies to .sh AND the Kit's .command launchers - a .command IS a shell script macOS runs.
const GNUISMS = [
  [/\bsed\s+-i\b(?!\s*['"]{2})/, "GNU `sed -i` without a backup suffix; BSD sed requires `sed -i ''`. Do it in Node instead."],
  [/\bdate\s+-d\b/, 'GNU `date -d`; BSD date uses -v/-j -f. Do date math in Node instead.'],
  [/\breadlink\s+-f\b/, 'GNU `readlink -f`; BSD readlink has no -f. Use: "$(cd "$(dirname "$0")/.." && pwd)".'],
  [/\bstat\s+-c\b/, 'GNU `stat -c`; BSD stat uses -f. Do it in Node instead.'],
  [/\bmktemp\s+-p\b/, 'GNU `mktemp -p`; BSD mktemp has no -p. Use a full template path.'],
  [/\bgrep\s+-P\b/, 'GNU `grep -P` (PCRE); BSD grep has no -P. Use -E, or do it in Node.'],
  [/\bsort\s+-V\b/, 'GNU `sort -V`; BSD sort has no -V.'],
  [/\bcp\s+--/, 'GNU long-option `cp --...`; BSD cp takes short flags only.'],
  [/\bsed\s+-r\b/, 'GNU `sed -r`; BSD sed uses -E (which GNU also accepts). Use -E.'],
];

const BASH4 = [
  [/\bdeclare\s+-A\b/, '`declare -A` (associative array) is bash 4+; macOS ships 3.2.'],
  [/\$\{[A-Za-z_][A-Za-z0-9_]*\^\^/, '`${var^^}` case conversion is bash 4+; use tr.'],
  [/\$\{[A-Za-z_][A-Za-z0-9_]*,,/, '`${var,,}` case conversion is bash 4+; use tr.'],
  [/\b(mapfile|readarray)\b/, '`mapfile`/`readarray` is bash 4+; use a while-read loop.'],
  [/\bshopt\s+-s\s+globstar\b/, 'globstar (`**`) is bash 4+; use find.'],
  [/\bwait\s+-n\b/, '`wait -n` is bash 4.3+.'],
  [/\blocal\s+-n\b/, '`local -n` nameref is bash 4.3+.'],
];

// A line ending in `# portability-ok: <reason>` is exempt. The reason is REQUIRED on the same
// line so every exemption stays reviewable in a diff (a bare suppression is how a lint dies).
const OK_MARKER = /#\s*portability-ok:\s*\S/;

function checkShell(file, text) {
  const lines = text.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (OK_MARKER.test(line)) continue;
    const code = line.replace(/#.*$/, '');
    if (!code.trim()) continue;
    for (const [re, msg] of GNUISMS) if (re.test(code)) add('P2 BSD/GNU', file, i + 1, msg);
    for (const [re, msg] of BASH4) if (re.test(code)) add('P3 BASH32', file, i + 1, msg);
  }
}

// ---------------------------------------------------------------- P4: no NEW PowerShell/batch
// The frozen 2026-08-31 inventory (18 .ps1 + 3 .cmd). Files LEAVE this list as their ports land.
// A new Windows-only file must be written portable (.mjs) instead - or, for a genuine launcher, as
// a .command/.cmd pair that both appear in a reviewed diff of this list.
//
// ONE ADDITION SINCE THE FREEZE, and it is written down rather than absorbed, because a baseline
// that grows quietly is not a freeze:
//
//   scripts/run-radar.ps1 (2026-09-20, #15 radar). The rule's intent is "do not add Windows-only
//   files that will later need porting". The mac port of a scheduled wrapper already exists
//   (scripts/run-job.mjs, which gained its `radar` job in the same change), so this file adds ZERO
//   port debt: both platforms were delivered together.
//   The alternative was to point the Windows job at run-job.mjs too, and it was rejected on a
//   measured behaviour loss rather than on taste: on Windows, run-job.mjs `armRetry` short-circuits
//   ("launchd retry arm is macOS-only") and `notify` returns early on a non-darwin platform. So the
//   portable route would have shipped a WEEKLY job with no retry ladder and no failure toast, on
//   the platform most installs run. A weekly job that fails and never retries loses a whole week,
//   which is exactly the silent-degradation class this project refuses everywhere else.
//   The honest fix is to make armRetry/notify cross-platform, at which point this row leaves the
//   list along with the other four run-*.ps1 wrappers. Until then: one line, one reason.
const P4_BASELINE = new Set([
  'Install-Alex.cmd',
  'Start-Here.cmd',
  'Update-Alex.cmd',
  'scripts/auth-check.ps1',
  'scripts/bootstrap.ps1',
  'scripts/git-backup.ps1',
  'scripts/lib/close-out.ps1',
  'scripts/lib/run-status.ps1',
  'scripts/lib/soul-canary.ps1',
  'scripts/run-email-triage.ps1',
  'scripts/run-lint.ps1',
  'scripts/run-morning-brief.ps1',
  'scripts/run-radar.ps1',            // added 2026-09-20, see the reasoned note above
  'scripts/run-self-review.ps1',
  'scripts/run-vault-index.ps1',
  'scripts/tests/test-completion-sentinel.ps1',
  'scripts/tests/test-soul-canary.ps1',
  'scripts/tests/test-soul-canary-live.ps1',
  'scripts/vault-backup.ps1',
  'work/18-recovery-layer/check.ps1',
  'work/18-recovery-layer/escrow-test.ps1',
  'work/18-recovery-layer/security-sweep.ps1',
]);

function checkNoPs1(file) {
  const ext = path.extname(file).toLowerCase();
  if (ext !== '.ps1' && ext !== '.cmd' && ext !== '.bat') return;
  const rel = path.relative(ROOT, file).split(path.sep).join('/');
  if (P4_BASELINE.has(rel)) return;
  add('P4 NOPS', file, 1, `NEW ${ext} file outside the frozen 2026-08-31 baseline. Write it portable (.mjs) instead, or make the addition an explicit reviewed change to P4_BASELINE in this script.`);
}

// ---------------------------------------------------------------- P5: no Windows path literals
const P5_EXEMPT_FILES = new Set([
  // This checker's own file: the patterns legitimately name the bug class.
  'scripts/tests/portability-check.mjs',
]);

const P5_WIN_PATH = /['"`]([A-Za-z]:\\[^'"`]+\.[A-Za-z0-9]{1,6})['"`]/g;

function checkNoWinPath(file, text) {
  const rel = path.relative(ROOT, file).split(path.sep).join('/');
  if (P5_EXEMPT_FILES.has(rel)) return;
  const lines = text.split('\n');
  for (let i = 0; i < lines.length; i++) {
    // Same reviewable escape hatch as P2/P3 (`// portability-ok: <reason>`): a cross-platform
    // tool resolver legitimately lists the Windows install locations as guarded FALLBACKS, and
    // exempting the whole file for that would blind P5 to real regressions elsewhere in it.
    if (/\/\/\s*portability-ok:\s*\S/.test(lines[i])) continue;
    let m;
    P5_WIN_PATH.lastIndex = 0;
    while ((m = P5_WIN_PATH.exec(lines[i])) !== null) {
      add('P5 NOWINPATH', file, i + 1, `Windows absolute path literal '${m[1]}'. Resolve it relative to the repo root instead, or justify it inline with // portability-ok: <reason>.`);
    }
  }
}

// ---------------------------------------------------------------- P6: no call to a script that is not here
// `node scripts/<x>.js` in a shipped script, command or workflow must name a file this tree holds.
// The donor system's nightly backup called four aggregators the Kit never shipped, and a sweep printed
// a command for a fifth, on every family laptop and every Virtual Alex (fleet Fix C, 2026-09-24). A
// call to a missing file fails at run time, quietly, inside a best-effort block nobody reads. Run in
// each tree against its own files, so a script dropped online is caught where it is dropped. Tests
// are left out: their fixtures name scripts on purpose. The escape hatch is the same reviewable
// marker as P2/P3/P5, on the line: `portability-ok: <reason>`.
const P6_CALL = /\bnode(?:\.exe)?["']?\s+["']?(?:\$\{?[A-Za-z_]+\}?[\\/])?(scripts[\\/][A-Za-z0-9_./\\-]+?\.(?:js|mjs|cjs))\b/g;
const P6_EXT = new Set(['.js', '.mjs', '.cjs', '.sh', '.ps1', '.cmd', '.command', '.md', '.yml', '.yaml']);
function checkDeadCalls(file, text) {
  const rel = path.relative(ROOT, file).split(path.sep).join('/');
  if (rel.startsWith('scripts/tests/') || !P6_EXT.has(path.extname(file).toLowerCase())) return;
  const lines = text.split('\n');
  for (let i = 0; i < lines.length; i++) {
    if (/portability-ok:\s*\S/.test(lines[i])) continue;
    for (const m of lines[i].matchAll(P6_CALL)) {
      const target = m[1].split('\\').join('/');
      if (!fs.existsSync(path.join(ROOT, target))) add('P6 DEADCALL', file, i + 1, `calls ${target}, which this tree does not hold. Ship the script, or remove the call.`);
    }
  }
}

// ---------------------------------------------------------------- P7: no invisible character in code
// A literal U+FEFF (byte-order mark) or zero-width character inside a regex or string reads as empty
// in every editor and every diff, so `.replace(/^<BOM>/, '')` and `.replace(/^/, '')` look identical
// and nobody can review which one a file holds. Seat 3 fixed this class once; by 2026-09-24 six sites
// had come back (fleet seat 8 F21, fleet Fix D), because nothing failed on it. Write the escape
// (\uFEFF, \u200B ...) instead. A BOM at byte 0 of a file is a different defect and is not this leg's.
const P7_INVISIBLE = /[\uFEFF\u200B\u200C\u200D\u2060]/g;
const P7_NAMES = { '\uFEFF': 'U+FEFF', '\u200B': 'U+200B', '\u200C': 'U+200C', '\u200D': 'U+200D', '\u2060': 'U+2060' };
function checkInvisible(file, text) {
  const body = text.charCodeAt(0) === 0xFEFF ? text.slice(1) : text;
  const offset = body === text ? 0 : 1;
  const lines = body.split('\n');
  for (let i = 0; i < lines.length; i++) {
    for (const m of lines[i].matchAll(P7_INVISIBLE)) {
      add('P7 INVISIBLE', file, i + 1, `a literal ${P7_NAMES[m[0]]} at column ${m.index + 1 + (i === 0 ? offset : 0)}. It reads as nothing in an editor or a diff; write the escape (\\u${P7_NAMES[m[0]].slice(2)}) instead.`);
    }
  }
}

// ---------------------------------------------------------------- run
// .claude/ is skipped by the walk (skill links, local settings), but its slash commands are shipped
// instructions a session runs, so P6 reads them.
const files = walk(ROOT).concat(walk(path.join(ROOT, '.claude', 'commands')));
let scannedCase = 0;
let scannedShell = 0;

for (const f of files) {
  const ext = path.extname(f);
  checkNoPs1(f);
  let text;
  try {
    text = fs.readFileSync(f, 'utf8');
  } catch {
    continue;
  }
  if (['.js', '.mjs', '.cjs', '.py', '.json', '.ps1', '.sh', '.command'].includes(ext)) {
    checkCase(f, text);
    scannedCase++;
  }
  if (ext === '.sh' || ext === '.command') {
    checkShell(f, text);
    scannedShell++;
  }
  if (['.js', '.mjs', '.cjs', '.py', '.sh', '.command'].includes(ext)) {
    checkNoWinPath(f, text);
    checkInvisible(f, text);
  }
  checkDeadCalls(f, text);
}

// ---------------------------------------------------------------- report
const byCheck = {};
for (const f of findings) (byCheck[f.check] ||= []).push(f);

console.log(`portability-check: ${scannedCase} files scanned for path case, ${scannedShell} shell files scanned for portability`);

if (!findings.length) {
  console.log('PASS: no portability findings.');
  process.exit(0);
}

for (const [check, list] of Object.entries(byCheck)) {
  console.log(`\n${check}  (${list.length})`);
  for (const f of list) console.log(`  ${f.file}:${f.line}  ${f.msg}`);
}
console.log(`\nFAIL: ${findings.length} portability finding(s).`);
process.exit(1);
