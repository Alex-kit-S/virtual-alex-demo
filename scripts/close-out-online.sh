#!/usr/bin/env bash
# scripts/close-out-online.sh - the mechanical half of the Close-Out Gate for Virtual Alex.
#
# WHY A SCRIPT. On a laptop install the Close-Out Gate is prose in CLAUDE.md for a session and
# scripts/lib/close-out.ps1 or scripts/run-job.mjs for a scheduled wrapper, and the nightly jobs
# did the housekeeping (status rotation, ledger reconcile, lesson harvest, the backup push). None
# of those run in a cloud session: there is no nightly slot and the wrappers are not shipped
# (drop rows in system/kit-manifest.json). So the housekeeping moves INTO the Close-Out, and it is
# one script the online CLAUDE.md points at, because a checklist the model has to remember is a
# checklist that gets skipped under load.
#
# WHAT IT RUNS, in order (every step reports one line; a failed step never stops the next, because
# the last step is the save and nothing is allowed to stand between the work and the save):
#   1. node scripts/status-rotate.js               Tier-1 status pages back under their byte budget
#   2. node scripts/outputs-ledger.js reconcile     skeleton rows for unledgered deliverables
#      node scripts/outputs-ledger.js render        outputs/INDEX.md + vault/outputs-index.md
#   3. the Close-Out L-line -> vault/projects/self-review/lessons.jsonl, one JSON row
#      {at, class, evidence, job, lesson}; `L: none` writes nothing. This file replaces the
#      recall lessons table online; /self-review counts hits with a sort over it.
#   4. node scripts/run-log.mjs append              the run's row in system/run-log.jsonl
#   5. bash scripts/autosave.sh --stop              content legs, commit, rebase, push, read back
#
# Usage:
#   bash scripts/close-out-online.sh --job <name> [--status COMPLETE|PARTIAL|BLOCKED|SKIPPED|RED]
#        [--reason <text>] [--canary ok|missing] [--model <id>] [--missed <n>] [--session-url <url>]
#        [--lesson "L: none" | --lesson "L: class=<cls> lesson=\"<one sentence>\" evidence=<ref>"]
#   --status defaults to COMPLETE. --job is required (a session passes `session`; a Routine its name).
#
# Exit 0 when every step reported ok, 1 when any step failed (after the save ran). The verdict line
# of the Close-Out Report is still the model's; this script is the part that does not depend on it.
# bash 3.2 and BSD tools only (scripts/tests/portability-check.mjs P2 and P3).

JOB=""
STATUS="COMPLETE"
LESSON=""
RUNLOG_ARGS=()
while [ $# -gt 0 ]; do
  case "$1" in
    --job) JOB="$2"; shift 2 ;;
    --status) STATUS="$2"; shift 2 ;;
    --lesson) LESSON="$2"; shift 2 ;;
    --reason|--canary|--model|--missed|--session-url) RUNLOG_ARGS+=("$1" "$2"); shift 2 ;;
    *) echo "close-out: REFUSED - unknown argument $1" >&2; exit 2 ;;
  esac
done
if [ -z "$JOB" ]; then
  echo "close-out: REFUSED - --job <name> is required (a session passes session; a Routine its own name)" >&2
  exit 2
fi

ROOT="$(git rev-parse --show-toplevel 2>/dev/null)" || { echo "close-out: REFUSED - not inside a git repository" >&2; exit 2; }
cd "$ROOT" || exit 2

FAILED=0
FAILED_STEPS=""
step_ok()   { echo "close-out: ok   $1"; }
step_fail() { echo "close-out: FAIL $1"; FAILED=$((FAILED + 1)); FAILED_STEPS="$FAILED_STEPS $2"; }
lastline()  { printf '%s\n' "$1" | grep -v '^[[:space:]]*$' | tail -n 1; }

# --- 1. status rotation --------------------------------------------------------------------------
out="$(node scripts/status-rotate.js 2>&1)"
code=$?
case "$code" in
  0) step_ok "status-rotate: $(lastline "$out")" ;;
  2) step_ok "status-rotate deferred (another writer holds the lock): $(lastline "$out")" ;;
  *) step_fail "status-rotate exit $code: $(lastline "$out")" "status-rotate" ;;
