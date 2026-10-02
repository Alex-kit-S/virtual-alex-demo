#!/usr/bin/env python3
"""scripts/vault_search.py - keyword search over the markdown vault, through one SQLite FTS5 index.

WHAT. Finds the sections of the vault's markdown pages that match a query and ranks them by BM25,
so a session goes straight to the page and heading that holds a fact instead of reading the vault
index and drilling down. The vault stays plain markdown and Obsidian never sees the index, which is
derived, disposable, and rebuilt by the laptop's nightly job as well as on demand.

HOW. `build` reads every page iter_md() yields under VAULT, splits each at its H1 to H3 headings into
chunks that carry their heading trail and first line, rewrites the FTS5 table `chunks` and the table
`meta` in DB inside one transaction, and prints one build line. `search` rebuilds first when the index
is stale (a page newer than the build, an indexed page that is no longer a page, or no build marker),
quotes each query word so FTS5 syntax in a query cannot raise, ANDs the words, ranks with the heading
weighted above the body, prints each hit as a numbered block and appends one row to READS_LOG. `stats`
prints the index's size, counts and build time. VAULT, DB and READS_LOG come from ALEX_VAULT_DIR,
ALEX_INDEX_DB and ALEX_READS_LOG, read once at import, and default to paths inside the repository
this file sits in. In the Kit only, system/recall/recall-inject.js reads `chunks` by column position,
so the column order is a contract there.

NEVER. Writes anywhere but DB and READS_LOG, or lets the read log change a search: that write is
telemetry and fails open, silently, on the two errors it can raise. Leaves a reader an empty index: a
rebuild commits whole or not at all. Imports anything outside the standard library, or grows past one
file, because tests copy it alone into a temp folder and run or import the copy.

Usage: python scripts/vault_search.py build
       python scripts/vault_search.py search "<query>" [-n <max results, default 10>]
       python scripts/vault_search.py stats
Exit: 0 done, a search with no matches included - 1 an unexpected error, left as a traceback (an index
      file that is not a database or stays locked, a folder that cannot be made) - 2 a usage error, an
      empty query, stats before any build, or an index the query cannot run against
"""

from __future__ import annotations

import argparse
import contextlib
import json
import os
import re
import sqlite3
import sys
import time
from collections.abc import Iterator
from pathlib import Path
from typing import TypedDict

REPO = Path(__file__).resolve().parent.parent
# Each path can be pointed elsewhere, so a test runs against a sandbox vault and never the real index.
# VAULT, DB and READS_LOG stay module globals, read once at import.
# contract: read as text by scripts/tests/test_vault_search_db_states.py:285-290 (unseen: imports the module copy).
VAULT = Path(os.environ.get("ALEX_VAULT_DIR", str(REPO / "vault")))
DB = Path(os.environ.get("ALEX_INDEX_DB", str(REPO / "scripts" / "vault-index" / "vault-search.db")))
# One row per search, so it can be measured whether the vault's retrieval path is used at all.
READS_LOG = Path(os.environ.get("ALEX_READS_LOG", str(REPO / "system" / "vault-reads.jsonl")))

HEADING = re.compile(r"^(#{1,3})\s+(.*)$")
DEFAULT_LIMIT = 10

# ONE exclusion list, because iter_md() feeds BOTH build() and the staleness scan. Anything kept out of
# the corpus is kept out of the scan by construction: a file you cannot search must not be able to force
# a rebuild either.
#
# log.md is the append-only journal. It is not a page: its chunks are near-duplicate one-liners that crowd
# out the real answers, and because every session writes to it, it is usually the newest file in the
# vault, so on its own it made the next search rebuild the whole index first.
#
# outputs-index.md is GENERATED from the deliverables ledger. Indexing a derived file makes every row in
# it findable twice.
EXCLUDED_RELPATHS = {"log.md", "outputs-index.md"}

