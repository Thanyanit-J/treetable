import { Injectable, computed, effect, inject, signal } from '@angular/core';
import {
  CellData,
  DEFAULT_TOPIC_COLUMNS,
  ImportResult,
  TableColumn,
  TreeNode,
  TreeTableState,
  TreeTableStateV1,
  TreeTopic,
  cloneState,
  createCellData,
  createEmptyCells,
  isValidColumnId,
  makeNodeId,
  slugToColumnId,
} from '../models/tree-table.model';
import { collectLeaves, findNodeAndParent, nodeExists, updateLeafCells, walkNodes } from '../utils/tree-helpers';
import { FormulaEngineService } from './formula-engine.service';
import { PersistenceService } from './persistence.service';

@Injectable({ providedIn: 'root' })
export class TreeTableStoreService {
  private readonly persistence = inject(PersistenceService);
  private readonly formulaEngine = inject(FormulaEngineService);

  private readonly stateSignal = signal<TreeTableStateV1>(this.recalculate(this.persistence.load()));
  private readonly past = signal<TreeTableStateV1[]>([]);
  private readonly future = signal<TreeTableStateV1[]>([]);

  readonly state = this.stateSignal.asReadonly();
  readonly title = computed(() => this.stateSignal().title);
  readonly topics = computed(() => this.stateSignal().topics);
  readonly selectedNodeId = computed(() => this.stateSignal().selectedNodeId);
  readonly canUndo = computed(() => this.past().length > 0);
  readonly canRedo = computed(() => this.future().length > 0);

  private saveTimer: ReturnType<typeof setTimeout> | null = null;

  constructor() {
    effect(() => {
      const snapshot = this.stateSignal();
      if (this.saveTimer) {
        clearTimeout(this.saveTimer);
      }
      this.saveTimer = setTimeout(() => {
        this.persistence.save(snapshot);
      }, 150);
    });
  }

  addTopic(label = 'New Topic'): void {
    this.mutate((state) => {
      const topicId = makeNodeId('topic');
      const columns = this.defaultTopicColumns();
      const nodeId = makeNodeId('node');
      const newTopic: TreeTopic = {
        id: topicId,
        label,
        columns,
        children: [
          {
            id: nodeId,
            topicId,
            label: 'New Node',
            children: [],
            cells: this.buildNewLeafCells(columns, []),
          },
        ],
      };
      state.topics.push(newTopic);
      state.selectedNodeId = nodeId;
    });
  }

  removeTopic(topicId: string): void {
    this.mutate((state) => {
      state.topics = state.topics.filter((topic) => topic.id !== topicId);
      const selectedId = state.selectedNodeId;
      if (!selectedId) {
        return;
      }
      const selectedStillExists = state.topics.some(
        (topic) => topic.id === selectedId || nodeExists(topic.children, selectedId),
      );
      if (!selectedStillExists) {
        state.selectedNodeId = null;
      }
    });
  }

  addChildNode(topicId: string, parentNodeId: string | null, label = 'New Node'): void {
    this.mutate((state) => {
      const topic = state.topics.find((currentTopic) => currentTopic.id === topicId);
      if (!topic) {
        return;
      }
      const newNodeId = makeNodeId('node');

      if (!parentNodeId) {
        const leaves = collectLeaves(topic.children);
        const newNode: TreeNode = {
          id: newNodeId,
          topicId,
          label,
          children: [],
          cells: this.buildNewLeafCells(topic.columns, leaves),
        };
        topic.children.push(newNode);
        state.selectedNodeId = newNodeId;
        return;
      }

      const parentResult = findNodeAndParent(topic.children, parentNodeId);
      const parentNode = parentResult?.node;
      if (!parentNode) {
        return;
      }

      if (parentNode.children.length === 0) {
        const child: TreeNode = {
          id: newNodeId,
          topicId,
          label,
          children: [],
          cells: structuredClone(parentNode.cells),
        };
        parentNode.children = [child];
        parentNode.cells = createEmptyCells(topic.columns);
        state.selectedNodeId = newNodeId;
        return;
      }

      const leaves = collectLeaves(topic.children);
      const newNode: TreeNode = {
        id: newNodeId,
        topicId,
        label,
        children: [],
        cells: this.buildNewLeafCells(topic.columns, leaves),
      };
      parentNode.children.push(newNode);
      state.selectedNodeId = newNodeId;
    });
  }

