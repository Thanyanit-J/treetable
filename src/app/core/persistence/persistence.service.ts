import { Injectable } from '@angular/core';
import {
  ACCENT_COLORS,
  AccentColor,
  CardV2,
  ChartConfigV2,
  ColumnV2,
  DocumentFileV2,
  DocumentViewState,
  ImportResult,
  NodeV2,
  makeId,
  walkNodes,
} from '../model/document.model';
import {
  isValidColumnRefName,
  isValidEntityRefName,
  slugifyColumnRefName,
  slugifyEntityRefName,
  uniqueRefName,
} from '../model/ref-name';
import { createStarterDocument } from '../model/starter';
import { migrateV1Document } from './v1-migration';

const V2_STORAGE_KEY = 'treetable.v2.document';
const V1_STORAGE_KEY = 'treetable.v1.state';

@Injectable({ providedIn: 'root' })
export class PersistenceService {
  /**
   * Loads the current Document: V2 storage first; otherwise the old V1
   * storage is migrated once, written through to the V2 key, and used.
   * The V1 key is left untouched as an implicit backup.
   */
  load(): DocumentFileV2 {
    const fromV2 = this.tryLoadV2();
    if (fromV2) {
      return fromV2;
    }

    const fromV1 = this.tryMigrateV1();
    if (fromV1) {
      this.save(fromV1);
      return fromV1;
    }

    return createStarterDocument();
  }

  save(file: DocumentFileV2): void {
    try {
      localStorage.setItem(V2_STORAGE_KEY, JSON.stringify(file));
    } catch {
      // Private browsing / quota — persisting is best-effort by design.
    }
  }

  export(file: DocumentFileV2): string {
    return JSON.stringify(file, null, 2);
  }

  import(json: string): { result: ImportResult; file?: DocumentFileV2 } {
    let parsed: unknown;
    try {
      parsed = JSON.parse(json);
    } catch {
      return { result: { ok: false, error: 'Unable to parse JSON file.' } };
    }

    const version = (parsed as { version?: unknown } | null)?.version;
    if (version === 1) {
      return {
        result: {
          ok: false,
          error: 'This file uses the old v1 format, which imports no longer support.',
        },
      };
    }

    const normalized = this.normalize(parsed);
    if (!normalized) {
      return { result: { ok: false, error: 'Invalid TreeTable document.' } };
    }
    return { result: { ok: true }, file: normalized };
  }

  private tryLoadV2(): DocumentFileV2 | null {
    try {
      const raw = localStorage.getItem(V2_STORAGE_KEY);
      if (!raw) {
        return null;
      }
      return this.normalize(JSON.parse(raw));
    } catch {
      return null;
    }
  }

  private tryMigrateV1(): DocumentFileV2 | null {
    try {
      const raw = localStorage.getItem(V1_STORAGE_KEY);
      if (!raw) {
        return null;
      }
      const migrated = migrateV1Document(JSON.parse(raw));
      return migrated ? this.normalize(migrated) : null;
    } catch {
      return null;
    }
  }

  /**
   * Lenient structural normalization: anything string-shaped survives,
   * Reference Names are validated/regenerated and uniquified, unknown keys
   * and orphaned values are dropped. Returns null only when the input is not
   * recognizably a V2 Document.
   */
  private normalize(input: unknown): DocumentFileV2 | null {
    if (!input || typeof input !== 'object') {
      return null;
    }
    const candidate = input as Partial<DocumentFileV2> & { cards?: unknown; view?: unknown };
    if (candidate.version !== 2 || !Array.isArray(candidate.cards)) {
      return null;
    }

    const takenCardRefs = new Set<string>();
    const cards: CardV2[] = [];
    for (const [index, rawCard] of candidate.cards.entries()) {
      const card = this.normalizeTopicCard(rawCard, index, takenCardRefs);
      if (card) {
        cards.push(card);
      }
    }

    const nodeIds = new Set<string>();
    for (const card of cards) {
      walkNodes(card.children, (node) => nodeIds.add(node.id));
    }

    const rawView = (candidate.view ?? {}) as Partial<DocumentViewState>;
    const collapsedNodeIds = Array.isArray(rawView.collapsedNodeIds)
      ? rawView.collapsedNodeIds.filter(
          (id): id is string => typeof id === 'string' && nodeIds.has(id),
        )
      : [];

    return {
      version: 2,
      title:
        typeof candidate.title === 'string' && candidate.title.trim().length > 0
          ? candidate.title
          : 'Untitled',
      cards,
      view: { collapsedNodeIds },
    };
  }

