// @ts-check
// scripts/tests/test-markers.mjs - a marked region is read and rewritten byte for byte, or refused.
//
// WHAT. Proves scripts/lib/markers.js: a document with no pair, two begins, two ends or a reversed pair is
// refused with a message that names the markers and the counts, or with the caller's own wording; a good
// pair is found, read with both markers, and replaced without one byte outside the region changing. The
// expected bytes here are what the four hand-written copies in the generators wrote on the same inputs
// when this module was built. Deleted, it would let the region helper trim a line break it must keep,
// eat a byte after the end marker, or write into a document whose markers a person has to fix first,
// and the generators that call it would carry the change into CLAUDE.md and the docs unseen.
//
// HOW. Every refusal is asserted before the passes: through locatePair, which reports without throwing,
// and through assertOnePair, replaceRegion and readRegion, which throw. Then each pass compares a whole
// output with a literal, over plain and CRLF line ends, a region first and last, trailing whitespace of
// several kinds in the block, a leading one kept, and replacement patterns that must stay literal.
//
// NEVER. Writes a file or reaches a network: every document it tests is a string it holds.
//
// Usage: node scripts/tests/test-markers.mjs
// Exit: 0 every assertion held - 1 one failed

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { assertOnePair, locatePair, PAIRS, readRegion, replaceRegion } from '../lib/markers.js';

const RT = PAIRS.ROUTING_TABLE;
const B = '<!-- ROUTING-TABLE:BEGIN (generated) -->';
const E = '<!-- ROUTING-TABLE:END -->';
const DOC = `top\n${B}\nold\n${E}\nbottom\n`;
const FIX = 'fix the document by hand before any tool writes it';

/** A caller's own wording, as a generator whose messages a test pins passes it. */
const PINNED = {
  count: (/** @type {{ begin: number, end: number }} */ f) =>
    `gen-claude-region: CLAUDE.md must contain exactly one ROUTING-TABLE BEGIN and END marker (found BEGIN=${f.begin}, END=${f.end})`,
  order: 'gen-claude-region: CLAUDE.md markers are out of order (END before BEGIN)'
};

describe('a document whose markers a person must fix is refused', () => {
  const broken = [
    ['no pair', 'plain text\n', { begin: 0, end: 0 }],
    ['two begins', `${B}\n${B}\n${E}\n`, { begin: 2, end: 1 }],
    ['no end', `${B}\nold\n`, { begin: 1, end: 0 }],
    ['no begin', `old\n${E}\n`, { begin: 0, end: 1 }],
    ['two ends, one of them inside the begin line', `${RT.begin} see ${E} -->\nold\n${E}\n`, { begin: 1, end: 2 }]
  ];
  for (const [name, text, found] of /** @type {Array<[string, string, { begin: number, end: number }]>} */ (broken)) {
    test(`${name}: counted, and refused by every reader and writer`, () => {
      assert.deepEqual(locatePair(text, RT), { ok: false, reason: 'count', found });
      const message = `markers: expected exactly one ${RT.begin} and one ${RT.end}, found ${found.begin} and ${found.end}; ${FIX}`;
      assert.throws(() => assertOnePair(text, RT), { name: 'Error', message });
      assert.throws(() => replaceRegion(text, RT, 'x'), { message });
      assert.throws(() => readRegion(text, RT), { message });
    });
  }

  test('a reversed pair: refused, never repaired', () => {
    const text = `${E}\nold\n${B}\n`;
    assert.deepEqual(locatePair(text, RT), { ok: false, reason: 'order' });
    assert.throws(() => replaceRegion(text, RT, 'x'), {
      message: `markers: ${RT.end} comes before ${RT.begin}; ${FIX}`
    });
  });

  test("with the caller's own wording when it passes one", () => {
    assert.throws(() => replaceRegion(`${B}\n${B}\n${E}`, RT, 'x', PINNED), {
      message:
        'gen-claude-region: CLAUDE.md must contain exactly one ROUTING-TABLE BEGIN and END marker (found BEGIN=2, END=1)'
    });
    assert.throws(() => readRegion(`${E}\n${B}\n`, RT, PINNED), { message: PINNED.order });
  });
});

