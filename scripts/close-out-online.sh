#!/usr/bin/env bash
# scripts/close-out-online.sh - the mechanical half of the Close-Out Gate for Virtual Alex.
#
# WHAT. A laptop install runs the Close-Out Gate as prose plus a nightly job; a cloud session has neither
# slot, so the housekeeping (status rotation, ledger reconcile, lesson harvest, the save) moves INTO one
# script the online CLAUDE.md points at, because a checklist the model has to remember gets skipped under
# load. Every step reports one line; a failed step never stops the next, since the last step is the save and
# nothing stands between the work and it.
#
# HOW. In order:
#   1. node scripts/status-rotate.js               Tier-1 status pages back under their byte budget
#   2. node scripts/outputs-ledger.js reconcile     skeleton rows for unledgered deliverables
#      node scripts/outputs-ledger.js render        outputs/INDEX.md + vault/outputs-index.md
#   3. the Close-Out L-line -> vault/projects/self-review/lessons.jsonl, one JSON row {at, class, evidence,
#      job, lesson}. A line the none-screen reads as none (see step_lesson) writes nothing; anything else is
#      parsed and appended, before the require that reads it, or fails the step if it does not parse.
#   4. node scripts/run-log.mjs append              the run's row in system/run-log.jsonl
#   5. bash scripts/autosave.sh --stop              content legs, commit, rebase, push, read back
#
# ARGUMENTS. --job, --status and --lesson are read here; --reason/--canary/--model/--missed/--session-url/
# --repo/--sha forward to run-log.mjs unexamined. A value that is EXACTLY one of this script's own flag
# names (a placeholder deleted) is no value at all: warned and dropped, leaving that word for the next turn
# to read as the flag it actually is - except --job and --status, which refuse, since a row with no job or
# status cannot be attributed. An unknown flag is warned and dropped the same way, with the bare word right
# after it when there is one; either way every step and the save still run. A value that merely STARTS with
# a dash but is not one of this script's own flag names (for example, `--dry-run was used`) is the value verbatim.
#
# NEVER. Loses a step's line when an earlier one failed. Lets the save run anywhere but last. Loses the save
# to a flag it does not recognise, or to a flag left without its value, except --job and --status (CO-EDGE,
# licensing CO-D1's hang and CO-D5's refusal). set -u; quoted expansions throughout; bash 3.2 and BSD tools
# only (portability-check.mjs P2 and P3): no arrays outside RUNLOG_ARGS, which bash 3.2 also has.
#
# Usage:
#   bash scripts/close-out-online.sh --job <name> [--status COMPLETE|PARTIAL|BLOCKED|SKIPPED|RED]
#        [--reason <text>] [--canary ok|missing] [--model <id>] [--missed <n>] [--session-url <url>]
#        [--repo <owner/name>] [--sha <commit>]
#        [--lesson "L: none" | --lesson "L: class=<cls> lesson=\"<one sentence>\" evidence=<ref>"]
#   --status defaults to COMPLETE. --job is required (a session passes `session`; a Routine its name).
#
# Exit: 0 every step ok - 1 a step failed, the save still ran - 2 refused, nothing written

set -u

JOB=""
STATUS="COMPLETE"
LESSON=""
RUNLOG_ARGS=()

# refuse MESSAGE - print the one-line refusal and stop before any step has run.
refuse() {
  echo "close-out: REFUSED - $1" >&2
  exit 2
}

# warn_dropped MESSAGE - note a dropped flag, or a flag dropped for want of a value, on stderr; the
# close-out carries on to the save regardless.
warn_dropped() {
  echo "close-out: WARNING - $1" >&2
}

# is_own_flag WORD - true when WORD is exactly one of this script's own flag names: what tells a deleted
# placeholder apart from a real value that merely starts with a dash.
is_own_flag() {
  case "$1" in
    --job|--status|--lesson|--reason|--canary|--model|--missed|--session-url|--repo|--sha) return 0 ;;
    *) return 1 ;;
  esac
}

# looks_like_flag WORD - true when WORD starts with a dash, whether or not this script knows it.
looks_like_flag() {
  case "$1" in
    --*) return 0 ;;
    *) return 1 ;;
  esac
}

# no_value FLAG NEXT - true when FLAG was given no value: NEXT is empty (FLAG was the last argument) or NEXT
# is itself one of this script's own flag names (a placeholder deleted).
no_value() {
  [ -z "$2" ] && return 0
  is_own_flag "$2"
}