# Retirement markers, read from the first 20 lines (the frontmatter block). Three shapes are accepted on
# purpose: the pages measured in use carry `status: retired` and `retired: <date>`, while the documented
# `retired: true` appeared on none of them. Matching only the documented form would ship a rule that
# excludes nothing while looking like it works. `retired: false` and `retired: no` say the page is live,
# so those two values are the ones that do not retire it.
_RETIRED_RE = re.compile(r"^\s*(?:retired\s*:\s*(?!false\b|no\b)\S|status\s*:\s*retired\s*$)", re.IGNORECASE)
_FRONTMATTER_LINES = 20


class ReadLogRow(TypedDict):
    """One READS_LOG row. The key order is the order it is written in."""

    ts: str
    query: str
    results: int


def _disp(p: Path) -> str:
    """The path as the index stores and shows it: repo-relative, or the plain path when p is outside
    the repository (a vault or index pointed elsewhere)."""
    try:
        return p.relative_to(REPO).as_posix()
    except ValueError:
        return p.as_posix()


def _is_retired(p: Path) -> bool:
    """True when the first 20 lines of p carry a retirement marker. An unreadable file is NOT retired:
    better indexed and noisy than silently dropped out of memory."""
    try:
        with p.open("r", encoding="utf-8", errors="replace") as fh:
            for i, line in enumerate(fh):
                if i >= _FRONTMATTER_LINES:
                    return False
                if _RETIRED_RE.match(line):
                    return True
    except OSError:
        return False
    return False


def iter_md() -> Iterator[Path]:
    """Every *.md under VAULT, less Obsidian's device-local state, the files in EXCLUDED_RELPATHS and
    any page whose frontmatter marks it retired. build() and the staleness scan both read this, so
    one list decides what is searchable and what can force a rebuild."""
    for p in VAULT.rglob("*.md"):
        if ".obsidian" in p.parts:
            continue
        rel = p.relative_to(VAULT).as_posix()
        if rel in EXCLUDED_RELPATHS:
            continue
        if _is_retired(p):
            continue
        yield p


def chunk_file(text: str) -> list[tuple[str, str, int]]:
    """Split a markdown page into (heading_trail, body, line_start) chunks at its H1 to H3 headings.

    The preamble before the first heading is its own chunk. The heading trail keeps the parent
    context ('Project > Status'), so a result names where in the page it lives."""
    lines = text.splitlines()
    chunks: list[tuple[str, str, int]] = []
    trail: list[tuple[int, str]] = []
    buf: list[str] = []
    buf_head = ""
    buf_start = 1
    for i, line in enumerate(lines, 1):
        m = HEADING.match(line)
        if m:
            if buf and any(s.strip() for s in buf):
                chunks.append((buf_head, "\n".join(buf).strip(), buf_start))
            level = len(m.group(1))
            title = m.group(2).strip()
            trail = [t for t in trail if t[0] < level]
            trail.append((level, title))
            buf_head = " > ".join(t[1] for t in trail)
            buf, buf_start = [], i
        else:
            buf.append(line)
    if buf and any(s.strip() for s in buf):
        chunks.append((buf_head, "\n".join(buf).strip(), buf_start))
    return chunks


