#!/usr/bin/env python3
"""scripts/tests/test_vault_search_rebuild.py - when `search` rebuilds the vault index first, and what it prints.

WHAT. Every trigger of the freshness gate: no index file, no build marker, a marker that is not a number,
an edited or unretired page, and an indexed page that is no longer a page (deleted, renamed or newly
retired). Also its strict comparison, a fresh index left alone, and where a rebuild inside a search prints.
Deleted, it would let through a gate that misses a trigger or fires on every search, and a build line
that lands among the results. Behaviour still wrong carries PINNED DEFECT <id> in its test name, so a
fix flips a named assertion.

HOW. The real CLI as a child process against a temp vault, ALEX_VAULT_DIR, ALEX_INDEX_DB and
ALEX_READS_LOG set into the temp folder and stripped from the inherited environment first. Mtimes are set
relative to the build's own recorded built_epoch, never slept for, so no test depends on the filesystem's
timestamp resolution or on the date. The one case the gate exists for, a page written after the build and
found by the next search, is test_vault_search_freshness.py's.

NEVER. Writes outside its own temp folder, reaches a network or touches a scheduled task.

Usage: python scripts/tests/test_vault_search_rebuild.py
Exit: 0 every test passed - 1 a test failed
"""

import os
import re
import shutil
import sqlite3
import subprocess
import sys
import tempfile
import time
import unittest
from contextlib import closing
from pathlib import Path

HERE = Path(__file__).resolve()
SCRIPT = HERE.parent.parent / "vault_search.py"
REPO = HERE.parent.parent.parent
OWNED_ENV = ("ALEX_VAULT_DIR", "ALEX_INDEX_DB", "ALEX_READS_LOG", "PYTHONIOENCODING", "PYTHONUTF8")
NOTICE = "index stale (vault changed since last build) - rebuilding before search...\n"
BUILD_LINE = r"indexed \d+ files -> \d+ chunks in \d+\.\d\ds -> .+"

PAGES = {
    "me/goals.md": "# Goals\n\n## This quarter\nShip the invoicing automation for the bakery.\n",
    "projects/demo/status.md": "# Demo status\n\n## Last run\nThe radar found three new feeds.\n",
    "notes/keep.md": "# Keep\nA page nobody edits.\n",
}


class Result:
    """One finished child process: its exit code, and stdout and stderr decoded with LF line ends."""

    def __init__(self, cp: subprocess.CompletedProcess[bytes]) -> None:
        self.code = cp.returncode
        self.out = cp.stdout.decode("utf-8").replace("\r\n", "\n")
        self.err = cp.stderr.decode("utf-8").replace("\r\n", "\n")

    def __repr__(self) -> str:
        return f"exit={self.code}\n--- stdout\n{self.out}--- stderr\n{self.err}"


