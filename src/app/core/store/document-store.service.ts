import { Injectable, computed, effect, inject, signal } from '@angular/core';
import { TopicEvaluation, evaluateTopic } from '../engine/formula-evaluator';
import {
  AccentColor,
  DocumentV2,
  ImportResult,
  NodeV2,
  TopicCardV2,
  cloneDocument,
  createInputColumn,
  createNode,
  findNodeAndParent,
  isLeaf,
  makeId,
  walkNodes,
} from '../model/document.model';
import { slugifyColumnRefName, slugifyEntityRefName, uniqueRefName } from '../model/ref-name';
import { PersistenceService } from '../persistence/persistence.service';

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
  private readonly selectedNodeIdSignal = signal<string | null>(null);
  private readonly pastSignal = signal<DocumentV2[]>([]);
  private readonly futureSignal = signal<DocumentV2[]>([]);

  readonly document;
  readonly title;
  readonly cards;
  readonly selectedNodeId = this.selectedNodeIdSignal.asReadonly();
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
    this.evaluations = computed(() => {
      const result = new Map<string, TopicEvaluation>();
      for (const card of this.documentSignal().cards) {
        result.set(card.id, evaluateTopic(card));
      }
      return result;
    });

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

  selectNode(nodeId: string | null): void {
    this.selectedNodeIdSignal.set(nodeId);
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

    const selected = this.selectedNodeIdSignal();
    if (selected && !nodeIds.has(selected)) {
      this.selectedNodeIdSignal.set(null);
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
      document.cards.push(card);
    });
    this.selectedNodeIdSignal.set(newNodeId);
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
      const node = createNode(displayName, this.nextNodeRefName(topic, displayName));

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
      this.selectedNodeIdSignal.set(newNodeId);
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
      const node = createNode(displayName, this.nextNodeRefName(topic, displayName));
      const siblings = located.parent ? located.parent.children : topic.children;
      siblings.splice(located.index + 1, 0, node);
      newNodeId = node.id;
    });
    if (newNodeId) {
      this.selectedNodeIdSignal.set(newNodeId);
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
   * converts the column back to input, preserving previously stored values.
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
      if (column) {
        column.rollup = rollup;
      }
    });
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

  private nextNodeRefName(topic: TopicCardV2, displayName: string): string {
    const taken = new Set<string>();
    walkNodes(topic.children, (node) => taken.add(node.refName));
    return uniqueRefName(slugifyEntityRefName(displayName), taken);
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
