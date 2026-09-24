#!/usr/bin/env python3
"""Before/after test for the vault_search freshness gate (feedback P1.5).

Bug: the nightly 21:35 FTS5 rebuild leaves an inverted staleness window. A fact captured
after the rebuild is grep-able immediately but invisible to BM25 until the next night, so the
better retrieval tool is the staler one.

Fix: `search` rebuilds whenever any vault file is newer than the index, so it can never return
silently stale results.

This test runs the real CLI (scripts/vault_search.py) against a throwaway sandbox vault via the
ALEX_VAULT_DIR / ALEX_INDEX_DB env overrides, so the live index is never touched. It asserts:
  BEFORE - a raw BM25 query against the un-rebuilt index misses a just-added fact (the bug exists).
  AFTER  - `search` on the same state finds it, because the gate rebuilt first (the fix works).

Run: python scripts/tests/test_vault_search_freshness.py   (exit 0 = pass, 1 = fail)
"""
import os
import sqlite3
import subprocess
import sys
import tempfile
from pathlib import Path

HERE = Path(__file__).resolve()
SCRIPT = HERE.parent.parent / "vault_search.py"

OLD_TERM = "zebraxyz"     # present at build time
NEW_TERM = "quokkaxyz"    # captured AFTER the build (the staleness window)

fails = []


def check(name, ok, detail=""):
    print(f"  [{'PASS' if ok else 'FAIL'}] {name}" + (f" - {detail}" if detail else ""))
    if not ok:
        fails.append(name)


def run(env, *args):
    return subprocess.run(
        [sys.executable, str(SCRIPT), *args],
        capture_output=True, text=True, env=env,
    )


def main():
    # ignore_cleanup_errors: on Windows the just-exited search subprocess can still hold the
    # .db handle for a beat; the test result does not depend on cleanup succeeding.
    with tempfile.TemporaryDirectory(ignore_cleanup_errors=True) as tmp:
        tmp = Path(tmp)
        vault = tmp / "vault"
        vault.mkdir()
        db = tmp / "index.db"
        env = dict(os.environ, ALEX_VAULT_DIR=str(vault), ALEX_INDEX_DB=str(db))

        # 1. Seed the vault and build the index.
        (vault / "a.md").write_text(
            f"# Alpha\n\nThe {OLD_TERM} fact was known at build time.\n", encoding="utf-8")
        r = run(env, "build")
        check("initial build succeeds", r.returncode == 0, r.stderr.strip() or r.stdout.strip())
        check("index db created", db.exists())

        # 2. Baseline: the old fact is findable.
        r = run(env, "search", OLD_TERM)
        check("build-time fact is findable", OLD_TERM in r.stdout.lower() or "1." in r.stdout,
              r.stdout.strip()[:80])

        # 3. Capture a NEW fact after the build (this is the post-21:35 staleness window).
        newfile = vault / "b.md"
        newfile.write_text(
            f"# Beta\n\nThe {NEW_TERM} fact was captured after the nightly rebuild.\n",
            encoding="utf-8")
        # Guarantee its mtime is strictly newer than the recorded build epoch.
        con = sqlite3.connect(db)
        built_epoch = float(con.execute(
            "SELECT val FROM meta WHERE key='built_epoch'").fetchone()[0])
        con.close()
        check("new file mtime is newer than the index", newfile.stat().st_mtime > built_epoch,
              f"mtime={newfile.stat().st_mtime:.3f} built={built_epoch:.3f}")

        # 4. BEFORE (bug reproduced): a raw BM25 query against the un-rebuilt index misses it.
        con = sqlite3.connect(db)
        rows = con.execute(
            'SELECT path FROM chunks WHERE chunks MATCH ?', (f'"{NEW_TERM}"',)).fetchall()
        con.close()
        check("BEFORE: raw index misses the new fact (staleness window exists)", rows == [],
              f"rows={rows}")

        # 5. AFTER (fix): the gated `search` finds it, having rebuilt because the vault changed.
        r = run(env, "search", NEW_TERM)
        found = "b.md" in r.stdout
        rebuilt = "rebuilding" in r.stderr.lower()
        check("AFTER: search finds the new fact", found, r.stdout.strip()[:80])
        check("AFTER: the gate rebuilt before searching", rebuilt, r.stderr.strip()[:80])

        # 6. No-op guarantee: a second search with nothing changed does NOT rebuild.
        r = run(env, "search", NEW_TERM)
        check("stable index does not rebuild on every search",
              "rebuilding" not in r.stderr.lower(), r.stderr.strip()[:80])

    print()
    if fails:
        print(f"RESULT: FAIL ({len(fails)} failing: {', '.join(fails)})")
        return 1
    print("RESULT: PASS (freshness gate closes the staleness window)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
