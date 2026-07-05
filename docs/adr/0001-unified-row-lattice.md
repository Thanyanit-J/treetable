---
status: accepted
---

# Render the Tree-Table as one unified row lattice

The v1 implementation rendered the tree canvas and the HTML table as two separate components kept aligned by a shared-CSS-variable convention plus `requestAnimationFrame`/`getBoundingClientRect` measurements. Every feature and CSS tweak had to keep both renderers agreeing, which made visual changes chronically break alignment. For the ground-up rewrite we decided: the Tree-Table is ONE layout surface (a single grid), where tree Nodes are vertically-merged cells (`grid-row: span n` / rowspan semantics) rendered as pills, and each Leaf's Row occupies the same lattice row as the Leaf itself. Alignment exists by construction; the browser does all height math; content-driven (non-uniform) row heights are the default, not a special case.

Lattice coordinates (row index, column index, span) are pure integer functions of the tree structure and collapse state — no pixel math in application code. Connector lines are a decorative SVG overlay positioned from measured pill edges (ResizeObserver); if the overlay redraws a frame late nothing misaligns, because alignment never depends on it.

## Considered options

- **Explicit layout engine** (React-Flow style: measure → layout function → absolutely positioned nodes/rows/edges). Rejected: maximum flexibility we don't need (no free-form/radial layouts requested), at the cost of permanently owning the measure→layout loop — a centralized version of exactly the sync burden this rewrite exists to kill.
- **Hardened two-pane sync** (keep separate tree + table, table publishes measured row geometry via ResizeObserver signals). Rejected: least rework, but alignment remains "two renderers agreeing" — the failure class being eliminated.

## Consequences

- The visual language is fixed to a row-aligned, left-to-right tree beside its table. Radial/free-form layouts or cross-tree edges would require revisiting this ADR.
- Pan/zoom is a CSS transform of the whole lattice, so tree and table always scale together.
- Printing works natively (real DOM, no canvas rasterization).
