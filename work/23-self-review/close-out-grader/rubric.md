# Close-Out Grader Rubric (identity-carrying output)

Independently checkable criteria for the Close-Out Gate item C. Each is graded PASS / FAIL / N-A
with one line of evidence. The grader sees ONLY the finished artifact + this rubric, never the
producing context's reasoning (the Outcomes separate-context pattern: a grader in its own window
can't be talked into passing by the maker's own justification).

**Source of truth:** brand/config/brand-config.md + brand/config/color-system.md (visual) and
soul.md Voice Rules + My Words (prose). If this rubric and those files ever disagree, the files win;
fix the rubric.

Grade against what the artifact ACTUALLY contains (for a visual you can't render, grade the source:
the hex codes, font-family declarations and logo references in the HTML/CSS/code). This is exactly
what would have caught the 2026-07-03 brand incident, where a dashboard shipped with improvised
off-brand styling because the brand file was never read.

---

## Visual criteria (apply when the artifact is a styled visual: HTML/CSS/SVG, deck, doc, image, dashboard, Excel, PDF)

- **BV1 Palette.** Every color resolves to the ALEX palette or plain white/black:
  Ink Black `#001219`, Dark Teal `#005f73`, Dark Cyan `#0a9396`, Pearl Aqua `#94d2bd`,
  Vanilla Custard `#e9d8a6`, Golden Orange `#ee9b00`, Burnt Caramel `#ca6702`,
  alarm reds `#bb3e03` / `#ae2012` / `#9b2226`, plus the light-mode tertiary gray `#4a5a5e`
  (captions/dates/secondary text on light surfaces; sanctioned by brand-config.md Fonts +
  color-system.md `[data-theme="light"] --text-tertiary`; rubric gap found by the 2026-07-07
  CV grade), the elevated dark surface `#00232e` (color-system.md §4.1 / §7 `--bg-elevated`),
  and Signal Coral `#ff8a75` ONLY as small error/recording text on dark surfaces (§4.4 /
  `--error-text-dark`, D5 2026-07-12; as a fill, border, or on light surfaces it FAILS - both
  added 2026-07-13, rubric-lag flagged by the wave-1 HQ grade). **FAIL** on any off-brand color,
  and specifically on the RETIRED brand palette (navy `#0C1651`, cyan `#12CCDD`, coral `#F09063`).
- **BV2 Accent discipline.** At most ONE Golden Orange accent per view/page. FAIL if orange is used
  as a general fill or on multiple competing elements in one view.
- **BV3 Typography.** Calibri for generated documents, or the `"Segoe UI", system-ui` stack for
  web/UI. One documented exception: the Alex HQ dashboard app runs Oxanium (display words/kickers) +
  Instrument Sans (body) + Martian Mono (data numerals) (brand-config.md Fonts, APPROVED DEVIATION
  D6 2026-07-12 as REPLACED 2026-07-29 - the earlier Chakra Petch + IBM Plex trio is retired with
  it; scoped to that app ONLY - the same trio on any other surface FAILS; added 2026-07-13,
  rubric-lag flagged by the wave-1 HQ grade, and re-aligned 2026-07-29 when the reskin grade
  exposed the lag again). FAIL if identity text uses a generic/other family (Arial, Times,
  Helvetica, default serif).
- **BV4 Red discipline.** Red appears ONLY as alarm / negative value / threshold, never as
  decoration or structure. A healthy screen has no red.
- **BV5 Logo.** The ALEX logo (`alex-logo-transparent.png`, or the full-bleed `alex-logo.jpg` on a
  dark block) is present on a primary identity surface (cover/header/hero), and the wordmark is never
  retyped as live text. N-A only if the artifact type genuinely carries no logo surface (state which).

## Voice criteria (apply when the artifact contains prose a human reads as the owner's words: email, LinkedIn post, cover letter, slide copy, any user-facing text)

- **PV1 No dashes.** Zero em-dashes, ever. En-dashes FAIL too, EXCEPT inside numeric/date ranges
  (e.g. "Jan 2019 – Present", "2006 – 2010" in a CV/experience/skills context), which are sanctioned
  by the no-dash sanitizer spec (root CLAUDE.md: em-dash -> comma always; date en-dashes protected;
  rubric aligned 2026-07-07). Comma or colon instead everywhere else. FAIL on any violation.
- **PV2 No AI tells.** None of: "it's important to note", "that said", "moreover", "furthermore",
  "additionally", "in conclusion", "delve", "navigate", "leverage", "underscore", "arguably",
  "tapestry", "realm". FAIL and quote the offender.
- **PV3 No corporate softeners.** No cheerleading, no "great question", no hedging walls, no faked
  certainty, no "I'd be happy to". FAIL and quote.
- **PV4 Rhythm.** Sentence length varies (a short punchy line near a longer one), not a uniform,
  evenly measured cadence. FAIL if every sentence is the same measured length (itself an AI tell).
- **PV5 The owner's words, not generic English.** ESL-direct, present tense, plain Anglo vocabulary
  ("cut" not "impacted", "deal" not "engagement", "fired" not "let go"), consistent with soul.md
  My Words. **FAIL if it reads as correct-but-generic corporate English that could have come from any
  competent AI.** This is the load-bearing one; the others are its symptoms.

## Process criterion (both)

- **PR1 Pre-flight.** The Brand + Soul pre-flight line was printed before generation (the audit
  trail). FAIL if the delivery record shows no pre-flight line for an identity-carrying output.

---

## Verdict
- **PASS** only if no criterion is FAIL (N-A criteria don't block).
- **FAIL** if any criterion fails; list the failing IDs so the producer can fix and re-grade.
- The grader is **ADVISORY**: it reports PASS/FAIL, it does not itself block a scheduled run
  (see the README). A FAIL is a flag for the producing session / the owner, not a hard gate.
