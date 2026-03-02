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
  isValidColumnId,
  slugToColumnId,
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

    const normalizedColumnMeta = this.normalizeColumns(candidate.columns);
    const normalizedColumns = normalizedColumnMeta.map((item) => item.column);
    const formulaReplacements = new Map<string, string>(
      normalizedColumnMeta
        .filter((item) => item.sourceId !== item.column.id && item.sourceId.length > 0)
        .map((item) => [item.sourceId, item.column.id]),
    );
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
        const childCells = this.normalizeSubtopicCells(
          child.cells,
          normalizedColumnMeta,
          formulaReplacements,
        );

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

  private normalizeColumns(columns: unknown): Array<{ column: TableColumn; sourceId: string }> {
    if (!Array.isArray(columns) || columns.length === 0) {
      return [{ column: structuredClone(STARTER_COLUMNS[0]), sourceId: STARTER_COLUMNS[0]!.id }];
    }

    const seen = new Set<string>();
    const normalized = columns
      .map((column, index) => {
        if (!column || typeof column !== 'object') {
          return null;
        }

        const candidate = column as Partial<TableColumn>;
        const name =
          typeof candidate.name === 'string' && candidate.name.trim().length > 0
            ? candidate.name
            : `Column ${index + 1}`;
        const type: 'number' | 'text' = candidate.type === 'text' ? 'text' : 'number';

        let id = slugToColumnId(name);
        if (typeof candidate.id === 'string' && isValidColumnId(candidate.id)) {
          id = candidate.id;
        }

        let uniqueId = id;
        let suffix = 2;
        while (seen.has(uniqueId)) {
          uniqueId = `${id}_${suffix}`;
          suffix += 1;
        }
        seen.add(uniqueId);

        return {
          column: { id: uniqueId, name, type },
          sourceId: typeof candidate.id === 'string' ? candidate.id : uniqueId,
        };
      })
      .filter((column): column is { column: TableColumn; sourceId: string } => column !== null);

    if (normalized.length === 0) {
      return [{ column: structuredClone(STARTER_COLUMNS[0]), sourceId: STARTER_COLUMNS[0]!.id }];
    }

    return normalized;
  }

  private normalizeSubtopicCells(
    cells: unknown,
    columns: Array<{ column: TableColumn; sourceId: string }>,
    formulaReplacements: Map<string, string>,
  ): Record<string, { raw: string; value: number | string | null; error: string | null }> {
    const cellRecord =
      cells && typeof cells === 'object' ? (cells as Record<string, { raw?: unknown }>) : {};
    const normalized: Record<string, { raw: string; value: number | string | null; error: string | null }> = {};

    for (const item of columns) {
      const rawByNewId = cellRecord[item.column.id]?.raw;
      const rawByOldId = item.sourceId !== item.column.id ? cellRecord[item.sourceId]?.raw : undefined;
      const rawValue = typeof rawByNewId === 'string' ? rawByNewId : rawByOldId;
      const nextRaw = typeof rawValue === 'string' ? this.replaceFormulaReferences(rawValue, formulaReplacements) : '';
      normalized[item.column.id] = createCellData(nextRaw);
    }

    return normalized;
  }

  private replaceFormulaReferences(raw: string, replacements: Map<string, string>): string {
    if (!raw.trim().startsWith('=')) {
      return raw;
    }

    let rewritten = raw;
    const entries = [...replacements.entries()].sort((a, b) => b[0].length - a[0].length);
    for (const [oldId, newId] of entries) {
      const escapedOldId = oldId.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const pattern = new RegExp(`(?<![A-Za-z0-9_$])${escapedOldId}(?![A-Za-z0-9_])`, 'g');
      rewritten = rewritten.replace(pattern, newId);
    }

    return rewritten;
  }
}
