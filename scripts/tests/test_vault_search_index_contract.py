#!/usr/bin/env python3
"""scripts/tests/test_vault_search_index_contract.py - the index vault_search.py builds, held as its readers' contract.

WHAT. system/recall/recall-inject.js opens the same index (the same env name ALEX_INDEX_DB, the same
default path) on every prompt and runs its own SQL, whose `snippet(chunks,2,...)` and
`bm25(chunks,w0,w1,w2,w3)` address the FTS5 columns BY POSITION. So the table names, the column names and
their order (path, heading, body, linestart), the tokenizer and the meta keys are a contract, not a detail.
This file asserts the schema exactly, the meta rows, and the rows the chunker writes: heading trail,
body, first line and the stored path's shape. Deleted, it would let through a column reorder that sends
the reader's snippets to the wrong column, a changed tokenizer, meta that disagrees with the build line,
and a chunker that moves a heading's line. Behaviour still wrong carries PINNED DEFECT <id> in its test
name. The reader's own query runs against a real index in test_vault_search_recall_reader.py, in the Kit
only, where recall-inject.js is.

HOW. The real CLI as a child process. Most tests use a temp vault outside the repo, with ALEX_VAULT_DIR,
ALEX_INDEX_DB and ALEX_READS_LOG set into the temp folder and stripped from the inherited environment
first. The default-path tests copy vault_search.py into a temp folder laid out like a repo and run the
copy with no override, so every default resolves inside that folder and nothing is written into the tree.

NEVER. Writes outside its own temp folder, reaches a network or touches a scheduled task.

Usage: python scripts/tests/test_vault_search_index_contract.py
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
from typing import Any

HERE = Path(__file__).resolve()
SCRIPT = HERE.parent.parent / "vault_search.py"
REPO = HERE.parent.parent.parent
OWNED_ENV = ("ALEX_VAULT_DIR", "ALEX_INDEX_DB", "ALEX_READS_LOG", "PYTHONIOENCODING", "PYTHONUTF8")

CHUNKS_SQL = (
    "CREATE VIRTUAL TABLE chunks USING fts5(path, heading, body, linestart UNINDEXED, "
    "tokenize='porter unicode61 remove_diacritics 2')"
)
META_SQL = "CREATE TABLE meta(key TEXT PRIMARY KEY, val TEXT)"

PAGES = {
    "projects/demo/status.md": (
        "---\ntags: [project]\n---\n# Demo status\n\n## Last run\n"
        "The radar found three new feeds about invoicing.\n\n#### Detail\n"
        "H4 stays in the body of Last run.\n"
    ),
    "z.md": "# A\nx1\n## B\ny1\n# C\nz1\n### D\nw1\n#NoSpace\n#### four\n",
    "spaced.md": "#   Spaced   title   \nbody under it\n",
    "crlf.md": "# Win\r\nline one\r\nline two\r\n",
    "empty.md": "",
    "blank.md": "\n\n   \n",
    "heading-only.md": "# Only a heading\n",
}


class Result:
    """One finished child process: its exit code, and stdout and stderr decoded with LF line ends."""

    def __init__(self, cp: subprocess.CompletedProcess[bytes]) -> None:
        self.code = cp.returncode
        self.out = cp.stdout.decode("utf-8").replace("\r\n", "\n")
        self.err = cp.stderr.decode("utf-8").replace("\r\n", "\n")

    def __repr__(self) -> str:
        return f"exit={self.code}\n--- stdout\n{self.out}--- stderr\n{self.err}"


class Sandbox(unittest.TestCase):
    """A temp root outside the repo holding an empty vault, and the CLI run against it."""

    def setUp(self) -> None:
        td = tempfile.TemporaryDirectory(ignore_cleanup_errors=True)
        self.addCleanup(td.cleanup)
        self.root = Path(td.name).resolve()
        self.assertFalse(self.root.is_relative_to(REPO), "the temp folder must sit outside the repo")
        self.vault = self.root / "vault"
        self.vault.mkdir()
        self.db = self.root / "index" / "vault-search.db"
        self.log = self.root / "reads.jsonl"

    def bare_env(self) -> dict[str, str]:
        """Return the inherited environment without the owned names."""
        return {k: v for k, v in os.environ.items() if k not in OWNED_ENV}

    def env(self) -> dict[str, str]:
        """Return the bare environment pointed into the sandbox."""
        env = self.bare_env()
        env.update(ALEX_VAULT_DIR=str(self.vault), ALEX_INDEX_DB=str(self.db), ALEX_READS_LOG=str(self.log))
        return env

    def page(self, rel: str, text: str, vault: Path | None = None) -> Path:
        """Write text to rel under the vault, or another vault, an hour old, and return its path."""
        p = (vault or self.vault) / rel
        p.parent.mkdir(parents=True, exist_ok=True)
        p.write_bytes(text.encode("utf-8"))
        t = time.time() - 3600
        os.utime(p, (t, t))
        return p

    def run_script(self, script: Path, *args: str, env: dict[str, str]) -> Result:
        """Run script with `args` under env and return the finished child."""
        return Result(subprocess.run([sys.executable, str(script), *args], capture_output=True, env=env, timeout=120))

    def build(self) -> Result:
        """Build the sandbox's index, assert it exited 0, and return the finished child."""
        r = self.run_script(SCRIPT, "build", env=self.env())
        self.assertEqual(r.code, 0, r)
        return r

    def query(self, sql: str, params: tuple[object, ...] = (), db: Path | None = None) -> list[Any]:
        """Run sql against the index, or another db, and return every row."""
        with closing(sqlite3.connect(db or self.db)) as con:
            return con.execute(sql, params).fetchall()

    def loc(self, rel: str) -> str:
        """Return the path the index stores for rel: the vault sits outside the repo, so the absolute one."""
        return (self.vault / rel).as_posix()

    def copied_repo(self) -> Path:
        """Copy vault_search.py into a temp folder laid out like a repo and return that folder."""
        repo = self.root / "repo"
        (repo / "scripts").mkdir(parents=True)
        shutil.copy2(SCRIPT, repo / "scripts" / "vault_search.py")
        return repo


