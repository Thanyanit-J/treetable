---
status: accepted
---

# Formulas belong to Columns, not cells

Although TreeTable looks spreadsheet-like, a formula is a property of a Column: a Column is either an **Input Column** (cells hold typed values) or a **Computed Column** (one expression such as `=$Amount*$Rate`, defined once on the column, evaluated per Row; its cells are read-only). A cell can never hold its own formula, and a column can never mix typed values with computed ones.

This formalizes v1's observed behavior (typing a formula into any cell silently applied it to the whole column, with the expression copied redundantly into every cell) instead of abandoning it. Expressions may reference same-row Input Columns (`$Rate`) and whole-column aggregates (`SUM($Amount)`); cycle detection operates at column granularity.

## Considered options

- **Per-cell formulas (Excel semantics)** — rejected: needs a per-cell dependency graph, reintroduces "fill the column" as manual UX, and contradicts how the product was actually used.
- **Column formula with per-cell override** — rejected for now: adds override-management UX (marking, clearing, column-edit conflicts) without a demonstrated need. Revisit only with concrete demand.

## Consequences

- The engine evaluates one expression per Computed Column per Row — no per-cell parse/store, simpler recalculation and cheaper documents.
- Editing UX must expose the expression at the column level (header affordance), not through individual cells.
- Rollups aggregate the *computed values* of a Computed Column; they never re-evaluate the expression over aggregated inputs.
