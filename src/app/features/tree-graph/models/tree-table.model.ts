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
  expanded: boolean;
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

export const RESERVED_COLUMN_IDS = new Set(['SUM', 'AVG', 'MIN', 'MAX', 'children']);

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
    .replace(/[^A-Za-z0-9_ ]/g, ' ')
    .split(/\s+/)
    .filter(Boolean)
    .map((part, index) => {
      const lower = part.toLowerCase();
      if (index === 0) {
        return lower;
      }
      return lower.charAt(0).toUpperCase() + lower.slice(1);
    })
    .join('');

  const base = cleaned.length > 0 ? cleaned : 'column';
  if (/^[A-Za-z_]/.test(base)) {
    return base;
  }
  return `_${base}`;
}

export function isValidColumnId(input: string): boolean {
  return /^[A-Za-z_][A-Za-z0-9_]*$/.test(input) && !RESERVED_COLUMN_IDS.has(input);
}

export const STARTER_COLUMNS: TableColumn[] = [
  { id: 'amount', name: 'Amount', type: 'number' },
  { id: 'rate', name: 'Rate', type: 'number' },
  { id: 'value', name: 'Value', type: 'number' },
];

export const STARTER_STATE: TreeTableStateV1 = {
  version: 1,
  selectedNodeId: null,
  columns: STARTER_COLUMNS,
  topics: [
    {
      id: 'topic_wealth',
      label: 'Wealth',
      expanded: true,
      children: [
        {
          id: 'subtopic_bankA',
          topicId: 'topic_wealth',
          label: 'Bank A',
          cells: {
            amount: createCellData('120000'),
            rate: createCellData('0.03'),
            value: createCellData('=amount*rate'),
          },
        },
        {
          id: 'subtopic_bankB',
          topicId: 'topic_wealth',
          label: 'Bank B',
          cells: {
            amount: createCellData('90000'),
            rate: createCellData('0.05'),
            value: createCellData('=amount*rate'),
          },
        },
      ],
    },
    {
      id: 'topic_business',
      label: 'Business',
      expanded: true,
      children: [
        {
          id: 'subtopic_dividend',
          topicId: 'topic_business',
          label: 'Dividend',
          cells: {
            amount: createCellData('30000'),
            rate: createCellData('1'),
            value: createCellData('=amount*rate'),
          },
        },
        {
          id: 'subtopic_family',
          topicId: 'topic_business',
          label: 'Family Company',
          cells: {
            amount: createCellData('45000'),
            rate: createCellData('1'),
            value: createCellData('=amount'),
          },
        },
      ],
    },
  ],
};

export function cloneState(state: TreeTableState): TreeTableState {
  return structuredClone(state);
}
