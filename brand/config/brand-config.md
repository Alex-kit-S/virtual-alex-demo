# Brand Configuration - ALEX (the default brand; `/brand` replaces it with the owner's own)

**APPLICATION: on conflict, `color-system.md` wins.** (Hierarchy formalized 2026-07-08: `brand/config/color-system.md` is the single source of color law: palette, hexes, tokens, ratios, contrast pairings, usage rules. This page holds only how to APPLY the brand in Excel, decks, PDFs, web, plus logo, fonts, and tone. Rules stated in both files were deleted from this one.)

**Rebrand 2026-07-03:** the previous brand identity (navy / cyan / coral + wordmark) is retired. Everything that carried it now uses the ALEX brand below. Old assets: `brand/archive/retired-brand/`. (Raw hexes of the dead palette removed from this file 2026-07-08 - validation check V5 allows only `color-system.md` tokens outside the law file; the retired values live in git history if ever needed.)

## Color tokens (lookup only)
Names + hexes for quick reference while building. Semantics, ratios (60-30-10), contrast pairings, and every do/don't live in `color-system.md`. Read it; don't work from this list alone.
Ink Black `#001219` · Dark Teal `#005f73` · Dark Cyan `#0a9396` · Pearl Aqua `#94d2bd` · Vanilla Custard `#e9d8a6` · Golden Orange `#ee9b00` · Burnt Caramel `#ca6702` · Rusty Spice `#bb3e03` · Oxidized Iron `#ae2012` · Brown Red `#9b2226` · elevated dark `#00232e` · light elevated `#fff5e1`

## Fonts (Type System v1.1, adopted by 2026-07-06)
**Generated documents (Word/Excel/PDF/HTML reports): Calibri.**
- Title/cover: 26pt bold · H1: 20pt bold `#005f73` · H2: 16pt bold `#005f73` · H3: 13pt bold `#005f73` · Body: 11pt `#001219` · Captions/footnotes: 9pt `#4a5a5e`. Line height ~1.45.
- Emphasis = bold, never color alone. Headings never in Golden Orange or any red (those are accent/alarm, not structure).

**Web/UI default (generated HTML reports, simple web output): `"Segoe UI", system-ui, -apple-system, sans-serif`.**
- Calibri is not web-safe cross-device; Segoe UI is its closest system sibling and needs no font download.
- Scale (px): display 32 · h1 24 · h2 18 · body 16 · secondary 14 · caption 12. Same color rules as documents (dark mode: white primary, Pearl Aqua secondary, Vanilla Custard tertiary).

**Web/UI instrument surfaces (Alex HQ dashboard) - APPROVED DEVIATION (documented 2026-07-12, D6; amended 2026-07-14, design-review C12; REPLACED 2026-07-29, light-default reskin):** the HQ app runs **Oxanium** (display + kickers - section labels, never data numerals) + **Instrument Sans** (body, INCLUDING timestamps/age stamps, with tabular figures where the font provides them) + **Martian Mono** (ALL data numerals: big stat numbers, overlay headline numbers, accent/readout counts - a true monospace, so tabular by construction), all variable fonts via `next/font/google`. *(Why replaced: 2026-07-29, "the font should read more tech", part of the 3D reskin commission. The Chakra Petch + IBM Plex trio this supersedes is in git history; the role SPLIT is unchanged from the 07-14 amendment - display words vs body vs data numerals - only the families moved.)* Same session, same reskin: the app gained a second, fully measured LIGHT theme (law §3 white foundation, §7 light tokens). **Superseded same day 2026-07-29:** it was built light-DEFAULT per the commission, then the owner saw the renders and reversed it ("Go back to the same colors") - **the HQ app opens DARK by default** (the pre-reskin tokens verbatim) and the light theme sits behind the manual day toggle. This stays a deliberate instrument-panel aesthetic scoped to the HQ app only. Segoe UI stays the default for every other web surface. Same color rules as above.

- The ALEX display lettering exists only inside the logo file. Never retype the wordmark.

