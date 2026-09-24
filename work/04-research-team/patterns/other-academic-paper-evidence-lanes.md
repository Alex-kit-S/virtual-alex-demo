---
class: other
created: 2026-08-06
last_used: 2026-08-06
times_used: 1
---
# Academic paper via parallel evidence lanes

> **LANE BUDGET: 3 spawned agents at a time, maximum.** This system runs on a Claude Pro plan, where
> the daily allowance is the binding constraint and parallel agents are the fastest way to spend it.
> If the roster below names more than three lanes, that is not permission to spawn them all at once:
> run the first three, let them report, then run the rest as a second pass against what came back.
> A second pass is usually BETTER than a wider first one, because the later lanes get to see the
> earlier findings instead of guessing in parallel. Say the plan out loud at the approval gate,
> including how many passes it will take, before spawning anything.

## Question shape
"Write me an academic paper / literature review (+ proposed study) on TOPIC in CONTEXT, citation style X, ~N words, deliverable a document." The relay family's first ACADEMIC MANUSCRIPT deliverable. Also fits: grant-proposal background sections, thesis literature chapters.

## Team
- Lane A - domain evidence (global): mission = what the international empirical record actually shows, meta-analyses first | tools: Exa/WebSearch/WebFetch | output: findings by theme + verified sources + gaps
- Lane B - theory spine: mission = the canonical frameworks + constructs + how each is measured, every classic verified live | same tools | same shape
- Lane C - the CASE context (here: Iraq): mission = local literature; widen to the region ONLY with the gap explicitly labelled, never padded | same tools | same shape
- Lane D - instruments + method: mission = validated instruments with psychometrics, design authorities, sampling/ethics practice in the case region | same tools | same shape
- Master (Alex): frames the study FIRST (title, problem, RQs bind every lane), synthesizes, writes the manuscript, builds the document, runs deterministic checks.

## Synthesis approach
Master writes; lanes never conclude. The reference list admits ONLY fully-verified entries (complete byline + venue + DOI/URL + retrieval date); incomplete records are EXCLUDED, not repaired from memory. Build the document programmatically (python-docx for APA 7) with deterministic checks in the build script: body word count against the commissioned band (fix the MANUSCRIPT when out of band, never the report), abstract band, zero em-dashes, every reference cited in text, alphabetical order. Read back the built file.

## Lessons
- Persona in every lane prompt verbatim (the 07-29 voice-law-downstream rule), plus the evidence law and the timebox.
- The evidence law is the whole game: "a fabricated reference fails the run" in every lane prompt produced 86 verified sources and honest byline-incomplete flags instead of confident fakes. 13 flagged records were dropped; none needed repair.
- First build under-ran the word band by 10% (3,248 vs 3,600 floor). Word bands need a mechanical in-script count, and the fix is substantive additions (scope conditions, hypotheses, counter-evidence), not padding. Same lesson as the guide rewrite (run 42 prompting): when a length is commissioned, measure.
- The case-context lane may over-deliver: brief it to label region-widening, but let it report the local literature it actually finds; the skew it maps (here: Kurdistan/private vs federal public) can become the paper's research gap.
- Naive alphabetical checkers false-positive on APA's initials rule (Liu, G. before Liu, G. L.); verify by the rule, not the regex.
- **The follow-on QA relay (run 42) is worth its cost and has a natural shape:** APA-audit agent -> design-applicability agent (RQ-trace: hypothesis/instrument/analysis per RQ, hunting analyzed-but-never-measured and measured-but-never-analyzed constructs) -> humanization agent, master debating each. The RQ-trace and the anonymization-vs-linkage check found what the writing pass could not see about itself.
- Reference fixes are their OWN verification sweep (Crossref API is the workhorse): two author-list corrections (a second author, a 1->3 author change with final pagination) surfaced that no memory-typed fix would have caught. Never insert a candidate DOI unresolved.
- Humanization is verifiable mechanically: citation + numeric MULTISET identity vs the source, references byte-identity, kill-list scan, sentence-length SD must RISE. The polished register (soul.md) survives an academic manuscript; broken grammar does not belong in one.