class Gate(unittest.TestCase):
    """A temp vault of three pages an hour old, and the CLI run against it."""

    def setUp(self) -> None:
        td = tempfile.TemporaryDirectory(ignore_cleanup_errors=True)
        self.addCleanup(td.cleanup)
        self.root = Path(td.name).resolve()
        self.assertFalse(self.root.is_relative_to(REPO), "the temp folder must sit outside the repo")
        self.vault = self.root / "vault"
        self.db = self.root / "index" / "vault-search.db"
        self.log = self.root / "reads.jsonl"
        for rel, text in PAGES.items():
            self.page(rel, text)

    # -- helpers ---------------------------------------------------------------------------------
    def env(self) -> dict[str, str]:
        """Return the inherited environment without the owned names, pointed into the sandbox."""
        env = {k: v for k, v in os.environ.items() if k not in OWNED_ENV}
        env.update(ALEX_VAULT_DIR=str(self.vault), ALEX_INDEX_DB=str(self.db), ALEX_READS_LOG=str(self.log))
        return env

    def page(self, rel: str, text: str, mtime: float | None = None) -> Path:
        """Write text to rel under the vault, an hour old unless mtime is given, and return its path."""
        p = self.vault / rel
        p.parent.mkdir(parents=True, exist_ok=True)
        p.write_bytes(text.encode("utf-8"))
        t = time.time() - 3600 if mtime is None else mtime
        os.utime(p, (t, t))
        return p

    def vs(self, *args: str) -> Result:
        """Run the CLI with `args` in the sandbox and return the finished child."""
        return Result(
            subprocess.run([sys.executable, str(SCRIPT), *args], capture_output=True, env=self.env(), timeout=120)
        )

    def build(self) -> Result:
        """Build the index, assert it exited 0, and return the finished child."""
        r = self.vs("build")
        self.assertEqual(r.code, 0, r)
        return r

    def epoch_text(self) -> str | None:
        """Return the built_epoch row's text, or None when the index holds no such row."""
        with closing(sqlite3.connect(self.db)) as con:
            row = con.execute("SELECT val FROM meta WHERE key='built_epoch'").fetchone()
        return None if row is None else row[0]

    def epoch(self) -> float:
        """Return built_epoch as a float, failing the test when the row is missing."""
        text = self.epoch_text()
        assert text is not None, "the index holds no built_epoch row"
        return float(text)

    def set_meta(self, sql: str, *params: object) -> None:
        """Run one statement with params against the index and commit it."""
        with closing(sqlite3.connect(self.db)) as con:
            con.execute(sql, params)
            con.commit()

    def loc(self, rel: str) -> str:
        """Return the path the index stores for rel: the vault sits outside the repo, so the absolute one."""
        return (self.vault / rel).as_posix()

    def assertNoRebuild(self, r: Result) -> None:
        """Assert the search exited 0 with stderr empty and no build line on stdout."""
        self.assertEqual(r.code, 0, r)
        self.assertEqual(r.err, "", r)
        self.assertNotRegex(r.out, BUILD_LINE)

    def assertRebuilt(self, r: Result) -> None:
        """Assert the search exited 0 and opened stderr with the rebuild notice."""
        # Only the notice, which opens stderr. Where the build line lands is one test's own concern,
        # so a change there fails that test and none of the tests that call this.
        self.assertEqual(r.code, 0, r)
        self.assertTrue(r.err.startswith(NOTICE), r)

    # -- triggers ------------------------------------------------------------------------------------
    def test_no_db_rebuilds_and_the_notice_claims_a_last_build_PINNED_DEFECT_D9(self) -> None:
        r = self.vs("search", "bakery")
        self.assertRebuilt(r)  # the notice says "since last build"; there was none
        self.assertTrue(self.db.exists())
        self.assertIn(f"1. {self.loc('me/goals.md')}:3  [Goals > This quarter]\n", r.out)

    def test_a_fresh_index_does_not_rebuild(self) -> None:
        self.build()
        before = self.epoch_text()
        r = self.vs("search", "bakery")
        self.assertNoRebuild(r)
        self.assertTrue(r.out.startswith("1. "), r)
        self.assertEqual(self.epoch_text(), before)

    def test_the_rebuild_line_goes_to_stderr_after_the_notice_D1_FIXED(self) -> None:
        self.build()
        self.page("notes/keep.md", "# Keep\nA page somebody edited.\n", mtime=self.epoch() + 10)
        r = self.vs("search", "bakery")
        self.assertEqual(r.code, 0, r)
        self.assertTrue(r.err.startswith(NOTICE), r)  # the notice first on stderr ...
        self.assertRegex(
            r.err[len(NOTICE) :],
            r"\Aindexed 3 files -> 3 chunks in \d+\.\d\ds -> " + re.escape(self.db.as_posix()) + r"\n\Z",
        )  # ... then the build line
        self.assertEqual(
            r.out,
            f"1. {self.loc('me/goals.md')}:3  [Goals > This quarter]\n"
            "   Ship the invoicing automation for the >>bakery<<.\n\n",
        )

    def test_a_missing_built_epoch_row_rebuilds(self) -> None:
        self.build()
        self.set_meta("DELETE FROM meta WHERE key='built_epoch'")
        self.assertRebuilt(self.vs("search", "bakery"))
        self.assertIsNotNone(self.epoch_text())

    def test_a_built_epoch_that_is_not_a_number_rebuilds(self) -> None:
        self.build()
        self.set_meta("UPDATE meta SET val='not-a-number' WHERE key='built_epoch'")
        self.assertRebuilt(self.vs("search", "bakery"))
        self.epoch()  # a float again

    def test_an_edited_page_rebuilds_and_its_new_text_is_found(self) -> None:
        self.build()
        self.page("notes/keep.md", "# Keep\nA page that now mentions a pangolin.\n", mtime=self.epoch() + 10)
        r = self.vs("search", "pangolin")
        self.assertRebuilt(r)
        self.assertIn(f"1. {self.loc('notes/keep.md')}:1  [Keep]\n", r.out)

    def test_the_comparison_is_strictly_newer_PINNED_DEFECT_D12(self) -> None:
        # The gate rebuilds only for a page strictly newer than built_epoch: an equal mtime is fresh.
        self.build()
        newest = max(p.stat().st_mtime for p in self.vault.rglob("*.md"))
        self.set_meta("UPDATE meta SET val=? WHERE key='built_epoch'", repr(newest))
        self.assertNoRebuild(self.vs("search", "bakery"))
        self.set_meta("UPDATE meta SET val=? WHERE key='built_epoch'", repr(newest - 0.5))
        self.assertRebuilt(self.vs("search", "bakery"))

    def test_a_future_mtime_rebuilds_on_every_search_PINNED_DEFECT_D22(self) -> None:
        self.build()
        self.page("notes/keep.md", "# Keep\nA page from a machine whose clock runs ahead.\n", mtime=time.time() + 86400)
        for attempt in (1, 2, 3):
            with self.subTest(search=attempt):
                self.assertRebuilt(self.vs("search", "bakery"))

    def test_an_unretired_page_rebuilds_and_comes_back(self) -> None:
        self.page("notes/old.md", "---\nstatus: retired\n---\n# Old\nThe okapi page.\n")
        self.build()
        self.assertEqual(self.vs("search", "okapi").out, "no matches for: okapi\n")
        self.page("notes/old.md", "---\nstatus: active\n---\n# Old\nThe okapi page.\n", mtime=self.epoch() + 10)
        r = self.vs("search", "okapi")
        self.assertRebuilt(r)
        self.assertIn(f"1. {self.loc('notes/old.md')}:4  [Old]\n", r.out)

    # -- the three cases an mtime scan cannot see ----------------------------------------------------------
    def test_a_deleted_page_rebuilds_and_is_no_longer_returned_D2_FIXED(self) -> None:
        self.build()
        (self.vault / "me" / "goals.md").unlink()
        r = self.vs("search", "bakery")
        self.assertRebuilt(r)
        self.assertNotIn(self.loc("me/goals.md"), r.out)
        self.assertEqual(r.out, "no matches for: bakery\n", r)

    def test_a_renamed_page_rebuilds_and_is_returned_under_its_new_path_D2_FIXED(self) -> None:
        self.build()
        old = self.vault / "projects" / "demo" / "status.md"
        new = self.vault / "projects" / "demo" / "renamed.md"
        mtime = old.stat().st_mtime
        old.replace(new)
        os.utime(new, (mtime, mtime))  # a rename keeps the content's mtime; make it explicit
        r = self.vs("search", "radar")
        self.assertRebuilt(r)
        self.assertIn(self.loc("projects/demo/renamed.md"), r.out)
        self.assertNotIn(self.loc("projects/demo/status.md"), r.out)

    def test_a_newly_retired_page_rebuilds_and_is_no_longer_returned_D2_FIXED(self) -> None:
        self.build()
        self.page(
            "me/goals.md",
            "---\nstatus: retired\n---\n# Goals\nShip the invoicing automation for the bakery.\n",
            mtime=self.epoch() + 10,
        )
        r = self.vs("search", "bakery")
        self.assertRebuilt(r)  # the mtime scan skips a retired page; the path check sees it
        self.assertNotIn(self.loc("me/goals.md"), r.out)
        self.assertEqual(r.out, "no matches for: bakery\n", r)

    def test_a_page_with_no_chunks_does_not_rebuild_every_search(self) -> None:
        # An empty page is a file the index holds no row for, so the check asks whether every indexed
        # path is still a page, and never the reverse.
        self.page("notes/empty.md", "")
        self.build()
        self.assertNoRebuild(self.vs("search", "bakery"))


