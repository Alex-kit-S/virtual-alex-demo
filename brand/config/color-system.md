# Brand File: Color System

**LAW: on conflict, this file wins.** (Hierarchy formalized 2026-07-08: this file is the single source of color law: palette, hexes, tokens, ratios, contrast pairings, usage rules. `brand-config.md` is application only.)

**Owner:** the owner of this install. It ships as the ALEX default palette; `/brand` is how an owner replaces it with their own.
**Version:** 1.0 (July 2026)
**Audience:** This document is written for Alex. It defines the official brand palette, what each color means, exactly where each color is allowed to be used, and where it is not. Follow it as a specification, not as inspiration.

---

## 1. Brand Personality

This palette communicates three things, in this order:

1. **Depth and trust.** The dark ink and teal family forms the foundation. It reads as calm, technical, and professional, like deep water or a night sky.
2. **Clarity and freshness.** The cyan and aqua tones bring a sense of growth, renewal, and modern tech.
3. **Energy and action.** The golden orange family is the spark. It exists only to draw the eye to the things that matter: calls to action, highlights, key numbers.

The red family (Rusty Spice, Oxidized Iron, Brown Red) carries urgency and intensity. It is a functional tool, not a decoration. It appears rarely, and only with purpose.

**One sentence summary:** a deep teal, tech-forward brand with a single warm accent, where red means "pay attention now."

---

## 2. The Palette

| # | Name | Hex | RGB | Role |
|---|------|-----|-----|------|
| 1 | Ink Black | `#001219` | 0, 18, 25 | Primary background (dark mode), primary text (light mode) |
| 2 | Dark Teal | `#005f73` | 0, 95, 115 | Primary brand color |
| 3 | Dark Cyan | `#0a9396` | 10, 147, 150 | Secondary brand color, links, active states |
| 4 | Pearl Aqua | `#94d2bd` | 148, 210, 189 | Highlights, secondary text on dark, soft surfaces |
| 5 | Vanilla Custard | `#e9d8a6` | 233, 216, 166 | Warm neutral, subtle backgrounds, dividers |
| 6 | Golden Orange | `#ee9b00` | 238, 155, 0 | Primary CTA, key highlights |
| 7 | Burnt Caramel | `#ca6702` | 202, 103, 2 | CTA hover / pressed state |
| 8 | Rusty Spice | `#bb3e03` | 187, 62, 3 | Strong emphasis, warnings |
| 9 | Oxidized Iron | `#ae2012` | 174, 32, 18 | Errors, urgency, critical alerts |
| 10 | Brown Red | `#9b2226` | 155, 34, 38 | Deep error surfaces, destructive-action hover |

---

## 3. Color Hierarchy and Ratios

Never use all ten colors at once. A screen or asset should feel like it uses 3 to 4 colors, not 10. Apply the 60-30-10 rule:

- **60% Foundation:** Ink Black `#001219` (dark mode) or white `#ffffff` (light mode).
- **30% Brand:** Dark Teal `#005f73` and Dark Cyan `#0a9396` for structure: headers, cards, nav, illustrations, section blocks. Pearl Aqua `#94d2bd` supports them for lighter touches.
- **10% Accent:** Golden Orange `#ee9b00` only. One clear accent per view. If everything is orange, nothing is.

The red family sits outside this ratio entirely. It is reserved for system states (errors, alerts, destructive actions) and should be absent from a healthy, neutral screen.

---

## 4. Exact Usage Rules

### 4.1 Backgrounds

- **Primary dark surface:** `#001219`. This is the default canvas for the brand in dark mode: website hero, slides, social posts.
- **Elevated dark surface (cards, panels):** `#005f73` at low opacity over `#001219`, or a solid step between them (e.g. `#00232e`).
- **Light surface:** `#ffffff` or an off-white. Use `#e9d8a6` only as a soft tint for callout boxes or section breaks, never as the main page background.
- **Never** use the red family or `#ee9b00` as a large background area.

### 4.2 Text

Accessibility is not optional. Use these pairings only:

**On dark backgrounds (`#001219`, `#005f73`):**
- Primary text: white `#ffffff`
- Secondary text: Pearl Aqua `#94d2bd`
- Tertiary / captions: Vanilla Custard `#e9d8a6`

