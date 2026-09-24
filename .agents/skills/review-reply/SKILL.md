---
name: review-reply
description: "Draft replies to customer reviews (Google Business Profile, marketplaces) in the owner's voice and language - Turkish and Arabic first-class. Use when the user pastes a review, asks to answer reviews, or mentions yorum, degerlendirme, or review replies. Drafts only; the owner posts. House-built 2026-08-31."
---

# Review Reply

Reviews are the trust currency of a local business - for a jeweller they are close to the whole
storefront. This skill turns a pasted review (or a batch) into a reply the owner can post as
their own, in the language the review was written in.

## The rules that outrank everything

1. **Draft, never post.** The output is text the owner copies. This skill has no business
   touching a live review platform, and it says so if asked to.
2. **Reply in the review's language.** A Turkish review gets a Turkish reply, an Arabic review
   an Arabic reply (right-to-left, proper punctuation), an English review an English reply. The
   owner's own register comes from `soul.md` and the locale file (`vault/business/locale-*.md`
   when present) - never generic corporate politeness in any language.
3. **Never invent facts.** No claimed compensation, discount, restock date or policy that the
   owner did not state. Where a concrete answer is needed ("when will you have 22-ayar back?"),
   the draft carries a clearly marked gap: `[SAHIBI DOLDURSUN: ...]` / `[OWNER FILLS: ...]`.
4. **Legal caution on gold.** Replies never state purity, weight or price claims about a past
   sale - that is documentation the owner controls, not something to reconstruct in a comment.

## Reply shapes, by review type

- **5 stars:** thank by name if the reviewer used one, mention ONE specific detail from their
  review (proves a human read it), invite them back. Two or three sentences. No emoji unless
  the owner's own voice uses them.
- **3-4 stars:** thank, acknowledge the specific shortfall without excuses, say the one thing
  that changes (only if the owner confirmed it), invite direct contact.
- **1-2 stars:** the reply everyone else reads. Calm, factual, no defensiveness, no arguing the
  reviewer's account. Acknowledge, offer the direct channel (phone/WhatsApp line from the
  business-context file), keep it short. If the review makes a factual claim the owner disputes,
  the draft notes it for the owner privately but the public reply never litigates.
- **Suspicious/fake:** do not draft an angry reply. Note the platform's report mechanism and
  draft the minimal neutral response.

## Batch mode

Given several reviews, produce a table: reviewer, stars, language, the draft, and any
`[OWNER FILLS]` gaps - newest first, so the owner works top-down.
