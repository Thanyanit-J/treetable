export type NodeId = string;
export type ColumnId = string;

export interface CellData {
  raw: string;
  value: number | string | null;
  error: string | null;
}

export interface TableColumn {
  id: ColumnId;
  name: string;
  type: 'number' | 'text';
}

export interface TreeSubtopic {
  id: NodeId;
  topicId: NodeId;
  label: string;
  cells: Record<ColumnId, CellData>;
}

export interface TreeTopic {
  id: NodeId;
  label: string;
  columns: TableColumn[];
  children: TreeSubtopic[];
}

export interface TreeTableStateV1 {
  version: 1;
  title: string;
  topics: TreeTopic[];
  selectedNodeId: NodeId | null;
}

export type TreeTableState = TreeTableStateV1;

export interface ImportResult {
  ok: boolean;
  error?: string;
  warnings?: string[];
}

export const RESERVED_COLUMN_BASENAMES = new Set(['SUM', 'AVG', 'MIN', 'MAX', 'children']);

export function createCellData(raw = ''): CellData {
  return {
    raw,
    value: raw,
    error: null,
  };
}

export function makeNodeId(prefix: string): NodeId {
  return `${prefix}_${crypto.randomUUID()}`;
}

export function createEmptyCells(columns: TableColumn[]): Record<ColumnId, CellData> {
  return Object.fromEntries(columns.map((column) => [column.id, createCellData('')])) as Record<
    ColumnId,
    CellData
  >;
}

export function slugToColumnId(input: string): string {
  const cleaned = input
    .trim()
    .replace(/[^A-Za-z0-9_]/g, '');

  let base = cleaned.length > 0 ? cleaned : 'Column';
  if (!/^[A-Za-z_]/.test(base)) {
    base = `_${base}`;
  }

  if (RESERVED_COLUMN_BASENAMES.has(base)) {
    base = `${base}_col`;
  }

  return `$${base}`;
}

export function isValidColumnId(input: string): boolean {
  if (!/^\$[A-Za-z_][A-Za-z0-9_]*$/.test(input)) {
    return false;
  }
  const baseName = input.slice(1);
  return !RESERVED_COLUMN_BASENAMES.has(baseName);
}

export const DEFAULT_TOPIC_COLUMNS: TableColumn[] = [
  { id: '$A', name: 'A', type: 'number' },
  { id: '$B', name: 'B', type: 'number' },
];

export const STARTER_STATE: TreeTableStateV1 = {
  version: 1,
  title: 'Untitled',
  selectedNodeId: null,
  topics: [
    {
      id: 'topic_wealth',
      label: 'Wealth',
      columns: structuredClone(DEFAULT_TOPIC_COLUMNS),
      children: [
        {
          id: 'subtopic_bankA',
          topicId: 'topic_wealth',
          label: 'Bank A',
          cells: {
            $A: createCellData('120000'),
            $B: createCellData('0.03'),
          },
        },
        {
          id: 'subtopic_bankB',
          topicId: 'topic_wealth',
          label: 'Bank B',
          cells: {
            $A: createCellData('90000'),
            $B: createCellData('0.05'),
          },
        },
      ],
    },
    {
      id: 'topic_business',
      label: 'Business',
      columns: structuredClone(DEFAULT_TOPIC_COLUMNS),
      children: [
        {
          id: 'subtopic_dividend',
          topicId: 'topic_business',
          label: 'Dividend',
          cells: {
            $A: createCellData('30000'),
            $B: createCellData('1'),
          },
        },
        {
          id: 'subtopic_family',
          topicId: 'topic_business',
          label: 'Family Company',
          cells: {
            $A: createCellData('45000'),
            $B: createCellData('1'),
          },
        },
      ],
    },
  ],
};

export function cloneState(state: TreeTableState): TreeTableState {
  return structuredClone(state);
}
