#!/usr/bin/env python3
"""scripts/tests/test_vault_search_freshness.py - a page written after the build is found by the next search.

WHAT. The one case the freshness gate exists for. A nightly rebuild alone leaves a window in which a
page written after it is findable by grep but missing from the BM25 index, so the better tool is the
staler one. `search` closes that window by rebuilding first whenever the vault moved past the index.
This file shows the window is real in the raw index, that `search` finds the new fact anyway, and
that it rebuilds once and not again. Deleted, it would let through a gate that no longer notices a
new page, a rebuild that leaves the build marker behind so every search rebuilds, and a search that
exits non-zero while still printing its results. Every other trigger and blind spot of the gate is
test_vault_search_rebuild.py's concern.

HOW. The real CLI as a child process against a temp vault, with ALEX_VAULT_DIR, ALEX_INDEX_DB and
ALEX_READS_LOG set into the temp folder and every variable this file owns stripped from the inherited
environment first. Every test builds the index from one page; three of the five then write a second
page and read the build marker (meta.built_epoch) straight from the index file. A hit is recognised by
its numbered result line, never by the query's words, because a miss echoes the query back.

NEVER. Writes outside its own temp folder, the checkout's index and read log included, reaches a
network or touches a scheduled task.

Usage: python scripts/tests/test_vault_search_freshness.py
Exit: 0 every test passed - 1 a test failed
"""

import os
import re
import sqlite3
import subprocess
import sys
import tempfile
import time
import unittest
from contextlib import closing
from pathlib import Path, PurePosixPath

HERE = Path(__file__).resolve()
SCRIPT = HERE.parent.parent / "vault_search.py"
OWNED_ENV = ("ALEX_VAULT_DIR", "ALEX_INDEX_DB", "ALEX_READS_LOG", "PYTHONIOENCODING", "PYTHONUTF8")

OLD_TERM = "zebraxyz"  # on the page the index is built from
NEW_TERM = "quokkaxyz"  # on the page written after the build
# A result block opens with "<n>. <stored path>:<line>", then two spaces and the heading trail when
# the hit has one. The stored path may hold a drive colon, so the line number is matched last.
RESULT_LINE = re.compile(r"^\d+\. (.+?):\d+(?:  \[.*\])?$", re.MULTILINE)


class Result:
    """One finished child process: its exit code, and stdout and stderr decoded with LF line ends."""

    def __init__(self, cp: subprocess.CompletedProcess[bytes]) -> None:
        self.code = cp.returncode
        self.out = cp.stdout.decode("utf-8").replace("\r\n", "\n")
        self.err = cp.stderr.decode("utf-8").replace("\r\n", "\n")

    def hits(self) -> list[str]:
        """The file name of every hit, in the order the search printed them."""
        return [PurePosixPath(m.group(1)).name for m in RESULT_LINE.finditer(self.out)]

    def __repr__(self) -> str:
        return f"exit={self.code}\n--- stdout\n{self.out}--- stderr\n{self.err}"


