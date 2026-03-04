import { Injectable, computed, effect, inject, signal } from '@angular/core';
import {
  CellData,
  ColumnId,
  DEFAULT_TOPIC_COLUMNS,
  ImportResult,
  NodeId,
  TableColumn,
  TreeSubtopic,
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
      const subtopicId = makeNodeId('subtopic');
      const newTopic: TreeTopic = {
        id: topicId,
        label,
        columns,
        children: [
          {
            id: subtopicId,
            topicId,
            label: 'New Subtopic',
            cells: this.buildNewSubtopicCells(columns, []),
          },
        ],
      };
      state.topics.push(newTopic);
      state.selectedNodeId = subtopicId;
    });
  }

  removeTopic(topicId: NodeId): void {
    this.mutate((state) => {
      state.topics = state.topics.filter((topic) => topic.id !== topicId);
      if (state.selectedNodeId?.startsWith('topic_') || state.selectedNodeId?.startsWith('subtopic_')) {
        const selectedStillExists = state.topics.some(
          (topic) => topic.id === state.selectedNodeId || topic.children.some((child) => child.id === state.selectedNodeId),
        );
        if (!selectedStillExists) {
          state.selectedNodeId = null;
        }
      }
    });
  }

  addSubtopic(topicId: NodeId, label = 'New Subtopic'): void {
    this.mutate((state) => {
      const topic = state.topics.find((currentTopic) => currentTopic.id === topicId);
      if (!topic) {
        return;
      }
      const subtopicId = makeNodeId('subtopic');
      const newSubtopic: TreeSubtopic = {
        id: subtopicId,
        topicId,
        label,
        cells: this.buildNewSubtopicCells(topic.columns, topic.children),
      };
      topic.children.push(newSubtopic);
      state.selectedNodeId = subtopicId;
    });
  }

  removeSubtopic(topicId: NodeId, subtopicId: NodeId): void {
    this.mutate((state) => {
      const topic = state.topics.find((currentTopic) => currentTopic.id === topicId);
      if (!topic) {
        return;
      }
      topic.children = topic.children.filter((child) => child.id !== subtopicId);
      if (state.selectedNodeId === subtopicId) {
        state.selectedNodeId = null;
      }
    });
  }

  renameNode(nodeId: NodeId, label: string): void {
    this.mutate((state) => {
      for (const topic of state.topics) {
        if (topic.id === nodeId) {
          topic.label = label;
          return;
        }
        const child = topic.children.find((currentChild) => currentChild.id === nodeId);
        if (child) {
          child.label = label;
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

  selectNode(nodeId: NodeId | null): void {
    this.mutate(
      (state) => {
        state.selectedNodeId = nodeId;
      },
      false,
    );
  }

  moveTopicCard(topicId: NodeId, toIndex: number): void {
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

  moveSubtopic(topicId: NodeId, subtopicId: NodeId, toIndex: number): void {
    this.mutate((state) => {
      const topic = state.topics.find((candidate) => candidate.id === topicId);
      if (!topic) {
        return;
      }
      const fromIndex = topic.children.findIndex((child) => child.id === subtopicId);
      if (fromIndex < 0 || toIndex < 0 || toIndex >= topic.children.length) {
        return;
      }
      const [child] = topic.children.splice(fromIndex, 1);
      if (!child) {
        return;
      }
      topic.children.splice(toIndex, 0, child);
    });
  }

  setCellRaw(topicId: NodeId, nodeId: NodeId, columnId: ColumnId, raw: string): void {
    this.mutate((state) => {
      const topic = state.topics.find((candidate) => candidate.id === topicId);
      if (!topic) {
        return;
      }

      const targetChild = topic.children.find((candidate) => candidate.id === nodeId);
      if (!targetChild) {
        return;
      }

      const prevRaw = targetChild.cells[columnId]?.raw ?? '';
      const nextIsFormula = raw.trim().startsWith('=');
      const wasFormula = prevRaw.trim().startsWith('=');
      if (nextIsFormula || wasFormula) {
        for (const child of topic.children) {
          child.cells[columnId] = this.withRaw(child.cells[columnId], raw);
        }
        return;
      }

      targetChild.cells[columnId] = this.withRaw(targetChild.cells[columnId], raw);
    });
  }

  insertColumn(topicId: NodeId, referenceColumnId: ColumnId, side: 'left' | 'right'): void {
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

      for (const child of topic.children) {
        child.cells[column.id] = createCellData('');
      }
    });
  }

  renameColumn(topicId: NodeId, columnId: ColumnId, name: string): void {
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

  deleteColumn(topicId: NodeId, columnId: ColumnId): ImportResult | void {
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
      for (const child of mutableTopic.children) {
        delete child.cells[columnId];
      }
    });

    return undefined;
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

    const next = stack[stack.length - 1];
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

      this.normalizeTopicColumns(topic);

      for (const child of topic.children) {
        child.topicId = topic.id;
        for (const column of topic.columns) {
          if (!child.cells[column.id]) {
            child.cells[column.id] = createCellData('');
          }
        }
        child.cells = this.formulaEngine.evaluateRow(topic.columns, child.cells);
      }
    }

    return next;
  }

  private normalizeTopicColumns(topic: TreeTopic): void {
    const seen = new Set<string>();
    const replacements = new Map<string, string>();

    topic.columns = topic.columns.map((column, index) => {
      const nextName = column.name.trim() || `Column ${index + 1}`;
      let nextId = isValidColumnId(column.id) ? column.id : slugToColumnId(nextName);

      if (seen.has(nextId)) {
        let suffix = 2;
        const baseId = nextId;
        while (seen.has(nextId)) {
          nextId = `${baseId}_${suffix}`;
          suffix += 1;
        }
      }

      seen.add(nextId);
      if (column.id !== nextId) {
        replacements.set(column.id, nextId);
      }

      return {
        id: nextId,
        name: nextName,
        type: column.type === 'text' ? 'text' : 'number',
      };
    });

    if (replacements.size > 0) {
      for (const child of topic.children) {
        for (const [oldId, newId] of replacements.entries()) {
          const oldCell = child.cells[oldId];
          if (oldCell) {
            child.cells[newId] = oldCell;
            delete child.cells[oldId];
          }
        }

        for (const cell of Object.values(child.cells)) {
          if (!cell.raw.trim().startsWith('=')) {
            continue;
          }
          for (const [oldId, newId] of replacements.entries()) {
            cell.raw = this.replaceFormulaToken(cell.raw, oldId, newId);
          }
        }
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

  private buildNewSubtopicCells(columns: TableColumn[], existingChildren: TreeSubtopic[]): Record<ColumnId, CellData> {
    const cells = createEmptyCells(columns);
    for (const column of columns) {
      const formulaRaw = this.findColumnFormulaRaw(existingChildren, column.id);
      if (formulaRaw !== null) {
        cells[column.id] = createCellData(formulaRaw);
      }
    }
    return cells;
  }

  private findColumnFormulaRaw(children: TreeSubtopic[], columnId: ColumnId): string | null {
    for (const child of children) {
      const raw = child.cells[columnId]?.raw ?? '';
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
    };
  }

  private buildUniqueColumnId(existingColumns: TableColumn[], name: string): ColumnId {
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

  private renameColumnReferences(topic: TreeTopic, oldId: ColumnId, newId: ColumnId): void {
    for (const child of topic.children) {
      const oldCell = child.cells[oldId];
      if (oldCell) {
        child.cells[newId] = oldCell;
        delete child.cells[oldId];
      } else if (!child.cells[newId]) {
        child.cells[newId] = createCellData('');
      }

      for (const cell of Object.values(child.cells)) {
        if (!cell.raw.trim().startsWith('=')) {
          continue;
        }
        cell.raw = this.replaceFormulaToken(cell.raw, oldId, newId);
      }
    }
  }

  private replaceFormulaToken(formula: string, oldId: ColumnId, newId: ColumnId): string {
    const escapedOldId = oldId.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const pattern = new RegExp(`(?<![\\w$])${escapedOldId}(?!\\w)`, 'g');
    return formula.replace(pattern, newId);
  }

  private defaultTopicColumns(): TableColumn[] {
    return structuredClone(DEFAULT_TOPIC_COLUMNS);
  }
}
