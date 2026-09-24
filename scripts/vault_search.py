#!/usr/bin/env python3
"""Vault search: a single-file SQLite FTS5 index over the markdown vault.

Alex's memory recall was read-the-index-and-drill (vault/index.md first), which stops
scaling as the vault grows (2026-07-06 audit weakness 2; 2026-07-07 upgrade scan item 1).
This adds keyword search with BM25 ranking, zero new dependencies (stdlib sqlite3 ships FTS5),
no embeddings. The vault stays plain markdown and Obsidian is untouched; the .db is derived and
disposable, rebuilt nightly by scripts/run-vault-index.ps1 (a zero-token scheduled job).

Usage:
  python scripts/vault_search.py build            # (re)build the index from vault/**/*.md
  python scripts/vault_search.py search "query"   # ranked results (default 10)
  python scripts/vault_search.py search "query" -n 20
  python scripts/vault_search.py stats            # index size / chunk count / last build

Design: derives the repo root from the script's own location (survives a restore to any path),
chunks each file by heading so results point at a section, ranks with bm25 weighting the heading
above the body. Query terms are quoted defensively so FTS5 syntax chars in the query can't error.
"""
import argparse
import json
import os
import re
import sqlite3
import sys
import time
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
# Paths are env-overridable so the freshness gate can be exercised against a sandbox vault
# (scripts/tests/test_vault_search_freshness.py) without touching the real index.
VAULT = Path(os.environ.get("ALEX_VAULT_DIR", str(REPO / "vault")))
DB = Path(os.environ.get("ALEX_INDEX_DB", str(REPO / "scripts" / "vault-index" / "vault-search.db")))
# Read-experiment instrument (2026-07-15, /prompting item 7): one JSONL row per search, so we can
# measure whether the vault's retrieval path is actually exercised. Gitignored, zero-token, no schedule.
READS_LOG = Path(os.environ.get("ALEX_READS_LOG", str(REPO / "system" / "vault-reads.jsonl")))

HEADING = re.compile(r"^(#{1,3})\s+(.*)$")


def _disp(p):
    """Repo-relative path for display, or the plain path if p is outside the repo."""
    try:
        return p.relative_to(REPO).as_posix()
    except ValueError:
        return p.as_posix()


# --- The exclusion list (ported from personal-os, 2026-09-20) --------------------------------------
# ONE list, because iter_md() feeds BOTH build() and _newest_source_mtime(). Anything kept out of the
# corpus is kept out of the staleness scan by construction, which is the point: a file you cannot
# search must not be able to force a rebuild either.
#
# log.md is your append-only journal. It is not a page: its chunks are near-duplicate one-liners that
# crowd out the real answers, and because every session writes to it, it is usually the newest file in
# the vault, so on its own it made the next search rebuild the whole index first.
#
# outputs-index.md is GENERATED from the deliverables ledger. Indexing a derived file makes every row
# in it findable twice.
EXCLUDED_RELPATHS = {"log.md", "outputs-index.md"}

# Retirement markers, read from the first 20 lines (the frontmatter block). Three shapes are accepted
# on purpose: upstream measured that `status: retired` and `retired: <date>` are what pages actually
# carry, while the documented `retired: true` appeared on none of them. Matching only the documented
# form would ship a rule that excludes nothing while looking like it works.
_RETIRED_RE = re.compile(r"^\s*(?:retired\s*:\s*\S|status\s*:\s*retired\s*$)", re.IGNORECASE)
_FRONTMATTER_LINES = 20


def _is_retired(p):
    """True if the first 20 lines carry a retirement marker. Unreadable = NOT retired (fail-open: a
    file we cannot read is better indexed and noisy than silently dropped out of memory)."""
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


