// @ts-check
// scripts/lib/markers.js - finds, reads and rewrites a marked region inside a hand-written document.
//
// WHAT. Several documents are half hand-written and half generated: CLAUDE.md's routing table, the online
// schedule's Routines, docs/projects/README.md's project table, and docs/README.md's welcome block, which
// is the owner's and is carried over word for word. Each part is fenced by a begin marker and an end
// marker. This module is the one place that says what a region is: exactly one begin, exactly one end,
// begin first. It reads a region out, or replaces it with freshly generated text, and refuses a document
// whose markers are missing, doubled or reversed, because then a person has to look before any tool writes.
//
// HOW. A pair is { begin, end }. PAIRS names the pairs the generators use; the routing, Routines and
// project-table begin markers are prefixes, because the rest of their begin line carries a note that may
// change. scripts/lib/validate/structure.js imports PAIRS and locatePair for its own structural guards
// (G2-G4), so this module keeps the one copy of the routing, custom-zone and project-table markers.
// locatePair counts each marker with split and finds it with indexOf, and returns the two offsets or the
// reason it cannot. assertOnePair throws that reason as an Error. replaceRegion
// keeps everything before the begin marker and everything after the end marker, and puts the block
// between them with its trailing whitespace removed: the block is meant to carry both markers, and the line
// break that followed the old end marker stays. readRegion returns the region with both markers. A caller
// whose wording is pinned passes its own messages; otherwise the message names the markers and the counts.
//
// NEVER. Writes a byte other than the ones scripts/tests/test-markers.mjs pins. Picks one of two begin
// markers, or repairs a reversed pair: it refuses instead. Reads or writes a file; the caller holds the text.
//
// Usage: module only - const { PAIRS, replaceRegion } = require('./markers');
'use strict';

/**
 * @typedef {{ begin: string, end: string }} MarkerPair
 * @typedef {{ ok: true, begin: number, end: number }
 *   | { ok: false, reason: 'count', found: { begin: number, end: number } }
 *   | { ok: false, reason: 'order' }} Location
 * @typedef {{ count: (found: { begin: number, end: number }) => string, order: string }} Messages
 */

/**
 * A frozen pair, so no caller can move a marker the others rely on.
 * @param {string} begin
 * @param {string} end
 * @returns {Readonly<MarkerPair>}
 */
const pair = (begin, end) => Object.freeze({ begin, end });

const PAIRS = Object.freeze({
  ROUTING_TABLE: pair('<!-- ROUTING-TABLE:BEGIN', '<!-- ROUTING-TABLE:END -->'),
  ROUTINES: pair('<!-- ROUTINES:BEGIN', '<!-- ROUTINES:END -->'),
  PROJECT_TABLE: pair('<!-- PROJECT-TABLE:BEGIN', '<!-- PROJECT-TABLE:END -->'),
  CUSTOM_ZONE: pair('<!-- CUSTOM_START -->', '<!-- CUSTOM_END -->')
});

/**
 * How many times a marker appears, counting non-overlapping occurrences.
 * @param {string} text
 * @param {string} marker
 */
const occurrences = (text, marker) => text.split(marker).length - 1;

/**
 * Where the one pair sits in the text, or why it cannot be used.
 * @param {string} text
 * @param {MarkerPair} markers
 * @returns {Location}
 */
function locatePair(text, markers) {
  const found = { begin: occurrences(text, markers.begin), end: occurrences(text, markers.end) };
  if (found.begin !== 1 || found.end !== 1) return { ok: false, reason: 'count', found };
  const begin = text.indexOf(markers.begin);
  const end = text.indexOf(markers.end);
  if (end < begin) return { ok: false, reason: 'order' };
  return { ok: true, begin, end };
}

/**
 * The messages a caller gets when it names none.
 * @param {MarkerPair} markers
 * @returns {Messages}
 */
function defaultMessages(markers) {
  return {
    count: (found) =>
      `markers: expected exactly one ${markers.begin} and one ${markers.end}, found ${found.begin} and ${found.end}; ` +
      'fix the document by hand before any tool writes it',
    order: `markers: ${markers.end} comes before ${markers.begin}; fix the document by hand before any tool writes it`
  };
}

/**
 * The offsets of the one pair, or an Error carrying the caller's message for why there is none.
 * @param {string} text
 * @param {MarkerPair} markers
 * @param {Messages} [messages]
 * @returns {{ begin: number, end: number }}
 */
function assertOnePair(text, markers, messages = defaultMessages(markers)) {
  const at = locatePair(text, markers);
  if (at.ok) return { begin: at.begin, end: at.end };
  throw new Error(at.reason === 'count' ? messages.count(at.found) : messages.order);
}

/**
 * The text with its whole region, both markers included, replaced by the block.
 * @param {string} text
 * @param {MarkerPair} markers
 * @param {string} block the new region, carrying both markers itself
 * @param {Messages} [messages]
 */
function replaceRegion(text, markers, block, messages) {
  const at = assertOnePair(text, markers, messages);
  return text.slice(0, at.begin) + block.replace(/\s+$/, '') + text.slice(at.end + markers.end.length);
}

/**
 * The region as it stands, both markers included.
 * @param {string} text
 * @param {MarkerPair} markers
 * @param {Messages} [messages]
 */
function readRegion(text, markers, messages) {
  const at = assertOnePair(text, markers, messages);
  return text.slice(at.begin, at.end + markers.end.length);
}

module.exports = { PAIRS, locatePair, assertOnePair, replaceRegion, readRegion };
