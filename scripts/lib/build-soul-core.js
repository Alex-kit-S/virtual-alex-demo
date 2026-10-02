// scripts/lib/build-soul-core.js - compile soul-core.md (the injection card) from soul.md.
//
// WHAT. soul.md NEVER shrinks and is NEVER edited here; this derives a small, stable-prefixed card
// from it nightly, so a session-start hook can inject an owner's identity without truncation. The
// card is a stable prefix (the operative layer, both canary blocks, pinned register entries) that
// changes only when those rules change, plus a volatile tail (the newest My Words entries by date,
// then a stamp comment) that changes nightly.
//
// HOW. parseSoul() splits soul.md into the operative layer, the end canary block and every dated
// entry; selectEntries() takes the newest NEWEST_N by parsed date plus any configured pins;
// assemble() joins them stable-first, appends the stamp, and refuses (throws, emitting nothing) a
// card that fails any floor check - see the comments at each check for what and why. Writing is
// atomic (a `.staging` sibling, then a rename, then a read-back to verify); on refusal an existing
// soul-core.md is left untouched, and an unchanged soul.md/pins pair leaves the card byte-identical
// (a verified no-op). REPO is resolved locally rather than through scripts/lib/repo-root.js: this
// file must load copied alone beside write-lock.js (test-build-soul-core-paths.mjs:107-111), so a
// shared resolver would drag a second file into every copy.
//
// NEVER. Never shrinks or edits soul.md itself - it is read-only input. Never emits a thin or
// malformed card: see the floor checks in assemble(). Never writes the card to a tracked path when
// soul.md is gitignored (privacy fail-closed, in assertIgnored()). Never treats a missing soul.md as
// a failure: a fresh clone or a pre-/setup install has none yet, and build() returns
// { skipped: true } rather than throwing.
//
// Usage: node scripts/lib/build-soul-core.js [--force]
//        require('./build-soul-core').build({log})  - in-process; takes NO lock (the caller does)
// Exit: 0 built, skipped or unchanged - 1 refused (floor not met, or a script error) - 2 the write
//       lock is busy (CLI only; a deferral, not a failure - the nightly chain retries)
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawnSync } = require('node:child_process');

const REPO = path.join(__dirname, '..', '..');
const SOUL = path.join(REPO, 'soul.md');
const PINS = path.join(REPO, 'system', 'soul-pins.json');
const OUT = path.join(REPO, 'soul-core.md');

const NEWEST_N = 20; // the recency slice
const MIN_ENTRIES = 12; // floor on the SELECTION from a corpus that holds at least this many entries
const WARN_BYTES = 60 * 1024; // honesty rail: warn (never refuse) if the card outgrows this

// Required operative headings (prefix match; suffixes like "(most to least)" vary).
const REQUIRED_HEADINGS = [
  '# Soul - Who I Am',
  '## Headless injection check',
  '## My Role',
  '## My Company/Business',
  '## Writing Style',
  '## How I Communicate',
  '## My Priorities',
  '## Agent Personality - Alex',
  '## Voice Rules',
  '## Things I Never Want',
  '## My Words'
];

const DATED_RE = /^###\s+(?:Harvested\s+)?(\d{4})-(\d{2})-(\d{2})/;

/**
 * Split soul.md into the operative layer, the end canary block and every dated entry.
 * @param {string} soulText the raw contents of soul.md
 * @returns {{ operative: string, endCanary: string, entries: Array<{heading: string, date: string, startLine: number, text: string}>, token: string }}
 * @throws {Error} a floor error when the canary token or the end canary block is missing or mismatched
 */
function parseSoul(soulText) {
  const lines = soulText.split(/\r?\n/);

  // Canary token from the top block.
  const tokenLine = lines.find((l) => l.startsWith('SOUL-CANARY-TOKEN:'));
  if (!tokenLine) throw new Error('floor: no SOUL-CANARY-TOKEN line in soul.md');
  const token = tokenLine.split(':')[1].trim();

  // Every dated entry: heading line index + parsed date; body runs to the next ###/## heading.
  // Zero entries is a legal state (a fresh /setup soul.md): the card is then the operative layer alone.
  const entries = [];
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(DATED_RE);
    if (!m) continue;
    let end = lines.length;
    for (let j = i + 1; j < lines.length; j++) {
      if (lines[j].startsWith('## ') || lines[j].startsWith('### ')) {
        end = j;
        break;
      }
    }
    entries.push({
      heading: lines[i],
      date: `${m[1]}-${m[2]}-${m[3]}`,
      startLine: i,
      text: lines.slice(i, end).join('\n').trimEnd()
    });
  }

  // End canary block: the SECOND "## Headless injection check" heading + lines to next heading.
  let endCanary = null;
  let endCanaryStart = lines.length;
  const canaryHeads = [];
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].startsWith('## Headless injection check')) canaryHeads.push(i);
  }
  if (canaryHeads.length >= 2) {
    const s = canaryHeads[canaryHeads.length - 1];
    let e = lines.length;
    for (let j = s + 1; j < lines.length; j++) {
      if (lines[j].startsWith('## ') || lines[j].startsWith('### ')) {
        e = j;
        break;
      }
    }
    endCanary = lines.slice(s, e).join('\n').trimEnd();
    endCanaryStart = s;
  }
  if (!endCanary) throw new Error('floor: end canary block (second "## Headless injection check") not found');
  if (!endCanary.includes(token)) throw new Error('floor: end canary block does not carry the same token');

  // Operative layer = line 0 through the line before the FIRST dated entry in file order. With no
  // entries yet it runs to the end canary block instead: assemble() appends that block on its own,
  // and letting it ride inside the operative slice as well would put the token in the card three times.
  const operativeEnd = entries.length ? Math.min(...entries.map((e) => e.startLine)) : endCanaryStart;
  const operative = lines.slice(0, operativeEnd).join('\n').trimEnd();

  return { operative, endCanary, entries, token };
}

