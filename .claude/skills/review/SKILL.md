---
name: review
description: "Run a full parallel codebase review across quality, security, performance, accessibility, and lint. Use when the user wants a comprehensive code review, audit, or health check of the codebase."
argument-hint: "[quality|security|performance|a11y|lint]"
---

Run a comprehensive codebase review by launching all reviewer agents in parallel.

## Instructions

If `$ARGUMENTS` specifies a single focus area (e.g., `quality`, `security`, `performance`, `a11y`, `lint`), run only that specific reviewer agent and return its full report.

Otherwise, launch ALL FIVE reviewer agents in **parallel** (a single message with multiple Agent tool calls):

1. **quality-reviewer** — Angular patterns, TypeScript, signals, SRP, component design
2. **security-reviewer** — XSS, injection, localStorage, formula safety, dependencies
3. **performance-reviewer** — OnPush, computed(), track, memory leaks, structuredClone
4. **a11y-reviewer** — WCAG AA, ARIA, keyboard nav, focus management, color contrast
5. **lint-reviewer** — Unused imports, naming, magic numbers, dead code, Prettier

After all agents complete, produce a **Master Review Report** with this structure:

---

## Master Review Report

### Executive Summary
_2-3 sentences summarizing the overall health of the codebase._

### Priority Action Items
_Top 5-10 issues across all domains, ranked by impact/severity._

| # | Issue | Domain | Severity | File:Line |
|---|-------|--------|----------|-----------|
| 1 | ... | Quality | CRITICAL | ... |
...

### Full Reports

<details>
<summary>Code Quality</summary>
[full quality report]
</details>

<details>
<summary>Security</summary>
[full security report]
</details>

<details>
<summary>Performance</summary>
[full performance report]
</details>

<details>
<summary>Accessibility</summary>
[full a11y report]
</details>

<details>
<summary>Lint & Style</summary>
[full lint report]
</details>

---

$ARGUMENTS