  addSiblingNode(topicId: string, nodeId: string, label = 'New Node'): void {
    this.mutate((state) => {
      const topic = state.topics.find((currentTopic) => currentTopic.id === topicId);
      if (!topic) {
        return;
      }

      const located = findNodeAndParent(topic.children, nodeId);
      if (!located) {
        return;
      }

      const siblings = located.parent ? located.parent.children : topic.children;
      const leaves = collectLeaves(topic.children);
      const newNodeId = makeNodeId('node');
      const newNode: TreeNode = {
        id: newNodeId,
        topicId,
        label,
        children: [],
        cells: this.buildNewLeafCells(topic.columns, leaves),
      };

      siblings.splice(located.index + 1, 0, newNode);
      state.selectedNodeId = newNodeId;
    });
  }

  removeNode(topicId: string, nodeId: string, options?: { inheritLeafValue?: boolean }): void {
    this.mutate((state) => {
      const topic = state.topics.find((currentTopic) => currentTopic.id === topicId);
      if (!topic) {
        return;
      }

      const located = findNodeAndParent(topic.children, nodeId);
      if (!located) {
        return;
      }

      let inheritedCells: Record<string, CellData> | null = null;
      if (options?.inheritLeafValue && located.parent?.children.length === 1) {
        const onlyLeaf = this.findOnlyLeafInChain(located.node);
        if (onlyLeaf && this.hasAnyRawValue(onlyLeaf.cells)) {
          inheritedCells = structuredClone(onlyLeaf.cells);
        }
      }

      const siblings = located.parent ? located.parent.children : topic.children;
      siblings.splice(located.index, 1);

      if (located.parent?.children.length === 0) {
        if (inheritedCells) {
          located.parent.cells = inheritedCells;
        } else {
          const leaves = collectLeaves(topic.children);
          located.parent.cells = this.buildNewLeafCells(topic.columns, leaves);
        }
      }

      const selectedId = state.selectedNodeId;
      if (!selectedId) {
        return;
      }

      const selectedStillExists = state.topics.some(
        (currentTopic) => currentTopic.id === selectedId || nodeExists(currentTopic.children, selectedId),
      );
      if (!selectedStillExists) {
        state.selectedNodeId = null;
      }
    });
  }

  renameNode(nodeId: string, label: string): void {
    this.mutate((state) => {
      for (const topic of state.topics) {
        if (topic.id === nodeId) {
          topic.label = label;
          return;
        }
        const found = this.findNodeById(topic.children, nodeId);
        if (found) {
          found.label = label;
          return;
        }
      }
    });
  }

  setTitle(title: string): void {
    this.mutate((state) => {
      const nextTitle = title.trim() || 'Untitled';
      state.title = nextTitle;
    });
  }

  selectNode(nodeId: string | null): void {
    this.mutate(
      (state) => {
        state.selectedNodeId = nodeId;
      },
      false,
    );
  }

  moveTopicCard(topicId: string, toIndex: number): void {
    this.mutate((state) => {
      const fromIndex = state.topics.findIndex((topic) => topic.id === topicId);
      if (fromIndex < 0 || toIndex < 0 || toIndex >= state.topics.length) {
        return;
      }
      const [topic] = state.topics.splice(fromIndex, 1);
      if (!topic) {
        return;
      }
      state.topics.splice(toIndex, 0, topic);
    });
  }

  moveNode(topicId: string, parentNodeId: string | null, nodeId: string, toIndex: number): void {
    this.mutate((state) => {
      const topic = state.topics.find((candidate) => candidate.id === topicId);
      if (!topic) {
        return;
      }

      const parentNode = parentNodeId ? findNodeAndParent(topic.children, parentNodeId)?.node ?? null : null;
      if (parentNodeId && !parentNode) {
        return;
      }

      const siblings = parentNode ? parentNode.children : topic.children;
      const fromIndex = siblings.findIndex((child) => child.id === nodeId);
      if (fromIndex < 0 || toIndex < 0 || toIndex >= siblings.length) {
        return;
      }
      const [child] = siblings.splice(fromIndex, 1);
      if (!child) {
        return;
      }
      siblings.splice(toIndex, 0, child);
    });
  }

