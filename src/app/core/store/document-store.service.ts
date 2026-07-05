import { Injectable, computed, effect, inject, signal } from '@angular/core';
import { parseExpressionSource, printExpression, transformRefPaths } from '../engine/formula-ast';
import {
  evaluateDocument,
  formatNumericValue,
  resolveRefBindings,
  rollupValue,
} from '../engine/formula-evaluator';
import { computeTopicLattice, hiddenLeavesOf } from '../lattice/lattice-layout';
import {
  AccentColor,
  CardV2,
  ChartCardV2,
  ChartConfigV2,
  ChartType,
  ColumnV2,
  ConnectorStyle,
  DocumentV2,
  DocumentViewState,
  ImportResult,
  NodeV2,
  NoteFormat,
  PageV2,
  PillAlignment,
  RollupMode,
  TopicCardV2,
  cloneDocument,
  collectLeaves,
  createInputColumn,
  createNode,
  createPage,
  ensureCanHostChildren,
  findNodeAndParent,
  isLeaf,
  makeId,
  isTopicCard,
  moveNodeInTopic,
  nextNodeRefName,
  nodeExists,
  normalizeDocumentLayout,
  removeCardFromLayout,
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

/** One click selects; the Details panel edits the selection (CONTEXT.md). */
export type SelectionV2 =
  | { kind: 'card'; topicId: string }
  | { kind: 'node'; topicId: string; nodeId: string }
  | { kind: 'column'; topicId: string; columnId: string }
  | { kind: 'cell'; topicId: string; nodeId: string; columnId: string }
  | { kind: 'range'; topicId: string; anchor: CellRef; focus: CellRef }
  /** topicId is the OWNING card (Topic card or Chart Card). */
  | { kind: 'chart'; topicId: string; chartId: string };

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
  private readonly activePageIdSignal;
  private readonly selectionSignal = signal<SelectionV2 | null>(null);
  private readonly clipboardSignal = signal<ClipboardContent | null>(null);
  private readonly formulaEditorSignal = signal<FormulaEditorSession | null>(null);
  private readonly pastSignal = signal<DocumentV2[]>([]);
  private readonly futureSignal = signal<DocumentV2[]>([]);

  readonly document;
  readonly title;
  readonly cards;
  readonly pages;
  readonly activePage;
  readonly activeStacks;
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
    normalizeDocumentLayout(document);
    this.documentSignal = signal<DocumentV2>(document);
    this.collapsedSignal = signal<ReadonlySet<string>>(new Set(view?.collapsedNodeIds ?? []));
    this.activePageIdSignal = signal<string | null>(view?.activePageId ?? null);

    this.document = this.documentSignal.asReadonly();
    this.title = computed(() => this.documentSignal().title);
    this.cards = computed(() => this.documentSignal().cards);
    this.pages = computed(() => this.documentSignal().pages);
    this.activePage = computed<PageV2>(() => {
      const pages = this.documentSignal().pages;
      return pages.find((page) => page.id === this.activePageIdSignal()) ?? pages[0]!;
    });
    this.activeStacks = computed(() => {
      const byId = new Map(this.documentSignal().cards.map((card) => [card.id, card]));
      return this.activePage().stacks.map((stack) => ({
        id: stack.id,
        cards: stack.cardIds
          .map((id) => byId.get(id))
          .filter((card): card is CardV2 => card !== undefined),
      }));
    });
    this.collapsedNodeIds = this.collapsedSignal.asReadonly();
    this.evaluations = computed(() => evaluateDocument(this.documentSignal()).topics);

    effect(() => {
      const document = this.documentSignal();
      const collapsed = this.collapsedSignal();
      const activePageId = this.activePageIdSignal();
      if (this.saveTimer) {
        clearTimeout(this.saveTimer);
      }
      this.saveTimer = setTimeout(() => {
        const view: DocumentViewState = { collapsedNodeIds: [...collapsed] };
        if (activePageId !== null) {
          view.activePageId = activePageId;
        }
        this.persistence.save({ ...document, view });
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
      if (card.kind !== 'topic') {
        continue;
      }
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
    normalizeDocumentLayout(next);
    this.documentSignal.set(next);
    this.pruneViewState(next);
  }

  /** Drops collapse entries and selection pointing at Nodes that no longer exist. */
  private pruneViewState(document: DocumentV2): void {
    const nodeIds = new Set<string>();
    for (const card of document.cards) {
      if (card.kind === 'topic') {
        walkNodes(card.children, (node) => nodeIds.add(node.id));
      }
    }

    const collapsed = this.collapsedSignal();
    if ([...collapsed].some((id) => !nodeIds.has(id))) {
      this.collapsedSignal.set(new Set([...collapsed].filter((id) => nodeIds.has(id))));
    }

    const selection = this.selectionSignal();
    if (selection && !this.selectionStillExists(selection, document, nodeIds)) {
      this.selectionSignal.set(null);
    }

    const activePageId = this.activePageIdSignal();
    if (activePageId !== null && !document.pages.some((page) => page.id === activePageId)) {
      this.activePageIdSignal.set(document.pages[0]?.id ?? null);
    }
  }

  private selectionStillExists(
    selection: SelectionV2,
    document: DocumentV2,
    nodeIds: ReadonlySet<string>,
  ): boolean {
    const card = document.cards.find((candidate) => candidate.id === selection.topicId);
    if (!card) {
      return false;
    }
    if (selection.kind === 'card') {
      return true;
    }
    if (selection.kind === 'chart') {
      return (this.chartsOf(card) ?? []).some((chart) => chart.id === selection.chartId);
    }
    if (card.kind !== 'topic') {
      return false;
    }
    const topic = card;
    switch (selection.kind) {
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
      const takenRefs = new Set(document.cards.filter(isTopicCard).map((card) => card.refName));
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
      this.placeOnActivePage(document, card.id);
    });
    if (newTopicId && newNodeId) {
      this.selectionSignal.set({ kind: 'node', topicId: newTopicId, nodeId: newNodeId });
    }
  }

  removeCard(cardId: string): void {
    this.mutate((document) => {
      document.cards = document.cards.filter((card) => card.id !== cardId);
      removeCardFromLayout(document, cardId);
    });
  }

  /** A Table is a Tree-Table without the tree: hidden root, flat rows. */
  addTable(displayName = 'New Table'): void {
    let newCardId: string | null = null;
    this.mutate((document) => {
      const takenRefs = new Set(document.cards.filter(isTopicCard).map((card) => card.refName));
      const refName = uniqueRefName(slugifyEntityRefName(displayName), takenRefs);
      const card: TopicCardV2 = {
        kind: 'topic',
        id: makeId('topic'),
        refName,
        displayName,
        columns: [createInputColumn('A', '$A'), createInputColumn('B', '$B')],
        children: [createNode('Row 1', 'Row1'), createNode('Row 2', 'Row2')],
        showRoot: false,
      };
      newCardId = card.id;
      document.cards.push(card);
      this.placeOnActivePage(document, card.id);
    });
    if (newCardId) {
      this.selectionSignal.set({ kind: 'card', topicId: newCardId });
    }
  }

  addNote(): void {
    let newCardId: string | null = null;
    this.mutate((document) => {
      const card: CardV2 = { kind: 'note', id: makeId('note'), text: '' };
      newCardId = card.id;
      document.cards.push(card);
      this.placeOnActivePage(document, card.id);
    });
    if (newCardId) {
      this.selectionSignal.set({ kind: 'card', topicId: newCardId });
    }
  }

  setNoteText(cardId: string, text: string): void {
    const card = this.cardById(cardId);
    if (card?.kind !== 'note' || card.text === text) {
      return;
    }
    this.mutate((document) => {
      const draft = document.cards.find((candidate) => candidate.id === cardId);
      if (draft?.kind === 'note') {
        draft.text = text;
      }
    });
  }

  setNoteFormat(cardId: string, format: NoteFormat): void {
    const card = this.cardById(cardId);
    if (card?.kind !== 'note' || (card.format ?? 'text') === format) {
      return;
    }
    this.mutate((document) => {
      const draft = document.cards.find((candidate) => candidate.id === cardId);
      if (draft?.kind === 'note') {
        draft.format = format;
      }
    });
  }

  /** A Charts card visualizes another Topic's Leaves from anywhere. */
  addChartCard(sourceTopicId: string): void {
    const source = this.topicById(sourceTopicId);
    const defaultColumn = source?.columns.find((column) => column.kind !== 'chart');
    if (!source || !defaultColumn) {
      return;
    }
    let newCardId: string | null = null;
    this.mutate((document) => {
      const card: ChartCardV2 = {
        kind: 'chartcard',
        id: makeId('chartcard'),
        sourceTopicId,
        charts: [{ id: makeId('chart'), type: 'bar', columns: [defaultColumn.refName] }],
      };
      newCardId = card.id;
      document.cards.push(card);
      this.placeOnActivePage(document, card.id);
    });
    if (newCardId) {
      this.selectionSignal.set({ kind: 'card', topicId: newCardId });
    }
  }

  removeChartFromCard(cardId: string, chartId: string): void {
    this.mutate((document) => {
      const draft = document.cards.find((candidate) => candidate.id === cardId);
      if (draft?.kind === 'chartcard') {
        draft.charts = draft.charts.filter((chart) => chart.id !== chartId);
      }
    });
  }

  /** Places a freshly created card as its own stack on the active Page. */
  private placeOnActivePage(document: DocumentV2, cardId: string): void {
    const page =
      document.pages.find((candidate) => candidate.id === this.activePageIdSignal()) ??
      document.pages[0];
    page?.stacks.push({ id: makeId('stack'), cardIds: [cardId] });
  }

  // -------------------------------------------------------------------------
  // Pages (layout; the active Page is view state)
  // -------------------------------------------------------------------------

  selectPage(pageId: string): void {
    if (this.documentSignal().pages.some((page) => page.id === pageId)) {
      this.activePageIdSignal.set(pageId);
    }
  }

  addPage(): void {
    let newPageId: string | null = null;
    this.mutate((document) => {
      const page = createPage(`Page ${document.pages.length + 1}`);
      newPageId = page.id;
      document.pages.push(page);
    });
    if (newPageId) {
      this.activePageIdSignal.set(newPageId);
    }
  }

  renamePage(pageId: string, name: string): void {
    const next = name.trim();
    const page = this.documentSignal().pages.find((candidate) => candidate.id === pageId);
    if (next.length === 0 || !page || page.name === next) {
      return;
    }
    this.mutate((document) => {
      const draftPage = document.pages.find((candidate) => candidate.id === pageId);
      if (draftPage) {
        draftPage.name = next;
      }
    });
  }

  /** Deletes the Page AND every card on it (the UI confirms first). */
  removePage(pageId: string): void {
    const pages = this.documentSignal().pages;
    if (pages.length <= 1 || !pages.some((page) => page.id === pageId)) {
      return;
    }
    this.mutate((document) => {
      const page = document.pages.find((candidate) => candidate.id === pageId);
      if (!page) {
        return;
      }
      const doomed = new Set(page.stacks.flatMap((stack) => stack.cardIds));
      document.cards = document.cards.filter((card) => !doomed.has(card.id));
      document.pages = document.pages.filter((candidate) => candidate.id !== pageId);
    });
  }

  movePage(fromIndex: number, toIndex: number): void {
    const count = this.documentSignal().pages.length;
    if (
      fromIndex === toIndex ||
      fromIndex < 0 ||
      toIndex < 0 ||
      fromIndex >= count ||
      toIndex >= count
    ) {
      return;
    }
    this.mutate((document) => {
      const [page] = document.pages.splice(fromIndex, 1);
      if (page) {
        document.pages.splice(toIndex, 0, page);
      }
    });
  }

  /** Horizontal reorder of a Page's stacks (rail columns). */
  moveStack(pageId: string, fromIndex: number, toIndex: number): void {
    const page = this.documentSignal().pages.find((candidate) => candidate.id === pageId);
    if (
      !page ||
      fromIndex === toIndex ||
      fromIndex < 0 ||
      toIndex < 0 ||
      fromIndex >= page.stacks.length ||
      toIndex >= page.stacks.length
    ) {
      return;
    }
    this.mutate((document) => {
      const draftPage = document.pages.find((candidate) => candidate.id === pageId);
      if (!draftPage) {
        return;
      }
      const [stack] = draftPage.stacks.splice(fromIndex, 1);
      if (stack) {
        draftPage.stacks.splice(toIndex, 0, stack);
      }
    });
  }

  /** Moves a card into an existing stack at `targetIndex` (post-removal). */
  moveCardToStack(cardId: string, targetStackId: string, targetIndex: number): void {
    const document = this.documentSignal();
    if (!document.cards.some((card) => card.id === cardId)) {
      return;
    }
    let source: { stackId: string; index: number; size: number } | null = null;
    let targetExists = false;
    for (const page of document.pages) {
      for (const stack of page.stacks) {
        if (stack.id === targetStackId) {
          targetExists = true;
        }
        const index = stack.cardIds.indexOf(cardId);
        if (index >= 0) {
          source = { stackId: stack.id, index, size: stack.cardIds.length };
        }
      }
    }
    if (!targetExists) {
      return;
    }
    if (source && source.stackId === targetStackId) {
      const clamped = Math.max(0, Math.min(targetIndex, source.size - 1));
      if (clamped === source.index) {
        return; // Dropped back where it was — no history entry.
      }
    }

    this.mutate((draft) => {
      removeCardFromLayout(draft, cardId);
      for (const page of draft.pages) {
        const stack = page.stacks.find((candidate) => candidate.id === targetStackId);
        if (stack) {
          const index = Math.max(0, Math.min(targetIndex, stack.cardIds.length));
          stack.cardIds.splice(index, 0, cardId);
          return;
        }
      }
    });
  }

  /** Moves a card out into its own new stack at `stackIndex` on the Page. */
  moveCardToNewStack(cardId: string, pageId: string, stackIndex: number): void {
    const document = this.documentSignal();
    const page = document.pages.find((candidate) => candidate.id === pageId);
    if (!page || !document.cards.some((card) => card.id === cardId)) {
      return;
    }
    const sourceIndex = page.stacks.findIndex((stack) => stack.cardIds.includes(cardId));
    const sourceStack = page.stacks[sourceIndex];
    if (
      sourceStack &&
      sourceStack.cardIds.length === 1 &&
      (stackIndex === sourceIndex || stackIndex === sourceIndex + 1)
    ) {
      return; // A lone card dropped beside itself changes nothing.
    }

    this.mutate((draft) => {
      const draftPage = draft.pages.find((candidate) => candidate.id === pageId);
      if (!draftPage) {
        return;
      }
      const before = draftPage.stacks.findIndex((stack) => stack.cardIds.includes(cardId));
      const emptiesAway = before >= 0 && draftPage.stacks[before]!.cardIds.length === 1;
      removeCardFromLayout(draft, cardId);
      let index = stackIndex;
      if (emptiesAway && before < stackIndex) {
        index -= 1;
      }
      index = Math.max(0, Math.min(index, draftPage.stacks.length));
      draftPage.stacks.splice(index, 0, { id: makeId('stack'), cardIds: [cardId] });
    });
  }

  /** Charts live on Topic cards and Chart Cards alike. */
  chartsOf(card: CardV2): ChartConfigV2[] | undefined {
    if (card.kind === 'topic') {
      return card.charts;
    }
    if (card.kind === 'chartcard') {
      return card.charts;
    }
    return undefined;
  }

  setChartType(ownerCardId: string, chartId: string, type: ChartType): void {
    const owner = this.cardById(ownerCardId);
    const chart = owner ? this.chartsOf(owner)?.find((c) => c.id === chartId) : undefined;
    if (!chart || chart.type === type) {
      return;
    }
    this.mutate((document) => {
      const draftOwner = document.cards.find((candidate) => candidate.id === ownerCardId);
      const draftChart = draftOwner
        ? this.chartsOf(draftOwner)?.find((candidate) => candidate.id === chartId)
        : undefined;
      if (draftChart) {
        draftChart.type = type;
      }
    });
  }

  /**
   * Includes or excludes a batch of source columns as ONE undo step.
   * Additions append in the source table's order; a chart keeps at least
   * one source.
   */
  setChartColumnsIncluded(
    ownerCardId: string,
    chartId: string,
    refNames: readonly string[],
    included: boolean,
  ): void {
    const owner = this.cardById(ownerCardId);
    const chart = owner ? this.chartsOf(owner)?.find((c) => c.id === chartId) : undefined;
    if (!owner || !chart) {
      return;
    }
    const source =
      owner.kind === 'topic'
        ? owner
        : owner.kind === 'chartcard'
          ? this.topicById(owner.sourceTopicId)
          : undefined;
    const targets = new Set(refNames);
    let next: string[];
    if (included) {
      const order = new Map(
        (source?.columns ?? []).map((column, index) => [column.refName, index]),
      );
      const valid = new Set(
        (source?.columns ?? [])
          .filter((column) => column.kind !== 'chart')
          .map((column) => column.refName),
      );
      const additions = [...targets]
        .filter((ref) => valid.has(ref) && !chart.columns.includes(ref))
        .sort((a, b) => (order.get(a) ?? 0) - (order.get(b) ?? 0));
      if (additions.length === 0) {
        return;
      }
      next = [...chart.columns, ...additions];
    } else {
      next = chart.columns.filter((ref) => !targets.has(ref));
      if (next.length === chart.columns.length || next.length === 0) {
        return;
      }
    }
    this.mutate((document) => {
      const draftOwner = document.cards.find((candidate) => candidate.id === ownerCardId);
      const draftChart = draftOwner
        ? this.chartsOf(draftOwner)?.find((candidate) => candidate.id === chartId)
        : undefined;
      if (draftChart) {
        draftChart.columns = next;
      }
    });
  }

  renameChart(ownerCardId: string, chartId: string, name: string): void {
    const owner = this.cardById(ownerCardId);
    const chart = owner ? this.chartsOf(owner)?.find((c) => c.id === chartId) : undefined;
    const trimmed = name.trim();
    if (!chart || (chart.name ?? '') === trimmed) {
      return;
    }
    this.mutate((document) => {
      const draftOwner = document.cards.find((candidate) => candidate.id === ownerCardId);
      const draftChart = draftOwner
        ? this.chartsOf(draftOwner)?.find((candidate) => candidate.id === chartId)
        : undefined;
      if (!draftChart) {
        return;
      }
      if (trimmed.length === 0) {
        delete draftChart.name; // Back to the derived title.
      } else {
        draftChart.name = trimmed;
      }
    });
  }

  removeOwnedChart(ownerCardId: string, chartId: string): void {
    this.mutate((document) => {
      const draftOwner = document.cards.find((candidate) => candidate.id === ownerCardId);
      if (draftOwner?.kind === 'topic') {
        draftOwner.charts = (draftOwner.charts ?? []).filter((chart) => chart.id !== chartId);
      } else if (draftOwner?.kind === 'chartcard') {
        draftOwner.charts = draftOwner.charts.filter((chart) => chart.id !== chartId);
      }
    });
  }

  /** Reorders a chart's visible source columns (drag in the Details panel). */
  moveChartColumn(ownerCardId: string, chartId: string, fromIndex: number, toIndex: number): void {
    const owner = this.cardById(ownerCardId);
    const chart = owner ? this.chartsOf(owner)?.find((c) => c.id === chartId) : undefined;
    if (
      !chart ||
      fromIndex === toIndex ||
      fromIndex < 0 ||
      toIndex < 0 ||
      fromIndex >= chart.columns.length ||
      toIndex >= chart.columns.length
    ) {
      return;
    }
    this.mutate((document) => {
      const draftOwner = document.cards.find((candidate) => candidate.id === ownerCardId);
      const draftChart = draftOwner
        ? this.chartsOf(draftOwner)?.find((candidate) => candidate.id === chartId)
        : undefined;
      if (!draftChart) {
        return;
      }
      const [ref] = draftChart.columns.splice(fromIndex, 1);
      if (ref !== undefined) {
        draftChart.columns.splice(toIndex, 0, ref);
      }
    });
  }

  /** Number of cards living on a Page (for delete confirmations). */
  pageCardCount(pageId: string): number {
    const page = this.documentSignal().pages.find((candidate) => candidate.id === pageId);
    return page ? page.stacks.reduce((total, stack) => total + stack.cardIds.length, 0) : 0;
  }

  /** Sets the card title; empty (or equal to the Root's name) re-syncs it. */
  setCardTitle(topicId: string, title: string): void {
    const topic = this.topicById(topicId);
    if (!topic) {
      return;
    }
    const next = title.trim();
    const normalized = next.length === 0 || next === topic.displayName ? '' : next;
    if (normalized === (topic.cardTitle ?? '')) {
      return;
    }
    this.mutate((document) => {
      const draftTopic = this.findTopic(document, topicId);
      if (!draftTopic) {
        return;
      }
      if (normalized === '') {
        delete draftTopic.cardTitle;
      } else {
        draftTopic.cardTitle = normalized;
      }
    });
  }

  renameCard(cardId: string, displayName: string): void {
    const next = displayName.trim();
    const topic = this.topicById(cardId);
    if (next.length === 0 || !topic || topic.displayName === next) {
      return;
    }
    const target: RefNameTarget = { kind: 'topic', topicId: cardId, entityId: cardId };
    const taken = new Set(
      this.documentSignal()
        .cards.filter(isTopicCard)
        .filter((card) => card.id !== cardId)
        .map((card) => card.refName),
    );
    const plan = this.planSyncedRefRename(
      target,
      topic.customRefName,
      topic.refName,
      uniqueRefName(slugifyEntityRefName(next), taken),
    );
    this.mutate((document) => {
      const card = this.findTopic(document, cardId);
      if (!card) {
        return;
      }
      card.displayName = next;
      if (plan) {
        this.applyRefRename(document, card, target, plan);
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
    const topic = this.topicById(topicId);
    const located = topic ? findNodeAndParent(topic.children, nodeId) : null;
    if (next.length === 0 || !topic || !located || located.node.displayName === next) {
      return;
    }
    const target: RefNameTarget = { kind: 'node', topicId, entityId: nodeId };
    const taken = new Set<string>();
    walkNodes(topic.children, (node) => {
      if (node.id !== nodeId) {
        taken.add(node.refName);
      }
    });
    const plan = this.planSyncedRefRename(
      target,
      located.node.customRefName,
      located.node.refName,
      uniqueRefName(slugifyEntityRefName(next), taken),
    );
    this.mutate((document) => {
      const draftTopic = this.findTopic(document, topicId);
      const draftLocated = draftTopic ? findNodeAndParent(draftTopic.children, nodeId) : null;
      if (!draftTopic || !draftLocated) {
        return;
      }
      draftLocated.node.displayName = next;
      if (plan) {
        this.applyRefRename(document, draftTopic, target, plan);
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
    const topic = this.topicById(topicId);
    const column = topic?.columns.find((candidate) => candidate.id === columnId);
    if (next.length === 0 || !topic || !column || column.displayName === next) {
      return;
    }
    const target: RefNameTarget = { kind: 'column', topicId, entityId: columnId };
    const taken = new Set(
      topic.columns
        .filter((candidate) => candidate.id !== columnId)
        .map((candidate) => candidate.refName),
    );
    const plan = this.planSyncedRefRename(
      target,
      column.customRefName,
      column.refName,
      uniqueRefName(slugifyColumnRefName(next), taken),
    );
    this.mutate((document) => {
      const draftTopic = this.findTopic(document, topicId);
      const draftColumn = draftTopic?.columns.find((candidate) => candidate.id === columnId);
      if (!draftTopic || !draftColumn) {
        return;
      }
      draftColumn.displayName = next;
      if (plan) {
        this.applyRefRename(document, draftTopic, target, plan);
      }
    });
  }

  setColumnRollup(topicId: string, columnId: string, rollup: RollupMode): void {
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
    const columnIds = topic.columns
      .filter((column) => column.hidden !== true)
      .map((column) => column.id);
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

    const visibleColumns = topic.columns.filter((column) => column.hidden !== true);
    const rowIndexOf = (nodeId: string): number =>
      lattice.rows.findIndex((row) => row.nodeId === nodeId);
    const columnIndexOf = (columnId: string): number =>
      visibleColumns.findIndex((column) => column.id === columnId);

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
        const column = visibleColumns[c]!;
        if (row.kind !== 'leaf') {
          // Collapsed Rollup Row: the displayed summary copies, never edits.
          const branch = findNodeAndParent(topic.children, row.nodeId)?.node;
          let copyText = '';
          if (branch && evaluation && column.rollup !== 'none') {
            const total = rollupValue(column, hiddenLeavesOf(branch), evaluation);
            copyText = total === null ? '' : formatNumericValue(total);
          }
          gridRow.push({ nodeId: row.nodeId, columnId: column.id, copyText, editable: false });
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
    const visibleColumns = topic.columns.filter((column) => column.hidden !== true);
    const anchorRow = lattice.rows.findIndex((row) => row.nodeId === anchor.nodeId);
    const anchorColumn = visibleColumns.findIndex((column) => column.id === anchor.columnId);
    if (anchorRow < 0 || anchorColumn < 0) {
      return null;
    }

    return matrix.map((matrixRow, rowOffset) =>
      matrixRow.map((_, columnOffset) => {
        const row = lattice.rows[anchorRow + rowOffset];
        const column = visibleColumns[anchorColumn + columnOffset];
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
      this.syncChartColumnOrder(document, topicId);
    });
  }

  /**
   * Reordering table columns carries over to every chart fed by the Topic
   * (its own Chart Panel and any Chart Cards): bars/rings follow the table.
   * A manual reorder in a chart's Sources list survives until the next
   * table reorder re-syncs it.
   */
  private syncChartColumnOrder(document: DocumentV2, topicId: string): void {
    const topic = this.findTopic(document, topicId);
    if (!topic) {
      return;
    }
    const orderOf = new Map(topic.columns.map((column, index) => [column.refName, index]));
    const resort = (charts: ChartConfigV2[] | undefined): void => {
      for (const chart of charts ?? []) {
        chart.columns = [...chart.columns].sort(
          (a, b) =>
            (orderOf.get(a) ?? Number.MAX_SAFE_INTEGER) -
            (orderOf.get(b) ?? Number.MAX_SAFE_INTEGER),
        );
      }
    };
    resort(topic.charts);
    for (const card of document.cards) {
      if (card.kind === 'chartcard' && card.sourceTopicId === topicId) {
        resort(card.charts);
      }
    }
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

  /**
   * Hides columns from the table (data and formulas keep working) or shows
   * them again — a whole batch is ONE undo step. Refused if no visible
   * column would remain.
   */
  setColumnsHidden(topicId: string, columnIds: readonly string[], hidden: boolean): void {
    const topic = this.topicById(topicId);
    if (!topic) {
      return;
    }
    const targets = new Set(columnIds);
    const changing = new Set(
      topic.columns
        .filter((column) => targets.has(column.id) && (column.hidden ?? false) !== hidden)
        .map((column) => column.id),
    );
    if (changing.size === 0) {
      return;
    }
    if (hidden) {
      const visibleCount = topic.columns.filter((column) => column.hidden !== true).length;
      if (visibleCount - changing.size < 1) {
        return; // The table keeps at least one visible column.
      }
    }
    this.mutate((document) => {
      for (const column of this.findTopic(document, topicId)?.columns ?? []) {
        if (!changing.has(column.id)) {
          continue;
        }
        if (hidden) {
          column.hidden = true;
        } else {
          delete column.hidden;
        }
      }
    });
  }

  /**
   * Moves a column so it sits at `toVisibleIndex` among the VISIBLE columns
   * (hidden ones keep their relative spots in the full order).
   */
  moveVisibleColumn(topicId: string, columnId: string, toVisibleIndex: number): void {
    const topic = this.topicById(topicId);
    if (!topic) {
      return;
    }
    const columns = topic.columns;
    const fromFull = columns.findIndex((candidate) => candidate.id === columnId);
    if (fromFull < 0) {
      return;
    }
    const visibleOthers = columns.filter(
      (candidate) => candidate.hidden !== true && candidate.id !== columnId,
    );
    const anchor = visibleOthers[toVisibleIndex];
    let toFull = anchor
      ? columns.findIndex((candidate) => candidate.id === anchor.id)
      : columns.length;
    if (fromFull < toFull) {
      toFull -= 1;
    }
    this.moveColumn(topicId, columnId, toFull);
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

  setShowRoot(topicId: string, show: boolean): void {
    this.mutate((document) => {
      const topic = this.findTopic(document, topicId);
      if (!topic) {
        return;
      }
      if (show) {
        delete topic.showRoot;
      } else {
        topic.showRoot = false;
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
   * follows it from anywhere. `markCustom` records whether the Reference
   * Name is now hand-picked (true), auto-synced (false) or unchanged (null).
   */
  setRefName(
    target: RefNameTarget,
    nextRefNameRaw: string,
    markCustom: boolean | null = true,
  ): ImportResult {
    const nextRefName = nextRefNameRaw.trim();
    const document = this.documentSignal();
    const topic = this.findTopic(document, target.topicId);
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
    const flagChanges =
      markCustom !== null && (this.currentCustomFlag(topic, target) ?? false) !== markCustom;
    if (currentRefName === nextRefName && !flagChanges) {
      return { ok: true };
    }

    const plan =
      currentRefName === nextRefName
        ? null
        : {
            currentRefName,
            nextRefName,
            rewrites: this.planRefRewrites(document, target, nextRefName),
          };

    this.mutate((draft) => {
      const draftTopic = this.findTopic(draft, target.topicId);
      if (!draftTopic) {
        return;
      }
      if (plan) {
        this.applyRefRename(draft, draftTopic, target, plan);
      }
      if (markCustom !== null) {
        this.writeCustomFlag(draftTopic, target, markCustom);
      }
    });

    return { ok: true };
  }

  /**
   * Re-syncs a Reference Name to its Display Name (synced = true, rewriting
   * formulas as needed) or detaches it for manual editing (synced = false).
   */
  setRefNameSync(target: RefNameTarget, synced: boolean): ImportResult {
    const topic = this.topicById(target.topicId);
    if (!topic) {
      return { ok: false, error: 'Topic not found.' };
    }
    const currentRefName = this.currentRefNameOf(topic, target);
    if (currentRefName === null) {
      return { ok: false, error: 'Entity not found.' };
    }
    if (!synced) {
      return this.setRefName(target, currentRefName, true);
    }
    const derived = this.deriveRefName(topic, target) ?? currentRefName;
    return this.setRefName(target, derived, false);
  }

  /** The auto-derived (slugified, uniquified) Reference Name for an entity. */
  private deriveRefName(topic: TopicCardV2, target: RefNameTarget): string | null {
    if (target.kind === 'column') {
      const column = topic.columns.find((candidate) => candidate.id === target.entityId);
      if (!column) {
        return null;
      }
      const taken = new Set(
        topic.columns
          .filter((candidate) => candidate.id !== target.entityId)
          .map((candidate) => candidate.refName),
      );
      return uniqueRefName(slugifyColumnRefName(column.displayName), taken);
    }
    if (target.kind === 'topic') {
      const taken = new Set(
        this.documentSignal()
          .cards.filter(isTopicCard)
          .filter((card) => card.id !== target.entityId)
          .map((card) => card.refName),
      );
      return uniqueRefName(slugifyEntityRefName(topic.displayName), taken);
    }
    const located = findNodeAndParent(topic.children, target.entityId);
    if (!located) {
      return null;
    }
    const taken = new Set<string>();
    walkNodes(topic.children, (node) => {
      if (node.id !== target.entityId) {
        taken.add(node.refName);
      }
    });
    return uniqueRefName(slugifyEntityRefName(located.node.displayName), taken);
  }

  /** Plans formula rewrites against the pre-rename Document. */
  private planRefRewrites(
    document: DocumentV2,
    target: RefNameTarget,
    nextRefName: string,
  ): Map<string, string> {
    const expressionRewrites = new Map<string, string>();
    for (const card of document.cards) {
      if (card.kind !== 'topic') {
        continue;
      }
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
    return expressionRewrites;
  }

  /** Applies a planned rename to the draft: entity, formulas, chart bindings. */
  private applyRefRename(
    draft: DocumentV2,
    draftTopic: TopicCardV2,
    target: RefNameTarget,
    plan: { currentRefName: string; nextRefName: string; rewrites: Map<string, string> },
  ): void {
    if (target.kind === 'topic') {
      draftTopic.refName = plan.nextRefName;
    } else if (target.kind === 'column') {
      const column = draftTopic.columns.find((candidate) => candidate.id === target.entityId);
      if (column) {
        column.refName = plan.nextRefName;
      }
    } else {
      const located = findNodeAndParent(draftTopic.children, target.entityId);
      if (located) {
        located.node.refName = plan.nextRefName;
      }
    }

    for (const card of draft.cards) {
      if (card.kind !== 'topic') {
        continue;
      }
      for (const column of card.columns) {
        const rewritten = plan.rewrites.get(column.id);
        if (rewritten !== undefined) {
          column.expression = rewritten;
        }
      }
    }

    // Chart Columns and Chart Panel configs bind to columns by Reference Name too.
    if (target.kind === 'column') {
      for (const column of draftTopic.columns) {
        if (column.kind === 'chart' && column.chartSource === plan.currentRefName) {
          column.chartSource = plan.nextRefName;
        }
      }
      for (const chart of draftTopic.charts ?? []) {
        chart.columns = chart.columns.map((ref) =>
          ref === plan.currentRefName ? plan.nextRefName : ref,
        );
      }
      for (const card of draft.cards) {
        if (card.kind === 'chartcard' && card.sourceTopicId === target.topicId) {
          for (const chart of card.charts) {
            chart.columns = chart.columns.map((ref) =>
              ref === plan.currentRefName ? plan.nextRefName : ref,
            );
          }
        }
      }
    }
  }

  /**
   * Rename plan for a synced entity whose Display Name is changing: derive
   * the new Reference Name and the formula rewrites, or null when the name
   * is custom (detached) or the derivation lands on the current name.
   */
  private planSyncedRefRename(
    target: RefNameTarget,
    custom: boolean | undefined,
    currentRefName: string,
    derivedRefName: string,
  ): { currentRefName: string; nextRefName: string; rewrites: Map<string, string> } | null {
    if (custom || derivedRefName === currentRefName) {
      return null;
    }
    return {
      currentRefName,
      nextRefName: derivedRefName,
      rewrites: this.planRefRewrites(this.documentSignal(), target, derivedRefName),
    };
  }

  private currentCustomFlag(topic: TopicCardV2, target: RefNameTarget): boolean | undefined {
    if (target.kind === 'topic') {
      return topic.customRefName;
    }
    if (target.kind === 'column') {
      return topic.columns.find((candidate) => candidate.id === target.entityId)?.customRefName;
    }
    return findNodeAndParent(topic.children, target.entityId)?.node.customRefName;
  }

  private writeCustomFlag(draftTopic: TopicCardV2, target: RefNameTarget, custom: boolean): void {
    const write = (entity: { customRefName?: boolean } | undefined): void => {
      if (!entity) {
        return;
      }
      if (custom) {
        entity.customRefName = true;
      } else {
        delete entity.customRefName;
      }
    };
    if (target.kind === 'topic') {
      write(draftTopic);
    } else if (target.kind === 'column') {
      write(draftTopic.columns.find((candidate) => candidate.id === target.entityId));
    } else {
      write(findNodeAndParent(draftTopic.children, target.entityId)?.node);
    }
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
        (card) => isTopicCard(card) && card.id !== target.entityId && card.refName === nextRefName,
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
    const view: DocumentViewState = { collapsedNodeIds: [...this.collapsedSignal()] };
    const activePageId = this.activePageIdSignal();
    if (activePageId !== null) {
      view.activePageId = activePageId;
    }
    return this.persistence.export({ ...this.documentSignal(), view });
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
      current.pages = document.pages;
    });
    this.collapsedSignal.set(new Set(view?.collapsedNodeIds ?? []));
    this.activePageIdSignal.set(view?.activePageId ?? null);
    this.pruneViewState(this.documentSignal());
    return imported.result;
  }

  // -------------------------------------------------------------------------
  // Lookups
  // -------------------------------------------------------------------------

  topicById(topicId: string): TopicCardV2 | undefined {
    return this.findTopic(this.documentSignal(), topicId);
  }

  cardById(cardId: string): CardV2 | undefined {
    return this.documentSignal().cards.find((card) => card.id === cardId);
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
    return document.cards.find(
      (card): card is TopicCardV2 => isTopicCard(card) && card.id === topicId,
    );
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
      if (card.kind !== 'topic') {
        continue;
      }
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
