#!/usr/bin/env python3
"""scripts/tests/test_vault_search_exclusions.py - what vault_search.py keeps out of the index and the staleness scan.

WHAT. iter_md() feeds BOTH build() and the freshness gate's mtime scan, so one list decides what is
searchable and what can force a rebuild: the vault-root log.md and outputs-index.md, anything under
a .obsidian folder, and any page whose first 20 lines carry a retirement marker (`status: retired`,
or `retired: <value>` for any value but false or no). This file holds that list, its edges, and the
scan's half of it. The behaviours known to be wrong are pinned as they are, with PINNED DEFECT <id>
in the test name, so a fix flips a named assertion. Deleted, it would let the journal, the generated
outputs index, Obsidian's own state or a retired page back into every session's search results, let
a live page marked `retired: false` drop out of them, and let a touch to an excluded file force a
full rebuild on the next search.

HOW. The real CLI as a child process against a temp vault, with ALEX_VAULT_DIR, ALEX_INDEX_DB and
ALEX_READS_LOG stripped from the inherited environment and set into the temp folder. The index is
checked two ways: the file count build() stores in meta, and a direct FTS query on the built db for
a word that lives on exactly one page. Mtimes are set relative to the stored build time, never slept
for.

NEVER. Writes outside its own temp folder, which sits outside the repository, reaches a network or
touches a scheduled task.

Usage: python scripts/tests/test_vault_search_exclusions.py
Exit: 0 every test passed - 1 a test failed
"""

import os
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


class Result:
    """A finished child: exit code and both streams, decoded as UTF-8 with Windows line endings folded."""

    def __init__(self, cp: subprocess.CompletedProcess[bytes]) -> None:
        self.code = cp.returncode
        self.out = cp.stdout.decode("utf-8").replace("\r\n", "\n")
        self.err = cp.stderr.decode("utf-8").replace("\r\n", "\n")

    def __repr__(self) -> str:
        return f"exit={self.code}\n--- stdout\n{self.out}--- stderr\n{self.err}"


class Sandbox(unittest.TestCase):
    """A temp vault holding one real page, an index path and a read log, all outside the repo."""

    def setUp(self) -> None:
        td = tempfile.TemporaryDirectory(ignore_cleanup_errors=True)
        self.addCleanup(td.cleanup)
        self.root = Path(td.name).resolve()
        self.assertFalse(self.root.is_relative_to(REPO), "the temp folder must sit outside the repo")
        self.vault = self.root / "vault"
        self.vault.mkdir()
        self.db = self.root / "index" / "vault-search.db"
        self.log = self.root / "reads.jsonl"
        # The real page every vault has; it must always be indexed.
        self.page("keeper.md", "# Keeper\n\nThe kiwifruitxyz fact lives on a real page.\n")

    def env(self) -> dict[str, str]:
        """Return the inherited environment without the owned names, pointed into the sandbox."""
        env = {k: v for k, v in os.environ.items() if k not in OWNED_ENV}
        env.update(ALEX_VAULT_DIR=str(self.vault), ALEX_INDEX_DB=str(self.db), ALEX_READS_LOG=str(self.log))
        return env

    def page(self, rel: str, text: str, mtime: float | None = None) -> Path:
        """Write a vault page as UTF-8 with the given mtime (an hour back by default), and return its path."""
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

    def build(self) -> int:
        """Build, and return how many files were indexed. Read from meta, not from the build line:
        the line's format is the CLI file's concern (test_vault_search_index_contract.py proves the
        two agree), so a change to it fails there and not across every test here."""
        r = self.vs("build")
        self.assertEqual(r.code, 0, r)
        return self.files()

    def files(self, db: Path | None = None) -> int:
        """Return the file count the build stored in meta."""
        with closing(sqlite3.connect(db or self.db)) as con:
            return int(con.execute("SELECT val FROM meta WHERE key='files'").fetchone()[0])

    def indexed(self, word: str) -> list[str]:
        """The distinct paths whose chunks hold `word`, straight from the built db."""
        with closing(sqlite3.connect(self.db)) as con:
            rows = con.execute("SELECT DISTINCT path FROM chunks WHERE chunks MATCH ?", (f'"{word}"',)).fetchall()
        return sorted(r[0] for r in rows)

    def loc(self, rel: str) -> str:
        """The path the index stores for a page when the vault is outside the repo."""
        return (self.vault / rel).as_posix()

    def epoch(self) -> float:
        """Return the build time stored in meta, in epoch seconds."""
        with closing(sqlite3.connect(self.db)) as con:
            return float(con.execute("SELECT val FROM meta WHERE key='built_epoch'").fetchone()[0])


