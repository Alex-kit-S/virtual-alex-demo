'use strict';
/*
 * scripts/status-rotate.js - S1 Compiled Surfaces Phase 2 (2026-08-16): put Tier-1 back on its
 * summary contract. Any vault/projects/<name>/status.md over meta.vault.status_byte_budget moves
 * its OLDEST dated H2 blocks to vault/projects/<name>/history/status-YYYY.md until it fits.
 *
 * Laws:
 *  - HEADING-BLOCK-ATOMIC: a block = one `## ` heading + everything to the next `## `. The BM25
 *    chunker is heading-based and supersession corrections are written INLINE in the same block,
 *    so a block always moves whole - a correction can never be separated from the fact it corrects.
 *  - MOVABLE = an H2 whose heading line carries a parseable YYYY-MM-DD date. Frontmatter, the H1
 *    preamble, and undated H2s (standing content) NEVER move. The newest dated block is kept even
 *    if the file stays over budget (C24 then ambers honestly - a giant newest block is a human
 *    problem, not a rotation problem).
 *  - NOTHING IS DELETED. Journal row (system/status-rotate-journal.jsonl) BEFORE each move;
 *    [[links]] both ways; history files are append-only archives.
 *  - Shared write-lock (scripts/lib/write-lock.js), DEFER when busy (exit 2) - nightly semantics.
 *  - Verify-after-write: every moved heading must be present in history and absent from status,
 *    read back from disk, else exit 1 loudly.
 *
 * Usage:
 *   node scripts/status-rotate.js --dry            report what would move, touch nothing
 *   node scripts/status-rotate.js                  rotate every over-budget status.md
 *   node scripts/status-rotate.js --project=NAME   limit to one vault/projects/<NAME>
 */
const fs = require('fs');
const path = require('path');

const REPO = path.join(__dirname, '..');
const MANIFEST = path.join(REPO, 'system', 'manifest.json');
const JOURNAL = path.join(REPO, 'system', 'status-rotate-journal.jsonl');
const DRY = process.argv.includes('--dry');
const onlyArg = process.argv.find(a => a.startsWith('--project='));
const ONLY = onlyArg ? onlyArg.split('=')[1] : null;

const DATE_RE = /\b(20\d{2}-\d{2}-\d{2})\b/;

function splitBlocks(text) {
  // Returns { head, blocks: [{heading, body, date|null, bytes}] } - head = frontmatter + preamble.
  const lines = text.split('\n');
  const idx = [];
  for (let i = 0; i < lines.length; i++) if (lines[i].startsWith('## ')) idx.push(i);
  if (idx.length === 0) return { head: text, blocks: [] };
  const head = lines.slice(0, idx[0]).join('\n');
  const blocks = [];
  for (let b = 0; b < idx.length; b++) {
    const start = idx[b], end = b + 1 < idx.length ? idx[b + 1] : lines.length;
    const heading = lines[start];
    const chunk = lines.slice(start, end).join('\n');
    const m = heading.match(DATE_RE);
    blocks.push({ heading, body: chunk, date: m ? m[1] : null, bytes: Buffer.byteLength(chunk) });
  }
  return { head, blocks };
}

function historyPathFor(projDir, date) {
  return path.join(projDir, 'history', `status-${date.slice(0, 4)}.md`);
}

function ensureHistoryFile(hPath, projName) {
  if (fs.existsSync(hPath)) return;
  fs.mkdirSync(path.dirname(hPath), { recursive: true });
  const year = path.basename(hPath).match(/status-(\d{4})/)[1];
  fs.writeFileSync(hPath,
    `---\ntags: [project, ${projName}, history, archive]\ncreated: ${new Date().toISOString().slice(0, 10)}\n---\n\n` +
    `# ${projName} - status history ${year}\n\n` +
    `Rotated whole dated blocks from [[projects/${projName}/status]] (scripts/status-rotate.js, ` +
    `oldest-first, heading-block-atomic, journaled). Append-only; blocks are verbatim.\n`, 'utf8');
}

function journal(row) {
  fs.appendFileSync(JOURNAL, JSON.stringify(row) + '\n', 'utf8');
}

