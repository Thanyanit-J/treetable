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
  children: TreeSubtopic[];
}

export interface TreeTableStateV1 {
  version: 1;
  topics: TreeTopic[];
  columns: TableColumn[];
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

export const STARTER_COLUMNS: TableColumn[] = [
  { id: '$Amount', name: 'Amount', type: 'number' },
  { id: '$Rate', name: 'Rate', type: 'number' },
  { id: '$Value', name: 'Value', type: 'number' },
];

export const STARTER_STATE: TreeTableStateV1 = {
  version: 1,
  selectedNodeId: null,
  columns: STARTER_COLUMNS,
  topics: [
    {
      id: 'topic_wealth',
      label: 'Wealth',
      children: [
        {
          id: 'subtopic_bankA',
          topicId: 'topic_wealth',
          label: 'Bank A',
          cells: {
            $Amount: createCellData('120000'),
            $Rate: createCellData('0.03'),
            $Value: createCellData('=$Amount*$Rate'),
          },
        },
        {
          id: 'subtopic_bankB',
          topicId: 'topic_wealth',
          label: 'Bank B',
          cells: {
            $Amount: createCellData('90000'),
            $Rate: createCellData('0.05'),
            $Value: createCellData('=$Amount*$Rate'),
          },
        },
      ],
    },
    {
      id: 'topic_business',
      label: 'Business',
      children: [
        {
          id: 'subtopic_dividend',
          topicId: 'topic_business',
          label: 'Dividend',
          cells: {
            $Amount: createCellData('30000'),
            $Rate: createCellData('1'),
            $Value: createCellData('=$Amount*$Rate'),
          },
        },
        {
          id: 'subtopic_family',
          topicId: 'topic_business',
          label: 'Family Company',
          cells: {
            $Amount: createCellData('45000'),
            $Rate: createCellData('1'),
            $Value: createCellData('=$Amount'),
          },
        },
      ],
    },
  ],
};

export function cloneState(state: TreeTableState): TreeTableState {
  return structuredClone(state);
}
