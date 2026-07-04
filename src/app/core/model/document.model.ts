/**
 * TreeTable Document model, version 2.
 *
 * Vocabulary and invariants live in CONTEXT.md; the architectural decisions
 * behind this shape are ADR-0001 (unified row lattice), ADR-0002 (formulas
 * belong to Columns) and ADR-0003 (document-wide references).
 *
 * The Document stores only source data (typed cell values and column
 * expressions). Evaluated values are always derived, never persisted.
 */

export type ColumnKind = 'input' | 'computed' | 'chart';
export type ColumnValueType = 'number' | 'text';
export type RollupMode = 'none' | 'sum';

export const ACCENT_COLORS = ['sky', 'amber', 'emerald', 'rose', 'violet', 'slate'] as const;
export type AccentColor = (typeof ACCENT_COLORS)[number];

export interface ColumnV2 {
  /** Internal identity — stable, never user-visible. Cell values key off this. */
  id: string;
  /** Formula-addressable Reference Name, e.g. `$Amount`. Unique per Topic. */
  refName: string;
  displayName: string;
  kind: ColumnKind;
  /** Meaningful for input columns; computed columns always produce numbers. */
  valueType: ColumnValueType;
  /** Source text including the leading `=`; null unless kind is 'computed'. */
  expression: string | null;
  rollup: RollupMode;
  /** Reference Name of the column a Chart Column visualizes; null unless kind is 'chart'. */
  chartSource?: string | null;
}

export interface NodeV2 {
  id: string;
  /** Formula-addressable Reference Name, e.g. `Savings`. Unique per Topic. */
  refName: string;
  displayName: string;
  accent: AccentColor | null;
  children: NodeV2[];
  /** Typed raw values keyed by column id. Meaningful on Leaves, for input columns. */
  values: Record<string, string>;
}

export type ChartType = 'bar' | 'pie';

export interface ChartConfigV2 {
  id: string;
  type: ChartType;
  /** Column Reference Names (same Topic) charted over the Leaves; pie uses the first. */
  columns: string[];
}

export type PillAlignment = 'center' | 'top';

export interface TopicCardV2 {
  kind: 'topic';
  id: string;
  /** Reference Name unique per Document, e.g. `Wealth`. */
  refName: string;
  displayName: string;
  columns: ColumnV2[];
  children: NodeV2[];
  /** Charts shown in the card's Chart Panel. */
  charts?: ChartConfigV2[];
  /** Branch pills centered in their span (default) or aligned to the top row. */
  pillAlignment?: PillAlignment;
}

export type CardV2 = TopicCardV2;

export interface DocumentV2 {
  version: 2;
  title: string;
  cards: CardV2[];
}

/** Persisted view state: survives reload and drives Reports, but never enters undo history. */
export interface DocumentViewState {
  collapsedNodeIds: string[];
}

/** The on-disk / localStorage shape: Document plus its view state. */
export interface DocumentFileV2 extends DocumentV2 {
  view?: DocumentViewState;
}

export interface ImportResult {
  ok: boolean;
  error?: string;
}

export function makeId(prefix: string): string {
  return `${prefix}_${crypto.randomUUID()}`;
}

export function cloneDocument(document: DocumentV2): DocumentV2 {
  return structuredClone(document);
}

export function createInputColumn(displayName: string, refName: string): ColumnV2 {
  return {
    id: makeId('col'),
    refName,
    displayName,
    kind: 'input',
    valueType: 'number',
    expression: null,
    rollup: 'none',
    chartSource: null,
  };
}

export function createNode(displayName: string, refName: string): NodeV2 {
  return {
    id: makeId('node'),
    refName,
    displayName,
    accent: null,
    children: [],
    values: {},
  };
}

export function isLeaf(node: NodeV2): boolean {
  return node.children.length === 0;
}

export function walkNodes(
  nodes: readonly NodeV2[],
  visit: (node: NodeV2, parent: NodeV2 | null) => void,
): void {
  const descend = (node: NodeV2, parent: NodeV2 | null): void => {
    visit(node, parent);
    for (const child of node.children) {
      descend(child, node);
    }
  };
  for (const node of nodes) {
    descend(node, null);
  }
}

export function collectLeaves(nodes: readonly NodeV2[]): NodeV2[] {
  const leaves: NodeV2[] = [];
  walkNodes(nodes, (node) => {
    if (isLeaf(node)) {
      leaves.push(node);
    }
  });
  return leaves;
}

export function findNodeAndParent(
  nodes: NodeV2[],
  nodeId: string,
): { node: NodeV2; parent: NodeV2 | null; index: number } | null {
  const search = (
    entries: NodeV2[],
    parent: NodeV2 | null,
  ): { node: NodeV2; parent: NodeV2 | null; index: number } | null => {
    for (let index = 0; index < entries.length; index += 1) {
      const node = entries[index];
      if (!node) {
        continue;
      }
      if (node.id === nodeId) {
        return { node, parent, index };
      }
      const found = search(node.children, node);
      if (found) {
        return found;
      }
    }
    return null;
  };
  return search(nodes, null);
}

export function nodeExists(nodes: readonly NodeV2[], nodeId: string): boolean {
  let found = false;
  walkNodes(nodes, (node) => {
    if (node.id === nodeId) {
      found = true;
    }
  });
  return found;
}
