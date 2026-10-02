#!/usr/bin/env bash
# scripts/autosave.sh - Virtual Alex: the repo is the disk, and this is the save.
#
# WHAT. In a Claude Code cloud session the VM evaporates when the session ends, and there is no
# nightly sweep that could catch what a session left uncommitted. The only place a save can happen
# is inside the session, by something that does not need the model to remember it. So the online
# .claude/settings.json runs this file from two hooks: PostToolUse on Write|Edit|MultiEdit (a text
# delta after every file write, which is what covers the turn that dies mid-way, the case the Stop
# hook can never see) and Stop with --stop (the catch-all, with the rebase and the rescue path).
#
# HOW. In order:
#   0. Exits with a one-line note unless CLAUDE_CODE_REMOTE=true. A laptop install never runs it.
#   1. ALEX_ROUTINE set (a Routine session): `git checkout -q -- <identity paths>` restores every
#      tracked identity file the routine changed and logs one line naming them; a NEW file under an
#      identity path is refused below. A routine writes memory, never the rules.
#   2. Content legs on every modified or new file, BEFORE anything is staged: the 10 MB size guard
#      (inline, no file to be absent), then scripts/secret-scan.mjs and
#      scripts/employer-data-guard.mjs, each called once per file if it exists (exit 0 clean, 2 hit,
#      anything else an error). A hit or an error refuses that path (fail-closed, left unstaged,
#      named on stderr, counted in the result line); nothing clean is ever lost.
#   3. `git add -A` minus the refused paths, `git commit -qm "alex: autosave <utc>"` if anything
#      is staged. The pre-commit gate (core.hooksPath, set by SessionStart) runs on that commit; a
#      blocked commit is reported with the gate's last lines and the work stays in the working tree.
#   4. --stop only: `git pull --rebase --autostash origin <branch>`. A rebase that stops on a
#      conflict is aborted and HEAD is pushed to claude/rescue-<utc> instead, with one loud line,
#      so the work is on GitHub under a name /alex-status can list and never merged wrong.
#   5. `git push -q origin HEAD`: the current branch to its own name, which the cloud proxy always
#      allows. In --stop mode the pushed ref is read back with git ls-remote. When that branch is
#      not main, every result line opens with OFF-MAIN: the save is real, but the next session
#      starts from main and will not see it until the branch is merged.
#
# NEVER. Never blocks a hook: every exit path prints one result line and exits 0 (finish()), so a
# hook can never end the session; the line is always appended to outputs/logs/autosave.log
# (gitignored) for /support-bundle. Never drops a clean file silently: a refusal is named on
# stderr and counted in the result line, never silent. Before --json existed, a hook's plain
# stdout never reached Claude, so a REFUSED commit looked exactly like a successful save; a real
# install lost an afternoon of memory to it on 2026-09-23, silently, before anyone noticed.
#
# Usage: scripts/autosave.sh [--stop] [--json]
# Exit: 0 always (finish() is the only exit path and never returns non-zero)
# Test: node scripts/tests/test-autosave.mjs (every guard shown refusing before the pass)
#
# --json  the hooks pass it; a person running this by hand does not. stdout then carries ONE JSON
#         object and nothing else, only when the save did NOT go cleanly, one shape per event; see
#         emit_json() below for the exact fields, the reference they come from, and why.
#
# bash 3.2 and BSD tools only (scripts/tests/portability-check.mjs P2 and P3).

set -u

MODE=""
JSON=0
for a in "$@"; do
  case "$a" in
    --stop) MODE="stop" ;;
    --json) JSON=1 ;;
  esac
done

# The Stop hook's payload. Read ONLY in --stop --json, because $(cat) with no hook behind it waits
# for EOF; that is the shape Claude Code's own reference Stop hook uses. The harness sets
# stop_hook_active=true when it re-invokes the Stop hook after a block, so this is the re-entry
# guard: block once per turn, never in a loop.
STOP_PAYLOAD=""
if [ "$MODE" = "stop" ] && [ "$JSON" = 1 ]; then
  STOP_PAYLOAD="$(cat)"
