#!/usr/bin/env python3
"""scripts/tests/test_vault_search_db_states.py - vault_search.py against an odd, busy or half-built index file.

WHAT. The index db is derived and disposable, so every subcommand meets it in states a clean build
never leaves: a file that is not a database, a 0-byte file, a meta table with no chunks table, a db
folder that cannot be made, a db another writer holds, and a db in the middle of a rebuild. The
rebuild is one transaction, so a second connection sees the old index, whole, until it commits, and
a build waits out another writer's lock before it succeeds. The behaviours known to be wrong are
pinned as they are, with PINNED DEFECT <id> in the test name, so a fix flips a named assertion.
Deleted, it would let a rebuild expose an empty or half-filled index to recall-inject.js, let a
build stop waiting for a writer that is about to let go, and let a broken, empty or locked db change
what each subcommand does with nothing to say so.

HOW. Mostly the real CLI as a child process, with ALEX_VAULT_DIR, ALEX_INDEX_DB and ALEX_READS_LOG
stripped from the inherited environment and set into a temp folder. Two things cannot be seen from
outside one process, so three tests load a byte-for-byte copy of the module in-process, with the same
names set BEFORE the import, because the module reads its paths at import time: what a second
connection sees while build() runs, and that the environment is not read again afterwards. The lock
tests wait out SQLite's default 5 s busy timeout, twice, on purpose: that wait IS the behaviour.

NEVER. Writes outside its own temp folder, which sits outside the repository, imports the module in
place (that would write scripts/__pycache__ into the checkout), reaches a network or touches a
scheduled task.

Usage: python scripts/tests/test_vault_search_db_states.py
Exit: 0 every test passed - 1 a test failed
"""

import contextlib
import importlib.util
import io
import os
import re
import shutil
import sqlite3
import subprocess
import sys
import tempfile
import time
import unittest
from collections.abc import Callable
from contextlib import closing
from pathlib import Path
from types import ModuleType, SimpleNamespace
from unittest import mock

HERE = Path(__file__).resolve()
SCRIPT = HERE.parent.parent / "vault_search.py"
REPO = HERE.parent.parent.parent
OWNED_ENV = ("ALEX_VAULT_DIR", "ALEX_INDEX_DB", "ALEX_READS_LOG", "PYTHONIOENCODING", "PYTHONUTF8")
NOTICE = "index stale (vault changed since last build) - rebuilding before search...\n"
NOT_A_DB = b"this is plain text sitting where the index should be, not an SQLite file\n" * 4


class Result:
    """A finished child: exit code and both streams, decoded as UTF-8 with Windows line endings folded."""

    def __init__(self, cp: subprocess.CompletedProcess[bytes]) -> None:
        self.code = cp.returncode
        self.out = cp.stdout.decode("utf-8").replace("\r\n", "\n")
        self.err = cp.stderr.decode("utf-8").replace("\r\n", "\n")

    def __repr__(self) -> str:
        return f"exit={self.code}\n--- stdout\n{self.out}--- stderr\n{self.err}"


class Sandbox(unittest.TestCase):
    """A temp vault of three pages dated an hour back, an index folder and a read log, outside the repo."""

    def setUp(self) -> None:
        td = tempfile.TemporaryDirectory(ignore_cleanup_errors=True)
        self.addCleanup(td.cleanup)
        self.root = Path(td.name).resolve()
        self.assertFalse(self.root.is_relative_to(REPO), "the temp folder must sit outside the repo")
        self.vault = self.root / "vault"
        self.db = self.root / "index" / "vault-search.db"
        self.db.parent.mkdir()
        self.log = self.root / "reads.jsonl"
        for i, word in enumerate(("bakery", "radar", "harbour")):
            p = self.vault / f"p{i}.md"
            p.parent.mkdir(parents=True, exist_ok=True)
            p.write_bytes(f"# Page {i}\nA line about the {word}.\n".encode())
            t = time.time() - 3600
            os.utime(p, (t, t))

    def env(self) -> dict[str, str]:
        """Return the inherited environment without the owned names, pointed into the sandbox."""
        env = {k: v for k, v in os.environ.items() if k not in OWNED_ENV}
        env.update(ALEX_VAULT_DIR=str(self.vault), ALEX_INDEX_DB=str(self.db), ALEX_READS_LOG=str(self.log))
        return env

    def vs(self, *args: str) -> Result:
        """Run the CLI with `args` in the sandbox and return the finished child."""
        return Result(
            subprocess.run([sys.executable, str(SCRIPT), *args], capture_output=True, env=self.env(), timeout=120)
        )