# build() keeps taking no argument.
# contract: read as text by scripts/tests/test_vault_search_db_states.py:231-235 (unseen: calls the imported copy).
def build() -> int:
    """Rebuild the index from every page iter_md() yields, print the build line, and return 0.

    Raises OSError when DB's folder cannot be made, and sqlite3.Error when DB is not a database or
    another writer holds it past the busy timeout. Both are left to surface as a traceback."""
    DB.parent.mkdir(parents=True, exist_ok=True)
    t0 = time.time()
    # One transaction from the first DROP to the last meta row, so a reader, such as the recall hook (in
    # the Kit only) on every prompt, never sees an empty index. While the pages are chunked it sees the
    # old index whole. While the rows are written, a large rebuild spills SQLite's page cache and takes
    # the exclusive lock early, a reader is told the db is busy, and the recall hook injects nothing:
    # measured on a 3000-page vault, the last 1.3 s of a 4.5 s build. The sqlite3 module opens no
    # transaction before DDL on its own, so it is begun and committed by hand. IMMEDIATE takes the write
    # lock at the BEGIN, where SQLite waits out its busy timeout for another writer. A deferred BEGIN
    # meets that writer later, from inside a read, where SQLite gives up at once, so a build that meets
    # the laptop's nightly job mid-write would crash instead of waiting.
    con = sqlite3.connect(DB, isolation_level=None)
    con.execute("BEGIN IMMEDIATE")
    con.execute("DROP TABLE IF EXISTS chunks")
    con.execute("DROP TABLE IF EXISTS meta")
    # contract: read as text by system/recall/recall-inject.js:118-128. Keep the column ORDER; it is read by position.
    con.execute(
        "CREATE VIRTUAL TABLE chunks USING fts5("
        "path, heading, body, linestart UNINDEXED, "
        "tokenize='porter unicode61 remove_diacritics 2')"
    )
    con.execute("CREATE TABLE meta(key TEXT PRIMARY KEY, val TEXT)")
    n_files = n_chunks = 0
    rows: list[tuple[str, str, str, str]] = []
    for p in iter_md():
        try:
            text = p.read_text(encoding="utf-8", errors="replace")
        except OSError:
            continue
        rel = _disp(p)
        n_files += 1
        # build() calls chunk_file through the module global, looked up at every call.
        # contract: read as text by scripts/tests/test_vault_search_db_states.py:237-260 (unseen: swaps in a spy).
        for head, body, start in chunk_file(text):
            rows.append((rel, head, body, str(start)))
            n_chunks += 1
    con.executemany("INSERT INTO chunks(path, heading, body, linestart) VALUES (?,?,?,?)", rows)
    # build() calls time.strftime through the module global `time`, once, after the last chunk row.
    # contract: read as text by scripts/tests/test_vault_search_db_states.py:262-283 (unseen: swaps in a clock).
    con.execute("INSERT OR REPLACE INTO meta VALUES('built_at', ?)", (time.strftime("%Y-%m-%d %H:%M:%S"),))
    # built_epoch is the freshness boundary the search-time gate compares page mtimes against: the
    # build's START time, so a page touched mid-build usually counts as newer on the next search -
    # except one written in the build's own first clock tick (D12), missed until another page changes.
    con.execute("INSERT OR REPLACE INTO meta VALUES('built_epoch', ?)", (repr(t0),))
    con.execute("INSERT OR REPLACE INTO meta VALUES('files', ?)", (str(n_files),))
    con.execute("INSERT OR REPLACE INTO meta VALUES('chunks', ?)", (str(n_chunks),))
    con.execute("COMMIT")
    con.execute("INSERT INTO chunks(chunks) VALUES('optimize')")
    con.close()
    dt = time.time() - t0
    print(f"indexed {n_files} files -> {n_chunks} chunks in {dt:.2f}s -> {_disp(DB)}")
    return 0


def _fts_query(raw: str) -> str:
    """The FTS5 query for raw: each word quoted, so FTS5 syntax characters cannot raise, and the words
    ANDed. Empty when raw holds no word; the caller refuses that."""
    terms = re.findall(r"[\w']+", raw, flags=re.UNICODE)
    return " ".join(f'"{t}"' for t in terms)


def _scan_pages() -> tuple[set[str], float]:
    """The stored path of every page iter_md() yields, and the newest mtime among them (-1.0 when the
    vault is empty or unreadable). One pass, so each page is opened once per search."""
    paths: set[str] = set()
    newest = -1.0
    for p in iter_md():
        paths.add(_disp(p))
        try:
            m = p.stat().st_mtime
        except OSError:
            continue
        if m > newest:
            newest = m
    return paths, newest


