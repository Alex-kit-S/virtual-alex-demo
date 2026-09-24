# The locale layer - how one Kit speaks its owner's language

Added 2026-08-31 with the third install (the first non-English owner). The convention, stated
once so every skill and command implements it the same way:

## The contract

1. **`system/install-profile.json` carries `locale`** (e.g. `"tr"`, `"ar"`, `"en"`). It is the
   language of every human-facing deliverable: reports, workbooks, review replies, the
   validate-business brief, the publish confirmation. Default `en`.
2. **Commands and skills stay English.** They are instructions TO Claude, the machine layer,
   and Claude reads them best that way. Only OUTPUT localizes. (This split is the whole reason
   a "Turkish install" costs a week and not a month.)
3. **A vault locale file carries the domain vocabulary**: `vault/business/locale-<code>-<domain>.md`
   (e.g. `locale-tr-gold.md`). Skills that produce owner-facing text read it when present. It
   holds: currency and number formatting, script direction notes (Arabic is RTL), orthography
   traps (Turkish dotted/dotless i - `I` lowercases to `ı`, `İ` to `i`, and a wrong one reads
   as illiterate to a native reader), and the trade vocabulary of the owner's business.
4. **The owner's VOICE is a separate thing from the locale.** Voice lives in `soul.md` (mined
   from their real writing); locale is formatting and vocabulary. A Turkish reply in a generic
   voice fails the same way an English one does.
5. **Deterministic guards must be locale-aware before they run on non-English text.** The
   English pronoun scan pattern (`\b(he|him|his|she|her)\b`) fires on ordinary Turkish - `her`
   means "every" - so a guard that scans generated text must either scope itself to English
   output or carry a per-locale pattern set. A guard that cries wolf in the owner's language
   teaches the owner to ignore guards. (Found live writing the first Turkish deliverables,
   2026-08-31.)

## What a per-install payload adds (not part of the template)

The template ships the CONVENTION; a person's own repo ships their instance: their
`locale-<code>-<domain>.md` with real trade vocabulary, seeded at install time and grown by
`/teach-alex` corrections like everything else the owner teaches.

**On Virtual Alex (2026-09-24).** A person's seed carries the file under the same name in
`starter/` (`starter/locale-tr-gold.md`), and the online `/setup` step 1 copies it as it is into
`vault/business/`, which is where item 3 says the skills read it. One file, one name, one reader.
The seed contract (`docs/SEED-CONTRACT.md`, rule 4) checks that its `<code>` is the profile's
`locale`.
