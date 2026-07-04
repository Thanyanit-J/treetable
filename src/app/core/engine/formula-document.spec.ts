import { describe, expect, it } from 'vitest';
import { ColumnV2, DocumentV2, NodeV2, TopicCardV2 } from '../model/document.model';
import { evaluateDocument } from './formula-evaluator';

/** Document-scoped resolution: subtree refs, cross-topic refs, shadowing, cycles (ADR-0003). */

function column(id: string, refName: string, expression: string | null = null): ColumnV2 {
  return {
    id,
    refName,
    displayName: refName.slice(1),
    kind: expression === null ? 'input' : 'computed',
    valueType: 'number',
    expression,
    rollup: 'none',
  };
}

function node(
  id: string,
  refName: string,
  values: Record<string, string> = {},
  children: NodeV2[] = [],
): NodeV2 {
  return { id, refName, displayName: refName, accent: null, values, children };
}

function topic(id: string, refName: string, columns: ColumnV2[], children: NodeV2[]): TopicCardV2 {
  return { kind: 'topic', id, refName, displayName: refName, columns, children };
}

function buildDocument(
  extraWealthColumns: ColumnV2[] = [],
  extraBusinessColumns: ColumnV2[] = [],
): DocumentV2 {
  return {
    version: 2,
    title: 'Test',
    cards: [
      topic(
        'topic_wealth',
        'Wealth',
        [column('w_amount', '$Amount'), column('w_rate', '$Rate'), ...extraWealthColumns],
        [
          node('n_savings', 'Savings', {}, [
            node('n_bank_a', 'BankA', { w_amount: '120000', w_rate: '0.03' }),
            node('n_bank_b', 'BankB', { w_amount: '90000', w_rate: '0.05' }),
          ]),
          node('n_cash', 'Cash', { w_amount: '5000', w_rate: '0' }),
        ],
      ),
      topic(
        'topic_business',
        'Business',
        [column('b_x', '$X'), ...extraBusinessColumns],
        [node('n_dividend', 'Dividend', { b_x: '30000' })],
      ),
    ],
  };
}

function cellOf(document: DocumentV2, topicId: string, leafId: string, columnId: string) {
  const cell = evaluateDocument(document)
    .topics.get(topicId)
    ?.computedCells.get(leafId)
    ?.get(columnId);
  if (!cell) {
    throw new Error(`no computation for ${topicId}/${leafId}/${columnId}`);
  }
  return cell;
}

describe('document-scoped references', () => {
  it('aggregates a Branch subtree by its Reference Name', () => {
    const document = buildDocument([column('w_sub', '$SavingsSum', '= SUM(Savings.$Amount)')]);
    expect(cellOf(document, 'topic_wealth', 'n_cash', 'w_sub').value).toBe(210000);
  });

  it('resolves a Leaf reference as a scalar', () => {
    const document = buildDocument([column('w_cashref', '$CashPlus', '= Cash.$Amount + 1')]);
    expect(cellOf(document, 'topic_wealth', 'n_bank_a', 'w_cashref').value).toBe(5001);
  });

  it('rejects a Branch reference used as a scalar, suggesting an aggregate', () => {
    const document = buildDocument([column('w_bad', '$Bad', '= Savings.$Amount + 1')]);
    expect(cellOf(document, 'topic_wealth', 'n_cash', 'w_bad').error).toContain(
      'wrap it in an aggregate like SUM(Savings.$Amount)',
    );
  });

  it('reads whole columns across Topics', () => {
    const document = buildDocument([], [column('b_fw', '$FromWealth', '= SUM(Wealth.$Amount)')]);
    expect(cellOf(document, 'topic_business', 'n_dividend', 'b_fw').value).toBe(215000);
  });

  it('reads subtree and leaf references across Topics', () => {
    const document = buildDocument(
      [],
      [
        column('b_sav', '$Sav', '= SUM(Wealth.Savings.$Amount)'),
        column('b_cash', '$CashTwice', '= Wealth.Cash.$Amount * 2'),
      ],
    );
    expect(cellOf(document, 'topic_business', 'n_dividend', 'b_sav').value).toBe(210000);
    expect(cellOf(document, 'topic_business', 'n_dividend', 'b_cash').value).toBe(10000);
  });

  it('counts over a subtree', () => {
    const document = buildDocument([column('w_count', '$N', '= COUNT(Savings.$Amount)')]);
    expect(cellOf(document, 'topic_wealth', 'n_cash', 'w_count').value).toBe(2);
  });

  it('lets Node Reference Names shadow Topic Reference Names inside their Topic', () => {
    const document = buildDocument([], [column('b_shadow', '$Shadow', '= SUM(Wealth.$X)')]);
    const business = document.cards[1]!;
    business.children.push(node('n_wealth_node', 'Wealth', { b_x: '7' }));

    // Inside Business, `Wealth` binds to the local node (values 7), not the Wealth topic.
    expect(cellOf(document, 'topic_business', 'n_dividend', 'b_shadow').value).toBe(7);
  });

  it('detects cycles that span Topics', () => {
    const document = buildDocument(
      [column('w_a2', '$A2', '= SUM(Business.$B2)')],
      [column('b_b2', '$B2', '= SUM(Wealth.$A2)')],
    );
    expect(cellOf(document, 'topic_wealth', 'n_cash', 'w_a2').error).toBe('Circular reference');
    expect(cellOf(document, 'topic_business', 'n_dividend', 'b_b2').error).toBe(
      'Circular reference',
    );
  });

  it('degrades unknown Topics and Nodes to visible errors', () => {
    const document = buildDocument([
      column('w_missing', '$Missing', '= SUM(Nowhere.$X)'),
      column('w_missing2', '$Missing2', '= SUM(Wealth.Nobody.$Amount)'),
    ]);
    expect(cellOf(document, 'topic_wealth', 'n_cash', 'w_missing').error).toBe(
      'Unknown reference: Nowhere',
    );
    expect(cellOf(document, 'topic_wealth', 'n_cash', 'w_missing2').error).toBe(
      'Unknown node in Wealth: Nobody',
    );
  });
});
