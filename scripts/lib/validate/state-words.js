// scripts/lib/validate/state-words.js - V7, the lifecycle-state drift lint, split from
// scripts/validate-alex.js.
//
// WHAT. Deterministic, zero-token: for every registry row (projects[] plus meta.unnumbered) it scans the
// hand-maintained prose surfaces for lifecycle-state words that CONTRADICT the manifest state, with exact
// file:line output.
//
// HOW. Scanned assertion locations only (state words inside dated history notes or body prose are
// narrative, not claims, and are deliberately out of scope): scheduler/schedule.md's "### " section title
// line plus its "- Status:"/"- State:" lines (ERROR-tier, uppercase-only match: the repo convention writes
// a real state assertion there in caps); the project's vault status.md YAML frontmatter state:/status:
// value (WARNING); the project's docs/projects/{docs} heading lines (WARNING). False-positive guards tuned
// against the real repo: hyphenated compounds, "A -> B" transition phrases, DISABLED next to Task
// Scheduler wording, and PAUSED accepted as the manifest's PARKED.
//
// NEVER. Reads narrative body prose as a claim. Fails a project for a state word appearing anywhere
// other than the three assertion locations above.
//
// Usage: module only - const { v7StateDriftLint } = require('./state-words');
'use strict';
const { effective } = require('./structure');

const STATE_WORDS = 'ON-DEMAND|LIVE|EVENT|DORMANT|PARKED|RETIRED|PAUSED|DISABLED';
const STATE_RE_CI = new RegExp(`\\b(${STATE_WORDS})\\b`, 'gi'); // frontmatter + docs headers
const STATE_RE_UC = new RegExp(`\\b(${STATE_WORDS})\\b`, 'g'); // schedule.md (uppercase-only)

function stateWordsIn(line, re = STATE_RE_CI) {
  const out = [];
  re.lastIndex = 0;
  for (let m = re.exec(line); m !== null; m = re.exec(line)) {
    const word = m[1].toUpperCase();
    const before = line.slice(0, m.index);
    const after = line.slice(m.index + m[1].length);
    if (/[A-Za-z0-9]-$/.test(before)) continue; // compound: phase-2-live
    if (/^-[A-Za-z0-9]/.test(after)) continue; // compound: Event-driven
    if (/(->|→)\s*$/.test(before.slice(-8))) continue; // transition target: "PARKED -> X"
    if (/^\s*(->|→)/.test(after.slice(0, 8))) continue; // transition source: "X -> ON-DEMAND"
    if (word === 'DISABLED' && /task scheduler|schtasks|scheduledtask/i.test(line)) continue;
    out.push(word);
  }
  return out;
}

function stateContradicts(word, manifestState) {
  const s = String(manifestState || '').toUpperCase();
  if (word === s) return false;
  if (word === 'PAUSED' && s === 'PARKED') return false; // same "deliberately stopped" class
  return true;
}

function v7StateDriftLint({ stagedDir, manifest }, failures, warnings) {
  const rows = [...manifest.projects, ...(manifest.meta?.unnumbered || [])];

  // --- scheduler/schedule.md (ERROR-tier) --------------------------------------------------
  const sched = effective(stagedDir, 'scheduler/schedule.md');
  if (sched) {
    const lines = sched.text.split(/\r?\n/);
    // sections: [startIdx, endIdx) of each "### " block
    const sections = [];
    for (let i = 0; i < lines.length; i++) {
      if (lines[i].startsWith('### ')) {
        if (sections.length) sections[sections.length - 1].end = i;
        sections.push({ start: i, end: lines.length });
      }
    }
    for (const sec of sections) {
      const title = lines[sec.start];
      const body = lines.slice(sec.start, sec.end);
      const cmdLine = body.find((l) => /^\s*-\s*Command:/i.test(l)) || '';
      // associate the section to registry rows
      const owners = rows.filter((p) => {
        if (p.title && new RegExp(`\\b${p.title.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i').test(title))
          return true;
        if (p.num != null && new RegExp(`\\(#0?${p.num}\\)`).test(title)) return true;
        return (p.commands || []).some((c) => new RegExp(`/${c}\\b`).test(cmdLine));
      });
      if (owners.length === 0) continue;
      // assertion lines: the title + Status/State lines
      const assertionIdx = [sec.start];
      for (let i = sec.start + 1; i < sec.end; i++)
        if (/^\s*-\s*\*{0,2}(Status|State)\b/i.test(lines[i])) assertionIdx.push(i);
      for (const idx of assertionIdx) {
        for (const word of stateWordsIn(lines[idx], STATE_RE_UC)) {
          for (const p of owners) {
            if (stateContradicts(word, p.state))
              failures.push(
                `FAILED V7: scheduler/schedule.md:${idx + 1} asserts ${word} but system/manifest.json says ${p.name} is ${p.state}`
              );
          }
        }
      }
    }
  }

  // --- vault status.md frontmatter + docs/projects headers (WARNING-tier) -------------------
  for (const p of rows) {
    if (p.status_md) {
      const st = effective(stagedDir, p.status_md);
      if (st) {
        const fmLines = st.text.split(/\r?\n/);
        if (fmLines[0] === '---') {
          for (let i = 1; i < fmLines.length && fmLines[i] !== '---'; i++) {
            const kv = fmLines[i].match(/^(state|status):\s*(.+)$/i);
            if (!kv) continue;
            for (const word of stateWordsIn(kv[2]))
              if (stateContradicts(word, p.state))
                warnings.push(
                  `WARNING V7: ${p.status_md}:${i + 1} frontmatter says ${word} but system/manifest.json says ${p.name} is ${p.state}`
                );
          }
        }
      }
    }
    if (p.docs) {
      const rel = `docs/projects/${p.docs}`;
      const doc = effective(stagedDir, rel);
      if (doc) {
        const dLines = doc.text.split(/\r?\n/);
        for (let i = 0; i < dLines.length; i++) {
          if (!/^#{1,6}\s/.test(dLines[i])) continue;
          for (const word of stateWordsIn(dLines[i]))
            if (stateContradicts(word, p.state))
              warnings.push(
                `WARNING V7: ${rel}:${i + 1} heading says ${word} but system/manifest.json says ${p.name} is ${p.state}`
              );
        }
      }
    }
  }
}

module.exports = { STATE_WORDS, stateWordsIn, stateContradicts, v7StateDriftLint };
