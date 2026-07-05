---
name: verify
description: Build, launch and drive TreeTable to verify a change end-to-end in the real app. Use when verifying that a feature or fix actually works at the UI surface, before committing.
---

# Verifying TreeTable changes

TreeTable is an Angular SPA (bun + `ng`), persisted to localStorage. A fresh
browser profile always loads the starter document from
`src/app/core/model/starter.ts` (Wealth topic: Amount input column with sum
rollup, Rate, computed Yield `= $Amount * $Rate`; Business topic).

## Launch

```bash
bun run start -- --port 4299   # background; serves http://localhost:4299/
```

The sandbox kills `ng` (SIGABRT) — run build/serve/test unsandboxed.

## Drive

Prefer claude-in-chrome. If the extension is not connected, fall back to
Playwright against system Chrome (no browser download):

```bash
cd <scratchpad> && bun add playwright-core
# chromium.launch({ channel: 'chrome', headless: true })
```

Useful handles (a fresh profile = starter document, stable ids):

- Cells: `[data-cell-node="node_bank_a"][data-cell-col="col_wealth_amount"]`,
  display div is the inner `div[tabindex="0"]`. Click selects; Enter starts
  editing (`input.edit-input`); Enter commits, Escape cancels.
- Details panel: `aside[aria-label="Details"]`. Selecting a cell shows the
  Cell section plus the column's settings (shared template).
- Footer summaries render in the SUMMARY row; assert via page text.

## Gotchas

- Sums can show float noise at the 10th decimal (pre-existing
  `formatNumericValue` behaviour) — don't flag it as a regression.
- `bun run test` is vitest; fine for TDD but not a substitute for driving
  the app.
