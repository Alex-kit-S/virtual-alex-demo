---
name: try-workbook
description: "Build the owner's TRY (Turkish lira) money workbooks with real formulas: quote sheets (teklif), 12-month cashflow, break-even across business shapes, and a simple ledger. Use for quotes, pricing a gold item, cashflow, break-even, or bookkeeping questions in a Turkish business context. REFUSES to produce anything labelled fatura/invoice - see the legal rule inside. House-built 2026-08-31."
---

# TRY Workbook

Money artifacts for a Turkish small business, built on the house openpyxl pattern: **every total
is a real formula (=SUM, =SUMIFS, =IF), never a hardcoded value**, so the owner changes an input
cell and watches everything move. Currency formatted as TRY; Turkish labels first, with the
owner's locale file (`vault/business/locale-*.md`) supplying vocabulary.

## THE LEGAL RULE - read before any sheet is built, refuse without exception

**Never produce a document labelled "fatura" (invoice), "e-Fatura", "e-Arşiv fatura", or
anything a recipient could take for one.** Turkey's e-invoicing regime runs through GİB (the
revenue administration) and licensed integrators, produces QR-coded UBL-TR documents, and its
thresholds have been tightening year over year - published English-language sources CONFLICT on
the current figures, which is itself the reason to refuse: a wrong invoice is a tax problem the
owner cannot see coming.

- Allowed, always: **teklif** (quote), **proforma** clearly marked "teklif niteliğindedir,
  fatura değildir", cashflow, break-even, ledgers, internal reports.
- If the owner asks for a fatura: refuse in one sentence, explain in one more, and point them
  at their **SMMM (mali müşavir)** - a real accountant is the answer, and picking one is on the
  install-day handoff list. Do not summarize threshold numbers from memory; they conflict.

## Sheet 1 - Teklif (quote)

Inputs (each its own cell, labelled): gram weight · **gram gold price in TRY, entered by hand
with its date** · milyem/fineness · işçilik (labour) · margin % · KDV %.

- The gold price is a **dated manual input, never a live feed**. A stale feed is invisible; a
  dated cell ("22.05.2026 itibarıyla") is honest by construction. If the date cell is older
  than today, the sheet's own conditional formatting flags it.
- Output: line total as formulas off the inputs, KDV line, grand total, and a validity line -
  **every teklif expires** ("Bu teklif ... tarihine kadar geçerlidir"), because gold moves all
  day and an open-ended quote loses money on every hour the price rises.
- Watermark text on the sheet: "TEKLİF - fatura değildir".

## Sheet 2 - Nakit akışı (12-month cashflow)

Startup costs, monthly fixed costs, up to three revenue scenarios (kötü/orta/iyi), running
balance per scenario, and the month the balance crosses zero highlighted. Methodology follows
the `cash-flow-forecast` skill; outputs in Turkish.

## Sheet 3 - Başabaş (break-even), across business shapes

One column per candidate shape of the business (for a gold venture: content/audience-first,
catalogue + offline settlement, licensed-partner split) with each shape's own cost structure and
margin per sale. The answer the owner actually needs is WHICH SHAPE breaks even soonest on
realistic volume - the sheet makes the shapes comparable instead of arguing about them.
Methodology follows the `break-even-calc` skill.

## Sheet 4 - Basit defter (simple ledger)

Dated in/out rows with categories, a monthly summary of formulas over them. Enough to hand a
real accountant clean records; NOT pretending to be accounting. Aging of unpaid quotes follows
the `invoice-aging` methodology but is labelled "bekleyen teklifler", never invoices.

## Build rules

- One workbook per purpose, into `outputs/` under the owner's project, filename in Turkish.
- Numbers the owner gave are inputs; everything derived is a formula. If a needed input is
  unknown, the cell says `[DOLDURUN]` and the summary names it - never a guessed number.
- Cross-check any pricing logic against the `pricing-optimizer` methodology skill before
  presenting margins as recommendations.
