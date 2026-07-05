import { Injectable } from '@angular/core';
import {
  ACCENT_COLORS,
  AccentColor,
  CardStackV2,
  CardV2,
  ChartCardV2,
  ChartConfigV2,
  ColumnV2,
  DocumentFileV2,
  DocumentViewState,
  ImportResult,
  NodeV2,
  NoteCardV2,
  PageV2,
  RollupMode,
  TopicCardV2,
  clampCardHeight,
  clampCardWidth,
  makeId,
  normalizeDocumentLayout,
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
    const legacyEmbeddedCharts = new Map<string, ChartConfigV2[]>();
    type Slot = { card: CardV2 } | { chartRaw: unknown };
    const slots: Slot[] = [];
    for (const [index, rawCard] of candidate.cards.entries()) {
      const kind = (rawCard as { kind?: unknown } | null)?.kind;
      if (kind === 'note') {
        const note = this.normalizeNoteCard(rawCard);
        if (note) {
          slots.push({ card: note });
        }
        continue;
      }
      if (kind === 'chartcard') {
        slots.push({ chartRaw: rawCard });
        continue;
      }
      const card = this.normalizeTopicCard(rawCard, index, takenCardRefs, legacyEmbeddedCharts);
      if (card) {
        slots.push({ card });
      }
    }

    // Chart cards validate against the (now parsed) topics, order preserved.
    const topicsById = new Map<string, TopicCardV2>();
    for (const slot of slots) {
      if ('card' in slot && slot.card.kind === 'topic') {
        topicsById.set(slot.card.id, slot.card);
      }
    }
    const cards: CardV2[] = [];
    for (const slot of slots) {
      if ('card' in slot) {
        cards.push(slot.card);
        continue;
      }
      const chartCard = this.normalizeChartCard(slot.chartRaw, topicsById);
      if (chartCard) {
        cards.push(chartCard);
      }
    }

    const nodeIds = new Set<string>();
    for (const card of cards) {
      if (card.kind === 'topic') {
        walkNodes(card.children, (node) => nodeIds.add(node.id));
      }
    }

    const rawView = (candidate.view ?? {}) as Partial<DocumentViewState>;
    const collapsedNodeIds = Array.isArray(rawView.collapsedNodeIds)
      ? rawView.collapsedNodeIds.filter(
          (id): id is string => typeof id === 'string' && nodeIds.has(id),
        )
      : [];

    const pages = this.normalizePages((candidate as { pages?: unknown }).pages);
    this.migrateEmbeddedCharts(cards, pages, legacyEmbeddedCharts);

    const document: DocumentFileV2 = {
      version: 2,
      title:
        typeof candidate.title === 'string' && candidate.title.trim().length > 0
          ? candidate.title
          : 'Untitled',
      cards,
      pages,
      view: { collapsedNodeIds },
    };
    normalizeDocumentLayout(document);

    if (
      typeof rawView.activePageId === 'string' &&
      document.pages.some((page) => page.id === rawView.activePageId)
    ) {
      document.view!.activePageId = rawView.activePageId;
    }
    return document;
  }

  /**
   * Topic cards used to embed a Chart Panel under the table. Those charts
   * now live in Charts cards: each affected Topic gets one, carrying its
   * chart configs, laid out immediately right of the Topic's stack.
   */
  private migrateEmbeddedCharts(
    cards: CardV2[],
    pages: PageV2[],
    legacy: ReadonlyMap<string, ChartConfigV2[]>,
  ): void {
    for (const [topicId, charts] of legacy) {
      const chartCard: ChartCardV2 = {
        kind: 'chartcard',
        id: makeId('chartcard'),
        sourceTopicId: topicId,
        charts,
      };
      cards.push(chartCard);
      const page = pages.find((candidate) =>
        candidate.stacks.some((stack) => stack.cardIds.includes(topicId)),
      );
      const stackIndex = page?.stacks.findIndex((stack) => stack.cardIds.includes(topicId)) ?? -1;
      if (page && stackIndex !== -1) {
        page.stacks.splice(stackIndex + 1, 0, { id: makeId('stack'), cardIds: [chartCard.id] });
      }
      // Otherwise normalizeDocumentLayout appends the card to the first Page.
    }
  }

  private normalizeNoteCard(input: unknown): NoteCardV2 | null {
    if (input === null || typeof input !== 'object') {
      return null;
    }
    const candidate = input as Partial<NoteCardV2>;
    const note: NoteCardV2 = {
      kind: 'note',
      id:
        typeof candidate.id === 'string' && candidate.id.length > 0 ? candidate.id : makeId('note'),
      text: typeof candidate.text === 'string' ? candidate.text : '',
    };
    if (candidate.format === 'markdown') {
      note.format = 'markdown';
    }
    return note;
  }

  private normalizeChartCard(
    input: unknown,
    topicsById: ReadonlyMap<string, TopicCardV2>,
  ): ChartCardV2 | null {
    if (input === null || typeof input !== 'object') {
      return null;
    }
    const candidate = input as Partial<ChartCardV2> & { charts?: unknown };
    if (typeof candidate.sourceTopicId !== 'string' || candidate.sourceTopicId.length === 0) {
      return null;
    }
    const source = topicsById.get(candidate.sourceTopicId);
    const sourceRefs = source ? new Set(source.columns.map((column) => column.refName)) : null;

    const rawCharts = Array.isArray(candidate.charts) ? candidate.charts : [];
    const charts: ChartConfigV2[] = [];
    for (const rawChart of rawCharts) {
      const chart = this.normalizeChartConfig(rawChart, sourceRefs);
      if (chart) {
        charts.push(chart);
      }
    }

    return {
      kind: 'chartcard',
      id:
        typeof candidate.id === 'string' && candidate.id.length > 0
          ? candidate.id
          : makeId('chartcard'),
      sourceTopicId: candidate.sourceTopicId,
      charts,
    };
  }

  /** One chart config; column refs are filtered against the source's columns. */
  private normalizeChartConfig(
    input: unknown,
    validRefs: ReadonlySet<string> | null,
  ): ChartConfigV2 | null {
    if (input === null || typeof input !== 'object') {
      return null;
    }
    const config = input as Partial<ChartConfigV2>;
    let columns = Array.isArray(config.columns)
      ? config.columns.filter((ref): ref is string => typeof ref === 'string')
      : [];
    if (validRefs) {
      columns = columns.filter((ref) => validRefs.has(ref));
    }
    if (columns.length === 0) {
      return null;
    }
    const chart: ChartConfigV2 = {
      id: typeof config.id === 'string' && config.id.length > 0 ? config.id : makeId('chart'),
      type: config.type === 'pie' || config.type === 'line' ? config.type : 'bar',
      columns,
    };
    if (typeof config.name === 'string' && config.name.trim().length > 0) {
      chart.name = config.name;
    }
    if (Array.isArray(config.rows)) {
      // Dead node ids are dropped lazily at render time, not here (the
      // source tree may not be parsed yet for Chart Cards).
      const rows = config.rows.filter((id): id is string => typeof id === 'string');
      if (rows.length > 0) {
        chart.rows = rows;
      }
    }
    if (
      config.rowRollup === 'avg' ||
      config.rowRollup === 'min' ||
      config.rowRollup === 'max' ||
      config.rowRollup === 'count'
    ) {
      chart.rowRollup = config.rowRollup; // 'sum' stays implicit.
    }
    if (config.categoryAxis === 'columns') {
      chart.categoryAxis = 'columns'; // 'rows' stays implicit.
    }
    if (config.horizontal === true) {
      chart.horizontal = true;
    }
    return chart;
  }

  /** Lenient Page/stack parsing; the layout invariant is repaired afterwards. */
  private normalizePages(input: unknown): PageV2[] {
    if (!Array.isArray(input)) {
      return [];
    }
    const pages: PageV2[] = [];
    for (const [index, rawPage] of input.entries()) {
      if (!rawPage || typeof rawPage !== 'object') {
        continue;
      }
      const candidate = rawPage as Partial<PageV2> & { stacks?: unknown };
      const stacks: CardStackV2[] = [];
      if (Array.isArray(candidate.stacks)) {
        for (const rawStack of candidate.stacks) {
          if (!rawStack || typeof rawStack !== 'object') {
            continue;
          }
          const stack = rawStack as Partial<CardStackV2>;
          stacks.push({
            id: typeof stack.id === 'string' && stack.id.length > 0 ? stack.id : makeId('stack'),
            cardIds: Array.isArray(stack.cardIds)
              ? stack.cardIds.filter((id): id is string => typeof id === 'string')
              : [],
          });
        }
      }
      pages.push({
        id:
          typeof candidate.id === 'string' && candidate.id.length > 0
            ? candidate.id
            : makeId('page'),
        name:
          typeof candidate.name === 'string' && candidate.name.trim().length > 0
            ? candidate.name
            : `Page ${index + 1}`,
        stacks,
      });
    }
    return pages;
  }

  private normalizeTopicCard(
    input: unknown,
    index: number,
    takenCardRefs: Set<string>,
    legacyEmbeddedCharts: Map<string, ChartConfigV2[]>,
  ): CardV2 | null {
    if (!input || typeof input !== 'object') {
      return null;
    }
    const candidate = input as Partial<TopicCardV2> & { columns?: unknown; children?: unknown };
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

    const card: CardV2 = {
      kind: 'topic',
      id:
        typeof candidate.id === 'string' && candidate.id.length > 0
          ? candidate.id
          : makeId('topic'),
      refName,
      displayName,
      columns,
      children,
    };

    // Topic cards used to embed charts; those migrate to a Charts card
    // placed beside the table (see migrateEmbeddedCharts).
    const columnRefs = new Set(columns.map((column) => column.refName));
    const rawCharts = Array.isArray((candidate as { charts?: unknown }).charts)
      ? ((candidate as { charts?: unknown[] }).charts as unknown[])
      : [];
    const embeddedCharts: ChartConfigV2[] = rawCharts
      .map((chart) => this.normalizeChartConfig(chart, columnRefs))
      .filter((chart): chart is ChartConfigV2 => chart !== null);
    if (embeddedCharts.length > 0) {
      legacyEmbeddedCharts.set(card.id, embeddedCharts);
    }
    const pillAlignment = (candidate as { pillAlignment?: unknown }).pillAlignment;
    if (pillAlignment === 'top' || pillAlignment === 'center') {
      card.pillAlignment = pillAlignment;
    }
    const connectorStyle = (candidate as { connectorStyle?: unknown }).connectorStyle;
    if (
      connectorStyle === 'elbow' ||
      connectorStyle === 'straight' ||
      connectorStyle === 'curved'
    ) {
      card.connectorStyle = connectorStyle;
    }
    if (typeof candidate.cardTitle === 'string' && candidate.cardTitle.trim().length > 0) {
      card.cardTitle = candidate.cardTitle;
    }
    if ((candidate as { showRoot?: unknown }).showRoot === false) {
      card.showRoot = false;
    }
    if (candidate.customRefName === true) {
      card.customRefName = true;
    }
    const sizing = (candidate as { sizing?: unknown }).sizing;
    if (sizing && typeof sizing === 'object') {
      const { mode, width, height } = sizing as Record<string, unknown>;
      if (mode === 'wrap' || mode === 'fixed') {
        card.sizing = { mode };
        if (typeof width === 'number' && Number.isFinite(width)) {
          card.sizing.width = clampCardWidth(width);
        }
        if (typeof height === 'number' && Number.isFinite(height)) {
          card.sizing.height = clampCardHeight(height);
        }
      }
    }
    return card;
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

    const rollupModes: readonly RollupMode[] = ['sum', 'avg', 'min', 'max', 'count'];
    const rollup =
      kind !== 'chart' && rollupModes.includes(candidate.rollup as RollupMode)
        ? (candidate.rollup as RollupMode)
        : 'none';

    const column: ColumnV2 = {
      id:
        typeof candidate.id === 'string' && candidate.id.length > 0 ? candidate.id : makeId('col'),
      refName,
      displayName,
      kind,
      valueType: candidate.valueType === 'text' ? 'text' : 'number',
      expression: kind === 'computed' ? expression : null,
      rollup,
      chartSource: kind === 'chart' ? chartSource : null,
    };
    if (candidate.customRefName === true) {
      column.customRefName = true;
    }
    if (candidate.hidden === true) {
      column.hidden = true;
    }
    return column;
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

    const node: NodeV2 = {
      id:
        typeof candidate.id === 'string' && candidate.id.length > 0 ? candidate.id : makeId('node'),
      refName,
      displayName,
      accent,
      values,
      children,
    };
    if (candidate.customRefName === true) {
      node.customRefName = true;
    }
    return node;
  }
}
