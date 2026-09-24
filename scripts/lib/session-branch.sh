#!/usr/bin/env bash
# scripts/lib/session-branch.sh - Virtual Alex: put a cloud session on GitHub's main before anything
# reads the tree. The online SessionStart hook calls it FIRST, before the identity card is built,
# and it prints exactly one line, one of four shapes:
#   BRANCH: main                      this copy IS GitHub's main
#   BRANCH: main (<what it did>)      it is now, after a switch, a fast-forward or a rescue
#   ---BRANCH-NOT-MAIN--- ...         the session is on another branch, with the reason
#   ---BRANCH-DIVERGED--- ...         the session is on main but this copy was NOT proved equal to
#                                     GitHub's main, with the reason. A marker, never a note after
#                                     the word main: a plain `BRANCH: main` over a stale tree is
#                                     what let a session read old content as current on 2026-09-23.
#
# WHY (both measured on 2026-09-23 against a real test repository):
#   1. claude.ai/code starts every session and every Routine on a platform branch `claude/<name>`
#      cut from origin/main, not on main, so a save there never reaches the next session.
#   2. The platform keeps a cached git directory per repository across sessions, so the LOCAL
#      `main` of a fresh session can be stale: behind origin/main, or, after a repository was
#      deleted and made again under the same name, an unrelated history. The first version of this
#      switch checked out that cached main, could not fast-forward it, stopped quietly, and a
#      session opened on old content with no identity under a plain `BRANCH: main`.
# So the target is always GitHub's main (FETCH_HEAD after a fetch), never the cached local ref.
#
# RULES:
#   - Only a CLEAN tree is ever moved: a claude/ branch with no commits of its own, or main itself.
#   - Commits that exist only on the cached local main are never dropped. They are pushed to
#     `claude/rescue-stale-main-<utc>-<commit>` first (a claude/ branch is always accepted), and if that push
#     fails, nothing is moved and the line says so.
#   - Exit 0 always: a start-up hook must never stop a session.
#
# bash 3.2 and BSD tools only (scripts/tests/portability-check.mjs P2 and P3).
# Test: node scripts/tests/test-autosave.mjs (T8b to T8f).

PD="${CLAUDE_PROJECT_DIR:-.}"
g() { git -C "$PD" "$@"; }
B="$(g symbolic-ref --short -q HEAD)"

not_main() {
  echo "---BRANCH-NOT-MAIN--- This session is on ${B:-a detached HEAD}, not main ($1). Every save here lands on that branch, and the next session starts from main without it. Tell the owner that in one plain sentence in your first reply, before any other work."
  exit 0
}
# The session IS on main, but this copy was NOT proved equal to GitHub's main. That is the case
# that has to be LOUD rather than a parenthetical: on 2026-09-23 a session opened on the platform's
# cached copy of a deleted repository, the sync failed, the screen said a plain `BRANCH: main`, and
# the model read a tree with no identity in it while believing it was current. A marker gets quoted
# in the first reply; a note after the word main does not.
diverged() {
  echo "---BRANCH-DIVERGED--- This session is on main, but this copy is NOT known to match GitHub's main ($1). What you read here may be old, and a save from here can land on top of work you cannot see. Tell the owner that in one plain sentence in your first reply, before any other work."
  exit 0
}
case "$B" in
  main|claude/*) ;;
  *) not_main "this start-up step only moves a fresh claude/ branch" ;;
esac

if [ -n "$(g status --porcelain 2>/dev/null)" ]; then
  [ "$B" = main ] && diverged "it has unsaved files, so nothing was synced with GitHub"
  not_main "it has unsaved files, so it was not moved"
fi

if ! g fetch -q origin main 2>/dev/null; then
  [ "$B" = main ] && diverged "GitHub's main could not be fetched, so this copy was never compared with it"
  not_main "could not fetch GitHub's main"
fi
T="$(g rev-parse -q --verify FETCH_HEAD)" || not_main "no FETCH_HEAD after the fetch"

if [ "$B" != main ]; then
  own="$(g rev-list --count "$T"..HEAD 2>/dev/null)"
  [ "${own:-1}" = 0 ] || not_main "it has commits of its own"
fi

# Commits only the cached local main carries: keep them on a rescue branch before moving.
note=""
if g rev-parse -q --verify refs/heads/main >/dev/null; then
  extra="$(g rev-list --count "$T"..refs/heads/main 2>/dev/null)"
  if [ "${extra:-0}" != 0 ]; then
    # The commit rides in the name, not only the second: two rescues within one second (two VMs, or
    # two tests on a fast runner) used to get the same name, and the second push was refused.
    R="claude/rescue-stale-main-$(date -u +%Y%m%dT%H%M%SZ)-$(g rev-parse --short=12 refs/heads/main)"
    if g push -q origin "refs/heads/main:refs/heads/$R" 2>/dev/null; then
      note="the cached local main had $extra commit(s) that GitHub's main lacks, kept on $R"
    else
      [ "$B" = main ] && diverged "the local main has $extra commit(s) GitHub's main lacks and they could not be kept on a rescue branch, so nothing was moved and no commit was dropped"
      not_main "the cached local main has commits that GitHub's main lacks and they could not be kept on a rescue branch"
    fi
  fi
fi

before="$(g rev-parse -q --verify HEAD)"
if ! g checkout -q -B main "$T" 2>/dev/null; then
  [ "$B" = main ] && diverged "the checkout of GitHub's main failed, so this copy was left as it was"
  not_main "the checkout of GitHub's main failed"
fi
g branch -q --set-upstream-to=origin/main main >/dev/null 2>&1

msg=""
if [ "$B" != main ]; then
  msg="switched from $B, a fresh platform branch with no work of its own"
elif [ "$before" != "$T" ] && [ -z "$note" ]; then
  msg="fast-forwarded to GitHub's main"
fi
[ -n "$note" ] && msg="${msg:+$msg; }$note"
if [ -n "$msg" ]; then echo "BRANCH: main ($msg)"; else echo "BRANCH: main"; fi
exit 0
