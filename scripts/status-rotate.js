#!/usr/bin/env node
// @ts-check
// scripts/status-rotate.js - moves the oldest dated blocks of an over-budget status page into its yearly history.
//
// WHAT. A project's status.md is its summary: the page everyone reads first. Run notes pile up in it as dated
// sections until it stops being one. For every status page the manifest lists over meta.vault.status_byte_budget,
// this moves the oldest dated blocks, word for word, into vault/projects/<name>/history/status-<year>.md and ends
// status.md with a History section linking every year moved. Nothing is deleted.
//
// HOW. A block is one `## ` heading line and every line up to the next one. Blocks move whole: the vault search chunks
// by heading, and a correction lives inside the block it corrects. A block is movable when its heading line carries a
// date (the first YYYY-MM-DD on it). The frontmatter, the preamble and undated blocks never move, and the newest dated
// block stays when the page is still over budget, which the laptop's recovery check C24 (check.ps1) reports. Movable blocks go oldest first until
// the projected size fits. For each page it appends one row per block to system/status-rotate-journal.jsonl before any
// other write, appends the blocks to their year's history file, writes status.md through a .staging file and a rename,
// and reads both back from disk. The History section goes last, under `## History (rotated archives)`; the next run
// rewrites the last block headed exactly that, carrying its year links, and keeps every other block, an owner's `##
// History (rotated ...)` included. The read-back works out from the page as read which blocks stayed, and needs each
// whole in status.md, every moved heading in its history file, and each moved heading's text in status.md no more than
// kept blocks carry it. --dry prints the plan and writes nothing. --project NAME or --project=NAME limits the run to one
// vault/projects/<NAME> folder: the first one given counts, one with no word or a flag after it is skipped, and an empty
// --project= limits nothing. --dry and --project keep their own rules above: scripts/lib/args.js's strict pass would
// refuse what this file quietly skips instead, so warnUnknownFlags uses it only for the unknown-flag warning and
// discards the rest. The run holds scripts/lib/write-lock.js; both it and args.js load only when the file runs as a
// command, so requiring the module pulls in nothing (test-recall-online-closure.mjs).
//
// NEVER. Deletes a block. The keep and the stayed check go by block, not by heading text, because a block that shared
// its heading with a moved one was once dropped from both files while the run printed "rotated + verified", and so
// was every `## History (rotated ...)` block but the first (SR-D1). Waits for the lock: a held lock defers the run
// with exit 2 and `status-rotate: deferred - <reason>`, which close-out-online.sh reads as deferred. Lets args.js's
// own wording or exit code reach a caller: EDGE-WARN warns once and swallows the rest. Carries on after an error: the
// first ends the run with exit 1 and one FAILED line on stderr, the lock released. Changes its last stdout line,
// `status-rotate: ...`, which close-out-online.sh prints and run-job.mjs and run-vault-index.ps1 find by that prefix.
// Fixes in passing a defect test-status-rotate-ledger.mjs pins: the "still in" count reads a moved heading's text
// anywhere in status.md, so a kept heading it prefixes or a kept body quoting it fails a run whose writes all
// landed; --project=a=b names a; a `## ` line in a code fence starts a block.
//
// contract: read as text by scripts/tests/test-status-rotate-ledger.mjs:573 (Usage vs FLAGS).
// Usage: node scripts/status-rotate.js [--dry] [--project NAME | --project=NAME]
// Exit: 0 ran, moved or not - 1 failed (no byte budget, an unreadable file, a failed read-back) - 2 deferred, lock held
'use strict';

const fs = require('node:fs');
const path = require('node:path');

const REPO = path.join(__dirname, '..');
const MANIFEST = path.join(REPO, 'system', 'manifest.json');
const JOURNAL = path.join(REPO, 'system', 'status-rotate-journal.jsonl');
// The one flag table both readCommandLine/projectArg's own rules and warnUnknownFlags below answer to:
// a flag added to or dropped from this program's own set is a change in one place.
/** @type {Record<string, { type: 'string' | 'boolean' }>} */
const FLAGS = { dry: { type: 'boolean' }, project: { type: 'string' } };
/** The first date on a heading line: the block's date, and what makes it movable. */
const DATE_RE = /\b(20\d{2}-\d{2}-\d{2})\b/;
/** The heading of the History section this file writes; the next run finds its own section by it. */
const HISTORY_SECTION = '## History (rotated archives)';
/** How much of a heading a dry run's plan prints. */
const PLAN_HEADING_WIDTH = 100;
/** How much of a heading a failed read-back names. */
const FAILURE_HEADING_WIDTH = 60;

