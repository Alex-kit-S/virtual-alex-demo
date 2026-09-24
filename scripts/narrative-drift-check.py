#!/usr/bin/env python
# Item 3 (2026-07-20): numbers-drift check for the identity-carrying master reference.
# Zero-token. Called from check.ps1 as C19. Detect, never repair.
#
# REPOINTED + EXPANDED 2026-07-25 (stress-test fix F2). The master reference MOVED out of the repo
# on 2026-07-21, but this check still hardcoded the old in-repo path - now a 481-byte retirement
# stub - so it read the stub, found no claims, and returned 0 (falsely clean). The living doc was
# guarded by nothing while its claims drifted (standing sections said "V1-V11" while the code ran
# V1-V12, the escrow date was stale, etc). The fixes:
#   (1) the master path is read from system/manifest.json meta.paths.master_reference_md (single
#       source of truth, %USERPROFILE%-anchored) so a future move updates ONE place and cannot
#       silently rot a hardcoded literal again;
#   (2) an ABSENT master returns 2 (amber), never 0 - so a move not reflected in the manifest, or a
#       fresh clone without the out-of-repo doc, is SURFACED, never hidden behind a green;
#   (3) the claim-set is DERIVED from ground-truth sources (not frozen numbers): the recovery
#       C-count from check.ps1, the validator V-count from validate-alex.js, the non-retired project
#       count from the manifest, and the escrow attestation date from state/passphrase-attested.txt.
#
# Claims are checked ONLY in the STANDING part of the doc (everything before the "## 11. Running
# changes" section). The dated running-changes entries legitimately carry the count/version AT THAT
# DATE ("added C18, now V1-V12"); flagging those would false-positive on every historical line and
# break the living-doc-with-running-changes model this check protects. Each new claim needs its own
# (doc-regex + derived-truth) pair; pure prose drift stays the monthly /lint's job.
#
# Exit 0 = consistent - 2 = drift found (one line per finding) - 1 = checker could not compute truth.
import re, sys, os, json, hashlib
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
CHECK_PS1 = REPO / "work" / "18-recovery-layer" / "check.ps1"
VALIDATE_JS = REPO / "scripts" / "validate-alex.js"
ATTEST = REPO / "work" / "18-recovery-layer" / "state" / "passphrase-attested.txt"
MANIFEST = REPO / "system" / "manifest.json"


def master_path(mani):
    p = (mani.get("meta", {}).get("paths", {}) or {}).get("master_reference_md")
    return Path(os.path.expandvars(p)) if p else None


def live_check_count():
    txt = CHECK_PS1.read_text(encoding="utf-8", errors="replace")
    return len(set(int(m) for m in re.findall(r'(?m)^\s*#\s*---\s*C(\d+)\b', txt)))


def live_v_count():
    """The validator suite size, read from its ONE structured declaration.

    Since 2026-07-25 (stress-test F-10) validate-alex.js declares `const V_MAX = <n>` and builds every
    label from it, so no consumer hand-writes the range. The old printed `V1-V<n> PASS` line is kept as
    a fallback for an older checkout; the bare-V scan is the last resort.
    """
    txt = VALIDATE_JS.read_text(encoding="utf-8", errors="replace")
    m = re.search(r'(?m)^const V_MAX\s*=\s*(\d+)\s*;', txt) or re.search(r'V1-V(\d+)\s+PASS', txt)
    if m:
        return int(m.group(1))
    nums = [int(x) for x in re.findall(r'\bV(\d+)\b', txt)]
    return max(nums) if nums else None


def live_project_count(mani):
    return sum(1 for p in mani.get("projects", []) if str(p.get("state", "")).upper() != "RETIRED")


def live_escrow_date():
    if not ATTEST.exists():
        return None
    lines = ATTEST.read_text(encoding="utf-8", errors="replace").splitlines()
    if not lines:
        return None
    m = re.search(r'\d{4}-\d{2}-\d{2}', lines[0])
    return m.group(0) if m else None


def standing_part(text):
    """Everything before the '## 11. Running changes' section (the dated history is excluded)."""
    m = re.search(r'(?m)^##\s+11\.\s', text)
    return text[:m.start()] if m else text


