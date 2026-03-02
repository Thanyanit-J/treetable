import { Injectable, computed, effect, inject, signal } from '@angular/core';
import {
  CellData,
  ColumnId,
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

export interface VisibleSubtopicRow {
  topicId: NodeId;
  topicLabel: string;
  subtopic: TreeSubtopic;
}

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
  readonly columns = computed(() => this.stateSignal().columns);
  readonly selectedNodeId = computed(() => this.stateSignal().selectedNodeId);
  readonly canUndo = computed(() => this.past().length > 0);
  readonly canRedo = computed(() => this.future().length > 0);
  readonly visibleSubtopicRows = computed<VisibleSubtopicRow[]>(() => {
    const rows: VisibleSubtopicRow[] = [];
    for (const topic of this.stateSignal().topics) {
      for (const subtopic of topic.children) {
        rows.push({ topicId: topic.id, topicLabel: topic.label, subtopic });
      }
    }
    return rows;
  });

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
      const subtopicId = makeNodeId('subtopic');
      const newTopic: TreeTopic = {
        id: topicId,
        label,
        children: [
          {
            id: subtopicId,
            topicId,
            label: 'New Subtopic',
            cells: this.buildNewSubtopicCells(state),
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
      if (state.selectedNodeId === topicId) {
        state.selectedNodeId = null;
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
        cells: this.buildNewSubtopicCells(state),
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

  moveTopic(topicId: NodeId, toIndex: number): void {
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

  setCellRaw(nodeId: NodeId, columnId: ColumnId, raw: string): void {
    this.mutate((state) => {
      const nextIsFormula = raw.trim().startsWith('=');
      let targetChild: TreeSubtopic | null = null;
      for (const topic of state.topics) {
        const child = topic.children.find((candidate) => candidate.id === nodeId);
        if (child) {
          targetChild = child;
          break;
        }
      }

      if (!targetChild) {
        return;
      }

      const prevRaw = targetChild.cells[columnId]?.raw ?? '';
      const wasFormula = prevRaw.trim().startsWith('=');
      if (nextIsFormula || wasFormula) {
        for (const topic of state.topics) {
          for (const child of topic.children) {
            child.cells[columnId] = this.withRaw(child.cells[columnId], raw);
          }
        }
        return;
      }

      targetChild.cells[columnId] = this.withRaw(targetChild.cells[columnId], raw);
    });
  }

  addColumn(name: string, type: 'number' | 'text'): void {
    this.mutate((state) => {
      const column = this.buildUniqueColumn(state.columns, name, type);
      state.columns.push(column);

      for (const topic of state.topics) {
        for (const child of topic.children) {
          child.cells[column.id] = createCellData('');
        }
      }
    });
  }

  insertColumn(referenceColumnId: ColumnId, side: 'left' | 'right'): void {
    this.mutate((state) => {
      const refIndex = state.columns.findIndex((column) => column.id === referenceColumnId);
      if (refIndex < 0) {
        return;
      }

      const column = this.buildUniqueColumn(state.columns, 'New Column', 'number');
      const insertionIndex = side === 'left' ? refIndex : refIndex + 1;
      state.columns.splice(insertionIndex, 0, column);

      for (const topic of state.topics) {
        for (const child of topic.children) {
          child.cells[column.id] = createCellData('');
        }
      }
    });
  }

  renameColumn(columnId: ColumnId, name: string): void {
    this.mutate((state) => {
      const columnIndex = state.columns.findIndex((currentColumn) => currentColumn.id === columnId);
      const column = columnIndex >= 0 ? state.columns[columnIndex] : undefined;
      if (!column) {
        return;
      }

      const nextName = name.trim() || column.name;
      const nextId = this.buildUniqueColumnId(
        state.columns.filter((candidate) => candidate.id !== columnId),
        nextName,
      );
      const oldId = column.id;
      column.name = nextName;
      column.id = nextId;

      if (oldId !== nextId) {
        this.renameColumnReferences(state, oldId, nextId);
      }
    });
  }

  deleteColumn(columnId: ColumnId): ImportResult | void {
    if (this.columns().length <= 1) {
      return { ok: false, error: 'At least one column is required.' };
    }

    this.mutate((state) => {
      state.columns = state.columns.filter((column) => column.id !== columnId);
      for (const topic of state.topics) {
        for (const child of topic.children) {
          delete child.cells[columnId];
        }
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

    if (next.columns.length === 0) {
      next.columns.push({ id: '$Value', name: 'Value', type: 'number' });
    }

    for (const topic of next.topics) {
      for (const child of topic.children) {
        child.cells = this.formulaEngine.evaluateRow(next.columns, child.cells);
      }
    }

    return next;
  }

  private withRaw(existing: CellData | undefined, raw: string): CellData {
    return {
      raw,
      value: existing?.value ?? null,
      error: existing?.error ?? null,
    };
  }

  private buildNewSubtopicCells(state: TreeTableStateV1): Record<ColumnId, CellData> {
    const cells = createEmptyCells(state.columns);
    for (const column of state.columns) {
      const formulaRaw = this.findColumnFormulaRaw(state, column.id);
      if (formulaRaw !== null) {
        cells[column.id] = createCellData(formulaRaw);
      }
    }
    return cells;
  }

  private findColumnFormulaRaw(state: TreeTableStateV1, columnId: ColumnId): string | null {
    for (const topic of state.topics) {
      for (const child of topic.children) {
        const raw = child.cells[columnId]?.raw ?? '';
        if (raw.trim().startsWith('=')) {
          return raw;
        }
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

  private renameColumnReferences(state: TreeTableStateV1, oldId: ColumnId, newId: ColumnId): void {
    for (const topic of state.topics) {
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
  }

  private replaceFormulaToken(formula: string, oldId: ColumnId, newId: ColumnId): string {
    const escapedOldId = oldId.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const pattern = new RegExp(`(?<![A-Za-z0-9_$])${escapedOldId}(?![A-Za-z0-9_])`, 'g');
    return formula.replace(pattern, newId);
  }
}
