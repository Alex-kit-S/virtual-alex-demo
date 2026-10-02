// scripts/tests/code-standard/shared.mjs - small constants and primitives every code-standard module needs.
//
// WHAT. The paths, patterns and tiny pure helpers more than one code-standard module reads: the repo
// root, the ratchet and Biome file paths, the diary pattern section 2 names, the scope's own path
// classifiers, and the common leg-result shape every leg function returns.
//
// HOW. Nothing here reads a file, a tree or a commit; every value is a literal or a pure function of its
// own arguments. REPO comes from scripts/lib/repo-root.js, the one shared resolver section 3.2 names;
// licensedIds reads only the ratchet object a caller already holds.
//
// NEVER. Reads disk, runs git, or scores a file. lex.mjs, reads.mjs, legs.mjs, ratchet.mjs and
// direction.mjs all import from here; nothing here imports from any of them.
//
// Usage: module only

import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
export const { REPO } = require('../../lib/repo-root.js');
export const { readJsonHeaderless } = require('../../lib/json-writer.js');

export const RATCHET_REL = 'scripts/tests/code-standard-ratchet.json';
export const RATCHET_SCHEMA = 'alex/code-standard-ratchet@3';
export const RATCHET_WRITER = 'scripts/tests/test-code-standard.mjs';
export const BIOME_REL = 'biome.json';
export const PY_HELPER_REL = 'scripts/tests/code_standard_ast.py';
export const VARIANT_PREFIX = 'variants/online/';
// The Kit's own file at a path a `variant` row claims is shadowed in the shipped tree (the builder emits
// the online replacement there instead), so nothing ever scores it under its own path. This prefix gives
// it its own identity in the scope and in every leg, sanction and ceiling that needs to tell the two apart.
export const KIT_ONLY_PREFIX = 'kit:';
export const HEADER_WINDOW = 40;
// Section 2, item 4 of the standard, character for character.
export const DIARY = /\b(20\d\d-[01]\d-[0-3]\d|R\d+-\d+L?|C[1-5]-N\d|HF[1-4]|seat \d|fleet seat|finding F?\d+)\b/;
export const MIGRATIONS = /^scripts\/migrations\/[^/]+\.js$/;
// Migrations are immutable history: once one exists, its own bytes never change again, so a date or a
// finding id inside it records what already happened, not drift a future edit should clean up. Exempt
// by NAME, not by MIGRATIONS' path shape above, so a migration added later - after this list was
// written - still gets the diary leg's full scrutiny. These two are every file scripts/migrations/
// holds today.
export const DIARY_EXEMPT_FILES = new Set([
  'scripts/migrations/001-structural-voice-tells.js',
  'scripts/migrations/002-install-state-seed.js'
]);
export const FIXTURES = 'scripts/tests/fixtures/';
export const TESTS = 'scripts/tests/';
export const TAGGABLE = /\.(?:js|mjs|cjs|py|sh|ya?ml)$/;
export const ENCODINGS = new Set(['utf8', 'utf-8', 'latin1', 'binary', 'base64', 'hex', 'ascii', 'utf16le']);

/** A tracked path under scripts/tests/, whatever it is named (loadContext's extraTests filter). */
export const isTestPath = (src) => src.startsWith(TESTS);
/** A shipped path this standard treats as a test file: scripts/tests/test-* or portability-check.mjs. */
export const isTestFile = (p) => /^scripts\/tests\/(test[-_][^/]+|portability-check\.mjs)$/.test(p);

/** The shape every leg function returns. */
export const leg = (name, unit, findings, extra = {}) => ({ name, unit, count: findings.length, findings, ...extra });

/** A key joining its parts on a byte no path or id holds, for a Map two or more fields together select. */
export const keyOf = (...parts) => parts.join('\u0000');

/** The FIX rows that license a pinned change now: the ones whose wave is the ratchet's current wave. */
export function licensedIds(ratchet) {
  return new Set((ratchet.fix_list || []).filter((r) => r.wave === ratchet.current_wave).map((r) => r.id));
}