def iter_md():
    """Every *.md under vault/, skipping Obsidian's device-local UI state, the journal and generated
    files in EXCLUDED_RELPATHS, and any page whose frontmatter marks it retired.

    Used by BOTH build() and _newest_source_mtime(), on purpose. See EXCLUDED_RELPATHS above."""
    for p in VAULT.rglob("*.md"):
        if ".obsidian" in p.parts:
            continue
        try:
            rel = p.relative_to(VAULT).as_posix()
        except ValueError:
            rel = p.name
        if rel in EXCLUDED_RELPATHS:
            continue
        if _is_retired(p):
            continue
        yield p


def chunk_file(text):
    """Split a markdown file into (heading_trail, body, line_start) chunks at H1-H3 headings.

    The preamble before the first heading is its own chunk. A heading trail keeps parent
    context ('Project > Status') so a result names where in the file it lives.
    """
    lines = text.splitlines()
    chunks = []
    trail = []            # (level, title) stack
    buf, buf_head, buf_start = [], "", 1
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


def build():
    DB.parent.mkdir(parents=True, exist_ok=True)
    t0 = time.time()
    con = sqlite3.connect(DB)
    con.execute("DROP TABLE IF EXISTS chunks")
    con.execute("DROP TABLE IF EXISTS meta")
    con.execute(
        "CREATE VIRTUAL TABLE chunks USING fts5("
        "path, heading, body, linestart UNINDEXED, "
        "tokenize='porter unicode61 remove_diacritics 2')"
    )
    con.execute("CREATE TABLE meta(key TEXT PRIMARY KEY, val TEXT)")
    n_files = n_chunks = 0
    rows = []
    for p in iter_md():
        try:
            text = p.read_text(encoding="utf-8", errors="replace")
        except OSError:
            continue
        try:
            rel = p.relative_to(REPO).as_posix()
        except ValueError:
            # Vault outside the repo (env override / symlinked restore): store the plain path.
            rel = p.as_posix()
        n_files += 1
        for head, body, start in chunk_file(text):
            rows.append((rel, head, body, str(start)))
            n_chunks += 1
    con.executemany(
        "INSERT INTO chunks(path, heading, body, linestart) VALUES (?,?,?,?)", rows
    )
    con.execute("INSERT OR REPLACE INTO meta VALUES('built_at', ?)",
                (time.strftime("%Y-%m-%d %H:%M:%S"),))
    # built_epoch is the freshness boundary the search-time gate compares vault mtimes against.
    # Use the build START time (t0), the conservative choice: a file touched mid-build is treated
    # as newer next search rather than silently missed.
    con.execute("INSERT OR REPLACE INTO meta VALUES('built_epoch', ?)", (repr(t0),))
    con.execute("INSERT OR REPLACE INTO meta VALUES('files', ?)", (str(n_files),))
    con.execute("INSERT OR REPLACE INTO meta VALUES('chunks', ?)", (str(n_chunks),))
    con.commit()
    con.execute("INSERT INTO chunks(chunks) VALUES('optimize')")
    con.commit()
    con.close()
    dt = time.time() - t0
    print(f"indexed {n_files} files -> {n_chunks} chunks in {dt:.2f}s -> {_disp(DB)}")
    return 0


def _fts_query(raw):
    """Quote each bareword term so FTS5 special chars in the query can't raise a syntax error.
    Implicit AND across terms. Empty query is rejected by the caller."""
    terms = re.findall(r"[\w']+", raw, flags=re.UNICODE)
    return " ".join(f'"{t}"' for t in terms)


def _newest_source_mtime():
    """Max mtime across indexed vault files; -1.0 if the vault is empty/unreadable."""
    newest = -1.0
    for p in iter_md():
        try:
            m = p.stat().st_mtime
        except OSError:
            continue
        if m > newest:
            newest = m
    return newest


def _index_is_stale():
    """True if any vault file changed at/after the index was built, or the freshness marker
    is missing (a pre-gate index rebuilds once to gain it). This is what makes silently-stale
    results impossible: the caller rebuilds before querying when this returns True."""
    if not DB.exists():
        return True
    con = sqlite3.connect(DB)
    try:
        row = con.execute("SELECT val FROM meta WHERE key='built_epoch'").fetchone()
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
    return _newest_source_mtime() > built