class OddFiles(Sandbox):
    def test_a_file_that_is_not_a_database_bricks_all_three_subcommands_PINNED_DEFECT_D3(self) -> None:
        self.db.write_bytes(NOT_A_DB)
        for cmd in (("search", "bakery"), ("build",), ("stats",)):
            with self.subTest(cmd=cmd[0]):
                r = self.vs(*cmd)
                self.assertEqual(r.code, 1, r)
                self.assertEqual(r.out, "", r)
                self.assertIn("sqlite3.DatabaseError: file is not a database", r.err)
        # build drops tables INSIDE the file instead of replacing it, so it cannot heal it.
        self.assertEqual(self.db.read_bytes(), NOT_A_DB)
        self.assertFalse(self.log.exists())

    def test_stats_on_an_empty_file_crashes_while_search_heals_it_PINNED_DEFECT_D4(self) -> None:
        self.db.write_bytes(b"")  # a 0-byte file is a valid, empty SQLite db
        r = self.vs("stats")
        self.assertEqual(r.code, 1, r)
        self.assertIn("sqlite3.OperationalError: no such table: meta", r.err)
        r = self.vs("search", "bakery")
        self.assertEqual(r.code, 0, r)
        self.assertIn("rebuilding", r.err)  # the word the freshness test reads; the notice's wording is its own pin
        self.assertIn("1. ", r.out)
        r = self.vs("stats")
        self.assertEqual(r.code, 0, r)
        self.assertIn("files:   3\n", r.out)

    def test_build_exits_1_when_the_db_folder_cannot_be_made(self) -> None:
        blocker = self.root / "a-file"
        blocker.write_bytes(b"a file where the index folder should go\n")
        env = self.env()
        env["ALEX_INDEX_DB"] = str(blocker / "sub" / "vault-search.db")
        r = Result(subprocess.run([sys.executable, str(SCRIPT), "build"], capture_output=True, env=env, timeout=120))
        self.assertEqual(r.code, 1, r)
        self.assertEqual(r.out, "", r)
        # The OS names it differently: FileExistsError on Windows, NotADirectoryError on POSIX.
        self.assertRegex(r.err, r"\n(FileExistsError|NotADirectoryError): ")

    def test_a_meta_table_without_chunks_rebuilds_before_the_search(self) -> None:
        with closing(sqlite3.connect(self.db)) as con:
            con.execute("CREATE TABLE meta(key TEXT PRIMARY KEY, val TEXT)")
            con.execute("INSERT INTO meta VALUES('built_epoch', ?)", (repr(time.time()),))
            con.commit()
        r = self.vs("search", "bakery")
        self.assertEqual(r.code, 0, r)
        self.assertTrue(r.err.startswith(NOTICE), r)
        self.assertIn("1. ", r.out)


class Locked(Sandbox):
    """Two writers exist on a laptop: the logon+20 index job and any search whose gate fired."""

    def hold_write_lock(self) -> sqlite3.Connection:
        """Take the db's write lock on a second connection, held until the test ends."""
        con = sqlite3.connect(self.db, isolation_level=None)
        con.execute("BEGIN IMMEDIATE")
        self.addCleanup(con.close)
        self.addCleanup(con.execute, "ROLLBACK")
        return con

    def test_build_waits_for_another_writer_and_succeeds_once_it_lets_go(self) -> None:
        # The rebuild takes the write lock at its BEGIN, where SQLite waits out the busy timeout. The lock
        # is held for 2 s and a three-page build takes milliseconds, so a build line reporting 0.5 s or
        # more proves the build met the lock and waited, rather than starting after the release.
        self.assertEqual(self.vs("build").code, 0)
        con = sqlite3.connect(self.db, isolation_level=None)
        self.addCleanup(con.close)
        con.execute("BEGIN IMMEDIATE")
        child = subprocess.Popen(
            [sys.executable, str(SCRIPT), "build"], stdout=subprocess.PIPE, stderr=subprocess.PIPE, env=self.env()
        )
        time.sleep(2.0)
        waiting = child.poll() is None
        con.execute("ROLLBACK")
        out, err = child.communicate(timeout=120)
        r = Result(subprocess.CompletedProcess(child.args, child.returncode, out, err))
        self.assertTrue(waiting, r)  # still running at the release: the lock held it and it did not give up
        self.assertEqual(r.code, 0, r)
        took = re.search(r" in (\d+\.\d\d)s -> ", r.out)
        assert took is not None, r
        self.assertGreaterEqual(float(took.group(1)), 0.5, r)

    def test_build_crashes_when_another_writer_holds_the_db_PINNED_DEFECT_D5(self) -> None:
        self.assertEqual(self.vs("build").code, 0)
        self.hold_write_lock()
        r = self.vs("build")
        self.assertEqual(r.code, 1, r)
        self.assertEqual(r.out, "", r)
        self.assertIn("sqlite3.OperationalError: database is locked", r.err)

    def test_a_search_that_must_rebuild_crashes_on_the_lock_while_one_that_need_not_reads_fine_PINNED_DEFECT_D5(
        self,
    ) -> None:
        self.assertEqual(self.vs("build").code, 0)
        self.hold_write_lock()
        r = self.vs("search", "bakery")  # fresh index: reading under a RESERVED lock works
        self.assertEqual(r.code, 0, r)
        self.assertEqual(r.err, "", r)
        self.assertIn("1. ", r.out)
        later = time.time() + 5
        os.utime(self.vault / "p0.md", (later, later))
        r = self.vs("search", "bakery")  # stale: the gate rebuilds, and the rebuild dies
        self.assertEqual(r.code, 1, r)
        self.assertTrue(r.err.startswith(NOTICE), r)
        self.assertIn("sqlite3.OperationalError: database is locked", r.err)