/**
 * The newest NEWEST_N entries by parsed date, plus any entry a configured pin names that the recency
 * slice missed, logging a line for every pin outcome (bad regex, no match, already selected, added).
 * @param {Array<{heading: string, date: string, startLine: number, text: string}>} entries parseSoul()'s entries
 * @param {{ pins?: Array<{ register: string, match: string }> }} pinsCfg the parsed contents of system/soul-pins.json
 * @param {(line: string) => void} log where each pin outcome line goes
 * @returns {{ newest: typeof entries, pinned: Array<{ pin: { register: string, match: string }, entry: typeof entries[number] }> }}
 */
function selectEntries(entries, pinsCfg, log) {
  // Newest-first by PARSED DATE; same-date ties keep file order (newest-at-top rule).
  const sorted = entries
    .slice()
    .sort((a, b) => (a.date === b.date ? a.startLine - b.startLine : a.date < b.date ? 1 : -1));
  const newest = sorted.slice(0, NEWEST_N);
  const chosen = new Set(newest.map((e) => e.startLine));

  const pinned = [];
  for (const pin of pinsCfg.pins || []) {
    let re;
    try {
      re = new RegExp(pin.match, 'i');
    } catch (e) {
      log(`  pin '${pin.register}': BAD REGEX (${e.message}) - skipped`);
      continue;
    }
    const hit = sorted.find((en) => re.test(en.heading)); // sorted = newest first
    if (!hit) {
      log(`  pin '${pin.register}': no matching entry - skipped`);
      continue;
    }
    if (chosen.has(hit.startLine)) {
      log(`  pin '${pin.register}': already in the newest slice (${hit.date})`);
      continue;
    }
    chosen.add(hit.startLine);
    pinned.push({ pin, entry: hit });
    log(`  pin '${pin.register}': + ${hit.date} "${hit.heading.slice(4, 80)}"`);
  }
  return { newest, pinned };
}

/**
 * Join the operative layer, both canary blocks, any pinned entries and the newest entries into the
 * card, append the stamp, and refuse (throw, emitting nothing) a card that fails a floor check.
 * @param {{ operative: string, endCanary: string, token: string, entries?: Array<{heading: string, date: string, startLine: number, text: string}> }} parsed parseSoul()'s result
 * @param {{ newest: Array<{heading: string, date: string, startLine: number, text: string}>, pinned: Array<{ entry: {heading: string, date: string, startLine: number, text: string} }> }} selected selectEntries()'s result
 * @param {string} soulSha the sha256 of soul.md's raw bytes, hex-encoded
 * @param {string} [pinsSha] the first 8 hex characters of the sha256 of system/soul-pins.json's text
 * @returns {string} the assembled card
 * @throws {Error} a floor error naming which check failed
 */
