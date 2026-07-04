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

import { slugifyEntityRefName, uniqueRefName } from './ref-name';

export type ColumnKind = 'input' | 'computed' | 'chart';
export type ColumnValueType = 'number' | 'text';
export type RollupMode = 'none' | 'sum' | 'avg' | 'min' | 'max' | 'count';

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
export type ConnectorStyle = 'elbow' | 'straight' | 'curved';

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
  /** Tree connector lines: right-angle elbows (default), straight segments, or curves. */
  connectorStyle?: ConnectorStyle;
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

/** A Reference Name for a new Node, unique within the Topic. */
export function nextNodeRefName(topic: TopicCardV2, displayName: string): string {
  const taken = new Set<string>();
  walkNodes(topic.children, (node) => taken.add(node.refName));
  return uniqueRefName(slugifyEntityRefName(displayName), taken);
}

/**
 * Prepares a Node to receive children: a data-bearing Leaf moves its values
 * into an auto-created carrier child so no data is destroyed (CONTEXT.md
 * relationships).
 */
export function ensureCanHostChildren(topic: TopicCardV2, parent: NodeV2): void {
  if (parent.children.length > 0) {
    return;
  }
  if (Object.values(parent.values).some((raw) => raw.trim().length > 0)) {
    const carrier = createNode(parent.displayName, nextNodeRefName(topic, parent.displayName));
    carrier.values = parent.values;
    parent.children.push(carrier);
  }
  parent.values = {};
}

/**
 * Moves a Node (with its whole subtree) to `targetParentId` (null = top
 * level) at `targetIndex`, counted after the node's removal. Callers are
 * responsible for validating the move (no self/descendant targets); the
 * DocumentStore uses this inside one undo step, the lattice uses it to
 * render drag previews without touching the store.
 */
export function moveNodeInTopic(
  topic: TopicCardV2,
  nodeId: string,
  targetParentId: string | null,
  targetIndex: number,
): void {
  const located = findNodeAndParent(topic.children, nodeId);
  if (!located) {
    return;
  }

  const fromSiblings = located.parent ? located.parent.children : topic.children;
  fromSiblings.splice(located.index, 1);

  let targetSiblings = topic.children;
  if (targetParentId !== null) {
    const target = findNodeAndParent(topic.children, targetParentId);
    if (!target) {
      // Reinsert where it was — target vanished mid-operation.
      fromSiblings.splice(located.index, 0, located.node);
      return;
    }
    ensureCanHostChildren(topic, target.node);
    targetSiblings = target.node.children;
  }

  const index = Math.max(0, Math.min(targetIndex, targetSiblings.length));
  targetSiblings.splice(index, 0, located.node);
}
