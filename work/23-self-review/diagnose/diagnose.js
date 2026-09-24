#!/usr/bin/env node
/*
 * diagnose.js - instruction attribution for #23 self-review (2026-07-15, /prompting item 4).
 *
 * #22 captures THAT Alex was wrong; #23 clusters the corrections; neither asks WHICH instruction
 * caused the error, so corrections treat symptoms and the same class returns wearing new clothes.
 * Diagnose closes that: it names the most likely culprit instruction for a correction, behind a hard
 * confidence gate, and PROPOSES a fix - it never edits the constitution.
 *
 * Split of labour (matches the model-routing rule):
 *   - DETERMINISTIC (this script): bound the candidate corpus (`corpus`), record a diagnosis behind
 *     the >=80 gate + emit the gated proposal (`record`), and resolve diagnoses at 60 days by asking
 *     the world "did this correction class recur after the patch?" (`resolve`). Zero Claude calls.
 *   - REASONING (Alex in the /self-review run, claude-sonnet-4-6, NO voice block): read the bounded
 *     corpus and name the culprit instruction with a quoted span + file:line + confidence 0-100. That
 *     one judgement is fed back into `record`.
 *
 * THE HARD RULE (enforced by construction): this tool writes ONLY to the diagnoses log + the
 * human-actions queue. It NEVER edits CLAUDE.md or soul.md. The constitution is hand-authored law;
 * it changes only when the owner edits the source + regenerates (the #23 gated propose/approve/apply
 * loop). Auto-patching the law from a semantic inference with no oracle is the one thing not built.
 *
 * Records: vault/projects/self-review/diagnoses.jsonl (append-only, latest-per-id wins, like
 * human-actions.jsonl). Below the confidence gate a diagnosis is still recorded (status
 * 'no-attribution') so we can SEE that most errors do not trace to a line - that is the honest,
 * common case, not a failure.
 *
 * Usage:
 *   node work/23-self-review/diagnose/diagnose.js corpus --project <name>
 *   node .../diagnose.js record --correction "<ref>" --class <type> --file <path> --line <n> \
 *        --span "<quote>" --confidence <0-100> [--proposal "<fix>"] [--date YYYY-MM-DD] [--dry-run]
 *   node .../diagnose.js resolve
 *   node .../diagnose.js stats
 * Env overrides (for tests/drills): ALEX_DIAGNOSES_LOG, ALEX_CORRECTIONS_LOG.
 */
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const REPO = path.resolve(__dirname, '..', '..', '..');
const DIAG = process.env.ALEX_DIAGNOSES_LOG || path.join(REPO, 'vault', 'projects', 'self-review', 'diagnoses.jsonl');
const CORR = process.env.ALEX_CORRECTIONS_LOG || path.join(REPO, 'vault', 'projects', 'teach-alex', 'corrections-log.md');
const MANIFEST = path.join(REPO, 'system', 'manifest.json');
const CONFIDENCE_GATE = 80;   // below this: report "no attributable instruction" and propose nothing
const RESOLVE_DAYS = 60;

function arg(name) { const i = process.argv.indexOf('--' + name); return i > -1 ? process.argv[i + 1] : undefined; }
function has(name) { return process.argv.includes('--' + name); }
const today = () => new Date().toISOString().slice(0, 10);
function addDays(iso, n) { const d = new Date(iso + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); }

// diagnoses.jsonl: append-only; a 'resolve' row supersedes its diagnosis by id (latest-per-id wins).
function load() {
  if (!fs.existsSync(DIAG)) return new Map();
  const byId = new Map();
  for (const line of fs.readFileSync(DIAG, 'utf8').split('\n')) {
    const t = line.trim(); if (!t) continue;
    let r; try { r = JSON.parse(t); } catch { continue; }
    if (r.resolve_event) { const p = byId.get(r.id); if (p) Object.assign(p, { status: 'resolved', recurred: r.recurred, resolved_date: r.resolved_date, applied: r.applied }); }
    else byId.set(r.id, r);
  }
  return byId;
}
function append(obj) {
  fs.mkdirSync(path.dirname(DIAG), { recursive: true });
  fs.appendFileSync(DIAG, JSON.stringify(obj) + '\n', 'utf8');
  const lines = fs.readFileSync(DIAG, 'utf8').trim().split('\n'); // verify-after-write
  if (JSON.parse(lines[lines.length - 1]).id !== obj.id) { console.error('diagnose: append verify FAILED'); process.exit(1); }
}

function manifest() { return JSON.parse(fs.readFileSync(MANIFEST, 'utf8')); }
function projectClaudeMd(name) {
  const m = manifest();
  const all = [...(m.projects || []), ...((m.meta && m.meta.unnumbered) || [])];
  const row = all.find((p) => p.name === name);
  return row && row.work_dir ? path.join(row.work_dir, 'CLAUDE.md') : null;
}

function corpus() {
  const project = arg('project');
  const files = [
    ['CLAUDE.md', 'root: Standing Orders, gates, model-routing, the Skill Bindings table'],
    ['soul.md', 'voice + identity (gitignored; law even so)'],
  ];
  if (project) { const p = projectClaudeMd(project); if (p) files.push([p.replace(/\\/g, '/'), `#${project} behaviour`]); else console.error(`(no work_dir for project '${project}' in the manifest)`); }
  console.log('Bounded candidate instruction corpus (the ONLY files the reasoning step may cite):');
  for (const [f, why] of files) console.log(`  ${f}  <- ${why}`);
  console.log('\nRules for the reasoning step (Alex, claude-sonnet-4-6, no voice block):');
  console.log('  - cite a quoted span + file:line from WITHIN this set, or return confidence < ' + CONFIDENCE_GATE + '.');
  console.log('  - "no attributable instruction" is a legitimate, common answer. Do not invent a culprit.');
}