# warn_no_value FLAG NEXT - FLAG's value is missing, either because nothing follows it or
# because the next argument, NEXT, is itself a flag; note it and move on without consuming NEXT, so the next
# loop turn reads NEXT as the flag it actually is.
warn_no_value() {
  if [ -z "$2" ]; then
    warn_dropped "ignored $1: no value given"
  else
    warn_dropped "ignored $1: no value given (the next argument, $2, is a flag)"
  fi
}

# parse_args ARGS... - fill JOB, STATUS, LESSON and RUNLOG_ARGS, or refuse and exit 2. --job and --status
# refuse when given no value, since a row with no job or status cannot be attributed; every other
# flag this script knows, and every flag it does not, is warned and dropped instead, together with the bare
# word right after an unknown one when there is one, and the close-out still runs every step and still
# saves. A value that merely starts with a dash, but is not one of this script's own flag names, is the
# value verbatim (for example, `--dry-run was used`): matching only the exact names is what makes that possible.
parse_args() {
  while [ $# -gt 0 ]; do
    case "$1" in
      --job)
        if no_value "$1" "${2:-}"; then refuse "--job needs a value"; fi
        JOB="$2"; shift 2
        ;;
      --status)
        if no_value "$1" "${2:-}"; then refuse "--status needs a value"; fi
        STATUS="$2"; shift 2
        ;;
      --lesson)
        if no_value "$1" "${2:-}"; then warn_no_value "$1" "${2:-}"; shift 1
        else LESSON="$2"; shift 2
        fi
        ;;
      --reason|--canary|--model|--missed|--session-url|--repo|--sha)
        if no_value "$1" "${2:-}"; then warn_no_value "$1" "${2:-}"; shift 1
        else RUNLOG_ARGS+=("$1" "$2"); shift 2
        fi
        ;;
      *)
        if ! looks_like_flag "$1"; then
          warn_dropped "ignored $1: not a flag"
          shift 1
        elif [ $# -ge 2 ] && ! looks_like_flag "$2"; then
          warn_dropped "ignored $1 $2: unknown flag $1"
          shift 2
        else
          warn_dropped "ignored $1: unknown flag $1"
          shift 1
        fi
        ;;
    esac
  done
  [ -n "$JOB" ] || refuse "--job <name> is required (a session passes session; a Routine its own name)"
}

FAILED=0
FAILED_STEPS=""
# step_ok LINE - a step succeeded; print its line under the "ok" tag.
step_ok()   { echo "close-out: ok   $1"; }
# step_fail LINE ID - a step failed; print it under "FAIL" and remember ID for the closing summary.
step_fail() { echo "close-out: FAIL $1"; FAILED=$((FAILED + 1)); FAILED_STEPS="$FAILED_STEPS $2"; }
# contract: read as text by scripts/tests/test-autosave-paths.mjs:333 (unseen: the test lifts this body, brace to matching brace, and holds it equal to autosave.sh's copy). lastline TEXT - the last non-blank line of TEXT, for a step's own multi-line output.
lastline()  { printf '%s\n' "$1" | grep -v '^[[:space:]]*$' | tail -n 1; }

# step_status_rotate - Tier-1 status pages back under their byte budget; a held write lock defers cleanly.
# contract: read as text by scripts/tests/test-recall-online-closure.mjs:140-145. This call and the two ledger calls of step_ledger keep their literal command lines, on every run.
step_status_rotate() {
  local out code
  out="$(node scripts/status-rotate.js 2>&1)"
  code=$?
  case "$code" in
    0) step_ok "status-rotate: $(lastline "$out")" ;;
    2) step_ok "status-rotate deferred (another writer holds the lock): $(lastline "$out")" ;;
    *) step_fail "status-rotate exit $code: $(lastline "$out")" "status-rotate" ;;
  esac
}

# step_ledger - the deliverables ledger: skeleton rows, then the two generated index files. A template-born
# repo has no outputs/ and no vault/ until something writes there, so both are made here, free on an
# already-created pair.
step_ledger() {
  local out code
  mkdir -p outputs vault
  out="$(node scripts/outputs-ledger.js reconcile 2>&1)"
  code=$?
  if [ "$code" -eq 0 ]; then step_ok "ledger reconcile: $(printf '%s\n' "$out" | head -n 1)"
  else step_fail "ledger reconcile exit $code: $(lastline "$out")" "ledger-reconcile"; fi
  out="$(node scripts/outputs-ledger.js render 2>&1)"
  code=$?
  if [ "$code" -eq 0 ]; then step_ok "ledger $(lastline "$out")"
  else step_fail "ledger render exit $code: $(lastline "$out")" "ledger-render"; fi
}