def sha256(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


# IO_REPARSE_TAG_MOUNT_POINT: what an NTFS directory junction is, at the filesystem level.
REPARSE_TAG_JUNCTION = 0xA0000003


def _strip_nt_prefix(s):
    for p in ("\\\\?\\", "\\??\\"):
        if s.startswith(p):
            return s[len(p):]
    return s


def view_findings(mani):
    """The identity docs must be ONE file object each, reached through a junction - not two synced copies.

    REWRITTEN 2026-07-25 (owner: "APPLY"), replacing a byte-equality compare that was only ever a
    monitor. History worth keeping, because it is the whole argument: the two folder copies of each doc
    were unified BY HAND on 07-24, drifted within a day, were unified again on 07-25, and drifted AGAIN
    85 minutes later while the permanent fix was being designed - a parallel session correctly appended a
    running-changes entry to the canonical and the duplicate silently fell behind. A weekly report that
    ends in a human re-copy cannot clear the permanence bar.

    So the invariant changed from "the two copies have equal bytes" to "there is only one file". The real
    files live in meta.paths.identity_doc_real_dir; every other location is a DIRECTORY JUNCTION into it,
    so each legacy path still resolves and divergence is not detected, it is impossible.

    WHY A JUNCTION AND NOT A HARDLINK - measured on this machine, not assumed: a replace-style save
    (write temp, rename over target; what Word, python-docx and most editors do) SILENTLY breaks a
    hardlink, leaving two files that look correct to anything not comparing file ids. The same write
    through a junction keeps one file, because the junction is on the DIRECTORY and NTFS resolves it
    before the file is ever created or renamed.

    MANDATORY IMPLEMENTATION NOTE: pin the test to st_reparse_tag. os.path.islink() returns FALSE for a
    junction (verified on this box, Python 3.12), so an islink-based check would green-light a fork.
    """
    out = []
    paths = mani.get("meta", {}).get("paths", {}) or {}

    real_raw = paths.get("identity_doc_real_dir")
    views = paths.get("identity_doc_views") or []
    if not real_raw:
        return ["meta.paths.identity_doc_real_dir is not set - the identity-doc layout cannot be verified"]
    real = Path(os.path.expandvars(real_raw))

    # (a) the real directory must exist, be a directory, and NOT itself be a link (nobody inverts this)
    if not real.is_dir():
        out.append(f"identity docs: the real directory is missing at {real} - every view is dangling")
        return out
    try:
        if os.lstat(real).st_reparse_tag != 0:
            out.append(f"identity docs: {real} is itself a reparse point - the real files must live in a REAL directory")
            return out
    except (AttributeError, OSError):
        pass  # non-Windows or unsupported: the samefile checks below still hold

    docs = sorted(p.name for p in real.iterdir() if p.is_file())
    if not docs:
        out.append(f"identity docs: the real directory {real} is EMPTY - the documents are gone from their declared home")

    # (b) every declared view is a junction, points at the real dir, and resolves to the SAME file objects
    for v in views:
        vp_raw, kind = v.get("path"), (v.get("kind") or "junction")
        if not vp_raw:
            continue
        vp = Path(os.path.expandvars(vp_raw))
        if not vp.exists():
            out.append(f"identity docs: the view {vp} is MISSING - re-create it: cmd /c mklink /J \"{vp}\" \"{real}\"")
            continue
        try:
            tag = os.lstat(vp).st_reparse_tag
        except (AttributeError, OSError) as e:
            out.append(f"identity docs: cannot read the reparse tag of {vp} ({e}) - cannot prove it is a junction")
            continue
        if kind == "junction" and tag != REPARSE_TAG_JUNCTION:
            out.append(
                f"identity docs: {vp} is NOT a junction any more (reparse tag {tag:#x}) - it is a real "
                f"directory or a copy, so the documents can now diverge. Compare it against {real} BY HAND "
                f"before removing anything; a file there may hold edits that exist nowhere else.")
            continue
        try:
            target = _strip_nt_prefix(os.readlink(vp))
            if Path(target) != real:
                out.append(f"identity docs: the view {vp} points at {target}, not at the declared real dir {real}")
                continue
        except OSError as e:
            out.append(f"identity docs: cannot read the junction target of {vp} ({e})")
            continue
        # the decisive assertion: same file object, per document, no byte comparison needed
        for name in docs:
            a, b = real / name, vp / name
            try:
                if not os.path.samefile(a, b):
                    out.append(f"identity docs: {b} is NOT the same file as {a} - the view has forked")
            except OSError as e:
                out.append(f"identity docs: cannot compare {a} and {b} ({e})")

    # (c) the copies that are still genuinely SEPARATE files keep the old byte-compare, honestly labelled.
    #     Today that is only the master's outer copy, pending the owner's decision to delete it.
    for pair in paths.get("identity_doc_byte_pairs") or []:
        canon_raw, copy_raw = pair.get("canonical"), pair.get("copy")
        if not canon_raw or not copy_raw:
            continue
        canon, copy = Path(os.path.expandvars(canon_raw)), Path(os.path.expandvars(copy_raw))
        label = pair.get("doc") or canon.name
        if not canon.exists():
            out.append(f"{label}: canonical missing at {canon}")
            continue
        if not copy.exists():
            out.append(f"{label}: the declared separate copy is missing at {copy} (drop it from manifest identity_doc_byte_pairs if it was deleted on purpose)")
            continue
        if sha256(canon) != sha256(copy):
            out.append(
                f"{label}: the separate copy at {copy} has DRIFTED from {canon.name}. This one is a real "
                f"second file, so it can drift; deleting it (the master stays reachable through the view) "
                f"is the permanent fix and is the owner's call.")
    return out


def main():
    if not MANIFEST.exists():
        print(f"cannot compute ground truth: {MANIFEST} missing", file=sys.stderr)
        return 1
    mani = json.loads(MANIFEST.read_text(encoding="utf-8", errors="replace"))
    if not CHECK_PS1.exists():
        print(f"cannot compute ground truth: {CHECK_PS1} missing", file=sys.stderr)
        return 1

    live_c = live_check_count()
    if live_c == 0:
        print("cannot compute ground truth: no '# --- C<n>' headers found in check.ps1", file=sys.stderr)
        return 1

    # Duplicate-copy equality runs FIRST and independently of the master's own claims: a drifted copy is
    # drift even when every number in the canonical file is right.
    copy_drift = view_findings(mani)

    master = master_path(mani)
    if master is None:
        print("cannot compute: system/manifest.json meta.paths.master_reference_md is not set", file=sys.stderr)
        return 1
    if not master.exists():
        for f in copy_drift:
            print(f)
        # AMBER, never silent-green: a move not reflected in the manifest, or a fresh clone without
        # the out-of-repo doc, must SURFACE. This is the anti-re-rot guard the old code never fired.
        print(f"master reference not found at {master} (out-of-repo doc absent; cannot verify its claims)")
        return 2

    text = standing_part(master.read_text(encoding="utf-8", errors="replace"))
    findings = list(copy_drift)

    # claim 1: recovery check count - "<N> deterministic checks"
    stated_c = [int(m.group(1)) for m in re.finditer(r'(\d+)\s+deterministic checks', text)]
    for v in stated_c:
        if v != live_c:
            findings.append(f"master claims '{v} deterministic checks' but check.ps1 runs {live_c} (C1-C{live_c})")
    if len(set(stated_c)) > 1:
        findings.append(f"master is internally inconsistent on the check count: claims {sorted(set(stated_c))} (live {live_c})")

    # claim 2: validator V-count - "V1-V<N>"
    live_v = live_v_count()
    if live_v is not None:
        for m in re.finditer(r'V1[-–]V(\d+)', text):
            v = int(m.group(1))
            if v != live_v:
                findings.append(f"master claims 'V1-V{v}' but validate-alex.js runs V1-V{live_v}")

    # claim 3: non-retired project count - "~N automations" (approximate register: flag only gross drift, >3 off)
    live_p = live_project_count(mani)
    for m in re.finditer(r'~?\s*(\d+)\s+automations', text):
        v = int(m.group(1))
        if abs(v - live_p) > 3:
            findings.append(f"master claims '{v} automations' but the manifest has {live_p} non-retired (>3 off)")

    # claim 4: escrow attestation date - "C14 attested <date>"
    esc = live_escrow_date()
    if esc:
        for m in re.finditer(r'C14 attested\s+(\d{4}-\d{2}-\d{2})', text):
            if m.group(1) != esc:
                findings.append(f"master cites 'C14 attested {m.group(1)}' but state/passphrase-attested.txt says {esc}")

    if findings:
        for f in findings:
            print(f)
        return 2
    return 0


if __name__ == "__main__":
    sys.exit(main())