def _index_is_stale() -> bool:
    """True when a page is newer than the build, when an indexed page was deleted, renamed or retired
    since, or when the build marker is missing (an index older than the marker rebuilds once to gain
    it). search() rebuilds before querying whenever this is True.

    Raises sqlite3.DatabaseError when DB is not a database."""
    if not DB.exists():
        return True
    con = sqlite3.connect(DB)
    try:
        row = con.execute("SELECT val FROM meta WHERE key='built_epoch'").fetchone()
        indexed: set[str] = {r[0] for r in con.execute("SELECT DISTINCT path FROM chunks")}
    except sqlite3.OperationalError:
        return True
    finally:
        con.close()
    if not row:
        return True
    try:
        built = float(row[0])
    except (TypeError, ValueError):
        return True
    pages, newest = _scan_pages()
    # An mtime cannot see a page that left: every indexed path must still be a page. Only this
    # direction, because a page with no chunks (an empty file) is a page the index holds no row for.
    # Paths compare as strings: alternating two spellings of one ALEX_VAULT_DIR rebuilds on every search.
    if not indexed <= pages:
        return True
    return newest > built


def append_jsonl_row(path: Path, row: ReadLogRow) -> None:
    """Append row to path as one JSON line: json.dumps in the row's own key order with UTF-8 kept
    raw, then a text-mode newline. Raises OSError, and ValueError for text it cannot encode."""
    # The bytes: json.dumps(..., ensure_ascii=False), "a" text mode in UTF-8, "\n" written as the platform newline.
    # contract: read as text by scripts/tests/test_vault_search_read_log.py:139-148 (unseen: compares log bytes).
    # contract: read as text by scripts/tests/test_vault_search_read_log.py:151-159 (unseen: counts log newlines).
    with path.open("a", encoding="utf-8") as f:
        f.write(json.dumps(row, ensure_ascii=False) + "\n")


def _log_read(query: str, count: int) -> None:
    """Append this search's row to READS_LOG. Telemetry: a failed write is dropped silently and never
    changes the search. ValueError is caught with OSError because a query holding an unencodable
    surrogate (a POSIX argv byte under surrogateescape, or an unpaired UTF-16 unit on Windows) cannot
    be encoded on write."""
    with contextlib.suppress(OSError, ValueError):
        # The key order is the contract: ts, query, results, the order append_jsonl_row() writes them in.
        # contract: read as text by scripts/tests/test_vault_search_read_log.py:131 (unseen: parses the log).
        # contract: read as text by scripts/tests/test_vault_search_read_log.py:139-148 (unseen: compares log bytes).
        row: ReadLogRow = {"ts": time.strftime("%Y-%m-%dT%H:%M:%S"), "query": query, "results": count}
        append_jsonl_row(READS_LOG, row)


