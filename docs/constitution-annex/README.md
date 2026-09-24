# The constitution annex

Every standing order keeps its OPERATIVE sentence in `CLAUDE.md`. The reasoning behind it, the
incident that produced it, and anything a future reader would need in order to change it safely
lives here, one page per family. The split exists because a rulebook that carries all of its own
history stops being read, and a rule nobody reads is a rule that is not enforced.

Rules for this folder:

- On any conflict, `CLAUDE.md` and the machine-checked sources (the manifest, the validators, the
  checkers) win. These pages explain; they do not decide.
- When an order's operative sentence changes in `CLAUDE.md`, the page behind it moves in the SAME
  session. A pointer that stays valid while the thing behind it rots is quiet misdirection, and it
  produces no error anywhere.
- Pages carrying machine-testable claims get a row in `scripts/facts-check.js` (check C21), which is
  the guard against exactly that.

Pages:
- **system-organs.md** - how the self-correction loop, the memory layer, the compiled soul card and
  the session root actually work.
- **model-routing.md** - which model each scheduled job runs, and why the contract lives in the
  manifest instead of in prose.
- **skills-provenance.md** - where the skills came from, what was audited, and what was deliberately
  left out.