function assemble({ operative, endCanary, token, entries = [] }, { newest, pinned }, soulSha, pinsSha = '00000000') {
  // Plain-text framing lines, NOT HTML comments: memory-file injection strips <!-- --> comments (the
  // model could see the card but not a commented stamp), and the stamp must be model-visible so an
  // injection proof can ask for it. Same class as SOUL-CANARY-TOKEN.
  const parts = [];
  parts.push(
    'SOUL-CORE NOTE: this file is GENERATED nightly from soul.md (scripts/lib/build-soul-core.js).',
    'Never hand-edit; edits die on the next rebuild. soul.md is the source of truth and the FULL',
    'corpus - gate-mandated re-reads still read soul.md itself. This card = operative layer +',
    'both canaries + pinned registers + the newest entries, stable-first for prompt-cache economy.',
    ''
  );
  parts.push(operative, '');
  parts.push(endCanary, '');
  if (pinned.length) {
    parts.push('PINNED REGISTERS (system/soul-pins.json, the relevance leg - these never age out of the card):', '');
    for (const { entry } of pinned) parts.push(entry.text, '');
  }
  parts.push(
    `NEWEST ${newest.length} ENTRIES by parsed heading date (recency slice, rebuilt nightly, newest first):`,
    ''
  );
  for (const e of newest) parts.push(e.text, '');
  parts.push(
    `SOUL-CORE-STAMP: source-sha256=${soulSha} pins-sha256=${pinsSha} generated-at=${new Date().toISOString()} entries=${newest.length} pinned=${pinned.length} token-count=2`
  );
  const card = parts.join('\n');

  // Floor checks on the ASSEMBLED card.
  for (const h of REQUIRED_HEADINGS) {
    if (!card.split('\n').some((l) => l.startsWith(h)))
      throw new Error(`floor: required heading missing from card: "${h}"`);
  }
  const tokenCount = card.split(`SOUL-CANARY-TOKEN: ${token}`).length - 1;
  if (tokenCount !== 2) throw new Error(`floor: canary token appears ${tokenCount}x in card, need exactly 2`);
  // The selection floor binds only once the corpus itself holds MIN_ENTRIES entries. With NEWEST_N
  // above MIN_ENTRIES it can only fire if someone lowers NEWEST_N; it stays because it is the contract
  // the stamp readers (C23) rely on for a grown corpus.
  if (entries.length >= MIN_ENTRIES && newest.length < MIN_ENTRIES) {
    throw new Error(
      `floor: only ${newest.length} entries selected from a corpus of ${entries.length}, need >= ${MIN_ENTRIES}`
    );
  }
  return card;
}

/**
 * git's answer for one path: true = ignored (exit 0), false = not ignored (exit 1); anything else
 * (not a repository, a path outside it) is a refusal, because "unknown" is not a privacy verdict.
 * @param {string} p an absolute path
 * @returns {{ rel: string, ignored: boolean }}
 * @throws {Error} privacy fail-closed when git's exit code is neither 0 nor 1
 */
function ignoreState(p) {
  const rel = path.relative(REPO, p).replace(/\\/g, '/');
  const r = spawnSync('git', ['check-ignore', '-q', rel], { cwd: REPO, encoding: 'utf8' });
  if (r.status === 0) return { rel, ignored: true };
  if (r.status === 1) return { rel, ignored: false };
  const why = r.error ? r.error.message : String(r.stderr || '').trim();
  throw new Error(
    `privacy fail-closed: cannot read the ignore state of '${rel}' (git check-ignore exit ${r.status}${why ? `: ${why}` : ''})`
  );
}

/**
 * Refuse (throw) when soul.md is gitignored but the output path is not: privacy fail-closed. Logs one
 * line naming both paths' tracked/gitignored state either way.
 * @param {string} outPath the card's absolute path
 * @param {string} [soulPath] soul.md's absolute path
 * @param {(line: string) => void} [log] where the privacy line goes
 * @throws {Error} when soul.md is gitignored and the output path is not
 */
function assertIgnored(outPath, soulPath = SOUL, log = () => {}) {
  const card = ignoreState(outPath);
  const soul = ignoreState(soulPath);
  if (soul.ignored && !card.ignored) {
    throw new Error(
      `privacy fail-closed: '${soul.rel}' is gitignored but output path '${card.rel}' is NOT - refusing to write identity content to a trackable path`
    );
  }
  const word = (s) => (s.ignored ? 'gitignored' : 'tracked');
  log(
    `  privacy: '${soul.rel}' ${word(soul)}, '${card.rel}' ${word(card)} - ` +
      (card.ignored ? 'the card stays local' : 'this repo tracks its own identity, by its own .gitignore')
  );
}

/**
 * Build soul-core.md from soulPath, or report a verified no-op or an intentional skip. Refuses (throws,
 * emitting nothing) rather than write a thin or malformed card; an existing card is left untouched on
 * refusal.
 * @param {{ log?: (line: string) => void, outPath?: string, soulPath?: string, pinsPath?: string, force?: boolean }} [opts]
 * @returns {{ skipped: true, reason: string } | { noop: true, bytes: number, sha: string } | { bytes: number, entries: number, pinned: number, sha: string }}
 * @throws {Error} a floor or privacy error; nothing is written
 */
