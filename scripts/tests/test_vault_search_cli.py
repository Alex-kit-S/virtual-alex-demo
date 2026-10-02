#!/usr/bin/env python3
"""scripts/tests/test_vault_search_cli.py - every mode, exit code and output line of the vault-search CLI.

WHAT. Pins scripts/vault_search.py's command line as it behaves: build, search and stats, every exit
code, and the exact lines other code and every session read. Those are the build line the laptop index
job parses (run-vault-index.ps1, Kit only), the result blocks the constitution tells each session to
read first, the stats block and the usage errors. A behaviour known to be wrong is pinned as it is,
with PINNED DEFECT <id> in the test name, so a fix flips a named assertion rather than an anonymous
one. Deleted, it would let the build line lose the shape the laptop job counts chunks from, let a
result block, its snippet or the bm25 order change under every session that reads them, and let the
default limit, an exit code or the UTF-8 output drift with nothing to say so.

HOW. Runs the real CLI as a child process against a throwaway vault per test. ALEX_VAULT_DIR,
ALEX_INDEX_DB and ALEX_READS_LOG are stripped from the inherited environment and set into the temp
folder; PYTHONIOENCODING and PYTHONUTF8 are stripped too, so the child's encoding is its own.
Fixture pages get an mtime an hour in the past, so the freshness gate never fires by accident. Both
streams are decoded as strict UTF-8, so a byte that is not UTF-8 is itself a failure.

NEVER. Writes outside its own temp folder, which sits outside the repository, reaches a network,
touches a scheduled task or pins the clock.

Usage: python scripts/tests/test_vault_search_cli.py
Exit: 0 every test passed - 1 a test failed
"""

import os
import re
import subprocess
import sys
import tempfile
import time
import unittest
from pathlib import Path

HERE = Path(__file__).resolve()
SCRIPT = HERE.parent.parent / "vault_search.py"
REPO = HERE.parent.parent.parent
OWNED_ENV = ("ALEX_VAULT_DIR", "ALEX_INDEX_DB", "ALEX_READS_LOG", "PYTHONIOENCODING", "PYTHONUTF8")
# The regex scripts/run-vault-index.ps1 applies to the build output to count chunks (and to refuse
# GREEN under 50). Held here as a literal so the contract is held in the online tree too, where
# that wrapper is a drop row.
LAPTOP_JOB_RE = r"indexed\s+\d+\s+files\s+->\s+(\d+)\s+chunks"

FIXTURE = {
    "projects/demo/status.md": (
        "---\ntags: [project]\n---\n# Demo status\n\n## Last run\n"
        "The radar found three new feeds about invoicing.\n\n#### Detail\n"
        "H4 stays in the body of Last run.\n"
    ),
    "me/goals.md": "# Goals\n\n## This quarter\nShip the invoicing automation for the bakery.\n",
    "notes/d.md": "---\nkind: note\n---\n# Note D\ninvoicing appears in a short note\n",
    "notes/f.md": "# Setup\n\n## Invoicing cli\nnpm i and the rest of the setup\n",
    "sub/log.md": "# Sub log\ninvoicing nested log is a real page\n",
    "people/kestrelcrew/lina.md": "# Lina\n\n## Where\nLina lives in G\u00f6teborg and runs a caf\u00e9.\n",
    "people/omar.md": "# Omar\n\n## Greeting\n\u0645\u0631\u062d\u0628\u0627 means hello.\n",
}


class Result:
    """A finished child: exit code and both streams, decoded as UTF-8 (strict, so a non-UTF-8 byte
    is itself a failure) with Windows line endings folded to \\n."""

    def __init__(self, cp: subprocess.CompletedProcess[bytes]) -> None:
        self.code = cp.returncode
        self.out = cp.stdout.decode("utf-8").replace("\r\n", "\n")
        self.err = cp.stderr.decode("utf-8").replace("\r\n", "\n")

    def locs(self) -> list[str]:
        """Return the numbered result lines of stdout, the `N. path:line  [heading]` ones."""
        return [line for line in self.out.splitlines() if re.match(r"\d+\. ", line)]

    def __repr__(self) -> str:
        return f"exit={self.code}\n--- stdout\n{self.out}--- stderr\n{self.err}"


