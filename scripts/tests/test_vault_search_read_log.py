#!/usr/bin/env python3
"""scripts/tests/test_vault_search_read_log.py - the read log: one JSONL row per search, written to ALEX_READS_LOG.

WHAT. Every successful search, one that found nothing included, appends
{"ts": <local %Y-%m-%dT%H:%M:%S>, "query": <raw query>, "results": <count shown>} to ALEX_READS_LOG
(default system/vault-reads.jsonl). Nothing in the Kit reads it. Its one reader lives outside this
repository: a report script that parses ts[:19] with that format and int(results), so the row is a
contract with a reader no test here can run. This file holds the row, when a row is and is not
written, the file's line ending, and the fail-open write. Deleted, it would let through a reordered
or renamed key, an escaped query, a truncated log, a row for a search that failed, and a log write
that can change or break a search. Behaviour still wrong carries PINNED DEFECT <id> in its test name.

HOW. The real CLI as a child process against a temp vault, with ALEX_VAULT_DIR, ALEX_INDEX_DB and
ALEX_READS_LOG set into the temp folder and stripped from the inherited environment first. The
default-path tests copy vault_search.py into a temp folder laid out like a repo and run the copy with no
override, so the default log lands inside that folder, never in the tree. Times are asserted by shape only.

NEVER. Writes outside its own temp folder, reaches a network or touches a scheduled task.

Usage: python scripts/tests/test_vault_search_read_log.py
Exit: 0 every test passed - 1 a test failed
"""

import json
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
from datetime import datetime
from pathlib import Path
from typing import Any

HERE = Path(__file__).resolve()
SCRIPT = HERE.parent.parent / "vault_search.py"
REPO = HERE.parent.parent.parent
OWNED_ENV = ("ALEX_VAULT_DIR", "ALEX_INDEX_DB", "ALEX_READS_LOG", "PYTHONIOENCODING", "PYTHONUTF8")
TS = r"\A\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\Z"  # local time, no offset

PAGES = {
    "me/goals.md": "# Goals\n\n## This quarter\nShip the invoicing automation for the bakery.\n",
    "projects/demo/status.md": "# Demo status\n\n## Last run\nThe radar found three new invoicing feeds.\n",
    "people/lina.md": "# Lina\n\n## Where\nLina lives in G\u00f6teborg.\n",
}


class Result:
    """One finished child process: its exit code, and stdout and stderr decoded with LF line ends."""

    def __init__(self, cp: subprocess.CompletedProcess[bytes]) -> None:
        self.code = cp.returncode
        self.out = cp.stdout.decode("utf-8").replace("\r\n", "\n")
        self.err = cp.stderr.decode("utf-8").replace("\r\n", "\n")

    def blocks(self) -> int:
        """How many result blocks stdout holds."""
        return len([line for line in self.out.splitlines() if re.match(r"\d+\. ", line)])

    def __repr__(self) -> str:
        return f"exit={self.code}\n--- stdout\n{self.out}--- stderr\n{self.err}"


class Sandbox(unittest.TestCase):
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
            self.page(self.vault / rel, text)

    def page(self, p: Path, text: str) -> None:
        """Write text to p, an hour old."""
        p.parent.mkdir(parents=True, exist_ok=True)
        p.write_bytes(text.encode("utf-8"))
        t = time.time() - 3600
        os.utime(p, (t, t))

    def bare_env(self) -> dict[str, str]:
        """Return the inherited environment without the owned names."""
        return {k: v for k, v in os.environ.items() if k not in OWNED_ENV}

    def env(self, **extra: str) -> dict[str, str]:
        """Return the bare environment pointed into the sandbox, with `extra` on top."""
        env = self.bare_env()
        env.update(ALEX_VAULT_DIR=str(self.vault), ALEX_INDEX_DB=str(self.db), ALEX_READS_LOG=str(self.log))
        env.update(extra)
        return env

    def vs(self, *args: str, env: dict[str, str] | None = None, script: Path = SCRIPT) -> Result:
        """Run script with `args` under env, the sandbox's by default, and return the finished child."""
        return Result(
            subprocess.run(
                [sys.executable, str(script), *args], capture_output=True, env=env or self.env(), timeout=120
            )
        )

    def rows(self, path: Path | None = None) -> list[dict[str, Any]]:
        """Return the rows of the read log, or of another log, each parsed as JSON."""
        raw = (path or self.log).read_bytes().decode("utf-8")
        return [json.loads(line) for line in raw.splitlines()]


