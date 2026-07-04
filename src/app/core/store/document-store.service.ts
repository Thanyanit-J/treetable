import { Injectable, computed, effect, inject, signal } from '@angular/core';
import { parseExpressionSource, printExpression, transformRefPaths } from '../engine/formula-ast';
import {
  evaluateDocument,
  formatNumericValue,
  resolveRefBindings,
} from '../engine/formula-evaluator';
import { computeTopicLattice } from '../lattice/lattice-layout';
import {
  AccentColor,
  ChartType,
  ColumnV2,
  ConnectorStyle,
  DocumentV2,
  ImportResult,
  NodeV2,
  PillAlignment,
  TopicCardV2,
  cloneDocument,
  collectLeaves,
  createInputColumn,
  createNode,
  ensureCanHostChildren,
  findNodeAndParent,
  isLeaf,
  makeId,
  moveNodeInTopic,
  nextNodeRefName,
  nodeExists,
  walkNodes,
} from '../model/document.model';
import {
  isValidColumnRefName,
  isValidEntityRefName,
  slugifyColumnRefName,
  slugifyEntityRefName,
  uniqueRefName,
} from '../model/ref-name';
import { PersistenceService } from '../persistence/persistence.service';

export interface RefNameTarget {
  kind: 'topic' | 'node' | 'column';
  topicId: string;
  entityId: string;
}

export interface CellRef {
  nodeId: string;
  columnId: string;
}

/** One click selects; the Inspector edits the selection (CONTEXT.md). */
export type SelectionV2 =
  | { kind: 'card'; topicId: string }
  | { kind: 'node'; topicId: string; nodeId: string }
  | { kind: 'column'; topicId: string; columnId: string }
  | { kind: 'cell'; topicId: string; nodeId: string; columnId: string }
  | { kind: 'range'; topicId: string; anchor: CellRef; focus: CellRef };

export type ClipboardContent =
  | { kind: 'node'; topicId: string; node: NodeV2; cutSourceNodeId: string | null }
  | { kind: 'cells'; matrix: string[][]; cut: { topicId: string; cells: CellRef[] } | null };

/**
 * The formula editor currently owning the caret. While one is active,
 * lattices highlight reference targets and clicking a column inserts its
 * Reference Name via `insertRef` instead of moving the selection.
 */
export interface FormulaEditorSession {
  topicId: string;
  /** Column whose formula is being edited (re-registers when it changes). */
  columnId: string | null;
  insertRef(refText: string): void;
}

/**
 * Document store implementing the history contract from CONTEXT.md:
 *
 * - Every Document data/styling edit is one step in a single Document-wide
 *   undo stack (whole-snapshot history — deliberate at personal scale).
 * - Collapse is persisted alongside the Document but never enters history;
 *   when undo/redo changes Nodes hidden under a collapsed Branch, the
 *   ancestors auto-expand to reveal the change.
 * - Selection is ephemeral view state: neither persisted nor undoable.
 *
 * Evaluated formula values are derived state (computed), never stored.
 */
@Injectable({ providedIn: 'root' })
export class DocumentStoreService {
  private readonly persistence = inject(PersistenceService);

  private readonly documentSignal;
  private readonly collapsedSignal;
  private readonly selectionSignal = signal<SelectionV2 | null>(null);
  private readonly clipboardSignal = signal<ClipboardContent | null>(null);
  private readonly formulaEditorSignal = signal<FormulaEditorSession | null>(null);
  private readonly pastSignal = signal<DocumentV2[]>([]);
  private readonly futureSignal = signal<DocumentV2[]>([]);

  readonly document;
  readonly title;
  readonly cards;
  readonly selection = this.selectionSignal.asReadonly();
  readonly clipboard = this.clipboardSignal.asReadonly();
  readonly formulaEditor = this.formulaEditorSignal.asReadonly();
  /** Node whose lattice row is highlighted, derived from the selection. */
  readonly selectedNodeId = computed(() => {
    const selection = this.selectionSignal();
    return selection && (selection.kind === 'node' || selection.kind === 'cell')
      ? selection.nodeId
      : null;
  });
  readonly collapsedNodeIds;
  readonly canUndo = computed(() => this.pastSignal().length > 0);
  readonly canRedo = computed(() => this.futureSignal().length > 0);

  /** Formula evaluation per topic card, derived from the Document. */
  readonly evaluations;

  private saveTimer: ReturnType<typeof setTimeout> | null = null;

  constructor() {
    const loaded = this.persistence.load();
    const { view, ...document } = loaded;
    this.documentSignal = signal<DocumentV2>(document);
    this.collapsedSignal = signal<ReadonlySet<string>>(new Set(view?.collapsedNodeIds ?? []));

    this.document = this.documentSignal.asReadonly();
    this.title = computed(() => this.documentSignal().title);
    this.cards = computed(() => this.documentSignal().cards);
    this.collapsedNodeIds = this.collapsedSignal.asReadonly();
    this.evaluations = computed(() => evaluateDocument(this.documentSignal()).topics);

    effect(() => {
      const document = this.documentSignal();
      const collapsed = this.collapsedSignal();
      if (this.saveTimer) {
        clearTimeout(this.saveTimer);
      }
      this.saveTimer = setTimeout(() => {
        this.persistence.save({ ...document, view: { collapsedNodeIds: [...collapsed] } });
      }, 150);
    });
  }

  // -------------------------------------------------------------------------
  // View state (never undoable)
  // -------------------------------------------------------------------------

  select(selection: SelectionV2 | null): void {
    this.selectionSignal.set(selection);
  }

  setFormulaEditor(session: FormulaEditorSession): void {
    this.formulaEditorSignal.set(session);
  }

  /** Clears only if `session` is still the active one (sessions may hand over). */
  clearFormulaEditor(session: FormulaEditorSession): void {
    if (this.formulaEditorSignal() === session) {
      this.formulaEditorSignal.set(null);
    }
  }

  toggleCollapse(nodeId: string): void {
    this.collapsedSignal.update((collapsed) => {
      const next = new Set(collapsed);
      if (next.has(nodeId)) {
        next.delete(nodeId);
      } else {
        next.add(nodeId);
      }
      return next;
    });
  }

  expandNode(nodeId: string): void {
    this.collapsedSignal.update((collapsed) => {
      if (!collapsed.has(nodeId)) {
        return collapsed;
      }
      const next = new Set(collapsed);
      next.delete(nodeId);
      return next;
    });
  }

