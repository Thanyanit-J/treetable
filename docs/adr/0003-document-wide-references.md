---
status: accepted
---

# References span the whole Document

Formulas and Charts may reference any Topic in the Document by Reference Name (`SUM(Wealth.$Amount)`, `SUM(Wealth.Savings.$Amount)`), even though Topics look like isolated cards. The formula engine is therefore **document-scoped, not topic-scoped**: one dependency graph covers every Computed Column in every Topic, and cycle detection spans Topic boundaries.

Addressing uses user-editable **Reference Names** (distinct from Display Names): Topics unique per Document, Columns and Nodes unique per Topic. Within a Topic, short forms (`$Amount`, `Savings.$Amount`) resolve locally; cross-Topic references are Topic-prefixed.

## Considered options

- **Charts-only crossing (formulas topic-local)** — recommended for simplicity, rejected by product owner: computed cross-Topic values (e.g. a "Total" topic aggregating others) are wanted.
- **Nothing crosses** — rejected: defeats the purpose of Topic Reference Names.

## Consequences

- Editing a Reference Name rewrites referencing formulas across the entire Document.
- Deleting a referenced Topic/Column/Node must not block: dangling references degrade to visible cell errors (a la `#REF!`), and dependent charts show "source missing".
- Recalculation ordering, memoization, and cycle reporting must operate on the document-wide graph — Topic-local shortcuts in the engine are a bug, not an optimization.
