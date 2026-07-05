import { ColumnV2, DocumentFileV2, NodeV2, TopicCardV2, makeId } from '../model/document.model';
import {
  isValidColumnRefName,
  slugifyColumnRefName,
  slugifyEntityRefName,
  uniqueRefName,
} from '../model/ref-name';

/**
 * One-time, silent migration of a v1 state (as stored under the old
 * localStorage key or exported by the old app) into a V2 Document.
 *
 * The interesting move is lifting formulas: v1 copied a column's formula into
 * every leaf cell (its de-facto column-formula semantics, see ADR-0002), so a
 * column becomes a Computed Column when any of its cells holds a formula, and
 * that raw becomes the column expression. Literal raws are preserved as
 * values even inside computed columns — migration never destroys data.
 */

interface V1Column {
  id?: unknown;
  name?: unknown;
  type?: unknown;
  summaryMode?: unknown;
}

interface V1Node {
  label?: unknown;
  children?: unknown;
  cells?: unknown;
}

interface V1Topic {
  label?: unknown;
  columns?: unknown;
  children?: unknown;
}

export function migrateV1Document(input: unknown): DocumentFileV2 | null {
  if (!input || typeof input !== 'object') {
    return null;
  }
  const candidate = input as { version?: unknown; title?: unknown; topics?: unknown };
  if (candidate.version !== 1 || !Array.isArray(candidate.topics)) {
    return null;
  }

  const takenTopicRefs = new Set<string>();
  const cards: TopicCardV2[] = candidate.topics.map((topic, index) =>
    migrateTopic((topic ?? {}) as V1Topic, index, takenTopicRefs),
  );

  return {
    version: 2,
    title:
      typeof candidate.title === 'string' && candidate.title.trim().length > 0
        ? candidate.title
        : 'Untitled',
    cards,
    // Layout is repaired downstream (normalizeDocumentLayout via persistence).
    pages: [],
    view: { collapsedNodeIds: [] },
  };
}

function migrateTopic(topic: V1Topic, index: number, takenTopicRefs: Set<string>): TopicCardV2 {
  const displayName =
    typeof topic.label === 'string' && topic.label.trim().length > 0
      ? topic.label
      : `Topic ${index + 1}`;
  const refName = uniqueRefName(slugifyEntityRefName(displayName), takenTopicRefs);
  takenTopicRefs.add(refName);

  const v1Columns: V1Column[] = Array.isArray(topic.columns) ? (topic.columns as V1Column[]) : [];
  const v1Nodes: V1Node[] = Array.isArray(topic.children) ? (topic.children as V1Node[]) : [];

  const takenColumnRefs = new Set<string>();
  const columnPlans = v1Columns.map((column, columnIndex) => {
    const name =
      typeof column.name === 'string' && column.name.trim().length > 0
        ? column.name
        : `Column ${columnIndex + 1}`;
    const oldId = typeof column.id === 'string' ? column.id : '';
    const baseRef = isValidColumnRefName(oldId) ? oldId : slugifyColumnRefName(name);
    const nextRef = uniqueRefName(baseRef, takenColumnRefs);
    takenColumnRefs.add(nextRef);
    return {
      oldId,
      id: makeId('col'),
      refName: nextRef,
      displayName: name,
      valueType: column.type === 'text' ? ('text' as const) : ('number' as const),
      rollup: column.summaryMode === 'sum' ? ('sum' as const) : ('none' as const),
    };
  });

  // References inside migrated formulas must follow any column ref renames.
  const refRewrites = new Map(
    columnPlans
      .filter((plan) => plan.oldId.length > 0 && plan.oldId !== plan.refName)
      .map((plan) => [plan.oldId, plan.refName]),
  );

  const columns: ColumnV2[] = columnPlans.map((plan) => {
    const formulaRaw = findFirstFormulaRaw(v1Nodes, plan.oldId);
    return {
      id: plan.id,
      refName: plan.refName,
      displayName: plan.displayName,
      kind: formulaRaw === null ? 'input' : 'computed',
      valueType: plan.valueType,
      expression: formulaRaw === null ? null : rewriteRefs(formulaRaw, refRewrites),
      rollup: plan.rollup,
    };
  });

  const takenNodeRefs = new Set<string>();
  const children = v1Nodes.map((node, nodeIndex) =>
    migrateNode(node, nodeIndex, columnPlans, takenNodeRefs),
  );

  return {
    kind: 'topic',
    id: makeId('topic'),
    refName,
    displayName,
    columns,
    children,
  };
}

function migrateNode(
  node: V1Node,
  index: number,
  columnPlans: readonly { oldId: string; id: string }[],
  takenNodeRefs: Set<string>,
): NodeV2 {
  const displayName =
    typeof node.label === 'string' && node.label.trim().length > 0
      ? node.label
      : `Node ${index + 1}`;
  const refName = uniqueRefName(slugifyEntityRefName(displayName), takenNodeRefs);
  takenNodeRefs.add(refName);

  const cells =
    node.cells && typeof node.cells === 'object'
      ? (node.cells as Record<string, { raw?: unknown }>)
      : {};
  const values: Record<string, string> = {};
  for (const plan of columnPlans) {
    const raw = cells[plan.oldId]?.raw;
    if (typeof raw === 'string' && raw.trim().length > 0 && !raw.trim().startsWith('=')) {
      values[plan.id] = raw;
    }
  }

  const childNodes: V1Node[] = Array.isArray(node.children) ? (node.children as V1Node[]) : [];
  return {
    id: makeId('node'),
    refName,
    displayName,
    accent: null,
    values,
    children: childNodes.map((child, childIndex) =>
      migrateNode(child, childIndex, columnPlans, takenNodeRefs),
    ),
  };
}

function findFirstFormulaRaw(nodes: readonly V1Node[], oldColumnId: string): string | null {
  for (const node of nodes) {
    const cells =
      node.cells && typeof node.cells === 'object'
        ? (node.cells as Record<string, { raw?: unknown }>)
        : {};
    const raw = cells[oldColumnId]?.raw;
    if (typeof raw === 'string' && raw.trim().startsWith('=')) {
      return raw;
    }
    const children: V1Node[] = Array.isArray(node.children) ? (node.children as V1Node[]) : [];
    const found = findFirstFormulaRaw(children, oldColumnId);
    if (found !== null) {
      return found;
    }
  }
  return null;
}

function rewriteRefs(formula: string, rewrites: ReadonlyMap<string, string>): string {
  if (rewrites.size === 0) {
    return formula;
  }
  let rewritten = formula;
  const entries = [...rewrites.entries()].sort((a, b) => b[0].length - a[0].length);
  for (const [oldRef, newRef] of entries) {
    const escaped = oldRef.replaceAll(/[.*+?^${}()|[\]\\]/g, String.raw`\$&`);
    const pattern = new RegExp(String.raw`(?<![\w$])${escaped}(?!\w)`, 'g');
    rewritten = rewritten.replaceAll(pattern, newRef);
  }
  return rewritten;
}
