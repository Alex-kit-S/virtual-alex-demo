'use strict';
/*
 * scripts/tests/test-lesson-parse.js - regression test for parseLLine (Recall Spine, lessons half).
 *
 * WHY THIS EXISTS: on 2026-07-29 an architecture review found the lessons table at 0 rows after four
 * days live, while lesson-harvest.js ran nightly and reported success. The cause was not missing
 * lessons. Every scheduled automation had been writing them; the parser anchored on `^L:` while every
 * real Close-Out Report is ONE line with middle-dot separators, so the L segment is never at the
 * start of a line, and email-triage writes `L class=` with no colon.
 *
 * The fixtures below are REAL lines lifted verbatim from outputs/logs/, not invented shapes. That is
 * the point of the test: the parser is pinned against what the system actually emits, so a future
 * tightening of the regex cannot silently reopen a four-day blind spot.
 *
 * Zero dependencies, zero Claude calls. Run: node scripts/tests/test-lesson-parse.js
 */

const { parseLLine } = require('../../system/recall/lib/lessons');

let pass = 0;
const fails = [];

function check(name, got, want) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (ok) { pass++; return; }
  fails.push(`  ${name}\n    got:  ${JSON.stringify(got)}\n    want: ${JSON.stringify(want)}`);
}

// --- REAL fixtures from outputs/logs/ (the regression cases) --------------------------------------

// morning-brief.log, 2026-07-28: inline, WITH colon, evidence containing spaces and parentheses.
// The shape is the real log line's; the lesson, the project path and the thread id are stand-ins,
// because the original named one owner's payment trouble, his job pipeline and a real Gmail thread.
const morningBrief =
  'Close-Out [morning-brief]: A1 N/A (no blocked run) · A2 vault/log.md appended · ' +
  'C N/A (no identity output) · V none · L: class=verification lesson="When a shared credential ' +
  'fails for one service, immediately audit all other pipeline dependencies that share the same credential ' +
  'before the next scheduled run" evidence=work/02-morning-brief (calendar step) + ' +
  'thread-00000000000000a1 · Verdict: COMPLETE';

check('morning-brief inline L: with spaced evidence', parseLLine(morningBrief), {
  cls: 'verification',
  lesson: 'When a shared credential fails for one service, immediately audit all other pipeline ' +
    'dependencies that share the same credential before the next scheduled run',
  evidence: 'work/02-morning-brief (calendar step) + thread-00000000000000a1',
});

// email-triage.log, run-81: inline, NO colon after L.
const emailTriage =
  'Close-Out [email-triage/run-81]: A1 clean run · A6 N/A · C N/A (no identity output) · ' +
  'V N/A (headless run) · L class=verification lesson="A thread in is:read can still have UNREAD ' +
  'messages in multi-message threads; always check message count before archiving, not just thread ' +
  'label state" evidence=thread:00000000000000b2 · Extras writing-style-notes N/A · Verdict: COMPLETE';

check('email-triage inline L without colon', parseLLine(emailTriage), {
  cls: 'verification',
  lesson: 'A thread in is:read can still have UNREAD messages in multi-message threads; always check ' +
    'message count before archiving, not just thread label state',
  evidence: 'thread:00000000000000b2',
});

// --- Shape cases -----------------------------------------------------------------------------------

check('standalone line, the documented form', parseLLine(
  'L: class=process lesson="Point a checker at the surface class, not the instance." evidence=file.md:12'
), { cls: 'process', lesson: 'Point a checker at the surface class, not the instance.', evidence: 'file.md:12' });

check('no evidence field', parseLLine('L: class=cost lesson="Pin the model per wrapper."'),
  { cls: 'cost', lesson: 'Pin the model per wrapper.', evidence: null });

check('no evidence, followed by another segment', parseLLine(
  'A1 ok · L: class=security lesson="Cover the folder name, not one instance." · Verdict: COMPLETE'
), { cls: 'security', lesson: 'Cover the folder name, not one instance.', evidence: null });

check('unknown class falls back to process', parseLLine('L: class=banana lesson="x" evidence=y'),
  { cls: 'process', lesson: 'x', evidence: 'y' });

// --- Null cases ------------------------------------------------------------------------------------

check('L: none standalone', parseLLine('L: none'), null);
check('L none inline', parseLLine('V N/A · L: none · Verdict: COMPLETE'), null);
check('not an L line at all', parseLLine('A4 HQ push green'), null);
check('empty', parseLLine(''), null);

// A real lesson must win over a stray "none" elsewhere in the same report line.
check('real lesson beats a stray none in the line', parseLLine(
  'A5 none · L: class=propagation lesson="Propagate before closing." evidence=CLAUDE.md · Verdict: COMPLETE'
), { cls: 'propagation', lesson: 'Propagate before closing.', evidence: 'CLAUDE.md' });

// Must NOT match a word merely ending in L (the reason the boundary is [^A-Za-z0-9] and not \b).
check('does not match SQL-ish prefix', parseLLine('SQL: class=verification lesson="nope"'), null);

// --- Report ----------------------------------------------------------------------------------------

const total = pass + fails.length;
if (fails.length) {
  console.error(`test-lesson-parse: FAIL ${fails.length}/${total}\n${fails.join('\n')}`);
  process.exit(1);
}
console.log(`test-lesson-parse: PASS (${pass}/${total} cases, incl. 2 real log fixtures)`);
