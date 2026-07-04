import { describe, expect, it } from 'vitest';
import { DocumentV2, NodeV2 } from '../../core/model/document.model';
import { formulaTokenAt, suggestForToken } from './formula-suggest';

const doc: DocumentV2 = {
  version: 2,
  title: 'Test',
  cards: [
    {
      kind: 'topic',
      id: 'topic_wealth',
      refName: 'Wealth',
      displayName: 'Wealth',
      columns: [
        column('col_amount', '$Amount', 'Amount', 'input'),
        column('col_rate', '$Rate', 'Rate', 'input'),
        column('col_bar', '$Bar', 'Bar', 'chart'),
      ],
      children: [
        node('node_savings', 'Savings', [node('node_bank', 'BankA', [])]),
        node('node_cash', 'Cash', []),
      ],
    },
    {
      kind: 'topic',
      id: 'topic_biz',
      refName: 'Business',
      displayName: 'Business',
      columns: [column('col_cost', '$Cost', 'Cost', 'input')],
      children: [],
    },
  ],
};

function column(id: string, refName: string, displayName: string, kind: 'input' | 'chart') {
  return {
    id,
    refName,
    displayName,
    kind,
    valueType: 'number' as const,
    expression: null,
    rollup: 'none' as const,
    chartSource: kind === 'chart' ? '$Amount' : null,
  };
}

function node(id: string, refName: string, children: NodeV2[]): NodeV2 {
  return { id, refName, displayName: refName, accent: null, children, values: {} };
}

function labels(topicId: string, token: string): string[] {
  return suggestForToken(doc, topicId, token).map((suggestion) => suggestion.label);
}

describe('formulaTokenAt', () => {
  it('returns null outside formulas', () => {
    expect(formulaTokenAt('plain text', 5)).toBeNull();
  });

  it('captures the dotted token ending at the caret', () => {
    const value = '= 1 + Wealth.$Amo';
    expect(formulaTokenAt(value, value.length)).toEqual({ token: 'Wealth.$Amo', start: 6 });
    expect(formulaTokenAt('= SUM(', 6)).toEqual({ token: '', start: 6 });
  });
});

describe('suggestForToken', () => {
  it('suggests columns, functions, nodes and topics at the root', () => {
    expect(labels('topic_wealth', '$')).toEqual(['$Amount', '$Rate']);
    expect(labels('topic_wealth', 'S')).toEqual(['SUM(…)', 'Savings']);
    expect(labels('topic_wealth', 'Bus')).toEqual(['Business']);
  });

  it('lists functions before references on an empty token (Ctrl+I)', () => {
    const all = labels('topic_wealth', '');
    expect(all[0]).toBe('SUM(…)');
    expect(all).toHaveLength(8);
    expect(all).toContain('$Amount');
  });

  it('never suggests chart columns', () => {
    expect(labels('topic_wealth', '$B')).toEqual([]);
  });

  it('scopes suggestions behind a topic qualifier', () => {
    expect(labels('topic_biz', 'Wealth.')).toEqual([
      '$Amount',
      '$Rate',
      'Savings',
      'BankA',
      'Cash',
    ]);
  });

  it('scopes suggestions behind a node qualifier', () => {
    expect(labels('topic_wealth', 'Savings.')).toEqual(['$Amount', '$Rate', 'BankA']);
  });

  it('suggests dot aggregates after a column reference', () => {
    expect(labels('topic_wealth', '$Amount.')).toEqual([
      '.sum()',
      '.avg()',
      '.min()',
      '.max()',
      '.count()',
      '.counta()',
      '.countblank()',
    ]);
    expect(labels('topic_wealth', '$Amount.c')).toEqual(['.count()', '.counta()', '.countblank()']);
  });

  it('stays silent when the only match is already fully typed', () => {
    expect(labels('topic_wealth', '$Amount')).toEqual([]);
    expect(labels('topic_wealth', 'nonsense')).toEqual([]);
    expect(labels('topic_wealth', 'Wealth..')).toEqual([]);
  });
});