function record() {
  const correction = arg('correction');
  const klass = arg('class');
  if (!correction || !klass) { console.error('record needs --correction and --class'); process.exit(1); }
  const confidence = parseInt(arg('confidence') || '0', 10);
  const date = arg('date') || today();
  const id = 'diag-' + date.replace(/-/g, '') + '-' + require('crypto').createHash('sha1').update(date + '|' + correction).digest('hex').slice(0, 8);
  const attributed = confidence >= CONFIDENCE_GATE;
  const rec = {
    id, date, correction, class: klass, confidence,
    culprit: attributed ? { file: arg('file'), line: arg('line') ? parseInt(arg('line'), 10) : null, span: arg('span') || null } : null,
    proposal: attributed ? (arg('proposal') || null) : null,
    status: attributed ? 'open' : 'no-attribution',
    resolve_by: attributed ? addDays(date, RESOLVE_DAYS) : null,
    recurred: null,
  };
  if (attributed && (!rec.culprit.file || !rec.culprit.span)) { console.error('an attributed diagnosis (confidence >= ' + CONFIDENCE_GATE + ') needs --file and --span'); process.exit(1); }
  append(rec);
  if (!attributed) { console.log(`recorded: ${id} -> NO attributable instruction (confidence ${confidence} < ${CONFIDENCE_GATE}). Nothing proposed. This is the honest common case.`); return; }
  // gated proposal -> human-actions. NEVER an edit to CLAUDE.md/soul.md.
  const what = `PROPOSED instruction fix (self-review diagnose, confidence ${confidence}): ${rec.culprit.file}:${rec.culprit.line || '?'} - "${(rec.culprit.span || '').slice(0, 80)}". ${rec.proposal ? 'Suggested change: ' + rec.proposal + '. ' : ''}From correction: "${correction.slice(0, 80)}". Alex proposes; you edit the source + regenerate. Never auto-applied. Resolve-by ${rec.resolve_by}.`;
  const why = 'Editing CLAUDE.md/soul.md is hand-authored law, gated to the owner (NEVER-TOUCH / #23 hard rule). Diagnose only proposes.';
  if (has('dry-run')) { console.log(`recorded: ${id} (open, resolve-by ${rec.resolve_by}). DRY-RUN, would queue human-action:\n  id=${id} sev=low\n  ${what}`); return; }
  try { execFileSync('node', ['scripts/human-actions.js', 'add', '--id', id, '--what', what, '--why', why, '--severity', 'low'], { cwd: REPO, stdio: 'pipe' }); }
  catch (e) { console.error('warning: human-actions proposal not queued: ' + (e.stderr ? e.stderr.toString().trim() : e.message)); }
  console.log(`recorded: ${id} (open, resolve-by ${rec.resolve_by}) + queued gated proposal ${id}.`);
}

// recurrence: did a correction of the SAME class land AFTER the diagnosis date? (append-only history)
function correctionsAfter(dateIso, klass) {
  if (!fs.existsSync(CORR)) return false;
  const re = /^##\s*\[(\d{4}-\d{2}-\d{2})[^\]]*\]\s*type=([a-z-]+)/gim;
  const text = fs.readFileSync(CORR, 'utf8');
  let m;
  while ((m = re.exec(text))) { if (m[1] > dateIso && m[2] === klass) return true; }
  return false;
}

function resolve() {
  const byId = load();
  const due = [...byId.values()].filter((d) => d.status === 'open' && d.resolve_by && d.resolve_by <= today());
  if (!due.length) { console.log('resolve: no open diagnoses are due yet.'); return; }
  for (const d of due) {
    const recurred = correctionsAfter(d.date, d.class);
    // was the proposal applied? (its human-actions row closed). Unknown here => reported as caveat.
    let applied = null;
    try { const out = execFileSync('node', ['scripts/human-actions.js', 'list'], { cwd: REPO, stdio: 'pipe' }).toString(); applied = !out.includes(d.id); } catch {}
    append({ id: d.id, resolve_event: true, resolved_date: today(), recurred, applied });
    console.log(`resolved ${d.id}: class=${d.class} recurred=${recurred} applied=${applied}` +
      (recurred ? '  (class returned -> the diagnosis likely missed, or the fix was not applied)' : '  (class did not return -> consistent with a correct diagnosis IF the fix was applied)'));
  }
  stats();
}

function stats() {
  const all = [...load().values()];
  const c = (f) => all.filter(f).length;
  const resolvedAttrib = all.filter((d) => d.status === 'resolved');
  const scored = resolvedAttrib.filter((d) => d.applied === true); // only applied fixes can score the diagnoser
  const right = scored.filter((d) => d.recurred === false).length;
  console.log(`diagnoses: ${all.length} total | open ${c((d) => d.status === 'open')} | no-attribution ${c((d) => d.status === 'no-attribution')} | resolved ${resolvedAttrib.length}`);
  if (scored.length) console.log(`diagnoser accuracy (of applied+resolved): ${right}/${scored.length} did not recur. Small n; a signal, never a scoreboard.`);
  else console.log('diagnoser accuracy: not enough applied+resolved diagnoses to say (by design, ~a dozen resolved rows/year).');
}

const cmd = process.argv[2];
if (cmd === 'corpus') corpus();
else if (cmd === 'record') record();
else if (cmd === 'resolve') resolve();
else if (cmd === 'stats') stats();
else { console.error('usage: diagnose.js corpus|record|resolve|stats  (see header)'); process.exit(1); }