  // -------------------------------------------------------------------------
  // History
  // -------------------------------------------------------------------------

  undo(): void {
    const past = this.pastSignal();
    const previous = past.at(-1);
    if (!previous) {
      return;
    }
    const current = this.documentSignal();
    this.pastSignal.set(past.slice(0, -1));
    this.futureSignal.set([...this.futureSignal(), cloneDocument(current)]);
    this.applyHistorySnapshot(current, previous);
  }

  redo(): void {
    const future = this.futureSignal();
    const next = future.at(-1);
    if (!next) {
      return;
    }
    const current = this.documentSignal();
    this.futureSignal.set(future.slice(0, -1));
    this.pastSignal.set([...this.pastSignal(), cloneDocument(current)]);
    this.applyHistorySnapshot(current, next);
  }

  private applyHistorySnapshot(before: DocumentV2, snapshot: DocumentV2): void {
    const after = cloneDocument(snapshot);
    this.documentSignal.set(after);
    this.revealChangedNodes(before, after);
    this.pruneViewState(after);
  }

  /**
   * Auto-expand: any collapsed Branch hiding a Node that this undo/redo
   * touched gets expanded, so the effect of Ctrl+Z is always visible.
   */
  private revealChangedNodes(before: DocumentV2, after: DocumentV2): void {
    const changed = diffChangedNodeIds(before, after);
    if (changed.size === 0) {
      return;
    }

    const collapsed = this.collapsedSignal();
    const toExpand = new Set<string>();
    for (const card of after.cards) {
      const path: string[] = [];
      const descend = (node: NodeV2): void => {
        if (changed.has(node.id)) {
          for (const ancestorId of path) {
            if (collapsed.has(ancestorId)) {
              toExpand.add(ancestorId);
            }
          }
        }
        path.push(node.id);
        for (const child of node.children) {
          descend(child);
        }
        path.pop();
      };
      for (const node of card.children) {
        descend(node);
      }
    }

    if (toExpand.size > 0) {
      this.collapsedSignal.update(
        (current) => new Set([...current].filter((id) => !toExpand.has(id))),
      );
    }
  }

  private mutate(mutator: (document: DocumentV2) => void): void {
    this.pastSignal.set([...this.pastSignal(), cloneDocument(this.documentSignal())]);
    this.futureSignal.set([]);
    const next = cloneDocument(this.documentSignal());
    mutator(next);
    this.documentSignal.set(next);
    this.pruneViewState(next);
  }

  /** Drops collapse entries and selection pointing at Nodes that no longer exist. */
  private pruneViewState(document: DocumentV2): void {
    const nodeIds = new Set<string>();
    for (const card of document.cards) {
      walkNodes(card.children, (node) => nodeIds.add(node.id));
    }

    const collapsed = this.collapsedSignal();
    if ([...collapsed].some((id) => !nodeIds.has(id))) {
      this.collapsedSignal.set(new Set([...collapsed].filter((id) => nodeIds.has(id))));
    }

    const selection = this.selectionSignal();
    if (selection && !this.selectionStillExists(selection, document, nodeIds)) {
      this.selectionSignal.set(null);
    }
  }

  private selectionStillExists(
    selection: SelectionV2,
    document: DocumentV2,
    nodeIds: ReadonlySet<string>,
  ): boolean {
    const topic = document.cards.find((card) => card.id === selection.topicId);
    if (!topic) {
      return false;
    }
    switch (selection.kind) {
      case 'card':
        return true;
      case 'node':
      case 'cell':
        return (
          nodeIds.has(selection.nodeId) &&
          (selection.kind === 'node' ||
            topic.columns.some((column) => column.id === selection.columnId))
        );
      case 'column':
        return topic.columns.some((column) => column.id === selection.columnId);
      case 'range':
        return (
          nodeIds.has(selection.anchor.nodeId) &&
          nodeIds.has(selection.focus.nodeId) &&
          topic.columns.some((column) => column.id === selection.anchor.columnId) &&
          topic.columns.some((column) => column.id === selection.focus.columnId)
        );
    }
  }

  // -------------------------------------------------------------------------
  // Document edits (each is exactly one undo step)
  // -------------------------------------------------------------------------

  setTitle(title: string): void {
    const next = title.trim() || 'Untitled';
    if (next === this.documentSignal().title) {
      return;
    }
    this.mutate((document) => {
      document.title = next;
    });
  }

  addTopic(displayName = 'New Topic'): void {
    let newNodeId: string | null = null;
    let newTopicId: string | null = null;
    this.mutate((document) => {
      const takenRefs = new Set(document.cards.map((card) => card.refName));
      const refName = uniqueRefName(slugifyEntityRefName(displayName), takenRefs);
      const node = createNode('New Node', 'NewNode');
      newNodeId = node.id;
      const card: TopicCardV2 = {
        kind: 'topic',
        id: makeId('topic'),
        refName,
        displayName,
        columns: [createInputColumn('A', '$A'), createInputColumn('B', '$B')],
        children: [node],
      };
      newTopicId = card.id;
      document.cards.push(card);
    });
    if (newTopicId && newNodeId) {
      this.selectionSignal.set({ kind: 'node', topicId: newTopicId, nodeId: newNodeId });
    }
  }

  removeCard(cardId: string): void {
    this.mutate((document) => {
      document.cards = document.cards.filter((card) => card.id !== cardId);
    });
  }

  renameCard(cardId: string, displayName: string): void {
    const next = displayName.trim();
    if (next.length === 0) {
      return;
    }
    this.mutate((document) => {
      const card = document.cards.find((candidate) => candidate.id === cardId);
      if (card) {
        card.displayName = next;
      }
    });
  }

  addChildNode(topicId: string, parentNodeId: string | null, displayName = 'New Node'): void {
    let newNodeId: string | null = null;
    this.mutate((document) => {
      const topic = this.findTopic(document, topicId);
      if (!topic) {
        return;
      }
      const node = createNode(displayName, nextNodeRefName(topic, displayName));

      if (parentNodeId === null) {
        topic.children.push(node);
        newNodeId = node.id;
        return;
      }

      const located = findNodeAndParent(topic.children, parentNodeId);
      if (!located) {
        return;
      }

      // A data-bearing Leaf that gains its first child becomes a Branch; its
      // values move into the newly created child so no data is destroyed.
      if (isLeaf(located.node)) {
        node.values = located.node.values;
        located.node.values = {};
      }
      located.node.children.push(node);
      newNodeId = node.id;
    });
    if (newNodeId) {
      this.selectionSignal.set({ kind: 'node', topicId, nodeId: newNodeId });
    }
  }