class Schema(Sandbox):
    """The seven fixture pages, built once per test."""

    def setUp(self) -> None:
        super().setUp()
        for rel, text in PAGES.items():
            self.page(rel, text)
        self.build_result = self.build()

    def test_the_two_tables_and_their_exact_create_statements(self) -> None:
        tables = dict(self.query("SELECT name, sql FROM sqlite_master WHERE type='table'"))
        own = {n for n in tables if not n.startswith("chunks_")}
        self.assertEqual(own, {"chunks", "meta"})  # everything else is FTS5's shadow tables
        self.assertEqual(tables["chunks"], CHUNKS_SQL)
        self.assertEqual(tables["meta"], META_SQL)

    def test_the_fts_columns_in_position_order(self) -> None:
        cols = [row[1] for row in self.query("PRAGMA table_info(chunks)")]
        self.assertEqual(cols, ["path", "heading", "body", "linestart"])

    def test_meta_holds_four_text_keys_that_agree_with_the_build_line(self) -> None:
        rows = self.query("SELECT key, val, typeof(val) FROM meta")
        meta = {k: v for k, v, _ in rows}
        self.assertEqual(set(meta), {"built_at", "built_epoch", "files", "chunks"})
        self.assertEqual({t for _, _, t in rows}, {"text"})
        self.assertEqual(repr(float(meta["built_epoch"])), meta["built_epoch"])
        m = re.match(r"indexed (\d+) files -> (\d+) chunks", self.build_result.out)
        self.assertIsNotNone(m, self.build_result)
        assert m is not None
        self.assertEqual((meta["files"], meta["chunks"]), m.groups())
        # A page with no chunk still counts as an indexed file.
        self.assertEqual(meta["files"], str(len(PAGES)))
        self.assertEqual(meta["chunks"], str(self.query("SELECT count(*) FROM chunks")[0][0]))

    def test_built_at_is_local_time_without_an_offset_PINNED_DEFECT_D13(self) -> None:
        built_at = self.query("SELECT val FROM meta WHERE key='built_at'")[0][0]
        self.assertRegex(built_at, r"\A\d{4}-\d\d-\d\d \d\d:\d\d:\d\d\Z")

    def test_the_rows_the_chunker_writes(self) -> None:
        rows = self.query(
            "SELECT path, heading, body, linestart, typeof(linestart) FROM chunks "
            "ORDER BY path, CAST(linestart AS INTEGER)"
        )
        loc = self.loc
        self.maxDiff = None
        self.assertEqual(
            rows,
            [
                (loc("crlf.md"), "Win", "line one\nline two", "1", "text"),
                (loc("projects/demo/status.md"), "", "---\ntags: [project]\n---", "1", "text"),
                (
                    loc("projects/demo/status.md"),
                    "Demo status > Last run",
                    "The radar found three new feeds about invoicing.\n\n#### Detail\n"
                    "H4 stays in the body of Last run.",
                    "6",
                    "text",
                ),
                (loc("spaced.md"), "Spaced   title", "body under it", "1", "text"),
                (loc("z.md"), "A", "x1", "1", "text"),
                (loc("z.md"), "A > B", "y1", "3", "text"),
                (loc("z.md"), "C", "z1", "5", "text"),
                (loc("z.md"), "C > D", "w1\n#NoSpace\n#### four", "7", "text"),
            ],
        )

    def test_a_line_number_is_not_searchable(self) -> None:
        # Every column but path, which stores the temp folder, and a temp folder can hold a standalone 7.
        self.assertEqual(self.query("SELECT path FROM chunks WHERE chunks MATCH '- {path} : \"7\"'"), [])