class InProcess(Sandbox):
    """White-box on purpose: build() is one call, so what another connection sees while it runs is
    visible only from inside it. chunk_file() runs once per page inside that window; wrapping it is
    the least invasive seam. A rewrite that renames build() or chunk_file() must port this test
    with it: it then errors by name rather than failing on its assertion."""

    def sandbox_env(self) -> contextlib.AbstractContextManager[object]:
        """Patch the three path variables into os.environ for the length of a with block."""
        return mock.patch.dict(
            os.environ,
            {"ALEX_VAULT_DIR": str(self.vault), "ALEX_INDEX_DB": str(self.db), "ALEX_READS_LOG": str(self.log)},
        )

    def load(self) -> ModuleType:
        """Import a byte-for-byte copy of vault_search.py from the temp folder, with the sandbox's env
        set first; importing the file in place would write scripts/__pycache__ into the tree."""
        copy = self.root / "vault_search_under_test.py"
        shutil.copy2(SCRIPT, copy)
        with self.sandbox_env():
            spec = importlib.util.spec_from_file_location("vault_search_under_test", copy)
            assert spec is not None
            mod = importlib.util.module_from_spec(spec)
            assert spec.loader is not None
            spec.loader.exec_module(mod)
        return mod

    def build(self, mod: ModuleType) -> None:
        # The env stays patched through the call too, so a rewrite that reads it lazily still
        # builds into this sandbox (only the import-time test cares WHEN it is read).
        with self.sandbox_env(), contextlib.redirect_stdout(io.StringIO()):
            self.assertEqual(mod.build(), 0)

    def test_a_reader_sees_the_old_index_during_a_rebuild_D5_FIXED(self) -> None:
        mod = self.load()
        self.build(mod)
        with closing(sqlite3.connect(self.db)) as con:
            self.assertEqual(con.execute("SELECT count(*) FROM chunks").fetchone()[0], 3)
        seen: list[tuple[int, int]] = []
        real: Callable[[str], list[tuple[str, str, int]]] = mod.chunk_file

        def spy(text: str) -> list[tuple[str, str, int]]:
            # A second connection, the way recall-inject.js opens the same file on every prompt.
            with closing(sqlite3.connect(self.db)) as con:
                seen.append(
                    (
                        con.execute("SELECT count(*) FROM chunks").fetchone()[0],
                        con.execute("SELECT count(*) FROM meta").fetchone()[0],
                    )
                )
            return real(text)

        with mock.patch.object(mod, "chunk_file", spy):
            self.build(mod)
        self.assertEqual(seen, [(3, 4)] * 3)  # the old index, whole, until the rebuild commits
        with closing(sqlite3.connect(self.db)) as con:
            self.assertEqual(con.execute("SELECT count(*) FROM chunks").fetchone()[0], 3)

    def test_a_reader_sees_the_old_index_after_the_rows_are_written_D5_FIXED(self) -> None:
        # The second seam: build() stamps built_at through the module's `time` once, after it has
        # written every chunk row and before the first meta row. The spy above only sees the chunking.
        mod = self.load()
        self.build(mod)
        seen: list[tuple[int, int]] = []

        def stamp(fmt: str) -> str:
            with closing(sqlite3.connect(self.db)) as con:
                seen.append(
                    (
                        con.execute("SELECT count(*) FROM chunks").fetchone()[0],
                        con.execute("SELECT count(*) FROM meta").fetchone()[0],
                    )
                )
            return time.strftime(fmt)

        with mock.patch.object(mod, "time", SimpleNamespace(time=time.time, strftime=stamp)):
            self.build(mod)
        self.assertEqual(seen, [(3, 4)])  # the rows and the meta commit together, or a reader sees (3, 0)
        with closing(sqlite3.connect(self.db)) as con:
            self.assertEqual(con.execute("SELECT count(*) FROM meta").fetchone()[0], 4)

    def test_the_paths_are_read_once_at_import_PINNED_DEFECT_D11(self) -> None:
        mod = self.load()
        with mock.patch.dict(os.environ, {"ALEX_INDEX_DB": str(self.root / "elsewhere.db")}):
            self.assertEqual(getattr(mod, "DB", None), self.db)
            self.assertEqual(getattr(mod, "VAULT", None), self.vault)
            self.assertEqual(getattr(mod, "READS_LOG", None), self.log)


if __name__ == "__main__":
    unittest.main(verbosity=2)