class Rows(Sandbox):
    """Searches against a built index."""

    def setUp(self) -> None:
        super().setUp()
        self.assertEqual(self.vs("build").code, 0)

    def test_one_row_per_search_with_three_keys_in_order_and_the_count_shown(self) -> None:
        searches = [(("bakery",), 1), (("nothingmatcheszq",), 0), (("invoicing", "-n", "1"), 1), (("invoicing",), 2)]
        for args, shown in searches:
            r = self.vs("search", *args)
            self.assertEqual(r.code, 0, r)
            self.assertEqual(r.blocks(), shown, r)
        rows = self.rows()
        self.assertEqual(len(rows), len(searches))
        for row, (args, shown) in zip(rows, searches, strict=True):
            with self.subTest(query=args[0]):
                self.assertEqual(list(row), ["ts", "query", "results"])
                self.assertEqual(row["query"], args[0])
                self.assertEqual(row["results"], shown)

    def test_ts_is_local_time_without_an_offset_PINNED_DEFECT_D13(self) -> None:
        self.vs("search", "bakery")
        self.assertRegex(self.rows()[0]["ts"], TS)

    def test_the_serialization_is_json_dumps_with_raw_utf8(self) -> None:
        self.assertEqual(self.vs("search", "G\u00f6teborg").code, 0)
        raw = self.log.read_bytes()
        self.assertIn("G\u00f6teborg".encode("utf-8"), raw)
        self.assertNotIn(b"\\u00f6", raw)
        line = raw.decode("utf-8").splitlines()[0]
        row = json.loads(line)
        self.assertEqual(
            line, json.dumps({"ts": row["ts"], "query": "G\u00f6teborg", "results": 1}, ensure_ascii=False)
        )

    def test_each_row_ends_with_the_platform_newline_PINNED_DEFECT_C1_N2(self) -> None:
        # The file is opened in TEXT append mode, so on Windows every JSONL row ends \r\n and on
        # macOS and Linux \n. The same log copied between machines mixes both.
        self.vs("search", "bakery")
        self.vs("search", "radar")
        raw = self.log.read_bytes()
        nl = os.linesep.encode()
        self.assertTrue(raw.endswith(nl), raw)
        self.assertEqual(raw.count(nl), 2)
        self.assertEqual(raw.count(b"\n"), 2)

    def test_the_query_is_stored_raw_not_as_the_search_terms(self) -> None:
        q = "  Bakery,  SHIP!  "
        r = self.vs("search", q)
        self.assertEqual(r.blocks(), 1, r)
        self.assertEqual(self.rows()[-1]["query"], q)

    def test_every_row_parses_the_way_its_outside_reader_parses_it(self) -> None:
        self.vs("search", "bakery")
        self.vs("search", "nothingmatcheszq")
        for row in self.rows():
            datetime.strptime(row["ts"][:19], "%Y-%m-%dT%H:%M:%S")
            self.assertIsInstance(row["results"], int)

    def test_rows_are_appended_never_truncated(self) -> None:
        self.log.write_bytes(b'{"ts": "2026-01-01T00:00:00", "query": "older", "results": 3}\n')
        self.vs("search", "bakery")
        rows = self.rows()
        self.assertEqual([r["query"] for r in rows], ["older", "bakery"])

    def test_a_search_that_rebuilt_first_writes_one_row(self) -> None:
        later = time.time() + 5
        os.utime(self.vault / "me" / "goals.md", (later, later))
        r = self.vs("search", "bakery")
        self.assertIn("rebuilding", r.err)
        self.assertEqual([row["query"] for row in self.rows()], ["bakery"])