  addSiblingNode(topicId: string, nodeId: string, displayName = 'New Node'): void {
    let newNodeId: string | null = null;
    this.mutate((document) => {
      const topic = this.findTopic(document, topicId);
      if (!topic) {
        return;
      }
      const located = findNodeAndParent(topic.children, nodeId);
      if (!located) {
        return;
      }
      const node = createNode(displayName, nextNodeRefName(topic, displayName));
      const siblings = located.parent ? located.parent.children : topic.children;
      siblings.splice(located.index + 1, 0, node);
      newNodeId = node.id;
    });
    if (newNodeId) {
      this.selectionSignal.set({ kind: 'node', topicId, nodeId: newNodeId });
    }
  }

  removeNode(topicId: string, nodeId: string, options?: { keepDataInParent?: boolean }): void {
    this.mutate((document) => {
      const topic = this.findTopic(document, topicId);
      if (!topic) {
        return;
      }
      const located = findNodeAndParent(topic.children, nodeId);
      if (!located) {
        return;
      }

      let inheritedValues: Record<string, string> | null = null;
      if (options?.keepDataInParent && located.parent?.children.length === 1) {
        const onlyLeaf = findOnlyLeafInChain(located.node);
        if (onlyLeaf && Object.values(onlyLeaf.values).some((raw) => raw.trim().length > 0)) {
          inheritedValues = structuredClone(onlyLeaf.values);
        }
      }

      const siblings = located.parent ? located.parent.children : topic.children;
      siblings.splice(located.index, 1);

      if (located.parent && located.parent.children.length === 0 && inheritedValues) {
        located.parent.values = inheritedValues;
      }
    });
  }

  renameNode(topicId: string, nodeId: string, displayName: string): void {
    const next = displayName.trim();
    if (next.length === 0) {
      return;
    }
    this.mutate((document) => {
      const topic = this.findTopic(document, topicId);
      const located = topic ? findNodeAndParent(topic.children, nodeId) : null;
      if (located && located.node.displayName !== next) {
        located.node.displayName = next;
      }
    });
  }

  /**
   * Moves a Node (with its whole subtree and Rows) to `targetParentId`
   * (null = top level) at `targetIndex`, counted after the node's removal.
   * Dropping into your own subtree is refused. A data-bearing Leaf that
   * becomes the target parent spawns a carrier child for its values first —
   * all in one undo step.
   */
  moveNode(
    topicId: string,
    nodeId: string,
    targetParentId: string | null,
    targetIndex: number,
  ): void {
    // Validate against the current document first: a refused move must not
    // push a no-op history snapshot.
    const currentTopic = this.findTopic(this.documentSignal(), topicId);
    const currentLocated = currentTopic ? findNodeAndParent(currentTopic.children, nodeId) : null;
    if (!currentTopic || !currentLocated) {
      return;
    }
    if (
      targetParentId !== null &&
      (targetParentId === nodeId ||
        nodeExists(currentLocated.node.children, targetParentId) ||
        !findNodeAndParent(currentTopic.children, targetParentId))
    ) {
      return;
    }

    this.mutate((document) => {
      const topic = this.findTopic(document, topicId);
      if (topic) {
        moveNodeInTopic(topic, nodeId, targetParentId, targetIndex);
      }
    });
  }

  /** Reorders a Node one step among its siblings (keyboard path for drag). */
  moveNodeAmongSiblings(topicId: string, nodeId: string, delta: -1 | 1): void {
    if (!this.canMoveNodeAmongSiblings(topicId, nodeId, delta)) {
      return;
    }
    const topic = this.topicById(topicId);
    const located = topic ? findNodeAndParent(topic.children, nodeId) : null;
    if (!located) {
      return;
    }
    this.moveNode(topicId, nodeId, located.parent?.id ?? null, located.index + delta);
  }

  canMoveNodeAmongSiblings(topicId: string, nodeId: string, delta: -1 | 1): boolean {
    const topic = this.topicById(topicId);
    const located = topic ? findNodeAndParent(topic.children, nodeId) : null;
    if (!topic || !located) {
      return false;
    }
    const siblings = located.parent ? located.parent.children : topic.children;
    const next = located.index + delta;
    return next >= 0 && next < siblings.length;
  }

  /**
   * Inserts a deep clone of the Node right after it, with fresh internal ids
   * and uniquified Reference Names — subtree and Row values included.
   */
  duplicateNode(topicId: string, nodeId: string): void {
    let newNodeId: string | null = null;
    this.mutate((document) => {
      const topic = this.findTopic(document, topicId);
      const located = topic ? findNodeAndParent(topic.children, nodeId) : null;
      if (!topic || !located) {
        return;
      }
      const taken = new Set<string>();
      walkNodes(topic.children, (node) => taken.add(node.refName));
      const clone = structuredClone(located.node);
      walkNodes([clone], (node) => {
        node.id = makeId('node');
        const refName = uniqueRefName(node.refName, taken);
        taken.add(refName);
        node.refName = refName;
      });
      const siblings = located.parent ? located.parent.children : topic.children;
      siblings.splice(located.index + 1, 0, clone);
      newNodeId = clone.id;
    });
    if (newNodeId) {
      this.selectionSignal.set({ kind: 'node', topicId, nodeId: newNodeId });
    }
  }

  moveCard(cardId: string, toIndex: number): void {
    this.mutate((document) => {
      const fromIndex = document.cards.findIndex((card) => card.id === cardId);
      if (
        fromIndex < 0 ||
        toIndex < 0 ||
        toIndex >= document.cards.length ||
        fromIndex === toIndex
      ) {
        return;
      }
      const [card] = document.cards.splice(fromIndex, 1);
      if (card) {
        document.cards.splice(toIndex, 0, card);
      }
    });
  }

  setNodeAccent(topicId: string, nodeId: string, accent: AccentColor | null): void {
    this.mutate((document) => {
      const topic = this.findTopic(document, topicId);
      const located = topic ? findNodeAndParent(topic.children, nodeId) : null;
      if (located) {
        located.node.accent = accent;
      }
    });
  }