  setCellRaw(topicId: string, nodeId: string, columnId: string, raw: string): void {
    this.mutate((state) => {
      const topic = state.topics.find((candidate) => candidate.id === topicId);
      if (!topic) {
        return;
      }

      const located = findNodeAndParent(topic.children, nodeId);
      const targetNode = located?.node;
      if (!targetNode || targetNode.children.length > 0) {
        return;
      }

      const prevRaw = targetNode.cells[columnId]?.raw ?? '';
      const nextIsFormula = raw.trim().startsWith('=');
      const wasFormula = prevRaw.trim().startsWith('=');
      if (nextIsFormula || wasFormula) {
        const leaves = collectLeaves(topic.children);
        for (const leaf of leaves) {
          leaf.cells[columnId] = this.withRaw(leaf.cells[columnId], raw);
        }
        return;
      }

      targetNode.cells[columnId] = this.withRaw(targetNode.cells[columnId], raw);
    });
  }

  insertColumn(topicId: string, referenceColumnId: string, side: 'left' | 'right'): void {
    this.mutate((state) => {
      const topic = state.topics.find((candidate) => candidate.id === topicId);
      if (!topic) {
        return;
      }

      const refIndex = topic.columns.findIndex((column) => column.id === referenceColumnId);
      if (refIndex < 0) {
        return;
      }

      const column = this.buildUniqueColumn(topic.columns, 'New Column', 'number');
      const insertionIndex = side === 'left' ? refIndex : refIndex + 1;
      topic.columns.splice(insertionIndex, 0, column);

      walkNodes(topic.children, (node) => {
        node.cells[column.id] = createCellData('');
      });
    });
  }

  renameColumn(topicId: string, columnId: string, name: string): void {
    this.mutate((state) => {
      const topic = state.topics.find((candidate) => candidate.id === topicId);
      if (!topic) {
        return;
      }

      const columnIndex = topic.columns.findIndex((currentColumn) => currentColumn.id === columnId);
      const column = columnIndex >= 0 ? topic.columns[columnIndex] : undefined;
      if (!column) {
        return;
      }

      const nextName = name.trim() || column.name;
      const nextId = this.buildUniqueColumnId(
        topic.columns.filter((candidate) => candidate.id !== columnId),
        nextName,
      );
      const oldId = column.id;
      column.name = nextName;
      column.id = nextId;

      if (oldId !== nextId) {
        this.renameColumnReferences(topic, oldId, nextId);
      }
    });
  }

  deleteColumn(topicId: string, columnId: string): ImportResult | void {
    const topic = this.topics().find((candidate) => candidate.id === topicId);
    if (!topic) {
      return { ok: false, error: 'Topic not found.' };
    }

    if (topic.columns.length <= 1) {
      return { ok: false, error: 'At least one column is required.' };
    }

    this.mutate((state) => {
      const mutableTopic = state.topics.find((candidate) => candidate.id === topicId);
      if (!mutableTopic) {
        return;
      }
      mutableTopic.columns = mutableTopic.columns.filter((column) => column.id !== columnId);
      walkNodes(mutableTopic.children, (node) => {
        delete node.cells[columnId];
      });
    });

    return undefined;
  }

  setColumnSummary(topicId: string, columnId: string, mode: 'none' | 'sum'): void {
    this.mutate((state) => {
      const topic = state.topics.find((candidate) => candidate.id === topicId);
      if (!topic) {
        return;
      }

      const column = topic.columns.find((candidate) => candidate.id === columnId);
      if (!column) {
        return;
      }

      column.summaryMode = mode;
    });
  }

  importState(json: string): ImportResult {
    const imported = this.persistence.import(json);
    if (!imported.result.ok || !imported.state) {
      return imported.result;
    }

    this.pushHistory();
    this.future.set([]);
    this.stateSignal.set(this.recalculate(cloneState(imported.state)));
    return imported.result;
  }