  private normalizeTopicCard(
    input: unknown,
    index: number,
    takenCardRefs: Set<string>,
  ): CardV2 | null {
    if (!input || typeof input !== 'object') {
      return null;
    }
    const candidate = input as Partial<CardV2> & { columns?: unknown; children?: unknown };
    if (candidate.kind !== undefined && candidate.kind !== 'topic') {
      return null;
    }

    const displayName =
      typeof candidate.displayName === 'string' && candidate.displayName.trim().length > 0
        ? candidate.displayName
        : `Topic ${index + 1}`;
    const baseRef =
      typeof candidate.refName === 'string' && isValidEntityRefName(candidate.refName)
        ? candidate.refName
        : slugifyEntityRefName(displayName);
    const refName = uniqueRefName(baseRef, takenCardRefs);
    takenCardRefs.add(refName);

    const takenColumnRefs = new Set<string>();
    const rawColumns = Array.isArray(candidate.columns) ? candidate.columns : [];
    const columns: ColumnV2[] = rawColumns
      .map((column, columnIndex) => this.normalizeColumn(column, columnIndex, takenColumnRefs))
      .filter((column): column is ColumnV2 => column !== null);

    const columnIds = new Set(columns.map((column) => column.id));
    const takenNodeRefs = new Set<string>();
    const rawChildren = Array.isArray(candidate.children) ? candidate.children : [];
    const children = rawChildren
      .map((node, nodeIndex) => this.normalizeNode(node, nodeIndex, columnIds, takenNodeRefs))
      .filter((node): node is NodeV2 => node !== null);

    const columnRefs = new Set(columns.map((column) => column.refName));
    const rawCharts = Array.isArray((candidate as { charts?: unknown }).charts)
      ? ((candidate as { charts?: unknown[] }).charts as unknown[])
      : [];
    const charts: ChartConfigV2[] = rawCharts
      .map((chart): ChartConfigV2 | null => {
        if (!chart || typeof chart !== 'object') {
          return null;
        }
        const config = chart as Partial<ChartConfigV2>;
        const chartColumns = Array.isArray(config.columns)
          ? config.columns.filter(
              (ref): ref is string => typeof ref === 'string' && columnRefs.has(ref),
            )
          : [];
        if (chartColumns.length === 0) {
          return null;
        }
        return {
          id: typeof config.id === 'string' && config.id.length > 0 ? config.id : makeId('chart'),
          type: config.type === 'pie' ? 'pie' : 'bar',
          columns: chartColumns,
        };
      })
      .filter((chart): chart is ChartConfigV2 => chart !== null);

    return {
      kind: 'topic',
      id:
        typeof candidate.id === 'string' && candidate.id.length > 0
          ? candidate.id
          : makeId('topic'),
      refName,
      displayName,
      columns,
      children,
      charts,
    };
  }

  private normalizeColumn(
    input: unknown,
    index: number,
    takenColumnRefs: Set<string>,
  ): ColumnV2 | null {
    if (!input || typeof input !== 'object') {
      return null;
    }
    const candidate = input as Partial<ColumnV2>;
    const displayName =
      typeof candidate.displayName === 'string' && candidate.displayName.trim().length > 0
        ? candidate.displayName
        : `Column ${index + 1}`;
    const baseRef =
      typeof candidate.refName === 'string' && isValidColumnRefName(candidate.refName)
        ? candidate.refName
        : slugifyColumnRefName(displayName);
    const refName = uniqueRefName(baseRef, takenColumnRefs);
    takenColumnRefs.add(refName);

    const expression =
      typeof candidate.expression === 'string' && candidate.expression.trim().startsWith('=')
        ? candidate.expression
        : null;
    const chartSource =
      typeof candidate.chartSource === 'string' && isValidColumnRefName(candidate.chartSource)
        ? candidate.chartSource
        : null;
    const kind =
      candidate.kind === 'computed' && expression !== null
        ? 'computed'
        : candidate.kind === 'chart' && chartSource !== null
          ? 'chart'
          : 'input';

    return {
      id:
        typeof candidate.id === 'string' && candidate.id.length > 0 ? candidate.id : makeId('col'),
      refName,
      displayName,
      kind,
      valueType: candidate.valueType === 'text' ? 'text' : 'number',
      expression: kind === 'computed' ? expression : null,
      rollup: kind === 'chart' ? 'none' : candidate.rollup === 'sum' ? 'sum' : 'none',
      chartSource: kind === 'chart' ? chartSource : null,
    };
  }

  private normalizeNode(
    input: unknown,
    index: number,
    columnIds: ReadonlySet<string>,
    takenNodeRefs: Set<string>,
  ): NodeV2 | null {
    if (!input || typeof input !== 'object') {
      return null;
    }
    const candidate = input as Partial<NodeV2> & { children?: unknown; values?: unknown };

    const displayName =
      typeof candidate.displayName === 'string' && candidate.displayName.trim().length > 0
        ? candidate.displayName
        : `Node ${index + 1}`;
    const baseRef =
      typeof candidate.refName === 'string' && isValidEntityRefName(candidate.refName)
        ? candidate.refName
        : slugifyEntityRefName(displayName);
    const refName = uniqueRefName(baseRef, takenNodeRefs);
    takenNodeRefs.add(refName);

    const values: Record<string, string> = {};
    if (candidate.values && typeof candidate.values === 'object') {
      for (const [key, value] of Object.entries(candidate.values as Record<string, unknown>)) {
        if (columnIds.has(key) && typeof value === 'string') {
          values[key] = value;
        }
      }
    }

    const rawChildren = Array.isArray(candidate.children) ? candidate.children : [];
    const children = rawChildren
      .map((child, childIndex) => this.normalizeNode(child, childIndex, columnIds, takenNodeRefs))
      .filter((child): child is NodeV2 => child !== null);

    const accent = ACCENT_COLORS.includes(candidate.accent as AccentColor)
      ? (candidate.accent as AccentColor)
      : null;

    return {
      id:
        typeof candidate.id === 'string' && candidate.id.length > 0 ? candidate.id : makeId('node'),
      refName,
      displayName,
      accent,
      values,
      children,
    };
  }
}