  /**
   * Commits a cell edit. Typing a formula (`=`…) into any cell of an input
   * column converts the whole column to a Computed Column (v1 muscle memory,
   * formalized by ADR-0002); committing plain text into a computed cell
   * converts the column back to input, freezing the formula's current
   * results as the other cells' values.
   */
  setCellValue(topicId: string, nodeId: string, columnId: string, raw: string): void {
    this.mutate((document) => {
      const topic = this.findTopic(document, topicId);
      if (!topic) {
        return;
      }
      const column = topic.columns.find((candidate) => candidate.id === columnId);
      const located = findNodeAndParent(topic.children, nodeId);
      if (!column || !located || !isLeaf(located.node)) {
        return;
      }

      const isFormula = raw.trim().startsWith('=');
      if (isFormula) {
        column.kind = 'computed';
        column.expression = raw;
        return;
      }

      if (column.kind === 'computed') {
        this.writeComputedResults(topic, column.id);
        column.kind = 'input';
        column.expression = null;
      }

      if (raw.length === 0) {
        delete located.node.values[columnId];
      } else {
        located.node.values[columnId] = raw;
      }
    });
  }

  setColumnExpression(topicId: string, columnId: string, expression: string): void {
    this.mutate((document) => {
      const topic = this.findTopic(document, topicId);
      const column = topic?.columns.find((candidate) => candidate.id === columnId);
      if (!column) {
        return;
      }
      const trimmed = expression.trim();
      if (trimmed.startsWith('=')) {
        column.kind = 'computed';
        column.expression = expression;
      }
    });
  }

  insertColumn(topicId: string, referenceColumnId: string, side: 'left' | 'right'): void {
    this.mutate((document) => {
      const topic = this.findTopic(document, topicId);
      if (!topic) {
        return;
      }
      const referenceIndex = topic.columns.findIndex((column) => column.id === referenceColumnId);
      if (referenceIndex < 0) {
        return;
      }
      const taken = new Set(topic.columns.map((column) => column.refName));
      const column = createInputColumn(
        'New Column',
        uniqueRefName(slugifyColumnRefName('New Column'), taken),
      );
      topic.columns.splice(side === 'left' ? referenceIndex : referenceIndex + 1, 0, column);
    });
  }

  deleteColumn(topicId: string, columnId: string): ImportResult | undefined {
    const topic = this.findTopic(this.documentSignal(), topicId);
    if (!topic) {
      return { ok: false, error: 'Topic not found.' };
    }
    if (topic.columns.length <= 1) {
      return { ok: false, error: 'At least one column is required.' };
    }

    this.mutate((document) => {
      const mutableTopic = this.findTopic(document, topicId);
      if (!mutableTopic) {
        return;
      }
      mutableTopic.columns = mutableTopic.columns.filter((column) => column.id !== columnId);
      walkNodes(mutableTopic.children, (node) => {
        delete node.values[columnId];
      });
    });
    return undefined;
  }

  renameColumn(topicId: string, columnId: string, displayName: string): void {
    const next = displayName.trim();
    if (next.length === 0) {
      return;
    }
    this.mutate((document) => {
      const topic = this.findTopic(document, topicId);
      const column = topic?.columns.find((candidate) => candidate.id === columnId);
      if (column) {
        column.displayName = next;
      }
    });
  }

  setColumnRollup(topicId: string, columnId: string, rollup: 'none' | 'sum'): void {
    this.mutate((document) => {
      const topic = this.findTopic(document, topicId);
      const column = topic?.columns.find((candidate) => candidate.id === columnId);
      if (column && column.kind !== 'chart') {
        column.rollup = rollup;
      }
    });
  }

  /**
   * Points a Chart Column at `sourceRefName` (same Topic), or turns a
   * value/formula column into one.
   */
  setColumnChart(topicId: string, columnId: string, sourceRefName: string): void {
    // Validate first — a refused conversion must not pollute undo history.
    const currentTopic = this.findTopic(this.documentSignal(), topicId);
    const currentColumn = currentTopic?.columns.find((candidate) => candidate.id === columnId);
    if (!currentTopic || !currentColumn) {
      return;
    }
    const source = currentTopic.columns.find((candidate) => candidate.refName === sourceRefName);
    if (!source || source.id === columnId || source.kind === 'chart') {
      return;
    }

    this.mutate((document) => {
      const column = this.findTopic(document, topicId)?.columns.find(
        (candidate) => candidate.id === columnId,
      );
      if (!column) {
        return;
      }
      column.kind = 'chart';
      column.chartSource = sourceRefName;
      column.expression = null;
      column.rollup = 'none';
    });
  }

  /** Inserts a new bar Chart Column right after the column it visualizes. */
  addChartColumn(topicId: string, sourceColumnId: string): void {
    const topic = this.findTopic(this.documentSignal(), topicId);
    const source = topic?.columns.find((candidate) => candidate.id === sourceColumnId);
    if (!topic || !source || source.kind === 'chart') {
      return;
    }
    let newColumnId: string | null = null;
    this.mutate((document) => {
      const draftTopic = this.findTopic(document, topicId);
      const index =
        draftTopic?.columns.findIndex((candidate) => candidate.id === sourceColumnId) ?? -1;
      if (!draftTopic || index < 0) {
        return;
      }
      const taken = new Set(draftTopic.columns.map((candidate) => candidate.refName));
      const displayName = `${source.displayName} chart`;
      const column = createInputColumn(
        displayName,
        uniqueRefName(slugifyColumnRefName(displayName), taken),
      );
      column.kind = 'chart';
      column.chartSource = source.refName;
      draftTopic.columns.splice(index + 1, 0, column);
      newColumnId = column.id;
    });
    if (newColumnId) {
      this.selectionSignal.set({ kind: 'column', topicId, columnId: newColumnId });
    }
  }

  // -------------------------------------------------------------------------
  // Clipboard (CONTEXT.md: node copy = subtree + Rows; cut moves on paste)
  // -------------------------------------------------------------------------

  copyNode(topicId: string, nodeId: string, cut = false): void {
    const topic = this.findTopic(this.documentSignal(), topicId);
    const located = topic ? findNodeAndParent(topic.children, nodeId) : null;
    if (!located) {
      return;
    }
    this.clipboardSignal.set({
      kind: 'node',
      topicId,
      node: structuredClone(located.node),
      cutSourceNodeId: cut ? nodeId : null,
    });
  }

