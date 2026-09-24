# Brand Assets

The ALEX brand lives here (since 2026-07-03; the old brand identity is retired and archived in `archive/retired-brand/`). Every automation that generates styled output reads from this folder, always through the Brand + Soul Pre-Flight Gate in `CLAUDE.md`: read the actual files, print the pre-flight line, then build. Files, not memory.

## config/ - two files, strict pecking order (formalized 2026-07-08)
- **color-system.md - the LAW.** The palette, the exact hexes, the 60-30-10 ratio, contrast pairings, chart rules, every do and don't. On any conflict, this file wins. It is the ONLY place a brand hex is defined; everything else refers to it.
- **brand-config.md - the APPLICATION.** How to apply the brand in Excel, decks, PDFs and web: fonts, logo rules, per-format mappings. It restates no law; rules stated in both files were deleted from it. When in doubt, go up one level.

## images/
- **alex-logo-transparent.png** - the ALEX wordmark + circuit-trace mark, transparent background. The default logo asset: works on dark and light surfaces.
- **alex-logo.jpg** - the original on the dark teal gradient with soft glow. Full-bleed block variant (hero, cover, dark card); never floated on white.
- Never retype the ALEX wordmark as text; the lettering exists only inside the logo files.

## templates/
Empty since the 2026-07-03 rebrand (the old .pptx/.xlsx templates archived). Excel/PDF styling comes straight from `config/brand-config.md`; decks are built with Claude Design. New templates get rebuilt in the ALEX brand on first real need.

## archive/retired-brand/
The retired pre-2026-07-03 brand. Kept for history (local-only, gitignored), never used for new output.

## How to change the brand
1. Palette or color rule: edit `config/color-system.md` (the law), nothing else.
2. How a format applies it: edit `config/brand-config.md`.
3. Then run `node scripts/generate-alex.js` so every generated doc stays consistent.
