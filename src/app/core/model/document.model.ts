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
  /** True once the user detached the Reference Name from the display name. */
  customRefName?: boolean;
  displayName: string;
  kind: ColumnKind;
  /** Meaningful for input columns; computed columns always produce numbers. */
  valueType: ColumnValueType;
  /** Source text including the leading `=`; null unless kind is 'computed'. */
  expression: string | null;
  rollup: RollupMode;
  /** Reference Name of the column a Chart Column visualizes; null unless kind is 'chart'. */
  chartSource?: string | null;
  /** Hidden from the table presentation; data and formulas keep working. */
  hidden?: boolean;
  /** Explicit column width in layout px (drag the header edge); absent = size to content. */
  width?: number;
  /** Cell text wraps (rows grow) instead of clipping when the column is narrow. */
  wrap?: true;
}

export const COLUMN_MIN_WIDTH = 48;
export const COLUMN_MAX_WIDTH = 960;

export function clampColumnWidth(width: number): number {
  return Math.min(COLUMN_MAX_WIDTH, Math.max(COLUMN_MIN_WIDTH, Math.round(width)));
}

export interface NodeV2 {
  id: string;
  /** Formula-addressable Reference Name, e.g. `Savings`. Unique per Topic. */
  refName: string;
  /** True once the user detached the Reference Name from the display name. */
  customRefName?: boolean;
  displayName: string;
  accent: AccentColor | null;
  children: NodeV2[];
  /** Typed raw values keyed by column id. Meaningful on Leaves, for input columns. */
  values: Record<string, string>;
}

export type ChartType = 'bar' | 'line' | 'pie';

export interface ChartConfigV2 {
  id: string;
  type: ChartType;
  /** User-given title; absent = derived from the charted columns. */
  name?: string;
  /** Column Reference Names (same Topic) charted over the rows; pie uses the first. */
  columns: string[];
  /**
   * Node ids charted as rows, in tree order; absent = every Leaf. Branch
   * rows chart their subtree aggregated per column (see rowRollup).
   */
  rows?: string[];
  /** Aggregate applied per column to a Branch row's subtree; absent = sum. */
  rowRollup?: ChartRowRollup;
  /**
   * Which dimension runs along the category (x) axis — pie slices likewise.
   * Absent = rows (columns are the coloured series); 'columns' swaps them.
   */
  categoryAxis?: 'columns';
  /** Bar only: horizontal bars, categories down the y axis. Absent = vertical. */
  horizontal?: true;
  /**
   * Column (by Reference Name, often a text column like an account name)
   * whose cell values label the row categories; absent = the row's name.
   */
  labelColumn?: string;
}

/** Distinct from a column's Summary — this only shapes Branch rows in charts. */
export type ChartRowRollup = Exclude<RollupMode, 'none'>;

export type PillAlignment = 'center' | 'top';
export type ConnectorStyle = 'elbow' | 'straight' | 'curved';

/**
 * Explicit card size (dragging a card border sets it): a fixed dimension
 * stops following content and overflow scrolls inside. Absent dimensions —
 * and an absent sizing altogether — keep hugging the content.
 */
export interface CardSizingV2 {
  width?: number;
  height?: number;
}

export const CARD_MIN_WIDTH = 256;
export const CARD_MAX_WIDTH = 1600;
export const CARD_MIN_HEIGHT = 160;
export const CARD_MAX_HEIGHT = 1600;

export function clampCardWidth(width: number): number {
  return Math.min(CARD_MAX_WIDTH, Math.max(CARD_MIN_WIDTH, Math.round(width)));
}

export function clampCardHeight(height: number): number {
  return Math.min(CARD_MAX_HEIGHT, Math.max(CARD_MIN_HEIGHT, Math.round(height)));
}