  /**
   * Pastes the clipboard node as a child of `targetParentId` (null = top
   * level of the topic). Inserts a deep clone with fresh ids and uniquified
   * Reference Names; a pending cut removes the original in the same step.
   */
  pasteNode(targetTopicId: string, targetParentId: string | null): void {
    const clipboard = this.clipboardSignal();
    if (clipboard?.kind !== 'node') {
      return;
    }

    // A cut node must not be pasted into its own subtree.
    if (clipboard.cutSourceNodeId !== null && clipboard.topicId === targetTopicId) {
      const sourceTopic = this.findTopic(this.documentSignal(), targetTopicId);
      const source = sourceTopic
        ? findNodeAndParent(sourceTopic.children, clipboard.cutSourceNodeId)
        : null;
      if (
        source &&
        targetParentId !== null &&
        (targetParentId === clipboard.cutSourceNodeId ||
          nodeExists(source.node.children, targetParentId))
      ) {
        return;
      }
    }

    this.mutate((document) => {
      const topic = this.findTopic(document, targetTopicId);
      if (!topic) {
        return;
      }

      if (clipboard.cutSourceNodeId !== null) {
        const sourceTopic = this.findTopic(document, clipboard.topicId);
        const located = sourceTopic
          ? findNodeAndParent(sourceTopic.children, clipboard.cutSourceNodeId)
          : null;
        if (located && sourceTopic) {
          const siblings = located.parent ? located.parent.children : sourceTopic.children;
          siblings.splice(located.index, 1);
        }
      }

      const taken = new Set<string>();
      walkNodes(topic.children, (node) => taken.add(node.refName));
      const clone = structuredClone(clipboard.node);
      walkNodes([clone], (node) => {
        node.id = makeId('node');
        const refName = uniqueRefName(node.refName, taken);
        taken.add(refName);
        node.refName = refName;
        // Values keyed by column id only transfer within the same topic.
        if (clipboard.topicId !== targetTopicId) {
          node.values = {};
        }
      });

      if (targetParentId === null) {
        topic.children.push(clone);
        return;
      }
      const target = findNodeAndParent(topic.children, targetParentId);
      if (!target) {
        topic.children.push(clone);
        return;
      }
      ensureCanHostChildren(topic, target.node);
      target.node.children.push(clone);
    });

    // A cut pastes once; further pastes behave like copies.
    this.clipboardSignal.set({ ...clipboard, cutSourceNodeId: null });
  }

  copyCells(matrix: string[][], cut: { topicId: string; cells: CellRef[] } | null): void {
    this.clipboardSignal.set({ kind: 'cells', matrix, cut });
  }

  /**
   * Writes the clipboard matrix into `targets` (a grid of cell refs aligned
   * with the matrix; nulls are skipped — e.g. computed/chart columns).
   * Pending cut sources are cleared in the same undo step.
   */
  pasteCells(topicId: string, targets: (CellRef | null)[][]): void {
    const clipboard = this.clipboardSignal();
    if (clipboard?.kind !== 'cells') {
      return;
    }

    this.mutate((document) => {
      if (clipboard.cut) {
        const sourceTopic = this.findTopic(document, clipboard.cut.topicId);
        if (sourceTopic) {
          for (const ref of clipboard.cut.cells) {
            const located = findNodeAndParent(sourceTopic.children, ref.nodeId);
            if (located) {
              delete located.node.values[ref.columnId];
            }
          }
        }
      }

      const topic = this.findTopic(document, topicId);
      if (!topic) {
        return;
      }
      for (const [rowIndex, matrixRow] of clipboard.matrix.entries()) {
        for (const [columnIndex, raw] of matrixRow.entries()) {
          const target = targets[rowIndex]?.[columnIndex];
          if (!target) {
            continue;
          }
          const located = findNodeAndParent(topic.children, target.nodeId);
          if (!located || !isLeaf(located.node)) {
            continue;
          }
          if (raw.length === 0) {
            delete located.node.values[target.columnId];
          } else {
            located.node.values[target.columnId] = raw;
          }
        }
      }
    });

    if (clipboard.cut) {
      this.clipboardSignal.set({ ...clipboard, cut: null });
    }
  }

  clearCells(topicId: string, cells: CellRef[]): void {
    if (cells.length === 0) {
      return;
    }
    this.mutate((document) => {
      const topic = this.findTopic(document, topicId);
      if (!topic) {
        return;
      }
      for (const ref of cells) {
        const located = findNodeAndParent(topic.children, ref.nodeId);
        if (located) {
          delete located.node.values[ref.columnId];
        }
      }
    });
  }

  /** Copies (or cuts) whatever is selected: a node subtree or a cell block. */
  copySelection(cut = false): void {
    const selection = this.selectionSignal();
    if (!selection) {
      return;
    }
    if (selection.kind === 'node') {
      this.copyNode(selection.topicId, selection.nodeId, cut);
      return;
    }
    if (selection.kind !== 'cell' && selection.kind !== 'range') {
      return;
    }
    const grid = this.selectionGrid(selection);
    if (!grid) {
      return;
    }
    const matrix = grid.map((row) => row.map((cell) => cell?.copyText ?? ''));
    const cutCells = cut
      ? grid
          .flat()
          .filter((cell): cell is NonNullable<typeof cell> => cell !== null && cell.editable)
          .map((cell) => ({ nodeId: cell.nodeId, columnId: cell.columnId }))
      : [];
    this.copyCells(
      matrix,
      cut && cutCells.length > 0 ? { topicId: selection.topicId, cells: cutCells } : null,
    );
  }

  /** Pastes the clipboard relative to the selection (node → as child; cells → from the anchor). */
  pasteSelection(): void {
    const selection = this.selectionSignal();
    const clipboard = this.clipboardSignal();
    if (!selection || !clipboard) {
      return;
    }

    if (clipboard.kind === 'node') {
      if (selection.kind === 'node') {
        this.pasteNode(selection.topicId, selection.nodeId);
      } else if (selection.kind === 'card') {
        this.pasteNode(selection.topicId, null);
      }
      return;
    }

    if (selection.kind !== 'cell' && selection.kind !== 'range') {
      return;
    }
    const anchor = this.selectionAnchor(selection);
    const targets = this.pasteTargets(selection.topicId, anchor, clipboard.matrix);
    if (targets) {
      this.pasteCells(selection.topicId, targets);
    }
  }