fi

# contract: read as text by scripts/tests/test-autosave-paths.mjs:417. The line keeps the form MAX_BLOB_BYTES=<digits> from column 0, holding 10485760, the same number as the online commit hook.
MAX_BLOB_BYTES=10485760   # 10 MB, the same number as MAX_BLOB_BYTES in scripts/hooks/pre-commit (the size-guard leg, on the staged blob); change both or neither, the disk stays diffable

# The paths a Routine session may never change. ONE list, owned by scripts/untrusted-lane-guard.js
# (IDENTITY_PATHS, the same list its identity deny is derived from) and read from it at run time in
# a routine session (below), so this script and the guard cannot drift; the static Edit denies in
# the online settings are the third copy. Git-pathspec shape: a trailing / is a directory, * is a
# glob within one segment (system/*allowlist*.json).
IDENTITY=""

LOG=""
say() {
  # In --json mode stdout belongs to the hook payload and nothing else may touch it: Claude Code
  # parses a hook's stdout as JSON, and one stray line ahead of the object makes the whole thing
  # plain text that is silently ignored.
  [ "$JSON" = 1 ] || echo "$1"
  if [ -n "$LOG" ]; then
    echo "$(date -u +%Y-%m-%dT%H:%M:%SZ) $1" >> "$LOG" 2>/dev/null
  fi
}

# One line into one JSON string. No jq and no node: this runs before the content legs and must work
# on a tree where neither is reachable. Tab, LF and CR become spaces; every OTHER C0 control byte is
# deleted, because JSON forbids them raw inside a string and an object that does not parse reaches
# Claude as plain text, which it ignores. A gate line carrying an ANSI colour (gitleaks prints them)
# would otherwise make the refusal invisible again.
# contract: read as text by scripts/tests/test-autosave.mjs:1228 (unseen: sed lifts the function). It opens at column 0 and closes on a column-0 brace, the range that sed prints and the test evals.
json_escape() {
  printf '%s' "$1" | tr '\011\012\015' '   ' | tr -d '\001-\010\013\014\016-\037' \
    | sed 's/\\/\\\\/g; s/"/\\"/g'
}

# Tell the OWNER, and the MODEL, that a save did not happen: the mechanism is per event,
# from Claude Code's own hooks reference (code.claude.com/docs/en/hooks):
#   PostToolUse  cannot block (the reference marks it "No" and says "Shows stderr to Claude; the
#                tool already ran"). systemMessage is documented as a "Warning message shown to the
#                user" - the OWNER, not the model. A live probe on Claude Code 2.1.259 confirmed it:
#                a PostToolUse systemMessage arrived only as a user-facing notice, and the model,
#                asked to repeat any hook text, had nothing to repeat. hookSpecificOutput's
#                additionalContext is what the reference actually routes to Claude on this event
#                ("String added to Claude's context next to the tool result"), and the same probe
#                quoted it back word for word. So this hook sends BOTH, over the same text: the owner
#                keeps systemMessage, and additionalContext now reaches the model too.
#   Stop         decision: "\"block\" prevents Claude from stopping. Omit to allow Claude to stop";
#                reason: "Tells Claude why it should continue" - this one already reaches the model,
#                unchanged.
emit_json() {
  [ "$JSON" = 1 ] || return 0
  r="$(json_escape "$1")"
  if [ "$MODE" = "stop" ]; then
    # Whitespace-tolerant on purpose: the harness owns the payload's spacing, and a spaced or
    # pretty-printed object is the same JSON. A byte match on the compact form blocked again on
    # those, which is the loop this guard exists to prevent. Newlines are folded first because grep
    # reads one line at a time.
    if printf '%s' "$STOP_PAYLOAD" | tr '\011\012\015' '   ' \
        | grep -Eq '"stop_hook_active"[[:space:]]*:[[:space:]]*true([^[:alnum:]_]|$)'; then
      return 0
    fi
    printf '{"decision":"block","reason":"%s"}' "$r"
  else
    printf '{"systemMessage":"%s","hookSpecificOutput":{"hookEventName":"PostToolUse","additionalContext":"%s"}}' "$r" "$r"
  fi
}