**Recorded deviation D7 - the HQ "burn" numerals (2026-07-25, design-review round 2, the owner's go; RE-MEASURED for the light theme 2026-07-29, deviation now DARK-SCOPED).** The C8 rule "zeros whisper, actionable counts burn" renders an unactioned action-count (brief urgent, email act-now, n8n broken) as a big numeral in Rusty Spice `#bb3e03` on the alarm face. **On the DARK alarm face `#00232e` that pairing measures ~2.98:1** - a hairline fail of even the 3:1 large-text floor, so no size rescues it. It is KEPT deliberately on dark, and recorded here so it stops being re-litigated at every review: the state is carried **redundantly** by the dot shape, the ring and the kicker (grayscale-verified since wave 2), so the color is an ENHANCEMENT and never the sole carrier of meaning. Two consequences that are law on the dark theme: alarm tile faces must stay at `--elev` `#00232e` (the round-2 luminance lift deliberately excluded them, since Rusty drops to ~2.56:1 on the lifted face), and Rusty Spice is banned from SMALL text on dark anywhere - small error text takes Signal Coral (§4.4 D5), small warning text takes Vanilla Custard.
**The 2026-07-29 light-theme re-measure (light-default reskin):** on the light faces the same Rusty numerals measure **5.52:1 on white `#ffffff` and 5.10:1 on the light alarm face Warm Cream `#fff5e1`** (the §6 companion documented for "softening error surfaces", and the §7 light `--bg-elevated`) - passing even the 4.5:1 normal-text bar, so the burn is fully contrast-legal in light mode and D7's recorded fail applies to the dark theme only. Light-side small-text pairings, measured the same session: small error text takes Oxidized Iron `#ae2012` (6.97:1 on white / 6.43:1 on cream; Signal Coral stays a dark-only token), small warning text may take Rusty Spice itself (5.52:1 on white - above the 4.5:1 small-text bar, so the dark-side small-Rusty ban does NOT extend to light), the waiting-strip count burns Rusty on light (vs Custard on dark, whose 1.42:1 on white bans it from light text entirely, same as Pearl Aqua at 1.72:1). The light luminance ladder keeps the R2-4 direction - healthy faces white 255.0, alarm faces cream 245.7, gap 9.3 on the guard scale - so health still reads brighter than sickness in both themes.

## Logo
- **Primary: `brand/images/alex-logo-transparent.png`** - ALEX wordmark + circuit-trace mark on a transparent background (extracted from the JPG 2026-07-03, glow removed). Works on dark AND light surfaces; verified on #001219, white, and #005f73.
- **Full-bleed variant: `brand/images/alex-logo.jpg`** - the original on the dark teal gradient with soft glow. Use as a self-contained block (hero, cover, dark card). Never float the JPG on white.
- Placement: top-left or bottom-left.
- The mark's ring cores are opaque white by design (connection nodes); keep them.
- Nice-to-have someday: vector SVG from the original design file.

## Charts / Data Visualization
Follow `color-system.md` §4.5 (series order, reds for data alarms only, gridline opacities) and §4.6 (allowed gradients). No local copy here: the duplicate was deleted 2026-07-08 (D9); the law file is the only place these rules live.

## Presentations
- Build decks with **Claude Design (DesignSync)** on claude.ai/design, then export PDF (standing rule 2026-06-15). NOT .pptx / python-pptx.
- Brand the components from THIS file + color-system.md: `#001219` canvas, teal structure, one Golden Orange accent, Calibri, ALEX logo block on dark.
- A project that needs its own LOCKED visual system (a recurring series, a client's brand) documents it inside its own `work/NN-*` folder and names that file here. Everything else uses the ALEX brand above.
- No live templates: the old .pptx/.xlsx templates are archived. Rebuild in the ALEX brand on first real need.

## Excel Formatting
- Headers: `#005F73` background, white bold Calibri
- Titles / labels: `#005F73` bold; body text `#001219`
- Data rows: alternating `#FFFFFF` and `#FFF5E1` (warm cream tint)
- KPI highlight: `#EE9B00` (one per sheet); links/positive `#0A9396`; negative or alert values: `#AE2012`
- KPI tiles on dark teal fill: labels Pearl Aqua `#94D2BD`, values white
- Currency: SEK format with 2 decimals (kr) unless the doc is USD-specific
- ALWAYS real formulas (=SUM, =SUMIFS, =IF), never hardcoded values

## PDF / Report Formatting
**THE LOGO IS MANDATORY ON EVERY GENERATED PDF. NO EXCEPTIONS, NO JUDGEMENT CALL.**
Every PDF your Alex generates carries your logo in the header. Every one. That includes private
administrative files, transcriptions of letters other people sent you, and documents only you will
ever open. The rule is deliberately absolute, because the moment it becomes "logo when the document
is a real deliverable", something has to decide which documents are real, and that decision gets made
wrong. **This happened for real** in the system this Kit comes from: a set of PDFs shipped with no logo,
and the brand pre-flight line had printed `logo=none` along with a perfectly reasonable justification.
The gate ran. It was talked out of it. A printed choice proves a value was considered, never that it
was right. So there is no choice here any more.
- Header: dark bar (`#001219` or `#001219→#005f73` gradient) carrying your logo block
- Body font: 11pt Calibri, text `#001219`
- Section headings: Bold 14pt, `#005f73`
- Accent rule lines: `#0a9396`; at most one `#ee9b00` highlight per page
- Callout boxes: `#e9d8a6` soft tint on light pages

## Tone
- Match soul.md voice rules (Alex). Calm, technical, deep water. Orange is the single spark. Red means "pay attention now."
- **Running prose in research output has its own standard: `brand/config/writing-style.md`** (added 2026-08-06). This file covers how the brand LOOKS; that one covers how the analytical third person READS (banned constructions, sentence rhythm, claim sourcing, no em-dashes). soul.md still governs prose written in the owner's own voice. Where an external standard governs a document (APA7, MLA, a journal template), the standard wins over both and the conflict gets flagged: [[research/apa7-brand-conflicts]].