  clearSelectedCells(): void {
    const selection = this.selectionSignal();
    if (!selection || (selection.kind !== 'cell' && selection.kind !== 'range')) {
      return;
    }
    const grid = this.selectionGrid(selection);
    if (!grid) {
      return;
    }
    const cells = grid
      .flat()
      .filter((cell): cell is NonNullable<typeof cell> => cell !== null && cell.editable)
      .map((cell) => ({ nodeId: cell.nodeId, columnId: cell.columnId }));
    this.clearCells(selection.topicId, cells);
  }

  private selectionAnchor(selection: Extract<SelectionV2, { kind: 'cell' | 'range' }>): CellRef {
    if (selection.kind === 'cell') {
      return { nodeId: selection.nodeId, columnId: selection.columnId };
    }
    // Top-left corner of the rectangle in visible-row / column order.
    const topic = this.findTopic(this.documentSignal(), selection.topicId);
    if (!topic) {
      return selection.anchor;
    }
    const rows = computeTopicLattice(topic, this.collapsedSignal()).rows.map((row) => row.nodeId);
    const columnIds = topic.columns.map((column) => column.id);
    const rowIndex = Math.min(
      rows.indexOf(selection.anchor.nodeId),
      rows.indexOf(selection.focus.nodeId),
    );
    const columnIndex = Math.min(
      columnIds.indexOf(selection.anchor.columnId),
      columnIds.indexOf(selection.focus.columnId),
    );
    return {
      nodeId: rows[rowIndex] ?? selection.anchor.nodeId,
      columnId: columnIds[columnIndex] ?? selection.anchor.columnId,
    };
  }

  /**
   * The selected rectangle as a grid of cells in visible-row order. Rollup
   * rows and non-value columns appear as read-only entries (null when the
   * position is not addressable at all).
   */
  private selectionGrid(
    selection: Extract<SelectionV2, { kind: 'cell' | 'range' }>,
  ): ({ nodeId: string; columnId: string; copyText: string; editable: boolean } | null)[][] | null {
    const topic = this.findTopic(this.documentSignal(), selection.topicId);
    if (!topic) {
      return null;
    }
    const lattice = computeTopicLattice(topic, this.collapsedSignal());
    const anchor =
      selection.kind === 'cell'
        ? { nodeId: selection.nodeId, columnId: selection.columnId }
        : selection.anchor;
    const focus = selection.kind === 'cell' ? anchor : selection.focus;

    const rowIndexOf = (nodeId: string): number =>
      lattice.rows.findIndex((row) => row.nodeId === nodeId);
    const columnIndexOf = (columnId: string): number =>
      topic.columns.findIndex((column) => column.id === columnId);

    const r1 = rowIndexOf(anchor.nodeId);
    const r2 = rowIndexOf(focus.nodeId);
    const c1 = columnIndexOf(anchor.columnId);
    const c2 = columnIndexOf(focus.columnId);
    if (r1 < 0 || r2 < 0 || c1 < 0 || c2 < 0) {
      return null;
    }

    const evaluation = this.evaluations().get(topic.id);
    const grid: ({
      nodeId: string;
      columnId: string;
      copyText: string;
      editable: boolean;
    } | null)[][] = [];
    for (let r = Math.min(r1, r2); r <= Math.max(r1, r2); r += 1) {
      const row = lattice.rows[r]!;
      const gridRow: ({
        nodeId: string;
        columnId: string;
        copyText: string;
        editable: boolean;
      } | null)[] = [];
      for (let c = Math.min(c1, c2); c <= Math.max(c1, c2); c += 1) {
        const column = topic.columns[c]!;
        if (row.kind !== 'leaf') {
          gridRow.push(null);
          continue;
        }
        const located = findNodeAndParent(topic.children, row.nodeId);
        if (!located) {
          gridRow.push(null);
          continue;
        }
        let copyText = '';
        if (column.kind === 'input') {
          copyText = located.node.values[column.id] ?? '';
        } else if (column.kind === 'computed') {
          const cell = evaluation?.computedCells.get(row.nodeId)?.get(column.id);
          copyText =
            cell && cell.error === null && cell.value !== null
              ? formatNumericValue(cell.value)
              : '';
        }
        gridRow.push({
          nodeId: row.nodeId,
          columnId: column.id,
          copyText,
          editable: column.kind === 'input',
        });
      }
      grid.push(gridRow);
    }
    return grid;
  }

  private pasteTargets(
    topicId: string,
    anchor: CellRef,
    matrix: string[][],
  ): (CellRef | null)[][] | null {
    const topic = this.findTopic(this.documentSignal(), topicId);
    if (!topic) {
      return null;
    }
    const lattice = computeTopicLattice(topic, this.collapsedSignal());
    const anchorRow = lattice.rows.findIndex((row) => row.nodeId === anchor.nodeId);
    const anchorColumn = topic.columns.findIndex((column) => column.id === anchor.columnId);
    if (anchorRow < 0 || anchorColumn < 0) {
      return null;
    }

    return matrix.map((matrixRow, rowOffset) =>
      matrixRow.map((_, columnOffset) => {
        const row = lattice.rows[anchorRow + rowOffset];
        const column = topic.columns[anchorColumn + columnOffset];
        if (!row || row.kind !== 'leaf' || !column || column.kind !== 'input') {
          return null;
        }
        return { nodeId: row.nodeId, columnId: column.id };
      }),
    );
  }

  // -------------------------------------------------------------------------
  // Columns: order, kind, alignment
  // -------------------------------------------------------------------------

  moveColumn(topicId: string, columnId: string, toIndex: number): void {
    const topic = this.findTopic(this.documentSignal(), topicId);
    const fromIndex = topic?.columns.findIndex((column) => column.id === columnId) ?? -1;
    if (
      !topic ||
      fromIndex < 0 ||
      toIndex < 0 ||
      toIndex >= topic.columns.length ||
      fromIndex === toIndex
    ) {
      return;
    }
    this.mutate((document) => {
      const draftTopic = this.findTopic(document, topicId);
      if (!draftTopic) {
        return;
      }
      const [column] = draftTopic.columns.splice(fromIndex, 1);
      if (column) {
        draftTopic.columns.splice(toIndex, 0, column);
      }
    });
  }