# $1 the result line. $2 "alert" when this exit is a refusal or a failure rather than a clean save.
# A clean save ON MAIN says nothing to the model: a note after every single file write would be
# noise, and noise is how a real warning stops being read. OFF-MAIN is the one exception: every
# result line from there reaches the model too, clean or not, because the next
# session starts from main and would otherwise never learn a side-branch save happened at all.
finish() {
  if [ -n "${OFFMAIN:-}" ]; then
    msg="autosave: OFF-MAIN on $OFFMAIN, not main (the next session starts from main and will not see this save until $OFFMAIN is merged); ${1#autosave: }"
  else
    msg="$1"
  fi
  say "$msg"
  if [ "${2:-}" = "alert" ] || [ -n "${OFFMAIN:-}" ] || [ "${REFUSED_COUNT:-0}" -gt 0 ]; then
    emit_json "$msg"
  fi
  exit 0
}
# contract: read as text by scripts/tests/test-autosave-paths.mjs:448 (unseen: the test lifts this body, brace to matching brace, and holds it equal to close-out-online.sh's copy). The last non-empty line of a command's output, for a result line that names the cause.
lastline() {
  printf '%s\n' "$1" | grep -v '^[[:space:]]*$' | tail -n 1
}

[ "${CLAUDE_CODE_REMOTE:-}" = "true" ] || finish "autosave: skipped (CLAUDE_CODE_REMOTE is not true; this save runs only in a cloud session)"

ROOT="$(git rev-parse --show-toplevel 2>/dev/null)" || finish "autosave: REFUSED - not inside a git repository, nothing saved" alert
cd "$ROOT" || finish "autosave: REFUSED - cannot enter $ROOT, nothing saved" alert
mkdir -p outputs/logs 2>/dev/null && LOG="outputs/logs/autosave.log"

TS="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
REF_TS="$(date -u +%Y%m%dT%H%M%SZ)"
BRANCH="$(git symbolic-ref --short -q HEAD)" || finish "autosave: REFUSED - detached HEAD, nothing committed or pushed (check out a branch first)" alert

# Off main. Every Routine and every new session starts from main, so
# a save on any other branch is real but invisible to the next session until that branch is merged.
# This never pushes main from a side branch by design: a save there must never land on main behind
# the owner's back. (The platform's docs read stricter than what was actually measured: an
# interactive cloud session pushed a brand-new claude/ branch that was not its current one, so a
# session is not limited to pushing only its current branch the way the docs alone would suggest;
# see scripts/lib/session-branch.sh for the same finding.) The save still runs (losing the work
# would be worse), and every result line from here on opens with OFF-MAIN, which
# scripts/close-out-online.sh counts as a failed step.
OFFMAIN=""
[ "$BRANCH" = "main" ] || OFFMAIN="$BRANCH"