**On light backgrounds (white, `#e9d8a6`):**
- Primary text: Ink Black `#001219`
- Secondary text / headings: Dark Teal `#005f73`
- Links and interactive text: Dark Cyan `#0a9396`

**Do not** set body text in Golden Orange, Burnt Caramel, or any red. These colors fail contrast at small sizes and read as alerts. They may appear in large display headlines or big stat numbers, but never in paragraphs.

### 4.3 Buttons and Calls to Action

- **Primary CTA:** background `#ee9b00`, text `#001219` (dark text on orange, never white).
- **Hover / pressed:** background shifts to `#ca6702`, text stays `#001219`.
- **Secondary button:** transparent or dark background, 1px border and text in `#0a9396`.
- **Destructive action:** background `#ae2012`, text `#ffffff`, hover `#9b2226`.
- One primary CTA per screen or asset. Everything else is secondary.

### 4.4 States and Feedback

- **Success / positive:** Dark Cyan `#0a9396` or Pearl Aqua `#94d2bd`.
- **Warning:** Rusty Spice `#bb3e03`.
- **Error / critical:** Oxidized Iron `#ae2012`, with `#9b2226` for pressed or deep variants.
- **Error / recording text on DARK surfaces (small text):** Signal Coral `#ff8a75` (semantic token `--error-text-dark`). Adopted 2026-07-12 (D5 of the upgrade): the palette red `#ae2012` reads muddy at small sizes on `#001219`/`#00232e` (~4:1), while Signal Coral clears it at ~8.4:1. Use ONLY for small error/recording state text on dark cards (e.g. the HQ "note not saved" line, the mic recording countdown), never as a fill, border, or on light surfaces.

### 4.5 Charts and Data Visualization

**Series colors are per-theme. The two orders below are NOT interchangeable.** This palette is dark-leaning, so its pale members die on white and its deep members die on Ink Black. One order cannot serve both canvases.

- **Light surfaces** (`#ffffff`, `#fff5e1`): `#0a9396`, `#ee9b00`, `#005f73`, `#94d2bd`, `#ca6702`.
- **Dark surfaces** (`#001219`, `#00232e`): `#0a9396`, `#ee9b00`, `#94d2bd`, `#e9d8a6`, `#ca6702`.

Series 1 and 2 stay Dark Cyan and Golden Orange in both themes on purpose, so the same chart reads as the same family whichever way it is rendered.

**Dark Teal `#005f73` is never a series color on dark.** It measures 2.62:1 on Ink Black and 2.25:1 on the elevated dark face, under the 3:1 floor, so a Dark Teal bar or line is close to invisible against the canvas. On dark it keeps its §4.1 role as a SURFACE color.

**The floor: every series color clears 3:1 against the canvas it sits on.** That is the WCAG non-text contrast bar for graphical objects, and bars, lines, dots and their legend swatches are graphical objects. Measure it, do not eyeball it. Measured values for the whole palette: §4.7.

**Redundancy carve-out.** A series may sit below 3:1 only when its identity is also carried by something other than color: a label on the series itself, a value label on the bar, a distinct dash pattern, or an unambiguous position. Color as an enhancement is fine. Color as the sole carrier of meaning, below 3:1, is a defect.

**Reserve the reds for negative values, thresholds, or alerts in the data itself.** The reds are theme-dependent too: Oxidized Iron `#ae2012` (2.74:1) and Brown Red `#9b2226` (2.41:1) both fail on Ink Black, and Rusty Spice `#bb3e03` passes on Ink Black at 3.46:1 but fails on the elevated dark face at 2.97:1. On dark, a data alarm takes Rusty Spice on the `#001219` canvas only.

Gridlines and axes: `#94d2bd` at 20 to 30% opacity on dark, `#001219` at 15% on light.

**Known limitation on the LIGHT order.** Golden Orange `#ee9b00` measures 2.25:1 on white and Pearl Aqua `#94d2bd` measures 1.72:1, both under the floor, so light charts pass only under the redundancy carve-out above. If you need a strictly conformant light chart, substitute Burnt Caramel `#ca6702` (3.85:1) for Golden Orange and Ink Black `#001219` (19.08:1) for Pearl Aqua.