class Sandbox(unittest.TestCase):
    """A temp vault, db and read log per test, all outside the repo."""

    def setUp(self) -> None:
        td = tempfile.TemporaryDirectory(ignore_cleanup_errors=True)
        self.addCleanup(td.cleanup)
        self.root = Path(td.name).resolve()
        self.assertFalse(self.root.is_relative_to(REPO), "the temp folder must sit outside the repo")
        self.vault = self.root / "vault"
        self.vault.mkdir()
        self.db = self.root / "index" / "vault-search.db"
        self.log = self.root / "reads.jsonl"

    def env(self, **extra: str) -> dict[str, str]:
        """Return the inherited environment without the owned names, pointed into the sandbox."""
        env = {k: v for k, v in os.environ.items() if k not in OWNED_ENV}
        env.update(ALEX_VAULT_DIR=str(self.vault), ALEX_INDEX_DB=str(self.db), ALEX_READS_LOG=str(self.log))
        env.update(extra)
        return env

    def page(self, rel: str, text: str, age: float = 3600.0) -> Path:
        """Write a vault page as UTF-8, dated `age` seconds in the past, and return its path."""
        p = self.vault / rel
        p.parent.mkdir(parents=True, exist_ok=True)
        p.write_bytes(text.encode("utf-8"))
        t = time.time() - age
        os.utime(p, (t, t))
        return p

    def pages(self, table: dict[str, str]) -> None:
        """Write every page of a {relative path: text} table."""
        for rel, text in table.items():
            self.page(rel, text)

    def vs(self, *args: str, env: dict[str, str] | None = None, cwd: str | None = None) -> Result:
        """Run the CLI with `args` and return the finished child."""
        cp = subprocess.run(
            [sys.executable, str(SCRIPT), *args], capture_output=True, env=env or self.env(), cwd=cwd, timeout=120
        )
        return Result(cp)

    def loc(self, rel: str) -> str:
        """The path the index stores for a page when the vault is outside the repo."""
        return (self.vault / rel).as_posix()


class BuildAndStats(Sandbox):
    def test_build_prints_exactly_one_line_that_the_laptop_job_regex_reads(self) -> None:
        self.pages(FIXTURE)
        r = self.vs("build")
        self.assertEqual(r.code, 0, r)
        self.assertEqual(r.err, "", r)
        self.assertRegex(
            r.out, r"\Aindexed 7 files -> 9 chunks in \d+\.\d\ds -> " + re.escape(self.db.as_posix()) + r"\n\Z"
        )
        m = re.search(LAPTOP_JOB_RE, r.out)
        self.assertIsNotNone(m, r)
        assert m is not None
        self.assertEqual(m.group(1), "9")

    def test_build_with_no_vault_folder_indexes_nothing_and_creates_the_db_folder(self) -> None:
        self.vault.rmdir()
        r = self.vs("build")
        self.assertEqual(r.code, 0, r)
        self.assertRegex(r.out, r"\Aindexed 0 files -> 0 chunks in \d+\.\d\ds -> ")
        self.assertTrue(self.db.exists())

    def test_stats_before_any_build_exits_2_with_a_python_hint_PINNED_DEFECT_D20(self) -> None:
        # The hint names `python`, which a stock macOS, Homebrew or Ubuntu shell does not have.
        r = self.vs("stats")
        self.assertEqual(r.code, 2, r)
        self.assertEqual(r.out, "", r)
        self.assertEqual(r.err, "no index yet - run: python scripts/vault_search.py build\n")
        self.assertFalse(self.db.exists())

    def test_stats_prints_four_lines_after_a_build(self) -> None:
        self.pages(FIXTURE)
        self.assertEqual(self.vs("build").code, 0)
        r = self.vs("stats")
        self.assertEqual(r.code, 0, r)
        self.assertEqual(r.err, "", r)
        lines = r.out.split("\n")
        self.assertEqual(len(lines), 5, r)  # four lines and the final newline
        self.assertRegex(lines[0], r"\Adb:      " + re.escape(self.db.as_posix()) + r" \(\d+ KB\)\Z")
        self.assertEqual(lines[1], "files:   7")
        self.assertEqual(lines[2], "chunks:  9")
        self.assertTrue(lines[3].startswith("built:   "), r)
        self.assertEqual(lines[4], "")

    def test_the_built_line_is_local_time_without_an_offset_PINNED_DEFECT_D13(self) -> None:
        self.pages(FIXTURE)
        self.assertEqual(self.vs("build").code, 0)
        self.assertRegex(self.vs("stats").out, r"\nbuilt:   \d{4}-\d\d-\d\d \d\d:\d\d:\d\d\n\Z")

    def test_stats_never_checks_freshness(self) -> None:
        self.pages(FIXTURE)
        self.assertEqual(self.vs("build").code, 0)
        self.page("me/new.md", "# New\nfresh page\n", age=-10)
        r = self.vs("stats")
        self.assertEqual(r.code, 0, r)
        self.assertEqual(r.err, "", r)
        self.assertIn("files:   7\n", r.out)