# ---------------------------------------------------------------- 1. routine identity reset
if [ -n "${ALEX_ROUTINE:-}" ]; then
  # The list comes from the guard. An unreadable list in an unattended session refuses the save
  # (the work stays in the tree) rather than guessing which files a Routine may rewrite.
  IDENTITY="$(node scripts/untrusted-lane-guard.js --identity-paths 2>/dev/null)"
  # A list of spaces passes the `-n` test below, then word-splits to NOTHING at the reset and
  # the diff further down, which resets and reverts every modified tracked file in the working tree,
  # silently. A whitespace-only list is exactly as unusable as an empty one.
  case "$IDENTITY" in *[![:space:]]*) ;; *) IDENTITY="" ;; esac
  [ -n "$IDENTITY" ] || finish "autosave: REFUSED - could not read the identity list (node scripts/untrusted-lane-guard.js --identity-paths printed nothing); a routine session does not save without it" alert
  # word-splitting of $IDENTITY is intended: none of those paths carries a space
  # A change already STAGED (git add, git rm) is still a change. Put the index back to HEAD for every
  # identity path first, so the restore below compares with HEAD rather than with what the routine
  # staged, and a staged NEW file is untracked again and refused below like any other new file. If
  # that cannot be done, the routine does not save.
  # shellcheck disable=SC2086 # the intended word-split, documented above
  reset_out="$(git reset -q -- $IDENTITY 2>&1)" || finish "autosave: REFUSED - could not reset the identity paths to HEAD: $(lastline "$reset_out"); a routine session does not save without it" alert
  # shellcheck disable=SC2086 # same intended word-split
  reverted="$(git diff --name-only -- $IDENTITY 2>/dev/null | tr '\n' ' ')"
  if [ -n "$reverted" ]; then
    # shellcheck disable=SC2086 # same intended word-split
    git diff --name-only -z -- $IDENTITY 2>/dev/null | xargs -0 git checkout -q -- 2>/dev/null
    say "autosave: routine identity reset reverted: $reverted"
  fi
fi