  /**
   * Switches a column between value (input) and formula (computed). Chart
   * Columns never change type — re-point or delete them instead. Converting
   * a formula to values freezes its current results into the cells —
   * destructive to the formula, so the UI confirms first; a new formula
   * starts empty.
   */
  setColumnKind(topicId: string, columnId: string, kind: 'input' | 'computed'): void {
    const topic = this.findTopic(this.documentSignal(), topicId);
    const column = topic?.columns.find((candidate) => candidate.id === columnId);
    if (!topic || !column || column.kind === kind || column.kind === 'chart') {
      return;
    }

    this.mutate((document) => {
      const draftTopic = this.findTopic(document, topicId);
      const draftColumn = draftTopic?.columns.find((candidate) => candidate.id === columnId);
      if (!draftTopic || !draftColumn) {
        return;
      }
      if (draftColumn.kind === 'computed' && kind === 'input') {
        this.writeComputedResults(draftTopic, draftColumn.id);
      }
      draftColumn.kind = kind;
      draftColumn.expression = kind === 'computed' ? (draftColumn.expression ?? '= ') : null;
    });
  }

  /**
   * Freezes a Computed Column's current results into the draft's leaf values
   * (errors and blanks clear the cell). Runs inside `mutate`, before the
   * draft's formula is touched, so `evaluations()` still sees the formula.
   */
  private writeComputedResults(topic: TopicCardV2, columnId: string): void {
    const evaluation = this.evaluations().get(topic.id);
    for (const leaf of collectLeaves(topic.children)) {
      const cell = evaluation?.computedCells.get(leaf.id)?.get(columnId);
      if (cell && cell.error === null && cell.value !== null) {
        leaf.values[columnId] = formatNumericValue(cell.value);
      } else {
        delete leaf.values[columnId];
      }
    }
  }

  setColumnValueType(topicId: string, columnId: string, valueType: 'number' | 'text'): void {
    this.mutate((document) => {
      const column = this.findTopic(document, topicId)?.columns.find(
        (candidate) => candidate.id === columnId,
      );
      if (column && column.kind === 'input') {
        column.valueType = valueType;
      }
    });
  }

  setPillAlignment(topicId: string, alignment: PillAlignment): void {
    this.mutate((document) => {
      const topic = this.findTopic(document, topicId);
      if (topic) {
        topic.pillAlignment = alignment;
      }
    });
  }

  setConnectorStyle(topicId: string, style: ConnectorStyle): void {
    this.mutate((document) => {
      const topic = this.findTopic(document, topicId);
      if (topic) {
        topic.connectorStyle = style;
      }
    });
  }

  // -------------------------------------------------------------------------
  // Chart Panel
  // -------------------------------------------------------------------------

  addChart(topicId: string, type: ChartType): void {
    const topic = this.findTopic(this.documentSignal(), topicId);
    const defaultColumn = topic?.columns.find((column) => column.kind !== 'chart');
    if (!topic || !defaultColumn) {
      return;
    }
    this.mutate((document) => {
      const draftTopic = this.findTopic(document, topicId);
      if (!draftTopic) {
        return;
      }
      draftTopic.charts = [
        ...(draftTopic.charts ?? []),
        { id: makeId('chart'), type, columns: [defaultColumn.refName] },
      ];
    });
  }

  removeChart(topicId: string, chartId: string): void {
    this.mutate((document) => {
      const topic = this.findTopic(document, topicId);
      if (topic) {
        topic.charts = (topic.charts ?? []).filter((chart) => chart.id !== chartId);
      }
    });
  }

  /** Adds or removes a series column; a chart always keeps at least one. */
  toggleChartColumn(topicId: string, chartId: string, columnRefName: string): void {
    this.mutate((document) => {
      const topic = this.findTopic(document, topicId);
      const chart = topic?.charts?.find((candidate) => candidate.id === chartId);
      if (!topic || !chart) {
        return;
      }
      if (chart.columns.includes(columnRefName)) {
        if (chart.columns.length > 1) {
          chart.columns = chart.columns.filter((ref) => ref !== columnRefName);
        }
        return;
      }
      if (
        topic.columns.some((column) => column.refName === columnRefName && column.kind !== 'chart')
      ) {
        chart.columns = [...chart.columns, columnRefName];
      }
    });
  }

  // -------------------------------------------------------------------------
  // Reference Names (ADR-0003)
  // -------------------------------------------------------------------------

  /**
   * Renames a Reference Name and rewrites every formula in the Document that
   * resolves to the renamed entity — one atomic undo step. Rewriting works on
   * the AST (resolve → substitute → print), so a Business-local `$Amount`
   * survives a rename of Wealth's `$Amount` untouched, while `Wealth.$Amount`
   * follows it from anywhere.
   */
  setRefName(target: RefNameTarget, nextRefNameRaw: string): ImportResult {
    const nextRefName = nextRefNameRaw.trim();
    const document = this.documentSignal();
    const topic = document.cards.find((card) => card.id === target.topicId);
    if (!topic) {
      return { ok: false, error: 'Topic not found.' };
    }

    const validation = this.validateRefName(document, topic, target, nextRefName);
    if (validation) {
      return { ok: false, error: validation };
    }

    const currentRefName = this.currentRefNameOf(topic, target);
    if (currentRefName === null) {
      return { ok: false, error: 'Entity not found.' };
    }
    if (currentRefName === nextRefName) {
      return { ok: true };
    }

    // Plan formula rewrites against the pre-rename Document.
    const expressionRewrites = new Map<string, string>();
    for (const card of document.cards) {
      for (const column of card.columns) {
        if (column.kind !== 'computed' || !column.expression) {
          continue;
        }
        const source = column.expression.trim().replace(/^=/, '');
        const parsed = parseExpressionSource(source);
        if ('error' in parsed) {
          continue; // Unparseable formulas cannot be rewritten; they stay as-is.
        }
        let changed = false;
        const transformed = transformRefPaths(parsed.expr, (path) => {
          const bindings = resolveRefBindings(document, card.id, path);
          if (!bindings) {
            return path;
          }
          const next = [...path];
          for (const [segment, binding] of bindings.entries()) {
            if (binding.kind === target.kind && binding.id === target.entityId) {
              next[segment] = nextRefName;
              changed = true;
            }
          }
          return next;
        });
        if (changed) {
          expressionRewrites.set(column.id, `= ${printExpression(transformed)}`);
        }
      }
    }

    this.mutate((draft) => {
      const draftTopic = this.findTopic(draft, target.topicId);
      if (!draftTopic) {
        return;
      }

      if (target.kind === 'topic') {
        draftTopic.refName = nextRefName;
      } else if (target.kind === 'column') {
        const column = draftTopic.columns.find((candidate) => candidate.id === target.entityId);
        if (column) {
          column.refName = nextRefName;
        }
      } else {
        const located = findNodeAndParent(draftTopic.children, target.entityId);
        if (located) {
          located.node.refName = nextRefName;
        }
      }

      for (const card of draft.cards) {
        for (const column of card.columns) {
          const rewritten = expressionRewrites.get(column.id);
          if (rewritten !== undefined) {
            column.expression = rewritten;
          }
        }
      }

      // Chart Columns and Chart Panel configs bind to columns by Reference Name too.
      if (target.kind === 'column') {
        for (const column of draftTopic.columns) {
          if (column.kind === 'chart' && column.chartSource === currentRefName) {
            column.chartSource = nextRefName;
          }
        }
        for (const chart of draftTopic.charts ?? []) {
          chart.columns = chart.columns.map((ref) => (ref === currentRefName ? nextRefName : ref));
        }
      }
    });

    return { ok: true };
  }

