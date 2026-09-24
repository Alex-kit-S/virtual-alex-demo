/*
 * 001-structural-voice-tells.js
 *
 * Adds detection-proofing rule 6, the STRUCTURAL AI tells, to soul.md.
 *
 * WHY A MIGRATION AND NOT AN ORDINARY UPDATE. soul.md is gitignored on purpose: it is the
 * owner's identity file and it is deliberately outside the repo so that whoever hosts the
 * repo never sees their content. That privacy has a cost, and this is it. A git update can
 * ship a skill, a house-style rule, a constitution line, but it can never reach soul.md. So
 * a voice rule needs a migration that runs locally, on their machine, against a file only
 * they have.
 *
 * WHAT THIS RULE IS. Voice rule 3 bans WORDS (delve, leverage, in conclusion). Rule 6 bans
 * SHAPES, which a word filter cannot see: a colon followed by a dramatic reveal, a line that
 * promises what nobody tells you, a closing sentence reaching for a metaphor. The eleven are
 * defined with examples in brand/config/writing-style.md sections 1.9 to 1.17, which ships
 * through git normally, so soul.md carries the short version and points there.
 *
 * RUNNING IT TWICE, OR AFTER /setup. The rule reaches soul.md by two roads: /setup writes a short
 * version at install time, this migration writes a long one for installs that predate that. So
 * "is it already there" cannot be answered by looking for this file's own sentences, and the
 * answer is built from the eleven names instead. See alreadyPresent() below.
 *
 * THE SAFETY RULE, AND IT IS THE POINT OF THE FILE. soul.md was written by /setup from the
 * owner's own interview, so its structure is PROBABLE, not guaranteed. If the anchor is not
 * found, this does nothing at all and says so. It never guesses at a position, never appends
 * to the end hoping for the best, and never leaves a half-written file. soul.md is the one
 * irreplaceable thing they own: everything else in the folder can be re-cloned, and it cannot.
 * Corrupting it to save a round trip is never the right trade.
 */
'use strict';
const fs = require('fs');
const path = require('path');

const ID = '001-structural-voice-tells';
const MARKER = 'Kill the structural AI tells';

/*
 * IS THE RULE ALREADY THERE. This is the question that got answered wrongly once, so it is worth
 * stating why it is answered this way.
 *
 * Two different writers put this rule into soul.md. /setup writes a SHORT version at install time,
 * in prose the model adapts to how the owner actually writes, and this migration writes a LONG one
 * for installs that predate that. Neither wording is fixed, and the heading number depends entirely
 * on how many rules the owner's own Detection-proofing list already had.
 *
 * So the first version of this check looked for one sentence of its own prose, and on any install
 * built by /setup that sentence is absent while the rule is fully present. The migration read a
 * complete rule as a missing one and wrote the whole thing again, numbered "6." and citing "Rule 3"
 * into a list that had neither. Two statements of the same eleven tells in the one file that
 * defines the owner's voice, and the second one pointing at numbers that are not there.
 *
 * What every version DOES carry is the taxonomy. The eleven names are the rule: paraphrase the
 * surrounding sentences all you like, drop the number, turn the list into bullets, and a colon
 * reveal is still called a colon reveal. So detection counts NAMES and reads no number at all.
 * A threshold rather than all eleven, because a short version may legitimately fold two together;
 * a threshold above one, because a soul.md is allowed to mention a colon reveal in passing without
 * that being the rule.
 */
// ELEVEN, matching the rule. Until 2026-09-24 this held ten while every comment said eleven:
// "superficial analysis" was missing, so a short variant naming three tells, that one among them,
// counted two and got the long block written on top of it (fleet review F20, test M1b). /setup
// writes it as "superficial `-ing` analysis" and a wizard may wrap it across a line, hence the
// tolerant separators.
const TELL_NAMES = [
  /colon reveal/i,
  /faux[-\s]?insight/i,
  /superficial[\s`*_-]+(?:-?ing[\s`*_-]+)?analysis/i,
  /importance puffery/i,
  /weasel attribution/i,
  /synonym cycling/i,
  /interpretive metadiscourse/i,
  /fake[-\s]?strong verb/i,
  /summary[-\s]?recap/i,
  /fake[-\s]?profound/i,
  /formatting slop/i,
];
const NAMES_MEAN_PRESENT = 3;

function alreadyPresent(text) {
  if (text.includes(MARKER)) return true;
  return TELL_NAMES.filter((re) => re.test(text)).length >= NAMES_MEAN_PRESENT;
}