# step_lesson - the Close-Out L-line. A line the none-screen reads as none (whitespace trimmed, any case: an
# exact "L: none", with or without its colon or its space, optionally followed by end of line, whitespace,
# ., ,, ;, ! or a dash and free text) writes nothing; a missing --lesson also writes nothing, but says so
# differently, since no lesson was even offered. A line that carries class= is never screened as none,
# whatever else it says, so a real lesson that merely mentions "L: none" in its own text still reaches the
# parser. Anything else is parsed and appended as one canonical row, or the step fails on an unparseable line.
# contract: read as text by scripts/tests/test-recall-online-closure.mjs:140-164. The none-screen below stays above the heredoc, whose require keeps its exact path.resolve form and path: the path a drop must keep.
step_lesson() {
  local trimmed lowered out code
  if [ -z "$LESSON" ]; then
    step_ok 'lesson: none given (pass --lesson "L: none" to say so explicitly)'
    return
  fi
  trimmed="$(printf '%s' "$LESSON" | sed -e 's/^[[:space:]]*//' -e 's/[[:space:]]*$//')"
  lowered="$(printf '%s' "$trimmed" | tr '[:upper:]' '[:lower:]')"
  case "$lowered" in
    *class=*) ;; # a real lesson always carries class=: never screened as none for any other text
    "l: none"|"l:none"|"l none"|"l: none"[!a-z0-9]*|"l:none"[!a-z0-9]*|"l none"[!a-z0-9]*)
      step_ok "lesson: L: none, no row written"
      return
      ;;
  esac
  mkdir -p vault/projects/self-review
  out="$(node - "$JOB" "$LESSON" 2>&1 <<'EOF'
const fs = require('fs');
const path = require('path');
const { parseLLine } = require(path.resolve('system/recall/lib/lessons.js'));
const { jsonlRow } = require(path.resolve('scripts/lib/json-writer.js'));
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
const text = jsonlRow(row);
const file = path.resolve('vault/projects/self-review/lessons.jsonl');
fs.appendFileSync(file, text + '\n', 'utf8');
const tail = fs.readFileSync(file, 'utf8').trimEnd().split('\n').pop();
if (tail !== text) { console.error('lessons.jsonl read-back does not match the row just appended'); process.exit(1); }
console.log('appended ' + text);
EOF
)"
  code=$?
  if [ "$code" -eq 0 ]; then step_ok "lesson: $(lastline "$out")"; else step_fail "lesson exit $code: $(lastline "$out")" "lesson"; fi
}

# step_run_log - the run's row in system/run-log.jsonl, JOB and STATUS plus whatever RUNLOG_ARGS carries.
step_run_log() {
  local out code
  out="$(node scripts/run-log.mjs append --job "$JOB" --status "$STATUS" ${RUNLOG_ARGS[@]+"${RUNLOG_ARGS[@]}"} 2>&1)"
  code=$?
  if [ "$code" -eq 0 ]; then step_ok "$(lastline "$out")"; else step_fail "run-log exit $code: $(lastline "$out")" "run-log"; fi
}

# step_save - the last step, always: content legs, commit, rebase, push, read back. Never skipped, whatever
# failed above; its own line decides the run's exit code together with the others.
step_save() {
  local out code save_line
  out="$(bash scripts/autosave.sh --stop 2>&1)"
  code=$?
  save_line="$(printf '%s\n' "$out" | grep '^autosave:' | tail -n 1)"
  [ -n "$save_line" ] || save_line="$(lastline "$out")"
  case "$save_line" in
    *"OFF-MAIN"*) step_fail "$save_line" "save-off-main" ;;
    *"pushed to origin/"*"read back"*) step_ok "$save_line" ;;
    *) step_fail "$save_line" "autosave" ;;
  esac
}

# report_and_exit - the closing verdict line, and the exit code every caller reads.
report_and_exit() {
  if [ "$FAILED" -eq 0 ]; then
    echo "close-out: COMPLETE for $JOB, every step ok"
    exit 0
  fi
  echo "close-out: INCOMPLETE for $JOB, $FAILED step(s) failed:$FAILED_STEPS (the save ran last; see the lines above)"
  exit 1
}

main() {
  parse_args "$@"
  ROOT="$(git rev-parse --show-toplevel 2>/dev/null)" || refuse "not inside a git repository"
  cd "$ROOT" || exit 2
  step_status_rotate
  step_ledger
  step_lesson
  step_run_log
  step_save
  report_and_exit
}

main "$@"