**Approved data-viz exception (2026-07-12, D10):** a network/force graph's own self/"me" node may render pure white `#ffffff` for maximum contrast against the teal node field (the Alex HQ Brain graph does this). This is a single-node legibility choice, not a series color; it does not count against the one-accent rule.

### 4.6 Gradients

Allowed gradients, use sparingly (hero sections, social covers):

- `#001219` to `#005f73` (depth)
- `#005f73` to `#0a9396` (brand)
- `#ee9b00` to `#ca6702` (accent, small elements only)

Never blend the teal family directly into the red family in a single gradient.

### 4.7 Measured Contrast Reference

Computed WCAG contrast ratios. **3:1 is the floor for graphical objects** (chart series, icons, borders); **4.5:1** for normal text, **3:1** for large text. Regenerate if the palette changes.

| Colour | Ink Black `#001219` | elev dark `#00232e` | White `#ffffff` | Warm Cream `#fff5e1` |
|---|---|---|---|---|
| Ink Black `#001219` | 1.00 | 1.16 | 19.08 | 17.63 |
| Dark Teal `#005f73` | **2.62** | **2.25** | 7.28 | 6.73 |
| Dark Cyan `#0a9396` | 5.11 | 4.40 | 3.73 | 3.45 |
| Pearl Aqua `#94d2bd` | 11.10 | 9.54 | **1.72** | **1.59** |
| Vanilla Custard `#e9d8a6` | 13.48 | 11.59 | **1.42** | **1.31** |
| Golden Orange `#ee9b00` | 8.47 | 7.29 | **2.25** | **2.08** |
| Burnt Caramel `#ca6702` | 4.95 | 4.26 | 3.85 | 3.56 |
| Rusty Spice `#bb3e03` | 3.46 | **2.97** | 5.52 | 5.10 |
| Oxidized Iron `#ae2012` | **2.74** | **2.36** | 6.97 | 6.43 |
| Brown Red `#9b2226` | **2.41** | **2.07** | 7.92 | 7.32 |
| White `#ffffff` | 19.08 | 16.41 | 1.00 | 1.08 |

Bold = below the 3:1 graphical-object floor on that surface. Read this before choosing any color for a chart, an icon, or a border, and pick the column matching the canvas the thing actually sits on.

---

## 5. Do and Don't Summary

**Do**
- Keep large areas calm: Ink Black, white, and the teal family carry the brand.
- Use Golden Orange as the single point of energy per view.
- Keep the reds for warnings, errors, and genuinely urgent messages.
- Check contrast before shipping anything with text **or any chart series**, measured against the canvas it actually sits on (§4.7).

**Don't**
- Don't use more than one accent color in the same component.
- Don't put orange or red text on teal backgrounds.
- Don't use the red family decoratively (icons, borders, backgrounds "for variety").
- Don't introduce outside colors without checking Section 6 first.

---

## 6. Extended Palette (Optional, Use With Restraint)

These companions may be used when the core palette needs support, for example in illustrations, moodboards, or marketing one-offs. They are never primary brand colors.

| Companion | Hex | Pairs with | Purpose |
|-----------|-----|-----------|---------|
| Soft Coral | `#ff6f61` | `#005f73` | Lively contrast in illustration |
| Pastel Peach | `#ffccbc` | `#0a9396` | Warm soft fill |
| Muted Lavender | `#e3e4f8` | `#94d2bd` | Calm light surface |
| Pale Gray | `#e9e9e9` | `#e9d8a6` | Neutral light surface |
| Burnt Umber | `#7b3e3f` | `#ee9b00` | Depth and anchoring |
| Slate Blue | `#2b3a67` | `#ca6702` | Grounding contrast |
| Teal | `#008080` | `#bb3e03` | Cool balance |
| Warm Cream | `#fff5e1` | `#ae2012` | Softening error surfaces |

Rule of thumb: maximum one companion color per asset, and never in the core UI.

---

## 7. Design Tokens

### CSS Variables