/**
 * @typedef {{ heading: string, body: string, date: string | null, bytes: number }} Block
 * @typedef {Block & { date: string }} DatedBlock
 * @typedef {{ rotated: number, size: number, after: number, dry?: true }} Rotation
 */

/**
 * What a command line asks for: a dry run, and the one project folder to limit the run to.
 * @param {string[]} args the arguments after the script's path
 * @returns {{ dry: boolean, only: string | null }}
 */
function readCommandLine(args) {
  return { dry: args.includes('--dry'), only: projectArg(args) };
}

/**
 * The folder --project names, as `--project=NAME` or `--project NAME`; the first one given wins. A --project
 * with no word after it, or with a flag after it, is skipped; an empty --project= ends the search and names
 * none.
 * @param {string[]} args
 * @returns {string | null}
 */
function projectArg(args) {
  for (let i = 0; i < args.length; i++) {
    if (args[i].startsWith('--project=')) return args[i].split('=')[1];
    if (args[i] === '--project' && i + 1 < args.length && !args[i + 1].startsWith('-')) return args[i + 1];
  }
  return null;
}

/**
 * Print one WARNING line on stderr for every flag that is neither --dry nor --project, and carry on: a Routine
 * edge never refuses one. --dry and --project keep readCommandLine's and projectArg's own rules
 * above; scripts/lib/args.js's strict pass would refuse a bare --project or one followed by another flag, which
 * this file quietly skips instead, so its parsed values are never read and a Refusal it raises for
 * either flag used oddly is swallowed here, never shown to a caller.
 * @param {string[]} args
 */
function warnUnknownFlags(args) {
  const { parseCommandLine } = require('./lib/args');
  const { Refusal } = require('./lib/errors');
  try {
    parseCommandLine({
      name: 'status-rotate',
      edge: 'routine',
      options: FLAGS,
      allowPositionals: false,
      argv: args
    });
  } catch (error) {
    if (!(error instanceof Refusal)) throw error;
  }
}

/**
 * A page's head (its frontmatter and preamble) and its `## ` blocks, each with the first date on its heading
 * line, or null, and its size in UTF-8 bytes. A page with no `## ` line is all head.
 * @param {string} text
 * @returns {{ head: string, blocks: Block[] }}
 */
function splitBlocks(text) {
  const lines = text.split('\n');
  /** @type {number[]} */
  const starts = [];
  lines.forEach((line, i) => {
    if (line.startsWith('## ')) starts.push(i);
  });
  if (starts.length === 0) return { head: text, blocks: [] };
  const blocks = starts.map((start, b) => {
    const heading = lines[start];
    const body = lines.slice(start, starts[b + 1] ?? lines.length).join('\n');
    const dated = heading.match(DATE_RE);
    return { heading, body, date: dated ? dated[1] : null, bytes: Buffer.byteLength(body) };
  });
  return { head: lines.slice(0, starts[0]).join('\n'), blocks };
}

/**
 * The blocks to move, oldest dated block first, until the page's projected size fits the budget, and that
 * projected size. The newest dated block is never one of them.
 * @param {Block[]} blocks
 * @param {number} size the page's size in bytes
 * @param {number} budget
 * @returns {{ moves: DatedBlock[], projected: number }}
 */
function planMoves(blocks, size, budget) {
  const movable = /** @type {DatedBlock[]} */ (blocks.filter((b) => b.date)).sort((a, b) => (a.date < b.date ? -1 : 1));
  /** @type {DatedBlock[]} */
  const moves = [];
  let projected = size;
  for (const block of movable) {
    if (projected <= budget || movable.length - moves.length <= 1) break;
    moves.push(block);
    projected -= block.bytes;
  }
  return { moves, projected };
}

/**
 * A heading as a failed read-back names it: quoted, and cut to FAILURE_HEADING_WIDTH characters.
 * @param {Block} block
 */
function named(block) {
  return `"${block.heading.slice(0, FAILURE_HEADING_WIDTH)}"`;
}

/**
 * The history file a block dated `date` moves to.
 * @param {string} projDir
 * @param {string} date
 */
function historyPathFor(projDir, date) {
  return path.join(projDir, 'history', `status-${date.slice(0, 4)}.md`);
}

/**
 * Create a year's history file with its frontmatter, title and link back to status.md, once.
 * @param {string} hPath
 * @param {string} projName
 * @param {string} year
 */
function ensureHistoryFile(hPath, projName, year) {
  if (fs.existsSync(hPath)) return;
  fs.mkdirSync(path.dirname(hPath), { recursive: true });
  const created = new Date().toISOString().slice(0, 10);
  fs.writeFileSync(
    hPath,
    `---\ntags: [project, ${projName}, history, archive]\ncreated: ${created}\n---\n\n` +
      `# ${projName} - status history ${year}\n\n` +
      `Rotated whole dated blocks from [[projects/${projName}/status]] (scripts/status-rotate.js, ` +
      'oldest-first, heading-block-atomic, journaled). Append-only; blocks are verbatim.\n',
    'utf8'
  );
}

