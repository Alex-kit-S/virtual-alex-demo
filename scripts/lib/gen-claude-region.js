// @ts-check
// scripts/lib/gen-claude-region.js - puts a freshly rendered routing table into CLAUDE.md's marked region.
//
// WHAT. CLAUDE.md is the owner's constitution, written by hand, with one generated part: the routing
// table between its ROUTING-TABLE markers. This module swaps that one region for a new one and leaves
// every other byte of the file as it was.
//
// HOW. regenerate hands the text, the ROUTING_TABLE pair and the new block to scripts/lib/markers.js,
// which replaces the region, both markers included, with the block trimmed at its end, and keeps the line
// break after the old end marker. The block carries its own markers; gen-routing-table.js renders it. The
// refusals are in this module's own words, which the generator tests pin.
//
// NEVER. Writes into a CLAUDE.md whose routing markers are missing, doubled or reversed: it refuses, and a
// person fixes the file before any tool writes it. Touches a byte outside the region. Writes a file: the
// caller stages the text it returns.
//
// Usage: module only - const { regenerate } = require('./gen-claude-region');
'use strict';

const { PAIRS, replaceRegion } = require('./markers');

/**
 * The refusals, in the words scripts/tests/test-generator-libs-contract.mjs pins.
 * @type {import('./markers').Messages}
 */
const MESSAGES = {
  count: (found) =>
    `gen-claude-region: CLAUDE.md must contain exactly one ROUTING-TABLE BEGIN and END marker (found BEGIN=${found.begin}, END=${found.end})`,
  order: 'gen-claude-region: CLAUDE.md markers are out of order (END before BEGIN)'
};

/**
 * CLAUDE.md with its routing region, markers included, replaced by the block.
 * @param {string} claudeMdText
 * @param {string} regionBlock the rendered region, carrying both markers
 * @returns {string}
 */
function regenerate(claudeMdText, regionBlock) {
  return replaceRegion(claudeMdText, PAIRS.ROUTING_TABLE, regionBlock, MESSAGES);
}

module.exports = { regenerate };