function build({ log = () => {}, outPath = OUT, soulPath = SOUL, pinsPath = PINS, force = false } = {}) {
  // NO soul.md IS NOT A FAILURE. It is gitignored on purpose, so a fresh clone of the Kit has none
  // and neither does any install before /setup runs. An exit code that says FAILED when nothing
  // failed is an exit code people stop reading, and the update path leans on this one being honest.
  // Nothing is written and nothing existing is touched; the caller states the skip.
  if (!fs.existsSync(soulPath)) {
    const reason = 'no soul.md yet, so there is no card to build. /setup writes it.';
    log(`  soul-core: skipped - ${reason}`);
    return { skipped: true, reason };
  }

  const soulText = fs.readFileSync(soulPath, 'utf8');
  // Hash the RAW BYTES (not the decoded string): C23 recomputes with PowerShell Get-FileHash,
  // which hashes file bytes - both sides must use the same primitive.
  const soulSha = crypto.createHash('sha256').update(fs.readFileSync(soulPath)).digest('hex');
  const pinsText = fs.existsSync(pinsPath) ? fs.readFileSync(pinsPath, 'utf8') : '';
  const pinsSha = crypto.createHash('sha256').update(pinsText).digest('hex').slice(0, 8);

  // No-op guard: an unchanged source is a VERIFIED no-op, not a rewrite. Nightly runs with nothing new
  // leave the card byte-identical, so the prompt-cache prefix and the file mtime only move when the
  // corpus or the pin list actually moved.
  if (!force && fs.existsSync(outPath)) {
    const tail = fs.readFileSync(outPath, 'utf8').slice(-400);
    const m = tail.match(/source-sha256=([0-9a-f]{64}) pins-sha256=([0-9a-f]{8})/);
    if (m && m[1] === soulSha && m[2] === pinsSha) {
      log(`  soul-core: unchanged (soul.md sha ${soulSha.slice(0, 12)}.., pins ${pinsSha}) - verified no-op`);
      return { noop: true, bytes: fs.statSync(outPath).size, sha: soulSha };
    }
  }
  const pinsCfg = pinsText ? JSON.parse(pinsText) : { pins: [] };

  const parsed = parseSoul(soulText);
  log(`  soul.md: ${soulText.length} B, ${parsed.entries.length} dated entries, canary ${parsed.token.slice(0, 6)}..`);
  const sel = selectEntries(parsed.entries, pinsCfg, log);
  const card = assemble(parsed, sel, soulSha, pinsSha);

  assertIgnored(outPath, soulPath, log);
  if (card.length > WARN_BYTES) log(`  WARN: card is ${card.length} B (> ${WARN_BYTES}) - consider lowering NEWEST_N`);

  // Atomic: staging sibling + rename over the real path.
  const staging = `${outPath}.staging`;
  fs.writeFileSync(staging, card, 'utf8');
  fs.renameSync(staging, outPath);
  const readBack = fs.readFileSync(outPath, 'utf8');
  if (readBack !== card) throw new Error('read-back verify failed after swap');
  log(
    `  soul-core.md written: ${card.length} B (~${Math.round(card.length / 2.93 / 100) / 10}k tok est), ` +
      `${sel.newest.length} newest + ${sel.pinned.length} pinned, sha ${soulSha.slice(0, 12)}..`
  );
  return { bytes: card.length, entries: sel.newest.length, pinned: sel.pinned.length, sha: soulSha };
}

module.exports = { build, parseSoul, selectEntries, assemble, assertIgnored, ignoreState, NEWEST_N, MIN_ENTRIES, OUT };

if (require.main === module) {
  const log = (m) => console.log(m);
  // Warn, never refuse, on an unknown flag (EDGE-WARN; standard section 4: a hook edge warns, it never
  // refuses). args.js is required inside this try (3.6): this file runs as a SessionStart hook CLI, so
  // a load failure here must never crash the hook, only mean no warning prints. --force itself keeps
  // the hand check below unchanged.
  try {
    const { parseCommandLine } = require('./args');
    parseCommandLine({ name: 'build-soul-core', edge: 'hook', options: { force: { type: 'boolean' } } });
  } catch {
    // a Refusal for a known flag used oddly is not this program's to surface, and a failed require
    // degrades to silence, never a crash
  }
  const writeLock = require('./write-lock');
  const held = writeLock.acquire({ label: 'build-soul-core (nightly)', log });
  if (!held.ok) {
    // DEFER (nightly semantics): a busy lock means another mutator is mid-run; yesterday's card
    // stays, the next night (or the generator run holding the lock) rebuilds. C23 catches real staleness.
    console.log(`build-soul-core: deferred - ${held.reason}`);
    process.exit(2);
  }
  try {
    const r = build({ log, force: process.argv.includes('--force') });
    if (r?.skipped) console.log(`build-soul-core: skipped - ${r.reason}`);
    process.exitCode = 0; // NOT process.exit(): that would skip the finally and leak the lock
  } catch (e) {
    console.error(`build-soul-core FAILED (no emit, existing card untouched): ${e.message}`);
    process.exitCode = 1;
  } finally {
    held.release();
  }
}