class Corpus(Sandbox):
    def test_journal_generated_index_and_obsidian_state_are_not_indexed(self) -> None:
        # Body text under each heading on purpose: a heading with no body emits no chunk, so a
        # heading-only fixture would pass even with no exclusion at all.
        self.page("log.md", "## [2026-09-20 01:00] session | log entry\n\nThe platypusxyz detail.\n")
        self.page("outputs-index.md", "# Outputs\n\n- narwhalxyz.pdf generated row\n")
        self.page(".obsidian/workspace.md", "# Workspace\nThe tapirxyz ui state.\n")
        self.page("notes/.obsidian/cache.md", "# Cache\nThe tapirxyz nested ui state.\n")
        self.assertEqual(len(list(self.vault.rglob("*.md"))), 5)
        self.assertEqual(self.build(), 1)
        self.assertEqual(self.indexed("platypusxyz"), [])
        self.assertEqual(self.indexed("narwhalxyz"), [])
        self.assertEqual(self.indexed("tapirxyz"), [])
        self.assertEqual(self.indexed("kiwifruitxyz"), [self.loc("keeper.md")])

    def test_the_names_are_matched_at_the_vault_root_only(self) -> None:
        self.page("sub/log.md", "# Sub log\nThe platypusxyz nested log is a real page.\n")
        self.page("sub/outputs-index.md", "# Sub outputs\nThe narwhalxyz nested index is a page.\n")
        self.assertEqual(self.build(), 3)
        self.assertEqual(self.indexed("platypusxyz"), [self.loc("sub/log.md")])
        self.assertEqual(self.indexed("narwhalxyz"), [self.loc("sub/outputs-index.md")])

    def test_three_retirement_shapes_are_excluded(self) -> None:
        self.page("old/status.md", "---\nstatus: retired\n---\n\n# Old\n\nThe wombatxyz fact.\n")
        self.page("old/dated.md", "---\nretired: 2026-08-01\n---\n# Dated\nThe wombatxyz date.\n")
        self.page("old/flagged.md", "---\nretired: true\n---\n\n# Flagged\n\nThe wombatxyz flag.\n")
        self.page("old/loud.md", "---\n  Status:   RETIRED  \n---\n# Loud\nThe wombatxyz case.\n")
        self.page("old/month.md", "---\nretired: November 2026\n---\n# Month\nThe wombatxyz month.\n")
        self.assertEqual(self.build(), 1)
        self.assertEqual(self.indexed("wombatxyz"), [])

    def test_the_marker_is_read_from_the_first_20_lines_only(self) -> None:
        filler = "".join(f"line {i}\n" for i in range(1, 20))  # 19 lines
        self.page("old/line20.md", filler + "status: retired\n# Late\nThe lynxxyz fact.\n")
        self.page("old/line21.md", filler + "\nstatus: retired\n# Later\nThe lynxxyz other fact.\n")
        self.assertEqual(self.build(), 2)
        self.assertEqual(self.indexed("lynxxyz"), [self.loc("old/line21.md")])

    def test_an_empty_retired_key_is_not_a_marker(self) -> None:
        self.page("old/empty.md", "---\nretired:\n---\n# Empty\nThe ibexxyz fact.\n")
        self.assertEqual(self.build(), 2)
        self.assertEqual(self.indexed("ibexxyz"), [self.loc("old/empty.md")])

    def test_a_body_line_starting_Retired_drops_a_live_page_PINNED_DEFECT_D7(self) -> None:
        self.page("notes/e.md", "# Notes\nRetired: two of the five geckoxyz tools this year.\n")
        self.assertEqual(self.build(), 1)
        self.assertEqual(self.indexed("geckoxyz"), [])

    def test_a_quoted_status_retired_is_not_recognised_PINNED_DEFECT_D7(self) -> None:
        self.page("old/quoted.md", '---\nstatus: "retired"\n---\n# Quoted\nThe egretxyz fact.\n')
        self.assertEqual(self.build(), 2)
        self.assertEqual(self.indexed("egretxyz"), [self.loc("old/quoted.md")])

    def test_retired_false_or_no_keeps_the_page_C1_N1_FIXED(self) -> None:
        # `retired: false` and `retired: no` say the page is live, so they do not retire it.
        self.page("notes/live.md", "---\nretired: false\n---\n# Live\nThe marmotxyz fact.\n")
        self.page("notes/also.md", "---\nretired: No\n---\n# Also\nThe marmotxyz other fact.\n")
        self.assertEqual(self.build(), 3)
        self.assertEqual(self.indexed("marmotxyz"), [self.loc("notes/also.md"), self.loc("notes/live.md")])

    def test_a_vault_inside_any_obsidian_folder_indexes_nothing_PINNED_DEFECT_D15(self) -> None:
        # `.obsidian` is tested against the ABSOLUTE path's parts, not the vault-relative ones.
        inner = self.root / ".obsidian" / "vault"
        inner.mkdir(parents=True)
        (inner / "page.md").write_bytes(b"# Page\nThe quailxyz fact.\n")
        env = self.env()
        env["ALEX_VAULT_DIR"] = str(inner)
        r = Result(subprocess.run([sys.executable, str(SCRIPT), "build"], capture_output=True, env=env, timeout=120))
        self.assertEqual(r.code, 0, r)
        self.assertEqual(self.files(), 0)

    def test_a_folder_named_like_a_page_is_skipped_silently_PINNED_DEFECT_D21(self) -> None:
        # rglob("*.md") also yields a DIRECTORY named x.md. Reading it fails, and build() drops it
        # without a count or a word, as it drops any page it cannot read. Its contents are still
        # indexed, because rglob walks into it.
        self.page("folder.md/inner.md", "# Inner\nThe stoatxyz fact.\n")
        r = self.vs("build")
        self.assertEqual(r.code, 0, r)
        self.assertEqual(r.err, "", r)  # not a word about the folder
        self.assertEqual(self.files(), 2)  # keeper.md and inner.md; the folder is not counted
        self.assertEqual(self.indexed("stoatxyz"), [self.loc("folder.md/inner.md")])


