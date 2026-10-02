// @ts-check
// scripts/tests/test-lesson-parse.js - parseLLine against the L-lines Close-Out Reports actually write.
//
// WHAT. Holds the L-line grammar of system/recall/lib/lessons.js: the L segment found mid-line in a one-line
// report, with or without its colon; evidence that carries spaces and parentheses; an unknown class written as
// process; and null for `L: none`, a line with no L segment, the empty string and a word merely ending in L.
// Deleted, a parser anchored on the start of a line, or on `L:` alone, would pass CI while every lesson is lost.
//
// HOW. Thirteen cases, two of them real report lines from outputs/logs/ with the personal parts replaced. Each
// result is compared through JSON.stringify, so the key order { cls, lesson, evidence } is held as well - a
// plain node:assert deep-equal does not see a key-order swap, which is exactly the shape this file must catch.
//
// NEVER. Writes anything or needs node:sqlite: it loads lessons.js alone, by the relative require below.
//
// Usage: node scripts/tests/test-lesson-parse.js
// Exit: 0 every case passed - 1 a case failed, each named with its got and want on stdout
'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');

// contract: read as text by scripts/tests/test-recall-online-closure.mjs:201. This relative require stays byte for byte: it is one of the two callers a drop of the lessons parser must keep working.
// biome-ignore format: the recall closure test finds this require byte for byte in the source
const { parseLLine } = require('../../system/recall/lib/lessons');

/**
 * Compares through JSON.stringify, which is sensitive to key order - the header's own claim about
 * { cls, lesson, evidence } - unlike assert.deepEqual, which would pass a same-content, different-order
 * object.
 * @param {unknown} got
 * @param {unknown} want
 */
function assertParsed(got, want) {
  assert.equal(JSON.stringify(got), JSON.stringify(want));
}

// --- REAL fixtures from outputs/logs/ (the regression cases) --------------------------------------

describe('real log fixtures', () => {
  // morning-brief.log: inline, WITH colon, evidence containing spaces and parentheses.
  // The shape is the real log line's; the lesson, the project path and the thread id are stand-ins for
  // the identifying details the real line carried.
  const morningBrief =
    'Close-Out [morning-brief]: A1 N/A (no blocked run) · A2 vault/log.md appended · ' +
    'C N/A (no identity output) · V none · L: class=verification lesson="When a shared credential ' +
    'fails for one service, immediately audit all other pipeline dependencies that share the same credential ' +
    'before the next scheduled run" evidence=work/02-morning-brief (calendar step) + ' +
    'thread-00000000000000a1 · Verdict: COMPLETE';

  test('morning-brief inline L: with spaced evidence', () => {
    assertParsed(parseLLine(morningBrief), {
      cls: 'verification',
      lesson:
        'When a shared credential fails for one service, immediately audit all other pipeline ' +
        'dependencies that share the same credential before the next scheduled run',
      evidence: 'work/02-morning-brief (calendar step) + thread-00000000000000a1'
    });
  });

  // email-triage.log, run-81: inline, NO colon after L.
  const emailTriage =
    'Close-Out [email-triage/run-81]: A1 clean run · A6 N/A · C N/A (no identity output) · ' +
    'V N/A (headless run) · L class=verification lesson="A thread in is:read can still have UNREAD ' +
    'messages in multi-message threads; always check message count before archiving, not just thread ' +
    'label state" evidence=thread:00000000000000b2 · Extras writing-style-notes N/A · Verdict: COMPLETE';

  test('email-triage inline L without colon', () => {
    assertParsed(parseLLine(emailTriage), {
      cls: 'verification',
      lesson:
        'A thread in is:read can still have UNREAD messages in multi-message threads; always check ' +
        'message count before archiving, not just thread label state',
      evidence: 'thread:00000000000000b2'
    });
  });
});

// --- Shape cases -----------------------------------------------------------------------------------

describe('shape cases', () => {
  test('standalone line, the documented form', () => {
    assertParsed(
      parseLLine(
        'L: class=process lesson="Point a checker at the surface class, not the instance." evidence=file.md:12'
      ),
      { cls: 'process', lesson: 'Point a checker at the surface class, not the instance.', evidence: 'file.md:12' }
    );
  });

  test('no evidence field', () => {
    assertParsed(parseLLine('L: class=cost lesson="Pin the model per wrapper."'), {
      cls: 'cost',
      lesson: 'Pin the model per wrapper.',
      evidence: null
    });
  });

  test('no evidence, followed by another segment', () => {
    assertParsed(
      parseLLine('A1 ok · L: class=security lesson="Cover the folder name, not one instance." · Verdict: COMPLETE'),
      { cls: 'security', lesson: 'Cover the folder name, not one instance.', evidence: null }
    );
  });

  test('unknown class falls back to process', () => {
    assertParsed(parseLLine('L: class=banana lesson="x" evidence=y'), { cls: 'process', lesson: 'x', evidence: 'y' });
  });
});

// --- Null cases ------------------------------------------------------------------------------------

describe('null cases', () => {
  test('L: none standalone', () => {
    assertParsed(parseLLine('L: none'), null);
  });

  test('L none inline', () => {
    assertParsed(parseLLine('V N/A · L: none · Verdict: COMPLETE'), null);
  });

  test('not an L line at all', () => {
    assertParsed(parseLLine('A4 HQ push green'), null);
  });

  test('empty', () => {
    assertParsed(parseLLine(''), null);
  });

  // A real lesson must win over a stray "none" elsewhere in the same report line.
  test('real lesson beats a stray none in the line', () => {
    assertParsed(
      parseLLine(
        'A5 none · L: class=propagation lesson="Propagate before closing." evidence=CLAUDE.md · Verdict: COMPLETE'
      ),
      { cls: 'propagation', lesson: 'Propagate before closing.', evidence: 'CLAUDE.md' }
    );
  });

  // Must NOT match a word merely ending in L.
  test('does not match SQL-ish prefix', () => {
    assertParsed(parseLLine('SQL: class=verification lesson="nope"'), null);
  });

  // The boundary is [^A-Za-z0-9], not \b: an underscore is a \b word character (no boundary before the L that
  // follows it) but is not a letter or digit, so it still opens a segment. Under \b this line would be null too.
  test('underscore before L still opens a segment, unlike \\b', () => {
    assertParsed(parseLLine('_L: class=cost lesson="x"'), { cls: 'cost', lesson: 'x', evidence: null });
  });
});