export interface TopicCardV2 {
  kind: 'topic';
  id: string;
  /** Reference Name unique per Document, e.g. `Wealth`. */
  refName: string;
  /** True once the user detached the Reference Name from the display name. */
  customRefName?: boolean;
  /** The Root Node's name (the root pill label). */
  displayName: string;
  /** Card title shown in the chrome strip; absent = follows the Root's name. */
  cardTitle?: string;
  columns: ColumnV2[];
  children: NodeV2[];
  /** Branch pills aligned to the top row (default) or centered in their span. */
  pillAlignment?: PillAlignment;
  /** False hides the Root pill (its column disappears); an empty Topic always shows it. */
  showRoot?: boolean;
  /** Tree connector lines: right-angle elbows (default), straight segments, or curves. */
  connectorStyle?: ConnectorStyle;
  /** Explicit card size and overflow behaviour; absent = grow with content. */
  sizing?: CardSizingV2;
  /** Numbers every visible row in a gutter column left of the data. */
  showRowNumbers?: true;
}

export type NoteFormat = 'text' | 'markdown';

/** Free-text card — no data, no references. */
export interface NoteCardV2 {
  kind: 'note';
  id: string;
  text: string;
  /** Plain text (default) or rendered markdown. */
  format?: NoteFormat;
}

/** Charts over another card's Leaves, living anywhere in the Document. */
export interface ChartCardV2 {
  kind: 'chartcard';
  id: string;
  /** The Topic whose Leaves feed these charts (stable id, rename-proof). */
  sourceTopicId: string;
  charts: ChartConfigV2[];
}

export type CardV2 = TopicCardV2 | NoteCardV2 | ChartCardV2;

export function isTopicCard(card: CardV2): card is TopicCardV2 {
  return card.kind === 'topic';
}

/** Columns that can feed chart VALUES — text columns label categories instead. */
export function isChartableColumn(column: ColumnV2): boolean {
  return column.kind !== 'chart' && !(column.kind === 'input' && column.valueType === 'text');
}

/** One rail column: cards stacked top-to-bottom. */
export interface CardStackV2 {
  id: string;
  cardIds: string[];
}

/** A named canvas of stacks; the sidebar switches between Pages. */
export interface PageV2 {
  id: string;
  name: string;
  /** Rail columns, left to right. */
  stacks: CardStackV2[];
}

export interface DocumentV2 {
  version: 2;
  title: string;
  /** All cards, Document-wide — formulas reference across Pages. */
  cards: CardV2[];
  /** Layout only: every card id appears exactly once across all Pages. */
  pages: PageV2[];
}

/** Persisted view state: survives reload and drives Reports, but never enters undo history. */
export interface DocumentViewState {
  collapsedNodeIds: string[];
  activePageId?: string;
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

export function createPage(name: string): PageV2 {
  return { id: makeId('page'), name, stacks: [] };
}

/**
 * Repairs the layout invariant in place: at least one Page, every card
 * referenced exactly once, no dangling ids, no empty stacks. Unreferenced
 * cards land on the first Page as their own stacks.
 */
export function normalizeDocumentLayout(document: DocumentV2): void {
  if (!Array.isArray(document.pages) || document.pages.length === 0) {
    document.pages = [createPage('Page 1')];
  }
  const cardIds = new Set(document.cards.map((card) => card.id));
  const seen = new Set<string>();
  for (const page of document.pages) {
    for (const stack of page.stacks) {
      stack.cardIds = stack.cardIds.filter((id) => {
        if (!cardIds.has(id) || seen.has(id)) {
          return false;
        }
        seen.add(id);
        return true;
      });
    }
    page.stacks = page.stacks.filter((stack) => stack.cardIds.length > 0);
  }
  const firstPage = document.pages[0]!;
  for (const card of document.cards) {
    if (!seen.has(card.id)) {
      firstPage.stacks.push({ id: makeId('stack'), cardIds: [card.id] });
    }
  }
}

/** Strips a card from every Page, dropping stacks it leaves empty. */
export function removeCardFromLayout(document: DocumentV2, cardId: string): void {
  for (const page of document.pages) {
    for (const stack of page.stacks) {
      stack.cardIds = stack.cardIds.filter((id) => id !== cardId);
    }
    page.stacks = page.stacks.filter((stack) => stack.cardIds.length > 0);
  }
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