class StalenessScan(Sandbox):
    """The other half, and the reason one list feeds both callers: an excluded file must not be
    able to force a rebuild. Mtimes are set relative to built_epoch, never slept for."""

    def test_touching_an_excluded_or_retired_file_does_not_rebuild(self) -> None:
        self.page("log.md", "## [2026-09-20 01:00] session | log entry\n\nThe journal.\n")
        self.page("outputs-index.md", "# Outputs\n\n- a generated row\n")
        self.page(".obsidian/workspace.md", "# Workspace\nui state\n")
        self.page("old/status.md", "---\nstatus: retired\n---\n# Old\nhistory\n")
        self.build()
        later = self.epoch() + 10
        for rel in ("log.md", "outputs-index.md", ".obsidian/workspace.md", "old/status.md"):
            p = self.vault / rel
            p.write_bytes(p.read_bytes() + b"appended again\n")
            os.utime(p, (later, later))
        r = self.vs("search", "kiwifruitxyz")
        self.assertEqual(r.code, 0, r)
        self.assertEqual(r.err, "", r)
        self.assertTrue(r.out.startswith(f"1. {self.loc('keeper.md')}:1  [Keeper]\n"), r)

    def test_a_folder_named_like_a_page_takes_part_in_the_scan_PINNED_DEFECT_C1_N3(self) -> None:
        # The folder.md DIRECTORY is never indexed, but _is_retired cannot open it and fails open,
        # so its own mtime joins the staleness scan: touching the folder alone forces a full rebuild.
        self.page("folder.md/inner.md", "# Inner\nThe stoatxyz fact.\n")
        old = time.time() - 3600
        os.utime(self.vault / "folder.md", (old, old))
        self.build()
        later = self.epoch() + 10
        os.utime(self.vault / "folder.md", (later, later))
        r = self.vs("search", "kiwifruitxyz")
        self.assertEqual(r.code, 0, r)
        self.assertTrue(r.err.startswith(NOTICE), r)

    def test_touching_a_real_page_still_rebuilds(self) -> None:
        # Control: the gate is not simply off. A nested sub/log.md is a real page too.
        self.page("sub/log.md", "# Sub log\nnested journal is a page\n")
        self.build()
        later = self.epoch() + 10
        os.utime(self.vault / "sub" / "log.md", (later, later))
        r = self.vs("search", "kiwifruitxyz")
        self.assertEqual(r.code, 0, r)
        self.assertTrue(r.err.startswith(NOTICE), r)


if __name__ == "__main__":
    unittest.main(verbosity=2)