/**
 * One journal row per block, written before anything else changes, so an interrupted run leaves a record.
 * @param {string} projName
 * @param {string} projDir
 * @param {DatedBlock[]} moves
 */
function journalMoves(projName, projDir, moves) {
  for (const m of moves) {
    const to = path.relative(REPO, historyPathFor(projDir, m.date)).replace(/\\/g, '/');
    const row = {
      ts: new Date().toISOString(),
      project: projName,
      date: m.date,
      bytes: m.bytes,
      heading: m.heading,
      to
    };
    fs.appendFileSync(JOURNAL, `${JSON.stringify(row)}\n`, 'utf8');
  }
}

/**
 * Append the moved blocks to their years' history files, in the order they move, one group per file.
 * @param {string} projName
 * @param {string} projDir
 * @param {DatedBlock[]} moves
 */
function appendToHistory(projName, projDir, moves) {
  /** @type {Map<string, DatedBlock[]>} */
  const byFile = new Map();
  for (const m of moves) {
    const hPath = historyPathFor(projDir, m.date);
    const group = byFile.get(hPath);
    if (group) group.push(m);
    else byFile.set(hPath, [m]);
  }
  for (const [hPath, group] of byFile) {
    ensureHistoryFile(hPath, projName, group[0].date.slice(0, 4));
    fs.appendFileSync(hPath, `\n${group.map((m) => m.body.trimEnd()).join('\n\n')}\n`, 'utf8');
  }
}

/**
 * The History section an earlier run wrote, if the page still has one: the LAST block headed exactly
 * HISTORY_SECTION, because a run writes its section under that heading after every other block. Every other
 * block is the owner's, a `## History (rotated ...)` block they wrote or copied included.
 * @param {Block[]} blocks
 * @returns {Block | undefined}
 */
function writtenSection(blocks) {
  return blocks.filter((b) => b.heading.trimEnd() === HISTORY_SECTION).at(-1);
}

/**
 * The new status.md: the head, every kept block but the History section an earlier run wrote, then a new
 * History section linking every year moved now or listed in that one.
 * @param {string} projName
 * @param {string} head
 * @param {Block[]} kept
 * @param {DatedBlock[]} moves
 */
function statusText(projName, head, kept, moves) {
  const years = new Set(moves.map((m) => m.date.slice(0, 4)));
  const history = writtenSection(kept);
  if (history) for (const link of history.body.matchAll(/status-(\d{4})/g)) years.add(link[1]);
  const blocks = kept.filter((b) => b !== history).map((b) => b.body.trimEnd());
  const links = [...years].sort().map((y) => `- [[projects/${projName}/history/status-${y}]]`);
  return (
    `${head.trimEnd()}\n\n${blocks.join('\n\n')}\n` +
    `\n${HISTORY_SECTION}\n\nOlder dated blocks live in append-only yearly archives ` +
    `(moved whole by scripts/status-rotate.js, journaled):\n${links.join('\n')}\n`
  );
}

/**
 * Read both files back from disk and throw if a block of the page as it was read, other than a moved one or
 * the History section an earlier run wrote, is not whole in status.md; if a moved heading is missing from its
 * history file; or if a moved heading's text is in status.md more often than the blocks that stayed carry
 * it. The blocks that stayed are worked out here from the page, not taken from the writer, so a wrong keep
 * is caught.
 * @param {string} statusPath
 * @param {string} projDir
 * @param {Block[]} blocks every block of the page as it was read
 * @param {DatedBlock[]} moves
 * @returns {string} status.md as it now stands
 */
function verifyRotation(statusPath, projDir, blocks, moves) {
  const after = fs.readFileSync(statusPath, 'utf8');
  /** @type {Set<Block>} */
  const moved = new Set(moves);
  const unmoved = blocks.filter((b) => !moved.has(b));
  const rewritten = writtenSection(unmoved);
  const stayed = unmoved.filter((b) => b !== rewritten);
  for (const b of stayed) {
    if (!after.includes(b.body.trimEnd())) throw new Error(`VERIFY FAIL: ${named(b)} missing from ${statusPath}`);
  }
  for (const m of moves) {
    const hPath = historyPathFor(projDir, m.date);
    if (!fs.readFileSync(hPath, 'utf8').includes(m.heading))
      throw new Error(`VERIFY FAIL: ${named(m)} missing from ${hPath}`);
    const keptUnder = stayed.filter((b) => b.heading === m.heading).length;
    if (after.split(m.heading).length - 1 > keptUnder)
      throw new Error(`VERIFY FAIL: ${named(m)} still in ${statusPath}`);
  }
  return after;
}