class Chunking(Sandbox):
    """One page each, built on its own."""

    def test_a_heading_inside_a_code_fence_starts_a_chunk_PINNED_DEFECT_D8(self) -> None:
        self.page("f.md", "# Setup\n\n```bash\n# install cli\nnpm i\n```\nbody after fence\n")
        self.build()
        self.assertEqual(
            self.query("SELECT heading, body, linestart FROM chunks ORDER BY rowid"),
            [
                ("Setup", "```bash", "1"),
                ("install cli", "npm i\n```\nbody after fence", "4"),
            ],
        )

    def test_a_form_feed_shifts_linestart_PINNED_DEFECT_D17(self) -> None:
        # str.splitlines() also breaks on \x0c, so the heading an editor shows on line 2 is stored as 3.
        self.page("y.md", "a\x0cb\n# Y\nyak body\n")
        self.build()
        self.assertEqual(
            self.query("SELECT heading, body, linestart FROM chunks ORDER BY rowid"),
            [
                ("", "a\nb", "1"),
                ("Y", "yak body", "3"),
            ],
        )


class StoredPath(Sandbox):
    """The path a chunk stores, for a vault outside the repo and for one inside it."""

    def test_a_vault_outside_the_repo_stores_the_absolute_posix_path(self) -> None:
        self.page("me/goals.md", "# Goals\nShip it.\n")
        r = self.build()
        self.assertIn(f" -> {self.db.as_posix()}\n", r.out)
        self.assertEqual(self.query("SELECT path FROM chunks"), [(self.loc("me/goals.md"),)])

    def test_the_default_paths_resolve_inside_the_repo_and_store_repo_relative_paths(self) -> None:
        repo = self.copied_repo()
        self.page("me/goals.md", "# Goals\nShip it.\n", vault=repo / "vault")
        r = self.run_script(repo / "scripts" / "vault_search.py", "build", env=self.bare_env())
        self.assertEqual(r.code, 0, r)
        self.assertRegex(
            r.out,
            r"\Aindexed 1 files -> 1 chunks in \d+\.\d\ds -> "
            r"scripts/vault-index/vault-search\.db\n\Z",
        )
        db = repo / "scripts" / "vault-index" / "vault-search.db"
        self.assertTrue(db.exists())
        self.assertEqual(self.query("SELECT path FROM chunks", db=db), [("vault/me/goals.md",)])

    def test_an_override_that_points_inside_the_repo_still_stores_repo_relative_paths(self) -> None:
        repo = self.copied_repo()
        self.page("me/goals.md", "# Goals\nShip it.\n", vault=repo / "vault")
        env = self.bare_env()
        env.update(ALEX_VAULT_DIR=str(repo / "vault"), ALEX_INDEX_DB=str(repo / "own.db"), ALEX_READS_LOG=str(self.log))
        r = self.run_script(repo / "scripts" / "vault_search.py", "build", env=env)
        self.assertEqual(r.code, 0, r)
        self.assertTrue(r.out.rstrip("\n").endswith(" -> own.db"), r)
        self.assertEqual(self.query("SELECT path FROM chunks", db=repo / "own.db"), [("vault/me/goals.md",)])


if __name__ == "__main__":
    unittest.main(verbosity=2)