function rotateFile(projName, statusPath, budget, log) {
  const before = fs.readFileSync(statusPath, 'utf8');
  const size = Buffer.byteLength(before);
  if (size <= budget) return { rotated: 0, size, after: size };

  const { head, blocks } = splitBlocks(before);
  const movable = blocks.filter(b => b.date).sort((a, b) => a.date < b.date ? -1 : 1); // oldest first
  const moves = [];
  let projected = size;
  for (const blk of movable) {
    if (projected <= budget) break;
    if (movable.length - moves.length <= 1) break; // always keep the newest dated block
    moves.push(blk);
    projected -= blk.bytes;
  }
  if (moves.length === 0) {
    log(`  ${projName}: ${size} B over budget but nothing movable (undated or single dated block) - C24 will amber`);
    return { rotated: 0, size, after: size };
  }
  log(`  ${projName}: ${size} B -> ~${projected} B, moving ${moves.length} block(s): ${moves.map(m => m.date).join(', ')}`);
  if (DRY) {
    for (const m of moves) log(`    would move: ${m.heading.slice(0, 100)}`);
    return { rotated: moves.length, size, after: projected, dry: true };
  }

  const projDir = path.dirname(statusPath);
  // 1. journal BEFORE any mutation
  for (const m of moves) {
    journal({ ts: new Date().toISOString(), project: projName, date: m.date, bytes: m.bytes,
              heading: m.heading, to: path.relative(REPO, historyPathFor(projDir, m.date)).replace(/\\/g, '/') });
  }
  // 2. append to history files (grouped by year, chronological within the append)
  const byFile = new Map();
  for (const m of moves) {
    const hp = historyPathFor(projDir, m.date);
    if (!byFile.has(hp)) byFile.set(hp, []);
    byFile.get(hp).push(m);
  }
  for (const [hp, ms] of byFile) {
    ensureHistoryFile(hp, projName);
    fs.appendFileSync(hp, '\n' + ms.map(m => m.body.trimEnd()).join('\n\n') + '\n', 'utf8');
  }
  // 3. rewrite status.md without the moved blocks + ensure the History pointer section
  const movedSet = new Set(moves.map(m => m.heading));
  const kept = blocks.filter(b => !movedSet.has(b.heading));
  const years = [...new Set(moves.map(m => m.date.slice(0, 4)))].sort();
  let histSection = kept.find(b => b.heading.startsWith('## History (rotated'));
  const histLinks = years.map(y => `- [[projects/${projName}/history/status-${y}]]`).join('\n');
  let out = head.trimEnd() + '\n\n' + kept.filter(b => !b.heading.startsWith('## History (rotated'))
    .map(b => b.body.trimEnd()).join('\n\n') + '\n';
  const existingLinks = histSection ? histSection.body : '';
  const allYears = new Set(years);
  if (existingLinks) for (const m of existingLinks.matchAll(/status-(\d{4})/g)) allYears.add(m[1]);
  out += `\n## History (rotated archives)\n\nOlder dated blocks live in append-only yearly archives (moved whole by scripts/status-rotate.js, journaled):\n` +
    [...allYears].sort().map(y => `- [[projects/${projName}/history/status-${y}]]`).join('\n') + '\n';
  fs.writeFileSync(statusPath + '.staging', out, 'utf8');
  fs.renameSync(statusPath + '.staging', statusPath);

  // 4. verify-after-write from disk
  const after = fs.readFileSync(statusPath, 'utf8');
  for (const m of moves) {
    const hp = historyPathFor(projDir, m.date);
    const hText = fs.readFileSync(hp, 'utf8');
    if (!hText.includes(m.heading)) throw new Error(`VERIFY FAIL: "${m.heading.slice(0, 60)}" missing from ${hp}`);
    if (after.includes(m.heading)) throw new Error(`VERIFY FAIL: "${m.heading.slice(0, 60)}" still in ${statusPath}`);
  }
  const newSize = Buffer.byteLength(after);
  log(`    rotated + verified: ${size} -> ${newSize} B (${moves.length} blocks to history/)`);
  return { rotated: moves.length, size, after: newSize };
}

function main(log = console.log) {
  const manifest = JSON.parse(fs.readFileSync(MANIFEST, 'utf8'));
  const budget = manifest.meta.vault && manifest.meta.vault.status_byte_budget;
  if (!budget) throw new Error('meta.vault.status_byte_budget missing from manifest');
  const targets = [];
  const seen = new Set();
  const rows = [...manifest.projects, ...(manifest.meta.unnumbered || [])];
  for (const p of rows) {
    if (!p.status_md) continue;
    const sp = path.join(REPO, p.status_md.replace(/\//g, path.sep));
    if (!fs.existsSync(sp) || seen.has(sp)) continue;
    seen.add(sp);
    const name = path.basename(path.dirname(sp));
    if (ONLY && name !== ONLY) continue;
    targets.push({ name, sp });
  }
  let total = 0;
  for (const t of targets) {
    const r = rotateFile(t.name, t.sp, budget, log);
    total += r.rotated || 0;
  }
  log(`status-rotate: ${DRY ? '(dry) ' : ''}${total} block(s) ${DRY ? 'would move' : 'moved'} across ${targets.length} status file(s), budget ${budget} B`);
  return total;
}

if (require.main === module) {
  const writeLock = require('./lib/write-lock');
  const held = writeLock.acquire({ label: 'status-rotate' });
  if (!held.ok) { console.log(`status-rotate: deferred - ${held.reason}`); process.exit(2); }
  try { main(); process.exitCode = 0; }
  catch (e) { console.error(`status-rotate FAILED: ${e.message}`); process.exitCode = 1; }
  finally { held.release(); }
}
module.exports = { splitBlocks, rotateFile, main };