/**
 * Bring one status page back under the budget, or on a dry run say what would move. Returns how many blocks
 * moved and the page's size before and after (projected, on a dry run).
 * @param {string} projName the project folder's name, as the log lines and the history links write it
 * @param {string} statusPath
 * @param {number} budget
 * @param {(line: string) => void} log
 * @param {{ dry?: boolean }} [options]
 * @returns {Rotation}
 */
function rotateFile(projName, statusPath, budget, log, { dry = false } = {}) {
  const before = fs.readFileSync(statusPath, 'utf8');
  const size = Buffer.byteLength(before);
  if (size <= budget) return { rotated: 0, size, after: size };

  const { head, blocks } = splitBlocks(before);
  const { moves, projected } = planMoves(blocks, size, budget);
  if (moves.length === 0) {
    log(`  ${projName}: ${size} B over budget but nothing movable (undated or single dated block) - C24 will amber`);
    return { rotated: 0, size, after: size };
  }
  const dates = moves.map((m) => m.date).join(', ');
  log(`  ${projName}: ${size} B -> ~${projected} B, moving ${moves.length} block(s): ${dates}`);
  if (dry) {
    for (const m of moves) log(`    would move: ${m.heading.slice(0, PLAN_HEADING_WIDTH)}`);
    return { rotated: moves.length, size, after: projected, dry: true };
  }

  const projDir = path.dirname(statusPath);
  journalMoves(projName, projDir, moves);
  appendToHistory(projName, projDir, moves);
  /** @type {Set<Block>} */
  const moved = new Set(moves);
  const kept = blocks.filter((b) => !moved.has(b));
  fs.writeFileSync(`${statusPath}.staging`, statusText(projName, head, kept, moves), 'utf8');
  fs.renameSync(`${statusPath}.staging`, statusPath);

  const newSize = Buffer.byteLength(verifyRotation(statusPath, projDir, blocks, moves));
  log(`    rotated + verified: ${size} -> ${newSize} B (${moves.length} blocks to history/)`);
  return { rotated: moves.length, size, after: newSize };
}

/**
 * Rotate every over-budget status page the manifest lists, once each, and log the summary line last.
 * Returns the number of blocks moved, or that would move on a dry run.
 * @param {(line: string) => void} [log]
 * @param {{ dry?: boolean, only?: string | null }} [options] only: the one vault/projects folder to rotate
 * @returns {number}
 */
function main(log = console.log, { dry = false, only = null } = {}) {
  const manifest = JSON.parse(fs.readFileSync(MANIFEST, 'utf8'));
  const budget = manifest.meta.vault?.status_byte_budget;
  if (!budget) throw new Error('meta.vault.status_byte_budget missing from manifest');
  /** @type {{ name: string, statusPath: string }[]} */
  const targets = [];
  const seen = new Set();
  // The spread and the replace stay written this way: a malformed manifest's error names these expressions.
  const rows = [...manifest.projects, ...(manifest.meta.unnumbered || [])];
  for (const p of rows) {
    if (!p.status_md) continue;
    const statusPath = path.join(REPO, p.status_md.replace(/\//g, path.sep));
    if (!fs.existsSync(statusPath) || seen.has(statusPath)) continue;
    seen.add(statusPath);
    const name = path.basename(path.dirname(statusPath));
    if (only && name !== only) continue;
    targets.push({ name, statusPath });
  }
  let total = 0;
  for (const t of targets) total += rotateFile(t.name, t.statusPath, budget, log, { dry }).rotated;
  const [mark, verb] = dry ? ['(dry) ', 'would move'] : ['', 'moved'];
  log(`status-rotate: ${mark}${total} block(s) ${verb} across ${targets.length} status file(s), budget ${budget} B`);
  return total;
}

if (require.main === module) {
  const writeLock = require('./lib/write-lock');
  const held = writeLock.acquire({ label: 'status-rotate' });
  if (!held.ok) {
    console.log(`status-rotate: deferred - ${held.reason}`);
    process.exit(2);
  }
  try {
    warnUnknownFlags(process.argv.slice(2));
    main(console.log, readCommandLine(process.argv.slice(2)));
    process.exitCode = 0;
  } catch (error) {
    console.error(`status-rotate FAILED: ${/** @type {Error} */ (error).message}`);
    process.exitCode = 1;
  } finally {
    held.release();
  }
}

module.exports = { splitBlocks, rotateFile, main };
