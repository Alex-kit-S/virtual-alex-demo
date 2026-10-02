#!/usr/bin/env bash
# scripts/lib/session-branch.sh - puts a cloud session on GitHub's main before anything reads the tree.
#
# WHAT. Virtual Alex saves to main, and every session and Routine starts from main. claude.ai/code opens
# each one on a platform branch, claude/<name>, cut from origin/main, where a save never reaches the next
# session, and it keeps a cached git folder per repository, so the local main can be behind GitHub's or,
# after a repository was deleted and made again under the same name, an unrelated history. The online
# SessionStart hook runs this first, before the identity card is built; /update and the snapshot Routine
# run it by hand. It prints exactly one line, one of four shapes, and callers branch on its first word:
#   BRANCH: main                      this copy IS GitHub's main
#   BRANCH: main (<what it did>)      it is now, after a switch, a fast-forward or a rescue
#   ---BRANCH-NOT-MAIN--- ...         the session is on another branch, with the reason
#   ---BRANCH-DIVERGED--- ...         the session is on main, but this copy was NOT proved equal to
#                                     GitHub's main, with the reason
#
# HOW. Only main or a claude/ branch goes on, and only with a clean tree. It fetches origin main and takes
# FETCH_HEAD as the target, never the cached local main, which may be stale or unrelated. A claude/ branch
# moves only when it has no commits of its own. Commits only the cached local main carries are pushed first
# to claude/rescue-stale-main-<utc>-<commit>, the commit in the name so two rescues in the same second
# never collide. The platform's docs read stricter than what was actually measured: an interactive
# session pushed exactly this shape, a new claude/ branch that was not its current one, and the push
# succeeded, matching the Routines page ("a push to claude/ is always accepted") over the GitHub proxy
# page's stricter "current branch only" reading (see scripts/autosave.sh's OFF-MAIN comment for the
# same finding). The code below still checks: if a push like this one were ever refused, nothing moves.
# Then main is checked out
# at FETCH_HEAD and set to track origin/main. When the session is on main and this copy could not be proved
# equal to GitHub's, the line is the DIVERGED marker, never a note after the word main: a plain
# "BRANCH: main" over a stale tree lets a session read old content as current, and a marker gets quoted in
# the first reply. There is no set -e, on purpose: a git call that fails is an answer the script reads
# (symbolic-ref on a detached HEAD, a count it could not make), and set -e would end it there with no line
# and exit 1. CLAUDE_PROJECT_DIR names the checkout, and . when it is unset. bash 3.2 and BSD tools only
# (scripts/tests/portability-check.mjs P2 and P3). Tested by scripts/tests/test-session-branch.mjs and by
# T8b to T8h of scripts/tests/test-autosave.mjs.
#
# NEVER. Moves a dirty tree, or a claude/ branch with work of its own. Drops a commit: when the rescue push
# fails, nothing is moved and the line says so. Prints more than one line on stdout. Exits non-zero, because
# a start-up hook must never stop a session.
#
# Usage: CLAUDE_PROJECT_DIR=<checkout> bash scripts/lib/session-branch.sh
# Exit: 0 always; the line on stdout carries the result

project="${CLAUDE_PROJECT_DIR:-.}"
project_git() { git -C "$project" "$@"; }
branch="$(project_git symbolic-ref --short -q HEAD)"

not_main() {
  echo "---BRANCH-NOT-MAIN--- This session is on ${branch:-a detached HEAD}, not main ($1). Every save here lands on that branch, and the next session starts from main without it. Tell the owner that in one plain sentence in your first reply, before any other work."
  exit 0
}
diverged() {
  echo "---BRANCH-DIVERGED--- This session is on main, but this copy is NOT known to match GitHub's main ($1). What you read here may be old, and a save from here can land on top of work you cannot see. Tell the owner that in one plain sentence in your first reply, before any other work."
  exit 0
}
case "$branch" in
  main|claude/*) ;;
  *) not_main "this start-up step only moves a fresh claude/ branch" ;;
esac

if [ -n "$(project_git status --porcelain 2>/dev/null)" ]; then
  [ "$branch" = main ] && diverged "it has unsaved files, so nothing was synced with GitHub"
  not_main "it has unsaved files, so it was not moved"
fi

if ! project_git fetch -q origin main 2>/dev/null; then
  [ "$branch" = main ] && diverged "GitHub's main could not be fetched, so this copy was never compared with it"
  not_main "could not fetch GitHub's main"
fi
target="$(project_git rev-parse -q --verify FETCH_HEAD)" || not_main "no FETCH_HEAD after the fetch"

if [ "$branch" != main ]; then
  own="$(project_git rev-list --count "$target"..HEAD 2>/dev/null)"
  [ "${own:-1}" = 0 ] || not_main "it has commits of its own"
fi

# Commits only the cached local main carries: keep them on a rescue branch before moving.
note=""
if project_git rev-parse -q --verify refs/heads/main >/dev/null; then
  extra="$(project_git rev-list --count "$target"..refs/heads/main 2>/dev/null)"
  if [ "${extra:-0}" != 0 ]; then
    rescue="claude/rescue-stale-main-$(date -u +%Y%m%dT%H%M%SZ)-$(project_git rev-parse --short=12 refs/heads/main)"
    if project_git push -q origin "refs/heads/main:refs/heads/$rescue" 2>/dev/null; then
      note="the cached local main had $extra commit(s) that GitHub's main lacks, kept on $rescue"
    else
      [ "$branch" = main ] && diverged "the local main has $extra commit(s) GitHub's main lacks and they could not be kept on a rescue branch, so nothing was moved and no commit was dropped"
      not_main "the cached local main has commits that GitHub's main lacks and they could not be kept on a rescue branch"
    fi
  fi
fi

before="$(project_git rev-parse -q --verify HEAD)"
if ! project_git checkout -q -B main "$target" 2>/dev/null; then
  [ "$branch" = main ] && diverged "the checkout of GitHub's main failed, so this copy was left as it was"
  not_main "the checkout of GitHub's main failed"
fi
project_git branch -q --set-upstream-to=origin/main main >/dev/null 2>&1

msg=""
if [ "$branch" != main ]; then
  msg="switched from $branch, a fresh platform branch with no work of its own"
elif [ "$before" != "$target" ] && [ -z "$note" ]; then
  msg="fast-forwarded to GitHub's main"
fi
[ -n "$note" ] && msg="${msg:+$msg; }$note"
if [ -n "$msg" ]; then echo "BRANCH: main ($msg)"; else echo "BRANCH: main"; fi
exit 0
