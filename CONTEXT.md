# TreeTable

A visual workspace that blends a hierarchy diagram with a spreadsheet: one row-aligned structure, presented two ways — the hierarchy as a tree, the leaves' data as a table.

## Language

**Document**:
A saved workspace: a title plus an ordered list of Topics; the unit of persistence, import, and export.
_Avoid_: tree (ambiguous), workspace, file

**Topic**:
A Tree-Table shown as a card; it owns its column schema, and its Root Node carries the Topic's label. Formulas and Charts elsewhere in the Document may reference it by its Reference Name.
_Avoid_: main topic, card (the card is how a Topic is displayed, not what it is)

**Tree-Table**:
The unified diagram: one row lattice presented two ways — root→leaf hierarchy as a tree (left), leaf Rows under a Header as a table (right).
_Avoid_: chart, graph view (there is no second data structure — it's one structure, two presentations)

**Node**:
An item of the hierarchy, visualized as a pill; behaves like a vertically merged cell spanning the rows of its visible Leaves. May carry a per-node color accent from a curated palette.
_Avoid_: subtopic (legacy code name)

**Root**:
The topmost Node of a Tree-Table.

**Branch**:
A Node with children; owns no Row of its own while expanded.

**Leaf**:
A Node with no children; contributes exactly one Row.

**Row**:
The data cells a Leaf extends into on the table side; stacking all visible Rows forms the table.
_Avoid_: extension (explanatory phrasing), record

**Header**:
The column-title band of the table presentation.

**Input Column**:
A Column whose cells hold values typed by the user.

**Computed Column**:
A Column defined by one expression (e.g. `=$Amount*$Rate`) evaluated per Row; its cells are read-only.
_Avoid_: formula cell (formulas never belong to a single cell — see ADR-0002)

**Collapse**:
Hiding a Branch's descendant Nodes — and therefore their Rows — in both presentations at once; pure view state that never changes computed values.

**Rollup**:
A per-column Summary function (Sum, Average, Min, Max, or Count) applied wherever many Rows compress into one: the summary footer, and the Row a collapsed Branch shows for its hidden Leaves. Blank cells don't participate — except in Count, which counts the non-blank ones.
_Avoid_: summary mode (legacy code name), subtotal

**Rollup Row**:
The read-only Row a collapsed Branch displays: each cell shows the column's Summary over the hidden Leaves' values, blank where no Summary is configured; if no column has a Summary, the collapsed Branch shows one merged cell counting its hidden rows instead.

**Report**:
A PDF or image rendering of one or more cards, configured by scope (card(s) or whole Document), format (PDF or PNG), and fit (fit-to-width with pagination and repeated Header, or scale-to-one-page including Charts).
_Avoid_: print (the browser mechanism, not the artifact), export (reserved for Document JSON)

**Details Panel**:
The right-side panel showing detailed editing for the current selection (card, Node, Column, or cell) — the home for anything too detailed for a context menu; toggled from the menubar, gone entirely when hidden.
_Avoid_: inspector (former name — too vague), sidebar, properties dialog

**Display Name**:
The free-text label an entity shows in the UI; renaming it never affects formulas.
_Avoid_: label, title (except the Document title)

**Reference Name**:
The unique, user-editable identifier formulas use to address a Topic, Column, or Node; editing it rewrites every formula that references it.
_Avoid_: id (internal ids are separate and never user-facing), slug

**Chart**:
A visualization fed by Leaf labels and column values; the same capability mounts in three hosts — a Chart Column, a Chart Panel, or a Chart Card.

**Chart Column**:
A Column whose cells render an in-cell visualization (initially: a horizontal bar proportional to a chosen source column's value in the same Row).
_Avoid_: sparkline column (a specific later variant, not the concept)

**Chart Panel**:
A toggleable area inside a Topic card (beside or under the lattice) holding one or more Charts over that Topic's data, optionally grouped by tree level.

**Chart Card**:
A standalone card in the rail holding Charts, which may combine data from any Topics in the Document (read-only).

## Relationships

- A **Document** contains one or more **Topics**; a **Topic** is exactly one **Tree-Table**, and its **Root** is the Topic itself
- A **Branch** spans the rows of all its visible **Leaves**, like a vertically merged spreadsheet cell rendered as a Node
- A **Leaf** owns exactly one **Row**; a **Row** belongs to exactly one **Leaf**
- **Collapsing** a Branch removes its subtree's Nodes and Rows together — the two presentations cannot disagree because there is only one row lattice
- A collapsed **Branch** shows a **Rollup Row**: each Column's Summary, or — when no Column has one — a single merged cell counting the hidden rows. Rollup cells are computed, selectable and copyable, and can never be edited
- Formulas and the footer always compute over ALL Leaves, hidden or not — collapsing can never change a number, only its visibility
- Dragging a Node drags its Rows (they are the same lattice object); dragging a **Branch** carries its whole subtree. Drop between rows = reorder among siblings; drop onto a pill = re-parent (never into your own subtree)
- When a **Leaf** holding data gains its first child, it becomes a **Branch** and its cells move to an auto-created first child Leaf — structure edits never silently destroy data
- Every **Topic**, **Column**, and **Node** carries a **Display Name** plus a **Reference Name**; Reference Names are unique per Topic (Columns, Nodes) or per Document (Topics)
- A formula may aggregate a Column over a **Branch**'s subtree by the Branch's Reference Name (e.g. `SUM(Savings.$Amount)`), alongside same-Row refs (`$Rate`) and whole-column aggregates (`SUM($Amount)`); the dotted form is equivalent sugar (`Savings.$Amount.sum()`, `$Amount.count()`)
- A formula may reference another **Topic** by prefixing its Reference Name (e.g. `SUM(Wealth.$Amount)` from inside Business) — dependencies and cycle detection span the whole **Document**
- Deleting or renaming a referenced entity never blocks: Reference Name edits rewrite all referencing formulas; deletions turn references into visible errors
- A **Column** is exactly one of: **Input Column** (number or text), **Computed Column**, or **Chart Column**
- Every edit to Document data or styling — cells (one step per commit), structure, columns, cards, charts, renames, color accents, JSON import — is one step in a single Document-wide undo stack; pure view state (selection, zoom, pan, collapse) never enters it
- One click selects (Node, cell, Column, card — shown in the **Details Panel**); a second click begins text editing. Selection never edits by itself
- Copying a **Node** copies its whole subtree and Rows; pasting inserts a deep clone with fresh internal ids and uniquified Reference Names as a child of the target; cut removes the original only when the paste happens (atomic move)
- A **Topic** may render its Branch pills aligned to the top row (default) or centered in their span — a per-Topic option, part of the Document
- A **Topic** may draw its tree connectors as right-angle elbows (default), straight segments, or curves — a per-Topic option, part of the Document
- Compound edits are atomic in history: a Reference Name edit undoes together with all the formula rewrites it caused; a re-parent undoes together with any auto-created child Leaf
- **Collapse** is persisted in the Document (reload and Reports respect it) yet is not an undo step; when undo/redo changes Nodes or Rows hidden under a collapsed Branch, the ancestor Branches auto-expand to reveal the change — and that expansion is itself just navigation, so redo never re-collapses anything

## Example dialogue

> **Dev:** "If a cell's text wraps and the **Row** gets taller, what code re-aligns the **Leaf**'s pill?"
> **Domain expert:** "None. The Leaf and its Row are the same lattice row — the pill grows because the row grew. There is nothing to synchronize."
>
> **Dev:** "I collapsed **Savings** and its Row shows 210000 under `$Amount` — can I type over it?"
> **Domain expert:** "No. That's a **Rollup Row** — computed from the hidden Leaves using the column's **Rollup**, same as the footer. Expand the Branch to edit the real cells. And notice the footer didn't change: **Collapse** never changes a number."
>
> **Dev:** "I renamed the pill from `Savings` to `My Savings 💰` — did `SUM(Savings.$Amount)` in Business just break?"
> **Domain expert:** "No — you changed the **Display Name**. Formulas bind to the **Reference Name**, which is still `Savings`. If you edit the Reference Name itself, every formula in the Document is rewritten to follow it."

## Flagged ambiguities

- "extension" was used to describe a Leaf's data cells — resolved: canonical term is **Row**.
- "title / main topic" — resolved: the Document title is just a name; each **Topic** is its own **Root**. There is no title-level node.
- Whether a collapsed **Branch** shows an aggregate Row of its hidden Leaves — resolved: it shows a read-only **Rollup Row** driven by the same per-column Rollup as the footer, or no Row when nothing is rolled up.
