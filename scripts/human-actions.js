#!/usr/bin/env node
/*
 * human-actions.js - the "Waiting on you" queue (upgrade P2, 2026-07-12, design 1.2 / plan Phase 2).
 * Tracks the items ONLY the owner can do, so they age visibly instead of evaporating.
 *
 * Store: system/human-actions.jsonl - append-only JSONL, GITIGNORED (MR2-1: rows may carry
 * personal context; the encrypted vault backup covers it because that set derives from .gitignore).
 * Rows are POINTER-STYLE: never a person's name, point at the vault page instead.
 *
 * Row shapes:
 *   open row:  {id, what, why_only_you, severity: "critical"|"high"|"medium"|"low", created, due?}
 *   done row:  {id, done: true, done_date}            (append-only close, latest-per-id wins)
 *
 * Commands:
 *   add --id X --what "..." --why "..." --severity high [--created YYYY-MM-DD] [--due YYYY-MM-DD]
 *   done <id>                 append the close row ("done: <id>" from the owner -> Alex runs this)
 *   list                      open items with ages (the brief/status/self-review surface)
 *   sessionline               ONE line if any open item is 7+ days old, else SILENT
 *                             (SessionStart hook; stdout is injected context, silence is the default)
 *   summary                   {open_count, oldest_days, worst_severity, headline} JSON for the HQ push
 */

const fs = require('fs');
const path = require('path');

const FILE = path.join(__dirname, '..', 'system', 'human-actions.jsonl');
const SEV_ORDER = { critical: 0, high: 1, medium: 2, low: 3 };

// --- Class A single-source-of-truth gate (2026-07-21, audit F-01) ------------------------------
// The escrow queue items may only close when the attestation FILE actually proves escrow works.
// This makes "queue says done, attestation says FAILED" (the 2026-07-18 contradiction) impossible:
// a `done` on these ids is refused unless work/18-recovery-layer/state/passphrase-attested.txt
// carries a real yyyy-MM-dd first line (not "PENDING"/malformed). escrow-test.ps1 is the ONE writer
// of that file and, on a PASS, stamps the date THEN closes these ids in the same run, so the honest
// close path is automatic and the manual one is gated. Deliberate bypass: append the done row by hand.
const ATTEST_GATED = new Set(['passphrase-attestation', 'passphrase-escrow-retest', 'passphrase-safeplace-fix']);
const ATTEST_FILE = path.join(__dirname, '..', 'work', '18-recovery-layer', 'state', 'passphrase-attested.txt');

function attestationIsProven() {
  try {
    const first = (fs.readFileSync(ATTEST_FILE, 'utf8').split('\n')[0] || '').trim();
    return /^\d{4}-\d{2}-\d{2}\b/.test(first);   // a real dated attestation, not PENDING / malformed
  } catch (_) { return false; }
}

function load() {
  if (!fs.existsSync(FILE)) return [];
  const byId = new Map();
  for (const line of fs.readFileSync(FILE, 'utf8').split('\n')) {
    const t = line.trim();
    if (!t) continue;
    let row;
    try { row = JSON.parse(t); } catch (_) { continue; }
    if (row.done) { const prev = byId.get(row.id); if (prev) prev.done = row.done_date || true; }
    else byId.set(row.id, { ...row });
  }
  return [...byId.values()];
}

function openItems() {
  return load().filter(r => !r.done).sort((a, b) =>
    (SEV_ORDER[a.severity] ?? 9) - (SEV_ORDER[b.severity] ?? 9) || a.created.localeCompare(b.created));
}

function ageDays(created) {
  return Math.floor((Date.now() - new Date(created + 'T00:00:00').getTime()) / 86400000);
}

function append(obj) {
  fs.appendFileSync(FILE, JSON.stringify(obj) + '\n', 'utf8');
  // verify-after-write: the row must be the file's last parseable line
  const lines = fs.readFileSync(FILE, 'utf8').trim().split('\n');
  const last = JSON.parse(lines[lines.length - 1]);
  if (last.id !== obj.id) { console.error('human-actions: append verify FAILED'); process.exit(1); }
}

function arg(name) {
  const i = process.argv.indexOf('--' + name);
  return i > -1 ? process.argv[i + 1] : undefined;
}

const cmd = process.argv[2];
const today = new Date().toISOString().slice(0, 10);

if (cmd === 'add') {
  const row = { id: arg('id'), what: arg('what'), why_only_you: arg('why'),
    severity: arg('severity') || 'medium', created: arg('created') || today };
  if (arg('due')) row.due = arg('due');
  if (!row.id || !row.what) { console.error('add needs --id and --what'); process.exit(1); }
  if (openItems().some(r => r.id === row.id)) { console.error(`open item '${row.id}' already exists`); process.exit(1); }
  append(row);
  console.log(`queued: ${row.id} (${row.severity})`);
} else if (cmd === 'done') {
  const id = process.argv[3];
  if (!openItems().some(r => r.id === id)) { console.error(`no open item '${id}'`); process.exit(1); }
  // Class A gate: an escrow item cannot be closed while the attestation file is unproven (F-01).
  if (ATTEST_GATED.has(id) && !attestationIsProven()) {
    console.error(`refusing to close '${id}': ${ATTEST_FILE} is not a fresh dated attestation (first line must be yyyy-MM-dd, not PENDING).`);
    console.error(`Run the escrow drill: powershell -File work/18-recovery-layer/escrow-test.ps1 - it stamps the attestation and closes this item on PASS.`);
    process.exit(1);
  }
  append({ id, done: true, done_date: today });
  console.log(`closed: ${id}`);
} else if (cmd === 'list') {
  const items = openItems();
  if (!items.length) { console.log('Waiting on you: nothing. Queue is empty.'); process.exit(0); }
  console.log(`Waiting on you (${items.length}):`);
  for (const r of items) {
    const due = r.due ? ` | due ${r.due}` : '';
    console.log(`- [${r.severity.toUpperCase()}] ${r.id} (${ageDays(r.created)}d): ${r.what}${due}`);
  }
  console.log(`Close one with: node scripts/human-actions.js done <id>  (or tell Alex "done: <id>")`);
} else if (cmd === 'sessionline') {
  const aged = openItems().filter(r => ageDays(r.created) >= 7);
  if (aged.length) {
    const oldest = Math.max(...aged.map(r => ageDays(r.created)));
    console.log(`WAITING ON YOU: ${aged.length} item(s) only you can do, oldest ${oldest}d (say "waiting list" for the queue).`);
  } // else: silent by design
} else if (cmd === 'summary') {
  const items = openItems();
  const oldest = items.length ? Math.max(...items.map(r => ageDays(r.created))) : 0;
  const worst = items.length ? items[0].severity : 'none';
  const top = items[0];
  console.log(JSON.stringify({ open_count: items.length, oldest_days: oldest, worst_severity: worst,
    headline: top ? `${top.what.slice(0, 80)} (${ageDays(top.created)}d)` : 'queue empty' }));
} else {
  console.error('usage: human-actions.js add|done|list|sessionline|summary');
  process.exit(1);
}