def search(query: str, n: int) -> int:
    """Print the hits for query, at most n of them (a value below 1 means DEFAULT_LIMIT), after
    rebuilding a stale index. Returns 0, a search with no matches included, or 2 for an empty query
    or an index the query cannot run against."""
    q = _fts_query(query)
    if not q:
        print("empty query", file=sys.stderr)
        return 2
    # The freshness gate. A nightly rebuild alone leaves an inverted staleness window: a fact captured
    # after it is findable by grep at once but invisible to BM25 until the next night, so the better
    # tool is the staler one. Rather than return stale results, rebuild whenever the vault moved past
    # the index (a full rebuild is sub-second). The laptop's nightly job stays only as a scheduled reconciler.
    if _index_is_stale():
        # The rebuild notice keeps its exact text, on stderr.
        # contract: read as text by scripts/tests/test_vault_search_db_states.py:51 (unseen: compares child stderr).
        # contract: read as text by scripts/tests/test_vault_search_rebuild.py:39 (unseen: compares child stderr).
        # contract: read as text by scripts/tests/test_vault_search_exclusions.py:41 (unseen: compares child stderr).
        print("index stale (vault changed since last build) - rebuilding before search...", file=sys.stderr)
        # The build line belongs to `build`'s own stdout, where the laptop job parses it. Inside a
        # search, stdout carries the results and nothing else, so the line follows the notice.
        with contextlib.redirect_stdout(sys.stderr):
            build()
    con = sqlite3.connect(DB)
    try:
        cur = con.execute(
            "SELECT path, heading, linestart, "
            "snippet(chunks, 2, '>>', '<<', ' ... ', 14) AS snip, "
            "bm25(chunks, 0.25, 2.0, 1.0, 0.0) AS score "
            "FROM chunks WHERE chunks MATCH ? ORDER BY score LIMIT ?",
            (q, n if n > 0 else DEFAULT_LIMIT),  # SQLite reads LIMIT 0 as none and a negative one as all
        )
        results: list[tuple[str, str, str, str, float]] = cur.fetchall()
    except sqlite3.OperationalError as e:
        print(f"search error: {e}", file=sys.stderr)
        return 2
    finally:
        con.close()
    _log_read(query, len(results))
    if not results:
        print(f"no matches for: {query}")
        return 0
    # Each result prints as this block, byte for byte.
    # contract: read as text by scripts/tests/test_vault_search_cli.py:186-194 (unseen: compares child stdout).
    for i, (path, head, line, snip, _score) in enumerate(results, 1):
        loc = f"{path}:{line}"
        if head:
            loc += f"  [{head}]"
        snip = " ".join(snip.split())
        print(f"{i}. {loc}")
        print(f"   {snip}\n")
    return 0


def stats() -> int:
    """Print the index's path and size, its file and chunk counts and its build time, and return 0; or
    return 2, with a hint on stderr, when there is no index yet. Raises sqlite3.Error when DB holds no
    meta table or is not a database."""
    if not DB.exists():
        print("no index yet - run: python scripts/vault_search.py build", file=sys.stderr)
        return 2
    con = sqlite3.connect(DB)
    meta: dict[str, str] = dict(con.execute("SELECT key, val FROM meta").fetchall())
    con.close()
    size_kb = DB.stat().st_size / 1024
    # The four stats lines keep their labels, padding and order.
    # contract: read as text by scripts/tests/test_vault_search_cli.py:151-163 (unseen: compares child stdout).
    print(f"db:      {_disp(DB)} ({size_kb:.0f} KB)")
    print(f"files:   {meta.get('files', '?')}")
    print(f"chunks:  {meta.get('chunks', '?')}")
    print(f"built:   {meta.get('built_at', '?')}")
    return 0


def main() -> int:
    """Run the subcommand on the command line and return its exit code."""
    # Vault content is full Unicode (arrows, Arabic, Swedish), and Windows consoles default to cp1252.
    # A stream without reconfigure (replaced, or absent under pythonw) is left as it is.
    for stream in (sys.stdout, sys.stderr):
        reconfigure = getattr(stream, "reconfigure", None)
        if reconfigure is not None:
            with contextlib.suppress(ValueError):
                reconfigure(encoding="utf-8", errors="replace")
    ap = argparse.ArgumentParser(description="SQLite FTS5 search over the markdown vault.")
    sub = ap.add_subparsers(dest="cmd", required=True)
    sub.add_parser("build", help="(re)build the index")
    sp = sub.add_parser("search", help="ranked keyword search")
    sp.add_argument("query")
    sp.add_argument(
        "-n",
        type=int,
        default=DEFAULT_LIMIT,
        help=f"max results (default {DEFAULT_LIMIT})",
    )
    sub.add_parser("stats", help="index size / counts / last build time")
    args = ap.parse_args()
    if args.cmd == "build":
        return build()
    if args.cmd == "search":
        return search(args.query, args.n)
    if args.cmd == "stats":
        return stats()
    raise AssertionError(f"unknown command {args.cmd!r}")


if __name__ == "__main__":
    sys.exit(main())
