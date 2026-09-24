// gen-command-headers.js - emits a GENERATED state/trigger header into each LIVE/EVENT command file
// (command-layer review F-3/F-4/F-6/F-11, 2026-07-28).
//
// WHY THIS EXISTS. The 2026-07-28 read-pass found six command files contradicting system/manifest.json
// on trigger, schedule, method or source of truth. That was not six unrelated typos, it was the
// predicted outcome of the system's own principle applied unevenly: every surface with a checker agreed
// with reality, and the one large prose surface with nothing asserting it drifted six times. check.ps1
// C1 asserts a declared command FILE EXISTS and C2 catches orphan command files; validator V7 uses
// command NAMES to bind schedule.md sections to projects. All three are filename-level. NOTHING read
// command file CONTENT.
//
// THE SHAPE OF THE FIX. Not "parse the prose and compare it to the manifest" - that is the V6
// anti-pattern (a validator deriving its expectation FROM prose), which is exactly what blocked the
// generator on 2026-07-24. Instead: REPLACE the prose claim with generated truth between markers, the
// same mechanism already trusted for the CLAUDE.md routing table. State and trigger then cannot drift,
// because they are no longer written by hand. V15 asserts the block still matches the registry, which
// catches a hand-edit or a stale file at commit time.
//
// SCOPE: LIVE + EVENT projects only (the owner's call 2026-07-28). ON-DEMAND, DORMANT, PARKED and RETIRED
// commands have no schedule worth asserting, and a smaller diff is a reviewable diff.
'use strict';

const BEGIN = '<!-- ALEX:CMD-HEADER:BEGIN generated from system/manifest.json by scripts/generate-alex.js - do not hand-edit -->';
const END = '<!-- ALEX:CMD-HEADER:END -->';
const HEADER_STATES = ['LIVE', 'EVENT'];

// Every command file that must carry a header, as {rel, project} pairs.
function targets(manifest) {
  const rows = [...manifest.projects, ...((manifest.meta && manifest.meta.unnumbered) || [])];
  const out = [];
  for (const p of rows) {
    if (!HEADER_STATES.includes(p.state)) continue;
    for (const c of p.commands || []) out.push({ rel: `.claude/commands/${c}.md`, command: c, project: p });
  }
  return out;
}

// The generated block for one command. Kept to two quoted lines: an agent reads it as context, and a
// command file's job is method, not registry data.
function block({ command, project: p }) {
  const num = p.num != null ? `#${String(p.num).padStart(2, '0')} ` : '';
  const pointers = [
    `Registry: \`system/manifest.json\``,
    p.work_dir ? `Spec: \`${p.work_dir}/CLAUDE.md\`` : null,
    p.status_md ? `Status: \`${p.status_md}\`` : null,
  ].filter(Boolean).join(' · ');
  return [
    BEGIN,
    `> **${num}/${command} · ${p.state} · Trigger: ${p.trigger}**`,
    `> ${pointers}`,
    `> *State and trigger above are GENERATED from the registry. Do not restate a schedule elsewhere in this file; point at the registry instead.*`,
    END,
  ].join('\n');
}

// Insert or replace the block. Idempotent: an unchanged manifest re-renders byte-identical output.
// With no markers present, the block goes directly after the H1 title (or at the top if there is none),
// which is where a reader looks for what a command is before reading how it works.
function apply(text, target) {
  const b = block(target);
  const bi = text.indexOf(BEGIN);
  const ei = text.indexOf(END);
  if (bi !== -1 && ei !== -1) {
    if (ei < bi) throw new Error(`gen-command-headers: ${target.rel} markers out of order (END before BEGIN)`);
    return text.slice(0, bi) + b + text.slice(ei + END.length);
  }
  if (bi !== -1 || ei !== -1)
    throw new Error(`gen-command-headers: ${target.rel} has one CMD-HEADER marker but not the other - a human must look before any tool writes`);
  const lines = text.split('\n');
  const h1 = lines.findIndex(l => /^#\s+/.test(l));
  if (h1 === -1) return `${b}\n\n${text}`;
  lines.splice(h1 + 1, 0, '', b);
  return lines.join('\n');
}

module.exports = { targets, block, apply, BEGIN, END, HEADER_STATES };
