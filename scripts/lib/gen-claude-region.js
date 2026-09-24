// gen-claude-region.js - regenerates ONLY the marked routing region inside CLAUDE.md (P1-S3).
// Everything outside the ROUTING-TABLE markers is hand-authored constitution and is preserved
// byte-for-byte. Refuses to run if the markers are missing, duplicated, or out of order - a
// malformed region means a human must look before any tool writes.
'use strict';

const BEGIN_PREFIX = '<!-- ROUTING-TABLE:BEGIN';
const END_MARK = '<!-- ROUTING-TABLE:END -->';

function assertMarkers(text, fileLabel) {
  const b = text.split(BEGIN_PREFIX).length - 1;
  const e = text.split(END_MARK).length - 1;
  if (b !== 1 || e !== 1)
    throw new Error(`gen-claude-region: ${fileLabel} must contain exactly one ROUTING-TABLE BEGIN and END marker (found BEGIN=${b}, END=${e})`);
  const bi = text.indexOf(BEGIN_PREFIX);
  const ei = text.indexOf(END_MARK);
  if (ei < bi) throw new Error(`gen-claude-region: ${fileLabel} markers are out of order (END before BEGIN)`);
  return { bi, ei };
}

// Replace the whole marked region (markers included) with the freshly rendered block.
function regenerate(claudeMdText, regionBlock) {
  const { bi, ei } = assertMarkers(claudeMdText, 'CLAUDE.md');
  return claudeMdText.slice(0, bi) + regionBlock.replace(/\s+$/, '') + claudeMdText.slice(ei + END_MARK.length);
}

module.exports = { regenerate, assertMarkers, BEGIN_PREFIX, END_MARK };