class SearchOutput(Sandbox):
    def setUp(self) -> None:
        super().setUp()
        self.pages(FIXTURE)
        self.assertEqual(self.vs("build").code, 0)

    def test_one_result_block_exact(self) -> None:
        r = self.vs("search", "invoicing bakery")
        self.assertEqual(r.code, 0, r)
        self.assertEqual(r.err, "", r)
        self.assertEqual(
            r.out,
            f"1. {self.loc('me/goals.md')}:3  [Goals > This quarter]\n"
            "   Ship the >>invoicing<< automation for the >>bakery<<.\n\n",
        )

    def test_a_preamble_hit_has_no_heading_brackets(self) -> None:
        r = self.vs("search", "tags")
        self.assertEqual(r.out, f"1. {self.loc('projects/demo/status.md')}:1\n   --- >>tags<<: [project] ---\n\n", r)

    def test_the_snippet_is_14_tokens_with_whitespace_collapsed_and_an_ellipsis(self) -> None:
        r = self.vs("search", "feeds")
        self.assertEqual(
            r.out,
            f"1. {self.loc('projects/demo/status.md')}:6  [Demo status > Last run]\n"
            "   The radar found three new >>feeds<< about invoicing. #### Detail H4 "
            "stays in the body ...\n\n",
            r,
        )

    def test_results_are_numbered_in_bm25_order(self) -> None:
        r = self.vs("search", "invoicing", "-n", "20")
        self.assertEqual(r.code, 0, r)
        self.maxDiff = None
        # A heading hit (weight 2.0) first, then body hits, shortest body first.
        self.assertEqual(
            r.locs(),
            [
                f"1. {self.loc('notes/f.md')}:3  [Setup > Invoicing cli]",
                f"2. {self.loc('notes/d.md')}:4  [Note D]",
                f"3. {self.loc('sub/log.md')}:1  [Sub log]",
                f"4. {self.loc('me/goals.md')}:3  [Goals > This quarter]",
                f"5. {self.loc('projects/demo/status.md')}:6  [Demo status > Last run]",
            ],
        )

    def test_a_miss_exits_0_and_echoes_the_raw_query(self) -> None:
        r = self.vs("search", "Nonexistent  Term?")
        self.assertEqual(r.code, 0, r)
        self.assertEqual(r.out, "no matches for: Nonexistent  Term?\n")
        self.assertEqual(r.err, "")

    def test_an_empty_or_symbol_only_query_exits_2(self) -> None:
        for q in ("", "   ", '*"():^-'):
            with self.subTest(query=q):
                r = self.vs("search", q)
                self.assertEqual(r.code, 2, r)
                self.assertEqual(r.out, "")
                self.assertEqual(r.err, "empty query\n")

    def test_fts_syntax_is_quoted_and_operator_words_become_terms_PINNED_DEFECT_D10(self) -> None:
        q = 'invoicing* AND (bakery) NOT "x" col:val'
        r = self.vs("search", q)
        self.assertEqual(r.code, 0, r)
        self.assertEqual(r.err, "", r)
        self.assertEqual(r.out, f"no matches for: {q}\n")

    def test_or_is_a_literal_required_word_PINNED_DEFECT_D10(self) -> None:
        self.assertEqual(len(self.vs("search", "radar").locs()), 1)
        self.assertEqual(self.vs("search", "invoicing OR radar").out, "no matches for: invoicing OR radar\n")

    def test_an_apostrophe_turns_the_word_into_a_phrase_PINNED_DEFECT_D10(self) -> None:
        self.assertEqual(len(self.vs("search", "bakery").locs()), 1)
        self.assertEqual(self.vs("search", "bakery's").out, "no matches for: bakery's\n")

    def test_every_word_is_required_PINNED_DEFECT_D10(self) -> None:
        self.assertEqual(
            self.vs("search", "invoicing bakery").locs(), [f"1. {self.loc('me/goals.md')}:3  [Goals > This quarter]"]
        )
        self.assertEqual(self.vs("search", "radar bakery").out, "no matches for: radar bakery\n")

    def test_case_diacritics_and_porter_stemming_fold(self) -> None:
        self.assertEqual(len(self.vs("search", "INVOICING", "-n", "20").locs()), 5)
        self.assertEqual(len(self.vs("search", "invoice", "-n", "20").locs()), 5)
        self.assertIn(">>feeds<<", self.vs("search", "feed").out)
        self.assertIn(">>G\u00f6teborg<<", self.vs("search", "goteborg").out)
        self.assertIn(">>caf\u00e9<<", self.vs("search", "cafe").out)

    def test_words_in_the_path_are_searchable(self) -> None:
        r = self.vs("search", "kestrelcrew")
        self.assertEqual(
            r.out,
            f"1. {self.loc('people/kestrelcrew/lina.md')}:3  [Lina > Where]\n"
            "   Lina lives in G\u00f6teborg and runs a caf\u00e9.\n\n",
            r,
        )

    def test_n_limits_the_results(self) -> None:
        self.assertEqual(len(self.vs("search", "invoicing", "-n", "1").locs()), 1)
        self.assertEqual(len(self.vs("search", "invoicing", "-n", "3").locs()), 3)

    def test_n_0_falls_back_to_the_default_limit_D6_FIXED(self) -> None:
        # More matches than the default 10, so "unlimited" and "the default" cannot look alike.
        for i in range(12):
            self.page(f"herd/w{i:02d}.md", f"# Walrus {i}\nwalrus sighting number {i}\n")
        self.assertEqual(self.vs("build").code, 0)
        r = self.vs("search", "walrus", "-n", "0")
        self.assertEqual(r.code, 0, r)
        self.assertEqual(len(r.locs()), 10)

    def test_negative_n_falls_back_to_the_default_limit_D6_FIXED(self) -> None:
        for i in range(12):
            self.page(f"herd/w{i:02d}.md", f"# Walrus {i}\nwalrus sighting number {i}\n")
        self.assertEqual(self.vs("build").code, 0)
        self.assertEqual(len(self.vs("search", "walrus", "-n", "-1").locs()), 10)

    def test_n_must_be_an_integer(self) -> None:
        r = self.vs("search", "invoicing", "-n", "abc")
        self.assertEqual(r.code, 2, r)
        self.assertEqual(r.out, "")
        self.assertIn("argument -n: invalid int value: 'abc'", r.err)

    def test_default_limit_is_10(self) -> None:
        for i in range(12):
            self.page(f"herd/w{i:02d}.md", f"# Walrus {i}\nwalrus sighting number {i}\n")
        self.assertEqual(self.vs("build").code, 0)
        self.assertEqual(len(self.vs("search", "walrus").locs()), 10)
        self.assertEqual(len(self.vs("search", "walrus", "-n", "12").locs()), 12)

    def test_output_is_utf8_even_when_the_child_is_told_cp1252(self) -> None:
        env = self.env(PYTHONIOENCODING="cp1252")
        r = self.vs("search", "\u0645\u0631\u062d\u0628\u0627", env=env)  # decode is strict UTF-8
        self.assertEqual(r.code, 0, r)
        self.assertEqual(
            r.out,
            f"1. {self.loc('people/omar.md')}:3  [Omar > Greeting]\n"
            "   >>\u0645\u0631\u062d\u0628\u0627<< means hello.\n\n",
        )
        self.assertIn("G\u00f6teborg", self.vs("search", "goteborg", env=env).out)

    def test_the_working_directory_does_not_matter(self) -> None:
        here = self.vs("search", "bakery")
        there = self.vs("search", "bakery", cwd=str(self.root))
        self.assertEqual(here.out, there.out)
        self.assertEqual(there.code, 0)


class UsageErrors(Sandbox):
    def test_no_subcommand(self) -> None:
        r = self.vs()
        self.assertEqual(r.code, 2, r)
        self.assertEqual(r.out, "")
        self.assertIn("the following arguments are required: cmd", r.err)

    def test_unknown_subcommand(self) -> None:
        r = self.vs("frob")
        self.assertEqual(r.code, 2, r)
        self.assertIn("invalid choice: 'frob'", r.err)

    def test_search_without_a_query(self) -> None:
        r = self.vs("search")
        self.assertEqual(r.code, 2, r)
        self.assertIn("the following arguments are required: query", r.err)


if __name__ == "__main__":
    unittest.main(verbosity=2)
