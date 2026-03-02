import { Injectable } from '@angular/core';
import {
  STARTER_COLUMNS,
  ImportResult,
  STARTER_STATE,
  TableColumn,
  TreeSubtopic,
  TreeTableState,
  TreeTableStateV1,
  cloneState,
  createCellData,
} from '../models/tree-table.model';

const STORAGE_KEY = 'treetable.v1.state';

@Injectable({ providedIn: 'root' })
export class PersistenceService {
  load(): TreeTableState {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) {
        return cloneState(STARTER_STATE);
      }
      const parsed = JSON.parse(raw) as unknown;
      const normalized = this.normalizeState(parsed);
      if (!normalized) {
        return cloneState(STARTER_STATE);
      }
      return normalized;
    } catch {
      return cloneState(STARTER_STATE);
    }
  }

  save(state: TreeTableState): void {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch {
      // Ignore storage errors for private browsing / quota issues.
    }
  }

  export(state: TreeTableState): string {
    return JSON.stringify(state, null, 2);
  }

  import(json: string): { result: ImportResult; state?: TreeTableState } {
    try {
      const parsed = JSON.parse(json) as unknown;
      const normalized = this.normalizeState(parsed);
      if (!normalized) {
        return { result: { ok: false, error: 'Invalid tree-table JSON format.' } };
      }
      return {
        result: { ok: true },
        state: normalized,
      };
    } catch {
      return {
        result: { ok: false, error: 'Unable to parse JSON file.' },
      };
    }
  }

  private normalizeState(input: unknown): TreeTableStateV1 | null {
    if (!input || typeof input !== 'object') {
      return null;
    }

    const candidate = input as Partial<TreeTableStateV1> & {
      topics?: Array<
        Partial<TreeTableStateV1['topics'][number]> & {
          cells?: unknown;
          children?: Array<Partial<TreeSubtopic>>;
        }
      >;
    };

    if (candidate.version !== 1 || !Array.isArray(candidate.topics)) {
      return null;
    }

    const normalizedColumns = this.normalizeColumns(candidate.columns);
    const topics = candidate.topics.map((topic, topicIndex) => {
      const topicId =
        typeof topic.id === 'string' && topic.id.length > 0 ? topic.id : `topic_migrated_${topicIndex}`;
      const topicLabel =
        typeof topic.label === 'string' && topic.label.trim().length > 0
          ? topic.label
          : `Topic ${topicIndex + 1}`;
      const topicExpanded = typeof topic.expanded === 'boolean' ? topic.expanded : true;
      const children = Array.isArray(topic.children) ? topic.children : [];

      const normalizedChildren = children.map((child, childIndex) => {
        const childId =
          typeof child.id === 'string' && child.id.length > 0
            ? child.id
            : `subtopic_migrated_${topicIndex}_${childIndex}`;
        const childLabel =
          typeof child.label === 'string' && child.label.trim().length > 0
            ? child.label
            : `Subtopic ${childIndex + 1}`;
        const childCells = this.normalizeSubtopicCells(child.cells, normalizedColumns);

        return {
          id: childId,
          topicId,
          label: childLabel,
          cells: childCells,
        };
      });

      return {
        id: topicId,
        label: topicLabel,
        expanded: topicExpanded,
        children: normalizedChildren,
      };
    });

    return {
      version: 1,
      topics,
      columns: normalizedColumns,
      selectedNodeId: typeof candidate.selectedNodeId === 'string' ? candidate.selectedNodeId : null,
    };
  }

  private normalizeColumns(columns: unknown): TableColumn[] {
    if (!Array.isArray(columns) || columns.length === 0) {
      return [structuredClone(STARTER_COLUMNS[0])];
    }

    const normalized = columns
      .map((column, index) => {
        if (!column || typeof column !== 'object') {
          return null;
        }

        const candidate = column as Partial<TableColumn>;
        const id = typeof candidate.id === 'string' && candidate.id.length > 0 ? candidate.id : `col_${index + 1}`;
        const name =
          typeof candidate.name === 'string' && candidate.name.trim().length > 0
            ? candidate.name
            : `Column ${index + 1}`;
        const type: 'number' | 'text' = candidate.type === 'text' ? 'text' : 'number';

        return { id, name, type };
      })
      .filter((column): column is TableColumn => column !== null);

    if (normalized.length === 0) {
      return [structuredClone(STARTER_COLUMNS[0])];
    }

    return normalized;
  }

  private normalizeSubtopicCells(
    cells: unknown,
    columns: TableColumn[],
  ): Record<string, { raw: string; value: number | string | null; error: string | null }> {
    const cellRecord =
      cells && typeof cells === 'object' ? (cells as Record<string, { raw?: unknown }>) : {};
    const normalized: Record<string, { raw: string; value: number | string | null; error: string | null }> = {};

    for (const column of columns) {
      const rawValue = cellRecord[column.id]?.raw;
      normalized[column.id] =
        typeof rawValue === 'string' ? createCellData(rawValue) : createCellData('');
    }

    return normalized;
  }
}