# ---------------------------------------------------------------- 2. content legs
REFUSED_COUNT=0
REFUSED_NAMES=""
EXCLUDE=()
UNSTAGE=()
refuse() {
  # $1 path, $2 reason. Named on stderr, excluded from the add, taken out of the index below (it may
  # have been staged before this ran), counted for the result line.
  echo "autosave: refused $1: $2 (left unstaged)" >&2
  if [ -n "$LOG" ]; then echo "$TS refused $1: $2" >> "$LOG" 2>/dev/null; fi
  REFUSED_COUNT=$((REFUSED_COUNT + 1))
  REFUSED_NAMES="$REFUSED_NAMES $1"
  EXCLUDE+=(":(exclude)$1")
  UNSTAGE+=(":(literal)$1")
}
is_identity_path() {
  # $i is left unquoted in the patterns on purpose: a spec may carry a glob, and a case pattern
  # expands a variable as a pattern. A trailing / (a directory spec) is stripped first.
  # shellcheck disable=SC2254 # the intended glob-as-pattern, documented above (SC2086 is not raised here)
  for i in $IDENTITY; do
    i="${i%/}"
    case "$1" in
      $i|$i/*) return 0 ;;
    esac
  done
  return 1
}

# porcelain v1 with NUL separators: `XY path`, and a rename/copy carries a second NUL field
skip_next=0
while IFS= read -r -d '' entry; do
  if [ "$skip_next" = 1 ]; then skip_next=0; continue; fi
  xy="${entry:0:2}"
  p="${entry:3}"
  case "$xy" in
    R*|C*) skip_next=1 ;;
  esac
  [ -f "$p" ] || continue          # deletions and directories need no scan
  if [ -n "${ALEX_ROUTINE:-}" ] && [ "$xy" = "??" ] && is_identity_path "$p"; then
    refuse "$p" "new file under an identity path in a routine session"
    continue
  fi
  bytes="$(wc -c < "$p" | tr -d ' ')"
  if [ "$bytes" -gt "$MAX_BLOB_BYTES" ]; then
    refuse "$p" "$bytes bytes is over the $MAX_BLOB_BYTES byte size guard"
    continue
  fi
  for leg in scripts/secret-scan.mjs scripts/employer-data-guard.mjs; do
    [ -f "$leg" ] || continue
    out="$(node "$leg" --file "$p" 2>&1)"
    code=$?
    if [ "$code" -ne 0 ]; then
      refuse "$p" "$leg exit $code: $(lastline "$out")"
      break
    fi
  done
done < <(git status --porcelain -z --untracked-files=all 2>/dev/null)

REFUSED_NOTE=""
if [ "$REFUSED_COUNT" -gt 0 ]; then
  REFUSED_NOTE="; refused $REFUSED_COUNT:$REFUSED_NAMES"
  # The exclude below only stops `git add` staging a refused path; a path ALREADY staged (a `git add`
  # before this ran) would still be committed. Put its index entry back to HEAD (the working tree is
  # untouched), and if that cannot be done, commit nothing rather than the refused content.
  unstage_out="$(git reset -q -- "${UNSTAGE[@]}" 2>&1)" || finish "autosave: REFUSED - could not unstage a refused file: $(lastline "$unstage_out"); nothing committed$REFUSED_NOTE" alert
fi

# ---------------------------------------------------------------- 3. add + commit
add_out="$(git add -A -- . ${EXCLUDE[@]+"${EXCLUDE[@]}"} 2>&1)" || finish "autosave: REFUSED - git add failed: $(lastline "$add_out")$REFUSED_NOTE" alert

NOTE="no new commit"
if ! git diff --cached --quiet; then
  commit_out="$(git commit -qm "alex: autosave $TS" 2>&1)"
  code=$?
  if [ "$code" -ne 0 ]; then
    finish "autosave: REFUSED - commit blocked (exit $code): $(lastline "$commit_out"); the work stays in the working tree, nothing pushed$REFUSED_NOTE" alert
  fi
  NOTE="committed $(git rev-parse --short HEAD)"
fi

# ---------------------------------------------------------------- 4. --stop: rebase, or rescue
PULL_NOTE=""
if [ "$MODE" = "stop" ]; then
  pull_out="$(git pull -q --rebase --autostash origin "$BRANCH" 2>&1)"
  code=$?
  if [ "$code" -ne 0 ]; then
    if [ -d "$(git rev-parse --git-path rebase-merge)" ] || [ -d "$(git rev-parse --git-path rebase-apply)" ]; then
      git rebase --abort >/dev/null 2>&1
      RESCUE="claude/rescue-$REF_TS"
      rescue_out="$(git push -q origin "HEAD:refs/heads/$RESCUE" 2>&1)"
      rcode=$?
      if [ "$rcode" -eq 0 ]; then
        finish "autosave: CONFLICT on $BRANCH, rebase aborted; $NOTE; HEAD pushed to $RESCUE instead (merge it from the next interactive session: git fetch origin && git merge origin/$RESCUE)$REFUSED_NOTE" alert
      fi
      finish "autosave: CONFLICT on $BRANCH, rebase aborted, AND the rescue push to $RESCUE FAILED (exit $rcode: $(lastline "$rescue_out")); $NOTE, and it exists only in this VM$REFUSED_NOTE" alert
    fi
    # no rebase in progress: the remote branch may not exist yet, or the fetch failed; the push
    # below reports its own result
    PULL_NOTE=" (pull --rebase did not run: $(lastline "$pull_out"))"
  fi
fi

# ---------------------------------------------------------------- 5. push the current branch
push_out="$(git push -q origin HEAD 2>&1)"
code=$?
if [ "$code" -ne 0 ]; then
  why="$(printf '%s\n' "$push_out" | grep -m 1 -E 'rejected|error|fatal')"
  [ -n "$why" ] || why="$(lastline "$push_out")"
  finish "autosave: $NOTE; push of $BRANCH FAILED (exit $code: $why); the Stop hook rebases and retries$PULL_NOTE$REFUSED_NOTE" alert
fi

if [ "$MODE" = "stop" ]; then
  local_head="$(git rev-parse HEAD)"
  remote_head="$(git ls-remote origin "refs/heads/$BRANCH" 2>/dev/null | cut -f 1)"
  if [ "$remote_head" != "$local_head" ]; then
    finish "autosave: $NOTE; $BRANCH pushed but the read-back DIFFERS (origin/$BRANCH is ${remote_head:-absent}, HEAD is $local_head)$PULL_NOTE$REFUSED_NOTE" alert
  fi
  finish "autosave: $NOTE; $BRANCH at $(git rev-parse --short HEAD) pushed to origin/$BRANCH and read back$PULL_NOTE$REFUSED_NOTE"
fi
finish "autosave: $NOTE; $BRANCH at $(git rev-parse --short HEAD) pushed to origin/$BRANCH$REFUSED_NOTE"
