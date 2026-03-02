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

@Injectable({ providedIn: 'root' })
export class TreeTableStoreService {
  private readonly persistence = inject(PersistenceService);
  private readonly formulaEngine = inject(FormulaEngineService);

  private readonly stateSignal = signal<TreeTableStateV1>(this.recalculate(this.persistence.load()));
  private readonly past = signal<TreeTableStateV1[]>([]);
  private readonly future = signal<TreeTableStateV1[]>([]);

  readonly state = this.stateSignal.asReadonly();
  readonly topics = computed(() => this.stateSignal().topics);
  readonly columns = computed(() => this.stateSignal().columns);
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
      const newTopic: TreeTopic = {
        id: topicId,
        label,
        expanded: true,
        cells: createEmptyCells(state.columns),
        children: [],
      };
      state.topics.push(newTopic);
      state.selectedNodeId = topicId;
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
        cells: createEmptyCells(state.columns),
      };
      topic.expanded = true;
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

  toggleExpand(topicId: NodeId): void {
    this.mutate((state) => {
      const topic = state.topics.find((currentTopic) => currentTopic.id === topicId);
      if (!topic) {
        return;
      }
      topic.expanded = !topic.expanded;
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
      for (const topic of state.topics) {
        if (topic.id === nodeId) {
          topic.cells[columnId] = this.withRaw(topic.cells[columnId], raw);
          return;
        }
        const child = topic.children.find((candidate) => candidate.id === nodeId);
        if (child) {
          child.cells[columnId] = this.withRaw(child.cells[columnId], raw);
          return;
        }
      }
    });
  }

  addColumn(name: string, type: 'number' | 'text'): void {
    this.mutate((state) => {
      const base = slugToColumnId(name);
      let candidate = base;
      let suffix = 2;
      const existing = new Set(state.columns.map((column) => column.id));
      while (!isValidColumnId(candidate) || existing.has(candidate)) {
        candidate = `${base}_${suffix}`;
        suffix += 1;
      }

      const column: TableColumn = { id: candidate, name: name.trim() || 'New Column', type };
      state.columns.push(column);

      for (const topic of state.topics) {
        topic.cells[candidate] = createCellData('');
        for (const child of topic.children) {
          child.cells[candidate] = createCellData('');
        }
      }
    });
  }

  renameColumn(columnId: ColumnId, name: string): void {
    this.mutate((state) => {
      const column = state.columns.find((currentColumn) => currentColumn.id === columnId);
      if (!column) {
        return;
      }
      column.name = name.trim() || column.name;
    });
  }

  removeColumn(columnId: ColumnId): void {
    this.mutate((state) => {
      state.columns = state.columns.filter((column) => column.id !== columnId);
      for (const topic of state.topics) {
        delete topic.cells[columnId];
        for (const child of topic.children) {
          delete child.cells[columnId];
        }
      }
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

    const previous = stack[stack.length - 1];
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

    for (const topic of next.topics) {
      for (const child of topic.children) {
        child.cells = this.formulaEngine.evaluateRow(next.columns, child.cells, []);
      }

      const childCells = topic.children.map((child) => child.cells);
      topic.cells = this.formulaEngine.evaluateRow(next.columns, topic.cells, childCells);
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
}