  private validateRefName(
    document: DocumentV2,
    topic: TopicCardV2,
    target: RefNameTarget,
    nextRefName: string,
  ): string | null {
    if (target.kind === 'column') {
      if (!isValidColumnRefName(nextRefName)) {
        return 'Column reference names start with $ followed by letters, digits or _ (e.g. $Amount).';
      }
      const taken = topic.columns.some(
        (column) => column.id !== target.entityId && column.refName === nextRefName,
      );
      return taken ? `${nextRefName} is already used by another column in this topic.` : null;
    }

    if (!isValidEntityRefName(nextRefName)) {
      return 'Reference names use letters, digits or _ and must not start with a digit (e.g. Savings).';
    }

    if (target.kind === 'topic') {
      const taken = document.cards.some(
        (card) => card.id !== target.entityId && card.refName === nextRefName,
      );
      return taken ? `${nextRefName} is already used by another topic.` : null;
    }

    let taken = false;
    walkNodes(topic.children, (node) => {
      if (node.id !== target.entityId && node.refName === nextRefName) {
        taken = true;
      }
    });
    return taken ? `${nextRefName} is already used by another node in this topic.` : null;
  }

  private currentRefNameOf(topic: TopicCardV2, target: RefNameTarget): string | null {
    if (target.kind === 'topic') {
      return topic.refName;
    }
    if (target.kind === 'column') {
      return (
        topic.columns.find((column: ColumnV2) => column.id === target.entityId)?.refName ?? null
      );
    }
    return findNodeAndParent(topic.children, target.entityId)?.node.refName ?? null;
  }

  // -------------------------------------------------------------------------
  // Import / export
  // -------------------------------------------------------------------------

  exportDocument(): string {
    return this.persistence.export({
      ...this.documentSignal(),
      view: { collapsedNodeIds: [...this.collapsedSignal()] },
    });
  }

  importDocument(json: string): ImportResult {
    const imported = this.persistence.import(json);
    if (!imported.result.ok || !imported.file) {
      return imported.result;
    }
    const { view, ...document } = imported.file;
    this.mutate((current) => {
      current.title = document.title;
      current.cards = document.cards;
    });
    this.collapsedSignal.set(new Set(view?.collapsedNodeIds ?? []));
    this.pruneViewState(this.documentSignal());
    return imported.result;
  }

  // -------------------------------------------------------------------------
  // Lookups
  // -------------------------------------------------------------------------

  topicById(topicId: string): TopicCardV2 | undefined {
    return this.documentSignal().cards.find((card) => card.id === topicId);
  }

  nodeHasAnyValue(topicId: string, nodeId: string): boolean {
    const topic = this.topicById(topicId);
    const located = topic ? findNodeAndParent(topic.children, nodeId) : null;
    if (!located) {
      return false;
    }
    const onlyLeaf = findOnlyLeafInChain(located.node);
    return onlyLeaf !== null && Object.values(onlyLeaf.values).some((raw) => raw.trim().length > 0);
  }

  canOfferKeepDataOnDelete(topicId: string, nodeId: string): boolean {
    const topic = this.topicById(topicId);
    const located = topic ? findNodeAndParent(topic.children, nodeId) : null;
    if (located?.parent?.children.length !== 1) {
      return false;
    }
    const onlyLeaf = findOnlyLeafInChain(located.node);
    return onlyLeaf !== null && Object.values(onlyLeaf.values).some((raw) => raw.trim().length > 0);
  }

  nodeIsBranch(topicId: string, nodeId: string): boolean {
    const topic = this.topicById(topicId);
    const located = topic ? findNodeAndParent(topic.children, nodeId) : null;
    return located !== null && located.node.children.length > 0;
  }

  private findTopic(document: DocumentV2, topicId: string): TopicCardV2 | undefined {
    return document.cards.find((card) => card.id === topicId);
  }
}

// ---------------------------------------------------------------------------
// Pure helpers
// ---------------------------------------------------------------------------

function findOnlyLeafInChain(node: NodeV2): NodeV2 | null {
  let current = node;
  while (current.children.length === 1) {
    const next = current.children[0];
    if (!next) {
      break;
    }
    current = next;
  }
  return current.children.length === 0 ? current : null;
}

/**
 * Node ids whose own content (display name, accent, values, child id list)
 * differs between two Documents, plus ids present in only one of them.
 * Card-level changes (title, columns) intentionally do not trigger reveals.
 */
export function diffChangedNodeIds(before: DocumentV2, after: DocumentV2): Set<string> {
  const fingerprint = (document: DocumentV2): Map<string, string> => {
    const prints = new Map<string, string>();
    for (const card of document.cards) {
      walkNodes(card.children, (node) => {
        prints.set(
          node.id,
          JSON.stringify([
            node.displayName,
            node.accent,
            node.values,
            node.children.map((child) => child.id),
          ]),
        );
      });
    }
    return prints;
  };

  const beforePrints = fingerprint(before);
  const afterPrints = fingerprint(after);
  const changed = new Set<string>();

  for (const [id, print] of beforePrints) {
    if (afterPrints.get(id) !== print) {
      changed.add(id);
    }
  }
  for (const id of afterPrints.keys()) {
    if (!beforePrints.has(id)) {
      changed.add(id);
    }
  }
  return changed;
}
