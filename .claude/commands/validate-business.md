# /validate-business - stress-test a business idea BEFORE anything gets built

The owner has an idea. Your job is to find out whether it survives contact with law, payments
and arithmetic - BEFORE a website exists, before money is spent, before anyone is embarrassed.
This command exists because the alternative was watched happening: a beautiful shop gets built
first, and then it turns out the owner cannot legally operate it or take payment through it.

Ships to EVERY install; the `business-validation` lane flag in `system/install-profile.json`
only controls whether `/setup` and the status command advertise it. On-demand, never scheduled.

**The deliverable is a plain-language brief in the owner's language** (profile `locale`) to
`outputs/validate-business/YYYY-MM-DD/`, plus the verdict spoken in one paragraph. Write for the
owner's reading level: short sentences, no jargon, sources linked.

## The gates, in order. Each one closes before the next opens.

### Gate 1 - Say it in one line
What is sold, to whom, where (country matters enormously), at roughly what price. If the owner
cannot fill all four, the session is about filling them, and no other gate runs.

### Gate 2 - Legality. THE GATE THAT NEVER GUESSES.
What licence, registration, certificate or permit does selling THIS thing in THIS country
require? Who issues it, what does it need, can this owner plausibly qualify? And what
obligations ATTACH AUTOMATICALLY alongside the licence - anti-money-laundering registration,
e-commerce/platform registration, consumer and distance-selling duties, product tracking
regimes? (These bind from the first sale and never announce themselves.)
- Research with primary sources: the regulator's own pages, the official gazette, the licence
  register. Secondary sources only corroborate. **Research in the jurisdiction's official
  language regardless of the deliverable's locale** - the sources that matter usually exist
  only there; an English-only search returns blogs.
- **If the CORE legal answer cannot be established from primary sources, the gate result is
  UNKNOWN and the process STOPS HERE** - with the exact question written down for a professional
  (lawyer, accountant, chamber of commerce) and, when identifiable, WHO to ask. An invented
  legal answer is worse than no answer. Never fill this gate from memory alone.
- **A PARTIAL unknown does not stop the process, it travels:** when the core answer is
  established but a material sub-question is not (e.g. does an online-only operation qualify),
  proceed, carry the sub-question forward in every later gate that depends on it, and put it -
  verbatim, with the addressee - in the brief's assumptions section.
- **An unreachable source is not a silent source.** "The primary source says nothing" and "I
  could not open the primary source" are different facts; when a substitute (state news agency,
  consolidated-law service) stands in for an unreachable primary, say so next to the claim.
- Distinguish the SHAPES: manufacturing vs wholesale vs retail vs brokering often carry
  different rules. Name which shape each rule applies to.

### Gate 3 - Money in. Can this business actually get paid?
Start from **how real businesses in this category, in this country, actually take money** -
then work outward: local bank and card-scheme rules (instalment caps, category exclusions,
settlement holds), cash-payment limits, and only then the global processor restricted-business
lists (Stripe/Adyen) - those lists are US/EU-shaped and are often the LEAST informative source
in other markets. **Pass test:** the gate passes when at least one payment rail exists that is
(a) legal for this category, (b) actually accepted by the target customers, and (c) priced
survivably for Gate 4. It fails when no such rail exists; it passes NARROWLY when the viable
rail is not the one the owner imagined - say which.

### Gate 4 - Unit economics. One sale, all-in.
Cost of the thing, cost to deliver it (for a physical good: insured carriage, loss-in-transit,
proof of delivery - these are real lines, not logistics trivia), payment fees, TAX treatment
(it can decide which product shape is even sellable), the licence and every RECURRING fee
amortized (an annual charge is a floor on viable volume - compute that floor), the price - and
what must be true (volume, margin, repeat rate) for the arithmetic to work.
**If the price of what is sold MOVES during the sale, name the exposure window and how it is
closed - quote expiry, hedge, or pre-purchased inventory.** A settlement delay on a thin-margin
volatile good is an unhedged position, not a sale; this line has killed real businesses that
passed every other check.
Use the `break-even-calc` and `pricing-optimizer` methodology skills, in a `try-workbook`-style
sheet when the owner's context is Turkish; **when a named skill is not loaded, say so and build
the arithmetic by hand** - the method matters, the tooling is replaceable. Unknown inputs are
named as unknowns, never guessed.

### Gate 5 - Who already does this?
Find 3-5 real competitors in the owner's market. For each: what shape they operate (which
ILLUSTRATES Gate 2 - **a competitor's existence is not a legal opinion**, and never un-fails a
gate), how they take money (which illustrates Gate 3), and what they charge (Gate 4). Real
competitors are the cheapest commercial research there is - and pay attention to what they all
AVOID doing: a position no operator occupies is usually empty for a reason worth naming.

### Gate 6 - Verdict.
- **GO** - all gates pass as stated.
- **GO-WITH-CHANGES** - the idea works in a DIFFERENT shape than stated; name the shape and
  exactly what changes (this is the most common honest outcome).
- **NO-GO-AS-STATED** - a gate fails with no shape that clears it; say which and why.
- **UNKNOWN-STOPPED** - Gate 2's core answer could not be established; the brief carries the
  professional's question, and nothing downstream was pretended.
**The verdict line always names the gate(s) that drove it** - a label like GO-WITH-CHANGES
(Gates 2, 4) tells the owner where the work is; a bare label does not, and two unrelated
failures collapsed into one word is information destroyed.

The brief always ends with: the three riskiest assumptions still standing, and the single
cheapest next step that tests one of them.

## Hard rules
- Never let enthusiasm reorder the gates. A gorgeous Gate-5 competitor analysis does not
  un-fail Gate 2.
- Every legal and processor claim carries its source. A claim with no source does not go in
  the brief.
- The owner decides. This command informs the decision; it never makes it, and it never
  moralizes about the idea.
