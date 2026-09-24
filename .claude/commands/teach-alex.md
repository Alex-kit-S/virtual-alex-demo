# /teach-alex - The Teach-Alex Button

<!-- ALEX:CMD-HEADER:BEGIN generated from system/manifest.json by scripts/generate-alex.js - do not hand-edit -->
> **#22 /teach-alex · EVENT · Trigger: inbox note + on-demand**
> Registry: `system/manifest.json` · Spec: `work/22-teach-alex/CLAUDE.md` · Status: `vault/projects/teach-alex/status.md`
> *State and trigger above are GENERATED from the registry. Do not restate a schedule elsewhere in this file; point at the registry instead.*
<!-- ALEX:CMD-HEADER:END -->

Full spec: `work/22-teach-alex/CLAUDE.md` (read it first).

Frictionless corrections from anywhere. Drop a note in `inbox/` ("you got X wrong, here is the rule"), or just say it in a session; Alex classifies it, files it to the right home, confirms before touching any identity file, and logs it so the weekly `/self-review` (#23) can batch it. The "correct it" verb of the system.

## Modes
- `/teach-alex "<correction>"` - correct Alex on the spot.
- Or drop the correction in the "Drop a note to Alex" inbox (typed or voice). The next touchpoint catches it.

## Steps the command executes
1. **Classify** the correction into ONE type: voice/phrasing · fact/person-label · rule/behavior · format · ambiguous.
2. **Choose the target file** per the classifier in the spec (soul.md My Words · a people/business page · a CLAUDE.md rule · a command/spec format note).
3. **Propose the exact edit** (file + old -> new + a one-line rationale).
4. **Apply:** identity files (soul.md, any CLAUDE.md) ALWAYS CONFIRM first, showing the exact edit before making it; unambiguous fact and format edits can apply on their own. A new person goes through People Intake. Moving a person between category folders CONFIRMS.
5. **Reply** with what changed (Alex voice), and **append to** `vault/projects/teach-alex/corrections-log.md` (date, raw note, type, target, status, edit).
6. Update the "what Alex learned" digest + `vault/log.md`.

## Guardrails
Never edits soul.md or any CLAUDE.md without explicit confirmation. Never sends outward. If the target is unclear, ask one sharp question (interactive) or file `needs-review` (unattended). Fabricate nothing.

## Close-Out
Print the Close-Out Report. Teach-Alex extras: every correction logged to corrections-log; identity edits confirmed; new person -> people/.