def _log_read(query, count):
    """Append one row per search to READS_LOG (read-experiment, 2026-07-15 /prompting item 7).
    Best-effort: a logging failure must NEVER break a search."""
    try:
        rec = {"ts": time.strftime("%Y-%m-%dT%H:%M:%S"), "query": query, "results": count}
        with open(READS_LOG, "a", encoding="utf-8") as f:
            f.write(json.dumps(rec, ensure_ascii=False) + "\n")
    except Exception:
        pass


def search(query, n):
    q = _fts_query(query)
    if not q:
        print("empty query", file=sys.stderr)
        return 2
    # Freshness gate (P1.5 fix). The nightly 21:35 rebuild otherwise leaves an inverted staleness
    # window: a fact captured after the rebuild is grep-able and index-able immediately but invisible
    # to BM25 until the next night, so the better tool is the staler one. Rather than return silently
    # stale results, rebuild whenever any vault file is newer than the index (a full rebuild over the
    # whole vault is sub-second). The nightly job stays only as a scheduled reconciler.
    if _index_is_stale():
        print("index stale (vault changed since last build) - rebuilding before search...",
              file=sys.stderr)
        build()
    con = sqlite3.connect(DB)
    try:
        cur = con.execute(
            "SELECT path, heading, linestart, "
            "snippet(chunks, 2, '>>', '<<', ' ... ', 14) AS snip, "
            "bm25(chunks, 0.25, 2.0, 1.0, 0.0) AS score "
            "FROM chunks WHERE chunks MATCH ? ORDER BY score LIMIT ?",
            (q, n),
        )
        results = cur.fetchall()
    except sqlite3.OperationalError as e:
        print(f"search error: {e}", file=sys.stderr)
        return 2
    finally:
        con.close()
    _log_read(query, len(results))
    if not results:
        print(f"no matches for: {query}")
        return 0
    for i, (path, head, line, snip, score) in enumerate(results, 1):
        loc = f"{path}:{line}"
        if head:
            loc += f"  [{head}]"
        snip = " ".join(snip.split())
        print(f"{i}. {loc}")
        print(f"   {snip}\n")
    return 0


def stats():
    if not DB.exists():
        print("no index yet - run: python scripts/vault_search.py build", file=sys.stderr)
        return 2
    con = sqlite3.connect(DB)
    meta = dict(con.execute("SELECT key, val FROM meta").fetchall())
    con.close()
    size_kb = DB.stat().st_size / 1024
    print(f"db:      {_disp(DB)} ({size_kb:.0f} KB)")
    print(f"files:   {meta.get('files', '?')}")
    print(f"chunks:  {meta.get('chunks', '?')}")
    print(f"built:   {meta.get('built_at', '?')}")
    return 0


def main():
    # Vault content is full Unicode (arrows, Arabic, Swedish); Windows consoles default to cp1252.
    for stream in (sys.stdout, sys.stderr):
        try:
            stream.reconfigure(encoding="utf-8", errors="replace")
        except (AttributeError, ValueError):
            pass
    ap = argparse.ArgumentParser(description="SQLite FTS5 search over the markdown vault.")
    sub = ap.add_subparsers(dest="cmd", required=True)
    sub.add_parser("build", help="(re)build the index")
    sp = sub.add_parser("search", help="ranked keyword search")
    sp.add_argument("query")
    sp.add_argument("-n", type=int, default=10, help="max results (default 10)")
    sub.add_parser("stats", help="index size / counts / last build time")
    args = ap.parse_args()
    if args.cmd == "build":
        return build()
    if args.cmd == "search":
        return search(args.query, args.n)
    if args.cmd == "stats":
        return stats()
    return 1


if __name__ == "__main__":
    sys.exit(main())