esac

# --- 2. deliverables ledger ----------------------------------------------------------------------
# A template-born repo has no outputs/ and no vault/ until something writes there; the ledger's
# render writes into both, so they must exist. Empty directories are not tracked, so this is free.
mkdir -p outputs vault
out="$(node scripts/outputs-ledger.js reconcile 2>&1)"
code=$?
if [ "$code" -eq 0 ]; then step_ok "ledger reconcile: $(printf '%s\n' "$out" | head -n 1)"; else step_fail "ledger reconcile exit $code: $(lastline "$out")" "ledger-reconcile"; fi
out="$(node scripts/outputs-ledger.js render 2>&1)"
code=$?
if [ "$code" -eq 0 ]; then step_ok "ledger $(lastline "$out")"; else step_fail "ledger render exit $code: $(lastline "$out")" "ledger-render"; fi

# --- 3. the lesson row ----------------------------------------------------------------------------
if [ -z "$LESSON" ]; then
  step_ok "lesson: none given (pass --lesson \"L: none\" to say so explicitly)"
elif printf '%s' "$LESSON" | grep -q -i -E '(^|[^A-Za-z0-9])L:?[[:space:]]*none'; then
  step_ok "lesson: L: none, no row written"
else
  mkdir -p vault/projects/self-review
  out="$(node - "$JOB" "$LESSON" 2>&1 <<'EOF'
const fs = require('fs');
const path = require('path');
const { parseLLine } = require(path.resolve('system/recall/lib/lessons.js'));
const { canonicalText } = require(path.resolve('scripts/lib/json-writer.js'));
const [job, line] = process.argv.slice(2);
const parsed = parseLLine(line);
if (!parsed) {
  console.error('the L-line did not parse; expected: L: class=<propagation|verification|cost|security|process> lesson="<one sentence>" evidence=<file:line or runid>');
  process.exit(2);
}
const row = {
  at: new Date().toISOString().replace(/\.\d{3}Z$/, 'Z'),
  class: parsed.cls,
  evidence: parsed.evidence,
  job,
  lesson: parsed.lesson,
};
const text = JSON.stringify(JSON.parse(canonicalText(row)));
const file = path.resolve('vault/projects/self-review/lessons.jsonl');
fs.appendFileSync(file, text + '\n', 'utf8');
const tail = fs.readFileSync(file, 'utf8').trimEnd().split('\n').pop();
if (tail !== text) { console.error('lessons.jsonl read-back does not match the row just appended'); process.exit(1); }
console.log('appended ' + text);
EOF
)"
  code=$?
  if [ "$code" -eq 0 ]; then step_ok "lesson: $(lastline "$out")"; else step_fail "lesson exit $code: $(lastline "$out")" "lesson"; fi
fi

# --- 4. the run-log row ---------------------------------------------------------------------------
out="$(node scripts/run-log.mjs append --job "$JOB" --status "$STATUS" ${RUNLOG_ARGS[@]+"${RUNLOG_ARGS[@]}"} 2>&1)"
code=$?
if [ "$code" -eq 0 ]; then step_ok "$(lastline "$out")"; else step_fail "run-log exit $code: $(lastline "$out")" "run-log"; fi

# --- 5. the save ---------------------------------------------------------------------------------
out="$(bash scripts/autosave.sh --stop 2>&1)"
code=$?
save_line="$(printf '%s\n' "$out" | grep '^autosave:' | tail -n 1)"
[ -n "$save_line" ] || save_line="$(lastline "$out")"
case "$save_line" in
  *"OFF-MAIN"*) step_fail "$save_line" "save-off-main" ;;
  *"pushed to origin/"*"read back"*) step_ok "$save_line" ;;
  *) step_fail "$save_line" "autosave" ;;
esac

if [ "$FAILED" -eq 0 ]; then
  echo "close-out: COMPLETE for $JOB, every step ok"
  exit 0
fi
echo "close-out: INCOMPLETE for $JOB, $FAILED step(s) failed:$FAILED_STEPS (the save ran last; see the lines above)"
exit 1
