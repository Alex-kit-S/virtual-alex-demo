// scripts/tests/code-standard.mjs - the measuring engine behind the code standard's checker.
//
// WHAT. Measures Alex's own code against docs/CODE-STANDARD.md, one leg at a time, and says which
// findings sit in files a finished wave has put under the ratchet. It measures and reports; the
// verdict belongs to scripts/tests/test-code-standard.mjs. The tool steps (js-tools.mjs,
// python-tools.mjs, python-floor.mjs, shell-tools.mjs) and the L2 test import its scope and its
// enforced set.
//
// HOW. The scope is what the online tree ships. In the Kit it is the builder's own planTree over the
// tracked files, so it cannot drift from what a recruiter receives; in a generated tree it is every
// tracked file, because that tree IS the build. Only code counts: JavaScript, Python, shell, the two
// CI workflows and the online settings file. JavaScript is split into comments and code by a lexer
// that knows strings, template literals and regular expressions. Shell and YAML comments come from a
// scan that knows quotes and heredocs. Python goes through scripts/tests/code_standard_ast.py, which
// uses Python's own tokenize and ast. Every leg reads only what section 2 and 9.7 of the standard say
// it reads (comment bodies, code bodies, test titles) and returns findings with a file and a line.
// The enforced set is the union of biome.json files.includes (the JavaScript ratchet the standard
// names) and the enforced list in scripts/tests/code-standard-ratchet.json (the files Biome cannot
// read: Python, shell, the workflows, and the two migrations, which never enter Biome's list). The
// same ratchet file holds each file's ceiling for every counted leg, the FIX list and the wave it is
// read for, the pinned-assertion snapshot, and the dated rows that name every raise and loosening; it
// is written only by writeRatchet(), through scripts/lib/json-writer.js. The direction leg compares
// the ratchet, biome.json and docs/L2.json with a base commit, read through git, and fingerprints the
// base's pinned tests with this checker's own code. The engine itself is six modules under
// scripts/tests/code-standard/ (shared, lex, reads, legs, ratchet, direction); this file imports every
// name each of the five importers below uses and re-exports it unchanged, so moving a function between
// those modules is invisible outside this file.
//
// NEVER. Runs a file it measures. The code it loads from the tree it measures is the builder's
// planTree, json-writer.js for the ratchet, and its own Python helper; it runs nothing else it
// measures. Writes anything except the ratchet file, and only
// when an operator asks, and a temp folder holding the base's Python pins, removed before it
// returns. Treats a leg that could not run as a clean one: a missing Python, a string the lexer
// cannot close, a file Python cannot parse or an unreadable ratchet all throw.
//
// Usage: module only; the checker and its operator modes are scripts/tests/test-code-standard.mjs

export {
  analyze,
  findPython,
  lexJs,
  LexError,
  pythonFacts,
  scanShell,
  scanYaml
} from './code-standard/lex.mjs';

export {
  enforcedSet,
  isTestPath,
  kitOnlyVariantPaths,
  languageOf,
  loadContext,
  loadScope,
  readRatchet
} from './code-standard/reads.mjs';

export {
  allLegs,
  collectPinned,
  commentedOutLeg,
  CONCERNS,
  contextMoved,
  contractLeg,
  contractRefs,
  countedLegs,
  danglingLeg,
  diaryIds,
  DIARY_PHRASES,
  diaryLeg,
  duplicationLegs,
  encodingFindings,
  FINGERPRINT_VERSION,
  fingerprintTokens,
  floorLeg,
  headerCliLeg,
  headerLeg,
  homesLeg,
  isCli,
  isCode,
  moduleSplitLeg,
  neverParagraphLines,
  pinnedIdsOf,
  pinnedLeg,
  PLANNED_HOMES,
  REASON_WORDS_MIN,
  resolveSegments,
  resolvesInTree,
  RUN_CONTEXT_LANGS,
  suppressionLeg
} from './code-standard/legs.mjs';

export {
  ceilingFailures,
  ceilingsOf,
  countsByFile,
  fixRatchet,
  L2_REL,
  OperatorRefusal,
  raiseRatchet,
  ratchetProblems,
  recordRatchet,
  shippedPath,
  unfreezeRatchet,
  waveRatchet,
  writeRatchet
} from './code-standard/ratchet.mjs';

export { directionFindings, resolveBase } from './code-standard/direction.mjs';

export {
  BIOME_REL,
  DIARY,
  HEADER_WINDOW,
  KIT_ONLY_PREFIX,
  licensedIds,
  PY_HELPER_REL,
  RATCHET_REL,
  RATCHET_SCHEMA,
  RATCHET_WRITER,
  REPO,
  VARIANT_PREFIX
} from './code-standard/shared.mjs';