class ShippedLayout(unittest.TestCase):
    """The layout an install runs: a temp folder laid out as the repository, with the vault inside it."""

    def setUp(self) -> None:
        td = tempfile.TemporaryDirectory(ignore_cleanup_errors=True)
        self.addCleanup(td.cleanup)
        self.repo = Path(td.name).resolve()
        self.assertFalse(self.repo.is_relative_to(REPO), "the temp folder must sit outside the repo")
        for rel, text in PAGES.items():
            p = self.repo / "vault" / rel
            p.parent.mkdir(parents=True, exist_ok=True)
            p.write_bytes(text.encode("utf-8"))
            t = time.time() - 3600
            os.utime(p, (t, t))
        (self.repo / "scripts").mkdir()
        (self.repo / "system").mkdir()
        self.copy = self.repo / "scripts" / "vault_search.py"
        shutil.copy2(SCRIPT, self.copy)

    def run_copy(self, *args: str) -> Result:
        """Run the copy with no ALEX_* override, so every path takes its default inside the temp repo."""
        env = {k: v for k, v in os.environ.items() if k not in OWNED_ENV}
        return Result(
            subprocess.run([sys.executable, str(self.copy), *args], capture_output=True, env=env, timeout=120)
        )

    def test_a_fresh_index_in_the_shipped_layout_does_not_rebuild(self) -> None:
        # Here the index stores a page's path repo-relative, so the path check must read the vault the
        # same way. Every other test keeps the vault outside the repo, where both forms are absolute.
        self.assertEqual(self.run_copy("build").code, 0)
        for attempt in (1, 2):
            with self.subTest(search=attempt):
                r = self.run_copy("search", "bakery")
                self.assertEqual(r.code, 0, r)
                self.assertEqual(r.err, "", r)
                self.assertEqual(
                    r.out,
                    "1. vault/me/goals.md:3  [Goals > This quarter]\n"
                    "   Ship the invoicing automation for the >>bakery<<.\n\n",
                )


if __name__ == "__main__":
    unittest.main(verbosity=2)