```css
:root {
  /* Core */
  --color-ink-black: #001219;
  --color-dark-teal: #005f73;
  --color-dark-cyan: #0a9396;
  --color-pearl-aqua: #94d2bd;
  --color-vanilla-custard: #e9d8a6;
  --color-golden-orange: #ee9b00;
  --color-burnt-caramel: #ca6702;
  --color-rusty-spice: #bb3e03;
  --color-oxidized-iron: #ae2012;
  --color-brown-red: #9b2226;

  /* Semantic (dark mode default) */
  --bg-primary: var(--color-ink-black);
  --bg-elevated: #00232e;
  --text-primary: #ffffff;
  --text-secondary: var(--color-pearl-aqua);
  --text-tertiary: var(--color-vanilla-custard);
  --brand-primary: var(--color-dark-teal);
  --brand-secondary: var(--color-dark-cyan);
  --cta-bg: var(--color-golden-orange);
  --cta-bg-hover: var(--color-burnt-caramel);
  --cta-text: var(--color-ink-black);
  --link: var(--color-dark-cyan);
  --warning: var(--color-rusty-spice);
  --error: var(--color-oxidized-iron);
  --error-deep: var(--color-brown-red);
  --error-text-dark: #ff8a75; /* Signal Coral - small error/recording text on dark surfaces, contrast 8.4:1 on #001219 (D5, 2026-07-12) */
}

[data-theme="light"] {
  --bg-primary: #ffffff;
  --bg-elevated: #fff5e1;
  --text-primary: var(--color-ink-black);
  --text-secondary: var(--color-dark-teal);
  --text-tertiary: #4a5a5e;
  --link: var(--color-dark-cyan);
}
```

### JSON

```json
{
  "Ink Black": "#001219",
  "Dark Teal": "#005f73",
  "Dark Cyan": "#0a9396",
  "Pearl Aqua": "#94d2bd",
  "Vanilla Custard": "#e9d8a6",
  "Golden Orange": "#ee9b00",
  "Burnt Caramel": "#ca6702",
  "Rusty Spice": "#bb3e03",
  "Oxidized Iron": "#ae2012",
  "Brown Red": "#9b2226"
}
```

### Flat Lists

```
CSV:    001219,005f73,0a9396,94d2bd,e9d8a6,ee9b00,ca6702,bb3e03,ae2012,9b2226
Hex:    #001219, #005f73, #0a9396, #94d2bd, #e9d8a6, #ee9b00, #ca6702, #bb3e03, #ae2012, #9b2226
Array:  ["001219","005f73","0a9396","94d2bd","e9d8a6","ee9b00","ca6702","bb3e03","ae2012","9b2226"]
```

### Full Color Data (RGB, CMYK, HSL)

| Name | Hex | RGB | CMYK | HSL |
|------|-----|-----|------|-----|
| Ink Black | #001219 | 0, 18, 25 | 100, 28, 0, 90 | 197, 100%, 5% |
| Dark Teal | #005f73 | 0, 95, 115 | 100, 17, 0, 55 | 190, 100%, 23% |
| Dark Cyan | #0a9396 | 10, 147, 150 | 93, 2, 0, 41 | 181, 88%, 31% |
| Pearl Aqua | #94d2bd | 148, 210, 189 | 30, 0, 10, 18 | 160, 41%, 70% |
| Vanilla Custard | #e9d8a6 | 233, 216, 166 | 0, 7, 29, 9 | 45, 60%, 78% |
| Golden Orange | #ee9b00 | 238, 155, 0 | 0, 35, 100, 7 | 39, 100%, 47% |
| Burnt Caramel | #ca6702 | 202, 103, 2 | 0, 49, 99, 21 | 30, 98%, 40% |
| Rusty Spice | #bb3e03 | 187, 62, 3 | 0, 67, 98, 27 | 19, 97%, 37% |
| Oxidized Iron | #ae2012 | 174, 32, 18 | 0, 82, 90, 32 | 5, 81%, 38% |
| Brown Red | #9b2226 | 155, 34, 38 | 0, 78, 75, 39 | 358, 64%, 37% |

Use CMYK values for print, HSL for programmatic color manipulation, RGB and Hex for everything digital.

---

## 8. Quick Reference Card

If you remember nothing else, remember this:

- **Canvas:** Ink Black (dark) or white (light)
- **Brand:** Dark Teal + Dark Cyan
- **Soft touch:** Pearl Aqua, Vanilla Custard
- **Action:** Golden Orange (hover: Burnt Caramel), dark text on it
- **Alarm only:** the three reds
- **One accent per view. Contrast always checked.**