class NoRow(Sandbox):
    """Runs that must not write a row."""

    def test_build_stats_and_an_empty_query_write_nothing(self) -> None:
        self.assertEqual(self.vs("build").code, 0)
        self.assertEqual(self.vs("stats").code, 0)
        self.assertEqual(self.vs("search", "  ").code, 2)
        self.assertFalse(self.log.exists())

    def test_a_search_error_writes_nothing(self) -> None:
        # A chunks table that is not the FTS5 index: the gate finds nothing stale and the query fails.
        self.db.parent.mkdir()
        with closing(sqlite3.connect(self.db)) as con:
            con.execute("CREATE TABLE meta(key TEXT PRIMARY KEY, val TEXT)")
            con.execute("INSERT INTO meta VALUES('built_epoch', ?)", (repr(time.time()),))
            con.execute("CREATE TABLE chunks(path TEXT)")
            con.commit()
        r = self.vs("search", "bakery")
        self.assertEqual(r.code, 2, r)
        self.assertEqual(r.out, "", r)
        # The prefix and one line, never SQLite's own message, which differs between versions.
        self.assertRegex(r.err, r"\Asearch error: .+\n\Z")
        self.assertFalse(self.log.exists())


class FailOpen(Sandbox):
    """A log that cannot be written never changes what the search prints or returns."""

    def setUp(self) -> None:
        super().setUp()
        self.assertEqual(self.vs("build").code, 0)
        self.expected = self.vs("search", "bakery", env=self.env(ALEX_READS_LOG=str(self.root / "ok.jsonl")))

    def test_an_unwritable_log_path_never_changes_the_search(self) -> None:
        blocked = self.root / "blocked.jsonl"
        blocked.mkdir()  # a folder where the file should be
        r = self.vs("search", "bakery", env=self.env(ALEX_READS_LOG=str(blocked)))
        self.assertEqual((r.code, r.out, r.err), (0, self.expected.out, ""))

    def test_a_missing_log_folder_is_swallowed_silently_PINNED_DEFECT_D14(self) -> None:
        missing = self.root / "no-such-folder" / "reads.jsonl"
        r = self.vs("search", "bakery", env=self.env(ALEX_READS_LOG=str(missing)))
        self.assertEqual((r.code, r.out, r.err), (0, self.expected.out, ""))
        self.assertFalse(missing.parent.exists())

    def test_a_query_the_log_cannot_encode_never_changes_the_search(self) -> None:
        # A lone surrogate: on POSIX subprocess passes it as the byte 0xff, which the child decodes back
        # under surrogateescape; on Windows it is an unpaired UTF-16 unit. The UTF-8 log write refuses it.
        r = self.vs("search", "bakery \udcff")
        self.assertEqual((r.code, r.out, r.err), (0, self.expected.out, ""))


class DefaultPath(Sandbox):
    """No ALEX_* override at all: the copy's defaults resolve inside the temp 'repo'."""

    def setUp(self) -> None:
        super().setUp()
        self.repo = self.root / "repo"
        (self.repo / "scripts").mkdir(parents=True)
        shutil.copy2(SCRIPT, self.repo / "scripts" / "vault_search.py")
        self.copy = self.repo / "scripts" / "vault_search.py"
        for rel, text in PAGES.items():
            self.page(self.repo / "vault" / rel, text)

    def test_the_default_log_is_system_vault_reads_jsonl(self) -> None:
        (self.repo / "system").mkdir()
        r = self.vs("search", "bakery", env=self.bare_env(), script=self.copy)
        self.assertEqual(r.code, 0, r)
        rows = self.rows(self.repo / "system" / "vault-reads.jsonl")
        self.assertEqual([(x["query"], x["results"]) for x in rows], [("bakery", 1)])

    def test_without_a_system_folder_nothing_is_logged_and_nothing_is_said_PINNED_DEFECT_D14(self) -> None:
        r = self.vs("search", "bakery", env=self.bare_env(), script=self.copy)
        self.assertEqual(r.code, 0, r)
        self.assertIn("1. vault/me/goals.md:3", r.out)
        self.assertFalse((self.repo / "system").exists())


if __name__ == "__main__":
    unittest.main(verbosity=2)