  exportState(): string {
    return this.persistence.export(this.stateSignal());
  }

  undo(): void {
    const stack = this.past();
    if (stack.length === 0) {
      return;
    }

    const previous = stack.at(-1);
    if (!previous) {
      return;
    }
    this.past.set(stack.slice(0, -1));
    this.future.set([...this.future(), cloneState(this.stateSignal())]);
    this.stateSignal.set(cloneState(previous));
  }

  redo(): void {
    const stack = this.future();
    if (stack.length === 0) {
      return;
    }

    const next = stack.at(-1);
    if (!next) {
      return;
    }
    this.future.set(stack.slice(0, -1));
    this.past.set([...this.past(), cloneState(this.stateSignal())]);
    this.stateSignal.set(cloneState(next));
  }

  private mutate(mutator: (state: TreeTableStateV1) => void, withHistory = true): void {
    if (withHistory) {
      this.pushHistory();
      this.future.set([]);
    }

    const next = cloneState(this.stateSignal());
    mutator(next);
    this.stateSignal.set(this.recalculate(next));
  }

  private pushHistory(): void {
    this.past.set([...this.past(), cloneState(this.stateSignal())]);
  }

  private recalculate(state: TreeTableState): TreeTableStateV1 {
    const next = cloneState(state);

    if (!next.title || next.title.trim().length === 0) {
      next.title = 'Untitled';
    }

    for (const topic of next.topics) {
      if (!Array.isArray(topic.columns) || topic.columns.length === 0) {
        topic.columns = this.defaultTopicColumns();
      }
      if (!Array.isArray(topic.children)) {
        topic.children = [];
      }

      this.normalizeTopicColumns(topic);

      walkNodes(topic.children, (node) => {
        node.topicId = topic.id;
        if (!Array.isArray(node.children)) {
          node.children = [];
        }
        if (!node.cells || typeof node.cells !== 'object') {
          node.cells = {};
        }
        for (const column of topic.columns) {
          if (!node.cells[column.id]) {
            node.cells[column.id] = createCellData('');
          }
        }
      });

      const leaves = collectLeaves(topic.children);
      const evaluatedLeaves = this.formulaEngine.evaluateTopicRows(topic.columns, leaves);
      const evaluatedMap = new Map(evaluatedLeaves.map((leaf) => [leaf.id, leaf.cells]));
      updateLeafCells(topic.children, evaluatedMap);
    }

    return next;
  }

  private normalizeTopicColumns(topic: TreeTopic): void {
    const seen = new Set<string>();
    const replacements = new Map<string, string>();

    topic.columns = topic.columns.map((column, index) =>
      this.normalizeTopicColumn(column, index, seen, replacements),
    );
    this.applyTopicColumnReplacements(topic.children, replacements);
  }

  private normalizeTopicColumn(
    column: TableColumn,
    index: number,
    seen: Set<string>,
    replacements: Map<string, string>,
  ): TableColumn {
    const nextName = column.name.trim() || `Column ${index + 1}`;
    const baseId = isValidColumnId(column.id) ? column.id : slugToColumnId(nextName);
    const nextId = this.ensureUniqueColumnId(baseId, seen);

    if (column.id !== nextId) {
      replacements.set(column.id, nextId);
    }

    return {
      id: nextId,
      name: nextName,
      type: column.type === 'text' ? 'text' : 'number',
      summaryMode: column.summaryMode === 'sum' ? 'sum' : 'none',
    };
  }

  private ensureUniqueColumnId(baseId: string, seen: Set<string>): string {
    let nextId = baseId;
    let suffix = 2;
    while (seen.has(nextId)) {
      nextId = `${baseId}_${suffix}`;
      suffix += 1;
    }
    seen.add(nextId);
    return nextId;
  }

  private applyTopicColumnReplacements(children: TreeNode[], replacements: ReadonlyMap<string, string>): void {
    if (replacements.size === 0) {
      return;
    }

    walkNodes(children, (node) => {
      this.renameChildCellKeys(node, replacements);
      this.rewriteChildFormulaReferences(node, replacements);
    });
  }

