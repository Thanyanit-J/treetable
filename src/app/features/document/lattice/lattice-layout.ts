import { NodeV2, TopicCardV2 } from '../../../core/model/document.model';

/**
 * Pure lattice layout (ADR-0001).
 *
 * Computes integer lattice coordinates — row index, tree depth, row span —
 * from the tree structure and collapse state. No pixels appear here: pixel
 * geometry is entirely the browser's job (CSS grid auto-sizing), which is
 * what makes tree/table alignment impossible to break from application code.
 */

export type PillKind = 'root' | 'branch' | 'leaf' | 'collapsed';

export interface LatticeRow {
  /** Leaf node (or collapsed Branch) whose Row this is. */
  nodeId: string;
  kind: 'leaf' | 'collapsed';
}

export interface LatticePill {
  node: NodeV2 | null;
  /** null only for the root pill, which represents the Topic itself. */
  nodeId: string;
  kind: PillKind;
  /** Tree column: 0 = Topic root, 1 = first level, … */
  depth: number;
  /** 1-based index into the data rows. */
  rowStart: number;
  rowSpan: number;
  /** Pill this one visually branches from (root pill id for depth 1). */
  parentPillId: string;
}

export interface TopicLattice {
  rows: LatticeRow[];
  /** Pills grouped by the row they start on (key = rowStart). */
  pillsByRowStart: ReadonlyMap<number, LatticePill[]>;
  pills: LatticePill[];
  /** Number of tree columns including the root column. */
  depthCount: number;
}

export const ROOT_PILL_ID = '__root__';

export function computeTopicLattice(
  topic: TopicCardV2,
  collapsed: ReadonlySet<string>,
): TopicLattice {
  const rows: LatticeRow[] = [];
  const pills: LatticePill[] = [];
  let maxDepth = 0;

  const visit = (
    node: NodeV2,
    depth: number,
    parentPillId: string,
  ): { rowStart: number; rowSpan: number } => {
    maxDepth = Math.max(maxDepth, depth);
    const hasChildren = node.children.length > 0;
    const isCollapsed = hasChildren && collapsed.has(node.id);

    if (!hasChildren || isCollapsed) {
      rows.push({ nodeId: node.id, kind: hasChildren ? 'collapsed' : 'leaf' });
      const rowStart = rows.length;
      pills.push({
        node,
        nodeId: node.id,
        kind: isCollapsed ? 'collapsed' : 'leaf',
        depth,
        rowStart,
        rowSpan: 1,
        parentPillId,
      });
      return { rowStart, rowSpan: 1 };
    }

    let rowStart = 0;
    let rowSpan = 0;
    for (const [index, child] of node.children.entries()) {
      const childPlacement = visit(child, depth + 1, node.id);
      if (index === 0) {
        rowStart = childPlacement.rowStart;
      }
      rowSpan += childPlacement.rowSpan;
    }

    pills.push({
      node,
      nodeId: node.id,
      kind: 'branch',
      depth,
      rowStart,
      rowSpan,
      parentPillId,
    });
    return { rowStart, rowSpan };
  };

  for (const child of topic.children) {
    visit(child, 1, ROOT_PILL_ID);
  }

  pills.push({
    node: null,
    nodeId: ROOT_PILL_ID,
    kind: 'root',
    depth: 0,
    rowStart: 1,
    rowSpan: Math.max(1, rows.length),
    parentPillId: '',
  });

  const pillsByRowStart = new Map<number, LatticePill[]>();
  for (const pill of pills) {
    const group = pillsByRowStart.get(pill.rowStart);
    if (group) {
      group.push(pill);
    } else {
      pillsByRowStart.set(pill.rowStart, [pill]);
    }
  }
  for (const group of pillsByRowStart.values()) {
    group.sort((a, b) => a.depth - b.depth);
  }

  return {
    rows,
    pills,
    pillsByRowStart,
    depthCount: maxDepth + 1,
  };
}

/** Leaves currently hidden beneath a collapsed Branch — the Rollup Row's inputs. */
export function hiddenLeavesOf(node: NodeV2): NodeV2[] {
  const leaves: NodeV2[] = [];
  const descend = (current: NodeV2): void => {
    if (current.children.length === 0) {
      leaves.push(current);
      return;
    }
    for (const child of current.children) {
      descend(child);
    }
  };
  for (const child of node.children) {
    descend(child);
  }
  return leaves;
}
