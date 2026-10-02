// scripts/lib/validate/remote.js - the CLAUDE_CODE_REMOTE drift classifier, split from
// scripts/validate-alex.js.
//
// WHAT. Decides, from a FAILED line's own wording, whether it belongs to the set of legs that compare a
// generated or derived surface with its source (REMOTE_DRIFT_LEGS) and is therefore degraded to a warning
// under CLAUDE_CODE_REMOTE=true in the pre-commit context. The entry requires this module unconditionally
// in every context, but its own degrade loop only runs when context === 'pre-commit', so isRemoteDrift is
// never actually CALLED from a generator run - the entry runs the degrade loop itself, after every leg has
// produced its failures, and calls only isRemoteDrift from here to decide each line.
//
// HOW. isRemoteDrift(failure) reads the `FAILED (G\d+|V\d+):` tag off the front of the line: a
// never-drift phrase (REMOTE_NEVER_DRIFT: a missing or unparseable source) always wins and blocks
// everywhere; V18 is split by its own wording (REMOTE_V18_DRIFT: the dangling-command, cut-project and
// dead-link phrasings drift, its control-byte, .cmd-guard and .ps1-parse phrasings do not); every other
// leg drifts exactly when its tag is in REMOTE_DRIFT_LEGS.
//
// NEVER. Reads CLAUDE_CODE_REMOTE itself - that belongs to the entry's runAll, which is the one place the
// generator-vs-pre-commit context is already known. Classifies a WARNING or an unprefixed line as drift:
// only a line that starts `FAILED ` can match at all.
//
// Usage: module only - const { isRemoteDrift, REMOTE_DRIFT_LEGS } = require('./remote');
'use strict';

// REMOTE_DRIFT_LEGS: the legs that compare a GENERATED or
// DERIVED surface with its source (docs counts, the jobs table, retired rows in docs, the MCP list,
// hex tokens, state words, the trifecta echo in work/NN/CLAUDE.md, wrapper pins, command headers,
// skill links, and the Routine prompt files against routines[]). Under CLAUDE_CODE_REMOTE=true in
// context=pre-commit their failures become warnings
// AFTER they run (runAll, below), so the transcript still names the drift and the weekly check.mjs
// can turn a persisting one red, while the commit (an autosave) goes through. A missing or
// unparseable source file is never drift (a broken registry blocks everywhere), and V18 is split:
// its dangling-command, cut-project-pointer and dead-link legs are drift, its control-byte, .cmd
// guard and .ps1 parse legs are content and block. V19 (the Routine prompt files) belongs here too:
// scheduler/routines/ is identity-denied in every unattended session, so an orphan there is an
// owner's edit, never a Routine's, and an autosave must not die on a registry row somebody forgot.
const REMOTE_DRIFT_LEGS = new Set(['V1', 'V2', 'V3', 'V4', 'V5', 'V7', 'V12', 'V13', 'V15', 'V17', 'V19']);
const REMOTE_NEVER_DRIFT = /not found|not valid JSON|cannot parse|is required/;
const REMOTE_V18_DRIFT = /names `\/|points at `|links to '/;
function isRemoteDrift(failure) {
  const m = /^FAILED (G\d+|V\d+):/.exec(failure);
  if (!m) return false;
  if (REMOTE_NEVER_DRIFT.test(failure)) return false;
  if (m[1] === 'V18') return REMOTE_V18_DRIFT.test(failure);
  return REMOTE_DRIFT_LEGS.has(m[1]);
}

module.exports = { REMOTE_DRIFT_LEGS, REMOTE_NEVER_DRIFT, REMOTE_V18_DRIFT, isRemoteDrift };
