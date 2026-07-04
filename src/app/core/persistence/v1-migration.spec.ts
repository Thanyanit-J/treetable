import { describe, expect, it } from 'vitest';
import { migrateV1Document } from './v1-migration';

const V1_SAMPLE = {
  version: 1,
  title: 'Example',
  selectedNodeId: 'subtopic_bankA',
  topics: [
    {
      id: 'topic_wealth',
      label: 'Wealth',
      columns: [
        { id: '$Amount', name: 'Amount', type: 'number', summaryMode: 'sum' },
        { id: '$Rate', name: 'Rate', type: 'number' },
        { id: '$Value', name: 'Value', type: 'number', summaryMode: 'none' },
      ],
      children: [
        {
          id: 'subtopic_bankA',
          topicId: 'topic_wealth',
          label: 'Bank A',
          children: [],
          cells: {
            $Amount: { raw: '120000', value: 120000, error: null },
            $Rate: { raw: '0.03', value: 0.03, error: null },
            $Value: { raw: '= $Amount *$Rate', value: 3600, error: null },
          },
        },
        {
          id: 'subtopic_bankB',
          topicId: 'topic_wealth',
          label: 'Bank A',
          children: [],
          cells: {
            $Amount: { raw: '90000', value: 90000, error: null },
            $Rate: { raw: '', value: 0, error: null },
            $Value: { raw: '= $Amount *$Rate', value: 0, error: null },
          },
        },
      ],
    },
  ],
};

describe('v1 migration', () => {
  it('lifts per-cell formulas into Computed Columns', () => {
    const migrated = migrateV1Document(structuredClone(V1_SAMPLE));
    expect(migrated).not.toBeNull();
    const topic = migrated!.cards[0]!;
    const valueColumn = topic.columns.find((column) => column.refName === '$Value')!;

    expect(valueColumn.kind).toBe('computed');
    expect(valueColumn.expression).toBe('= $Amount *$Rate');

    const amountColumn = topic.columns.find((column) => column.refName === '$Amount')!;
    expect(amountColumn.kind).toBe('input');
    expect(amountColumn.rollup).toBe('sum');
  });

  it('keeps literal values keyed by the new column ids and drops formula raws', () => {
    const migrated = migrateV1Document(structuredClone(V1_SAMPLE))!;
    const topic = migrated.cards[0]!;
    const amount = topic.columns.find((column) => column.refName === '$Amount')!;
    const value = topic.columns.find((column) => column.refName === '$Value')!;
    const bankA = topic.children[0]!;

    expect(bankA.values[amount.id]).toBe('120000');
    expect(bankA.values[value.id]).toBeUndefined();
  });

  it('generates unique Reference Names from labels', () => {
    const migrated = migrateV1Document(structuredClone(V1_SAMPLE))!;
    const topic = migrated.cards[0]!;

    expect(topic.refName).toBe('Wealth');
    expect(topic.children.map((node) => node.refName)).toEqual(['BankA', 'BankA_2']);
  });

  it('starts with nothing collapsed and rejects non-v1 payloads', () => {
    const migrated = migrateV1Document(structuredClone(V1_SAMPLE))!;
    expect(migrated.view?.collapsedNodeIds).toEqual([]);

    expect(migrateV1Document({ version: 2 })).toBeNull();
    expect(migrateV1Document('nonsense')).toBeNull();
    expect(migrateV1Document(null)).toBeNull();
  });
});