  private renameChildCellKeys(child: TreeNode, replacements: ReadonlyMap<string, string>): void {
    for (const [oldId, newId] of replacements.entries()) {
      const oldCell = child.cells[oldId];
      if (oldCell) {
        child.cells[newId] = oldCell;
        delete child.cells[oldId];
      }
    }
  }

  private rewriteChildFormulaReferences(child: TreeNode, replacements: ReadonlyMap<string, string>): void {
    for (const cell of Object.values(child.cells)) {
      if (!cell.raw.trim().startsWith('=')) {
        continue;
      }

      for (const [oldId, newId] of replacements.entries()) {
        cell.raw = this.replaceFormulaToken(cell.raw, oldId, newId);
      }
    }
  }

  private withRaw(existing: CellData | undefined, raw: string): CellData {
    return {
      raw,
      value: existing?.value ?? null,
      error: existing?.error ?? null,
    };
  }

  private buildNewLeafCells(columns: TableColumn[], existingLeaves: TreeNode[]): Record<string, CellData> {
    const cells = createEmptyCells(columns);
    for (const column of columns) {
      const formulaRaw = this.findColumnFormulaRaw(existingLeaves, column.id);
      if (formulaRaw !== null) {
        cells[column.id] = createCellData(formulaRaw);
      }
    }
    return cells;
  }

  private findColumnFormulaRaw(leaves: TreeNode[], columnId: string): string | null {
    for (const leaf of leaves) {
      const raw = leaf.cells[columnId]?.raw ?? '';
      if (raw.trim().startsWith('=')) {
        return raw;
      }
    }
    return null;
  }

  private buildUniqueColumn(
    existingColumns: TableColumn[],
    name: string,
    type: 'number' | 'text',
  ): TableColumn {
    return {
      id: this.buildUniqueColumnId(existingColumns, name),
      name: name.trim() || 'New Column',
      type,
      summaryMode: 'none',
    };
  }

  private buildUniqueColumnId(existingColumns: TableColumn[], name: string): string {
    const base = slugToColumnId(name);
    let candidate = base;
    let suffix = 2;
    const existing = new Set(existingColumns.map((column) => column.id));

    while (!isValidColumnId(candidate) || existing.has(candidate)) {
      candidate = `${base}_${suffix}`;
      suffix += 1;
    }

    return candidate;
  }

  private renameColumnReferences(topic: TreeTopic, oldId: string, newId: string): void {
    walkNodes(topic.children, (node) => {
      const oldCell = node.cells[oldId];
      if (oldCell) {
        node.cells[newId] = oldCell;
        delete node.cells[oldId];
      } else if (!node.cells[newId]) {
        node.cells[newId] = createCellData('');
      }

      for (const cell of Object.values(node.cells)) {
        if (!cell.raw.trim().startsWith('=')) {
          continue;
        }
        cell.raw = this.replaceFormulaToken(cell.raw, oldId, newId);
      }
    });
  }

  private findNodeById(nodes: TreeNode[], nodeId: string): TreeNode | null {
    for (const node of nodes) {
      if (node.id === nodeId) {
        return node;
      }
      const found = this.findNodeById(node.children, nodeId);
      if (found) {
        return found;
      }
    }
    return null;
  }

  private findOnlyLeafInChain(node: TreeNode): TreeNode | null {
    let current: TreeNode = node;
    while (current.children.length === 1) {
      const next = current.children[0];
      if (!next) {
        break;
      }
      current = next;
    }

    if (current.children.length > 0) {
      return null;
    }

    return current;
  }

  private hasAnyRawValue(cells: Record<string, CellData>): boolean {
    return Object.values(cells).some((cell) => cell.raw.trim().length > 0);
  }

  private replaceFormulaToken(formula: string, oldId: string, newId: string): string {
    const escapedOldId = oldId.replaceAll(/[.*+?^${}()|[\]\\]/g, String.raw`\$&`);
    const pattern = new RegExp(String.raw`(?<![\w$])${escapedOldId}(?!\w)`, 'g');
    return formula.replaceAll(pattern, newId);
  }

  private defaultTopicColumns(): TableColumn[] {
    return structuredClone(DEFAULT_TOPIC_COLUMNS);
  }
}