describe('the pairs', () => {
  test('are the marker strings the generators and the validator write, and cannot be changed', () => {
    assert.deepEqual(JSON.parse(JSON.stringify(PAIRS)), {
      ROUTING_TABLE: { begin: '<!-- ROUTING-TABLE:BEGIN', end: '<!-- ROUTING-TABLE:END -->' },
      ROUTINES: { begin: '<!-- ROUTINES:BEGIN', end: '<!-- ROUTINES:END -->' },
      PROJECT_TABLE: { begin: '<!-- PROJECT-TABLE:BEGIN', end: '<!-- PROJECT-TABLE:END -->' },
      CUSTOM_ZONE: { begin: '<!-- CUSTOM_START -->', end: '<!-- CUSTOM_END -->' }
    });
    assert.equal(Reflect.set(PAIRS, 'ROUTINES', RT), false);
    assert.equal(Reflect.set(PAIRS.ROUTINES, 'end', ''), false);
  });
});

describe('a good pair', () => {
  test('is found at its offsets, the begin marker matched as a prefix of its line', () => {
    assert.deepEqual(locatePair(DOC, RT), { ok: true, begin: 4, end: 49 });
    assert.deepEqual(assertOnePair(DOC, RT), { begin: 4, end: 49 });
  });

  test('is read with both markers and nothing around them', () => {
    assert.equal(readRegion(DOC, RT), `${B}\nold\n${E}`);
    const zone = `a\r\n<!-- CUSTOM_START -->\r\nhello\r\n<!-- CUSTOM_END -->\r\nb`;
    assert.equal(readRegion(zone, PAIRS.CUSTOM_ZONE), '<!-- CUSTOM_START -->\r\nhello\r\n<!-- CUSTOM_END -->');
  });

  test('is replaced whole, the block trimmed at its end and the line break after the old end marker kept', () => {
    assert.equal(replaceRegion(DOC, RT, 'NEW\n\n'), 'top\nNEW\nbottom\n');
    assert.equal(replaceRegion(DOC, RT, `${B}\nNEW\n${E}\n\n`), `top\n${B}\nNEW\n${E}\nbottom\n`);
  });

  test('keeps CRLF line ends outside the region as they were', () => {
    const text = `top\r\n${B}\r\nold\r\n${E}\r\nbottom\r\n`;
    assert.equal(replaceRegion(text, RT, `${B}\r\nNEW\r\n${E}\r\n`), `top\r\n${B}\r\nNEW\r\n${E}\r\nbottom\r\n`);
  });

  test('trims every kind of trailing whitespace from the block, and keeps leading whitespace', () => {
    const text = `a\n${B}\nold\n${E}\nb\n`;
    assert.equal(replaceRegion(text, RT, `${B}\nX\n${E} \t\n\u00a0\u2028\r\n`), `a\n${B}\nX\n${E}\nb\n`);
    assert.equal(replaceRegion(text, RT, `\n\n  ${B}\nX\n${E}\n`), `a\n\n\n  ${B}\nX\n${E}\nb\n`);
    assert.equal(replaceRegion(text, RT, '\n \n'), 'a\n\nb\n');
  });

  test('works with the region first or last in the document', () => {
    assert.equal(replaceRegion(`${B}\nold\n${E}\ntail`, RT, `${B}\nX\n${E}`), `${B}\nX\n${E}\ntail`);
    assert.equal(replaceRegion(`head\n${B}\nold\n${E}`, RT, `${B}\nX\n${E}\n`), `head\n${B}\nX\n${E}`);
  });

  test('writes replacement patterns in the block and the document literally', () => {
    const text = `a $& \n${B}\n$1\n${E}\n$$b\n`;
    assert.equal(replaceRegion(text, RT, `${B}\n$& $1 $$ $\`\n${E}\n`), `a $& \n${B}\n$& $1 $$ $\`\n${E}\n$$b\n`);
  });
});