const RULE = [
  '6. **Kill the structural AI tells, not just the banned words** (added 2026-08-21). Rule 3 catches',
  '   vocabulary. These are SHAPES, and they slip straight past a word filter. Each one is defined with',
  '   an example in `brand/config/writing-style.md` sections 1.9 to 1.17; read that file when one needs',
  '   judging, and use the `no-ai-slop` skill in DETECT mode to scan a draft on demand.',
  '   - **Colon reveals:** a noun phrase, a colon, then a dramatic lowercase reveal ("The best part: it',
  '     learns"). Write the plain sentence. Colons are for lists, labels and quotes.',
  '   - **Faux-insight setups:** "what nobody tells you", "the part everyone misses". Cut the setup, let',
  '     the claim stand alone.',
  '   - **Superficial analysis:** trailing -ing clauses that pretend to explain ("highlighting their',
  '     commitment", "underscoring the shift"). Replace with the actual consequence.',
  '   - **Importance puffery:** "marks a pivotal moment", "stands as a testament". State the fact.',
  '   - **Weasel attribution:** "experts agree", "studies show". Name the source or cut the claim.',
  '   - **Synonym cycling:** rotating agent, assistant, tool for one thing. Repeat the clear word.',
  '   - **Interpretive metadiscourse:** "the key point is", "as you can see", a redundant "in other',
  '     words". If the point is clear, delete the aside.',
  '   - **Fake-strong verbs:** "serves as a centralized hub for". Prefer is and has when clearer.',
  '   - **Summary-recap endings:** "in conclusion", "overall", a last paragraph restating the piece.',
  '   - **Fake-profound kickers:** the closing cute metaphor. Delete it, do not rewrite it better.',
  '   - **Formatting slop:** emoji headings, mid-sentence bold, bullets where prose reads better.',
  '   **Carve-out:** if you have locked a recurring format that deliberately uses one of these (a post',
  '   template, a client letter shape), that format wins inside that format and this rule is ignored',
  '   there. Everywhere else the list applies.',
  '',
  '',
].join('\n');

function run({ root, log }) {
  const soulPath = path.join(root, 'soul.md');

  if (!fs.existsSync(soulPath)) {
    return { status: 'declined', message: 'no soul.md yet, so there is nothing to add to. Run /setup first, which writes this rule in from the start.' };
  }

  let soul = fs.readFileSync(soulPath, 'utf8');

  if (alreadyPresent(soul)) {
    return { status: 'skipped', message: 'the writing rules are already there.' };
  }

  // Find where the rule belongs. Preference order, most specific first. We insert BEFORE the
  // heading or block that follows the numbered detection-proofing list, never at a guessed offset.
  const dp = soul.indexOf('### Detection-proofing');
  let insertAt = -1;

  if (dp !== -1) {
    // End of the Detection-proofing numbered list = the next bolded block or the next heading.
    const rest = soul.slice(dp);
    const m = rest.slice(1).search(/\n(\*\*[A-Z]|#{2,3} )/);
    insertAt = m === -1 ? -1 : dp + 1 + m + 1;
  }

  if (insertAt === -1) {
    // Fallback: end of the Voice Rules section.
    const vr = soul.search(/^## Voice Rules/m);
    if (vr !== -1) {
      const rest = soul.slice(vr);
      const m = rest.slice(1).search(/\n## /);
      insertAt = m === -1 ? -1 : vr + 1 + m + 1;
    }
  }

  if (insertAt === -1) {
    return {
      status: 'declined',
      message: 'could not find the voice rules section in soul.md, so nothing was changed. The file is exactly as it was.',
    };
  }

  // Only now, immediately before writing, take the backup.
  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const backup = path.join(root, `soul.md.bak-${stamp}`);
  fs.writeFileSync(backup, soul);
  log(`backup written: ${path.basename(backup)}`);

  const updated = soul.slice(0, insertAt) + RULE + soul.slice(insertAt);
  fs.writeFileSync(soulPath, updated);

  // Read-back verification. Never trust the write.
  const after = fs.readFileSync(soulPath, 'utf8');
  const hits = after.split(MARKER).length - 1;
  const grew = after.length > soul.length;
  if (hits !== 1 || !grew) {
    fs.writeFileSync(soulPath, soul);
    return {
      status: 'declined',
      message: `the change did not verify (marker x${hits}), so soul.md was put back exactly as it was.`,
    };
  }

  // Refresh the compiled soul card so the new rule reaches the next session. Best effort:
  // if this fails the card is merely stale, and the session hook falls back to the full file.
  try {
    require(path.join(root, 'scripts', 'lib', 'build-soul-core.js')).build({ log: () => {} });
    log('soul card rebuilt');
  } catch (e) {
    log(`soul card not rebuilt (${e.message}); it refreshes on the next generator run`);
  }

  return { status: 'applied', message: 'Alex learned eleven new writing rules.' };
}

module.exports = { id: ID, run, TELL_NAMES };