class StalenessWindow(unittest.TestCase):
    """A vault with one page and a fresh index built from it; each test writes a second page."""

    def setUp(self) -> None:
        # ignore_cleanup_errors: on Windows a child that just exited can hold the db handle for a beat,
        # and no result here depends on the cleanup.
        td = tempfile.TemporaryDirectory(ignore_cleanup_errors=True)
        self.addCleanup(td.cleanup)
        root = Path(td.name).resolve()
        self.vault = root / "vault"
        self.vault.mkdir()
        self.db = root / "index.db"
        self.log = root / "reads.jsonl"
        (self.vault / "a.md").write_text(f"# Alpha\n\nThe {OLD_TERM} fact was known at build time.\n", encoding="utf-8")
        built = self.vs("build")
        self.assertEqual(built.code, 0, built)
        self.assertTrue(self.db.exists(), "the build made no index file")

    def vs(self, *args: str) -> Result:
        """Run vault_search.py with args against this test's vault, index and read log."""
        env = {k: v for k, v in os.environ.items() if k not in OWNED_ENV}
        env.update(ALEX_VAULT_DIR=str(self.vault), ALEX_INDEX_DB=str(self.db), ALEX_READS_LOG=str(self.log))
        return Result(subprocess.run([sys.executable, str(SCRIPT), *args], capture_output=True, env=env, timeout=120))

    def built_epoch(self) -> float:
        """The build marker the gate compares page mtimes against, read from the index file itself."""
        with closing(sqlite3.connect(self.db)) as con:
            row = con.execute("SELECT val FROM meta WHERE key='built_epoch'").fetchone()
        self.assertIsNotNone(row, "the build wrote no built_epoch row, so the gate has no boundary to compare with")
        return float(row[0])

    def capture_after_the_build(self) -> Path:
        """Write the second page, and prove it is newer than the build, as the gate needs it to be.

        A write right after the build can land in the SAME clock tick as built_epoch (Windows'
        time.time() ticks as coarsely as 15.6 ms on a default-resolution host), so the mtime the
        filesystem stamps it with is not reliably greater than built. Set it explicitly a little past
        the marker instead of depending on the write's own timing: never a whole second ahead, which
        would meet D22 (a future mtime rebuilds every search) and make the no-second-rebuild test fail.
        Then wait until the clock is past that mtime: on a fast machine the next search's rebuild can
        start within 0.05 s of the first build, and a rebuild that starts before the page's mtime leaves
        the page newer than its own marker, so the search after it would rebuild again."""
        page = self.vault / "b.md"
        page.write_text(f"# Beta\n\nThe {NEW_TERM} fact was captured after the nightly rebuild.\n", encoding="utf-8")
        built = self.built_epoch()
        mtime = built + 0.05
        os.utime(page, (mtime, mtime))
        self.assertGreater(
            page.stat().st_mtime,
            built,
            f"the new page is not newer than the index: mtime={mtime:.3f} built={built:.3f}",
        )
        while time.time() <= mtime:
            time.sleep(0.01)
        return page

    def test_a_fact_known_at_build_time_is_found(self) -> None:
        r = self.vs("search", OLD_TERM)
        self.assertEqual(r.code, 0, r)
        self.assertEqual(r.hits(), ["a.md"], r)

    def test_the_raw_index_misses_a_fact_captured_after_the_build(self) -> None:
        self.capture_after_the_build()
        with closing(sqlite3.connect(self.db)) as con:
            rows = con.execute("SELECT path FROM chunks WHERE chunks MATCH ?", (f'"{NEW_TERM}"',)).fetchall()
        self.assertEqual(rows, [], "the window this file is about did not open")

    def test_the_next_search_rebuilds_first_and_finds_it(self) -> None:
        self.capture_after_the_build()
        r = self.vs("search", NEW_TERM)
        self.assertEqual(r.code, 0, r)
        self.assertEqual(r.hits(), ["b.md"], r)
        self.assertIn("rebuilding", r.err.lower(), r)

    def test_a_search_after_that_rebuild_does_not_rebuild_again(self) -> None:
        self.capture_after_the_build()
        self.vs("search", NEW_TERM)
        r = self.vs("search", NEW_TERM)
        self.assertEqual(r.code, 0, r)
        self.assertNotIn("rebuilding", r.err.lower(), r)

    def test_every_search_logs_its_read_inside_the_sandbox(self) -> None:
        # The checkout's own read log is the default, so a run that forgot ALEX_READS_LOG would append
        # a row there on every search. Each search this file makes must land here instead.
        for _ in range(2):
            self.assertEqual(self.vs("search", OLD_TERM).code, 0)
        self.assertTrue(self.log.exists(), "no search wrote the sandbox read log")
        self.assertEqual(len(self.log.read_bytes().splitlines()), 2)


if __name__ == "__main__":
    unittest.main(verbosity=2)
