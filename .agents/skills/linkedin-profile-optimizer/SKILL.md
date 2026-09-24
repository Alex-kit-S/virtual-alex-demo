---
name: linkedin-profile-optimizer
description: "Audit and rewrite a LinkedIn profile end to end: headline (220 chars), About (7-step, 265-char mobile hook), Featured, banner, photo, Experience metrics, Skills, custom URL, recommendations. Nine-section scorecard with concrete character budgets and pixel dimensions. Use for a profile audit or a single-section rewrite, especially recruiter-search visibility when job hunting. Triggers on \"review my profile\", \"rewrite my headline\", \"fix my About\", \"optimize banner\", \"profile audit\", \"LinkedIn bio\". Produces text you paste in yourself: it never reaches LinkedIn."
---

# LinkedIn Profile Optimizer

## SCOPE GUARD (read before using this file)

This skill was taken as DATA from `sergebulaev/linkedin-skills` (MIT, commit `e59dd61`), six markdown
files, nothing else. **The other 11 skills in that bundle are NOT installed and its Publora / Apify /
Pixfaro backends are NOT wired.** Nothing here posts, scrapes, schedules or reaches LinkedIn in any
way. It produces text you paste in yourself. There is no profile-write API on LinkedIn and this skill
has never had one. If you want the posting half, that is a deliberate decision to make on its own
terms: it means connecting a third-party service to the LinkedIn account you job-hunt on, and the
bundle's approval gate is prose rather than code by its own admission.

Four overrides, in force on every use:

1. **Your `soul.md` outranks this file on every voice conflict.** Profile copy is prose in your name,
   so read your voice rules BEFORE drafting a line. If you write English as a second language, your
   natural phrasing is the signal, not an error. Do not let this file "correct" you into polished
   corporate English, that is the fastest way to make your profile read as machine-written.
2. **Dashes.** Upstream's root `SKILL.md` permits roughly one em-dash per 100 words and its examples
   use them freely. That root file is deliberately NOT installed. All 59 em and en dashes in these six
   files were removed AT SOURCE, so whatever your own dash rule is, verbatim reuse cannot violate it.
3. **Every uplift number in these files is a vendor marketing claim, not research.** "3.9x more views",
   "71% more likely to land interviews", "14x more profile views", the Co.Actor 2026 figures: upstream
   cites no study for any of them. Use them to RANK which fix to do first. Never repeat one to someone
   else as a fact, and never put one in a deliverable.
4. **The worked examples are B2B-marketer shaped.** "Helping B2B SaaS founders book 40% more demos" is
   probably not your register. Keep the STRUCTURE (character budgets, keyword placement, the 7 steps)
   and rebuild the words from how you actually talk.

Upstream's own strength, kept deliberately: the nine-section scorecard, the character budgets, the
pixel dimensions and the anti-pattern lists are concrete and checkable, which is why this replaced the
previous generic version.

## When to use

- User pastes their LinkedIn profile URL and asks for an audit
- User wants to rewrite their headline, About section, or Featured section
- User is launching a content strategy and needs the profile to match
- Any of: "review my profile", "fix my headline", "optimize bio", "profile audit", "LinkedIn optimization"

## Input

- Profile URL (or screenshots of sections)
- Goal: **clients** / **job seeking** / **authority**, Featured and CTA vary by goal
- Optional: draft content to grade against the existing profile

## Output

A structured audit + rewrite in this shape:

1. **Scorecard** (9 sections, pass/fail/needs-work)
2. **Priority fixes** (ranked by impact)
3. **Before → After rewrites** for each failing section
4. **Expected uplift** (based on benchmark data)

## Steps

1. **Intake.** Collect profile state + goal. Flag missing sections.
2. **Score each of 9 sections** against the checklist (see references/).
3. **Rewrite headline** using `[What You Do] | [Who You Help] [Achieve What Result]`, fit all 220 chars.
4. **Rebuild About** with 7-step structure; verify first **265-275 chars** hook before "see more".
5. **Curate Featured** (3 strong items) matched to the goal:
   - **Clients:** lead magnet + case study with results + calendar link
   - **Job seeking:** portfolio + best work samples + top-performing post
   - **Authority:** best content + media/podcast features + newsletter signup
6. **Rewrite Experience bullets** as `action verb + specific metric`. Add 5+ skills per role. Pin top 3 skills.
7. **Claim custom URL** (linkedin.com/in/firstnamelastname, not the `-123abc456` default).
8. **Draft recommendation requests** with specifics ("about [project/skill]"), don't send LinkedIn's generic template.
9. **Deliver before/after diff** + expected uplift (3.9x views, 3-5x conversion, 71% more likely to land interviews).

## Nine-component scorecard

| # | Section | Pass criteria (2026) |
|---|---------|----------------------|
| 1 | **Photo** | ≥400x400, face fills 60% of frame, <3 years old, natural light, slight smile |
| 2 | **Banner** | 1584x396, text in right 2/3, high contrast, includes value prop + CTA, tests well on mobile |
| 3 | **Headline** | Uses all 220 chars; format `[What You Do] | [Who You Help] [Result]` |
| 4 | **About** | 200-300 words, first-person, 7-step structure, hook in first 265-275 chars |
| 5 | **Featured** | 3 items, matched to goal, custom 1200x627 thumbnails |
| 6 | **Experience** | Every bullet = `action verb + metric`, 5+ skills per role, media attached |
| 7 | **Skills** | 50 listed, top 3 pinned, mirrors target job descriptions, ≥1 endorsement each |
| 8 | **Custom URL** | `linkedin.com/in/firstnamelastname` (not the default hash) |
| 9 | **Recommendations** | At least 3 recent, specific (not generic), from diverse contexts |

## Key benchmarks (from co.actor research)

- Optimized About sections: **3.9x more views**
- 5+ listed skills: **3x more connection requests**
- Comprehensive profile: **71% more likely to land interviews**
- Featured section content: **30% longer viewing time**
- Personal founder profile vs company page: **315% more engagement, 270% more conversions**

## Hard rules

Global voice rules: **your `soul.md` voice rules** (see the SCOPE GUARD above). Upstream's root `SKILL.md` is NOT installed and its dash allowance does not apply here. Additional skill-specific rules:

- First person ("I help...") never third person ("Jane is a passionate...")
- Never "passionate thought leader" / "driven professional" / "results-oriented" (profile-specific AI vocab)
- Avoid wall-of-text. Use line breaks in About section
- 80% of users leave Featured empty. Filling it is a free edge

## Reference files

- `references/profile-headline-formulas.md`, 220-char formula + before/after examples
- `references/about-section-templates.md`, 7-step structure with character budgets
- `references/featured-section-playbook.md`, goal-matched content types
- `references/banner-photo-specs.md`, dimensions, composition, mobile test
- `references/experience-skills-rules.md`, bullet rewriting + skills strategy + custom URL + recommendations

## Related skills

- `linkedin-content-planner`, post pillars should echo the profile's headline/About thesis
- `linkedin-post-writer`, Featured section rotates quarterly; pin your flagship post
- `linkedin-humanizer`, scrub profile copy for the same AI tells we scrub from posts
