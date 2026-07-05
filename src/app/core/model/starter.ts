import { DocumentFileV2 } from './document.model';

/**
 * The document a first-time visitor sees. It deliberately exercises the core
 * concepts: a Branch (Savings) to collapse, a Computed Column, and a Rollup.
 */
export function createStarterDocument(): DocumentFileV2 {
  return structuredClone(STARTER_DOCUMENT);
}

const STARTER_DOCUMENT: DocumentFileV2 = {
  version: 2,
  title: 'Untitled',
  pages: [
    {
      id: 'page_1',
      name: 'Page 1',
      stacks: [
        { id: 'stack_wealth', cardIds: ['topic_wealth'] },
        { id: 'stack_business', cardIds: ['topic_business'] },
      ],
    },
  ],
  cards: [
    {
      kind: 'topic',
      id: 'topic_wealth',
      refName: 'Wealth',
      displayName: 'Wealth',
      columns: [
        {
          id: 'col_wealth_amount',
          refName: '$Amount',
          displayName: 'Amount',
          kind: 'input',
          valueType: 'number',
          expression: null,
          rollup: 'sum',
        },
        {
          id: 'col_wealth_rate',
          refName: '$Rate',
          displayName: 'Rate',
          kind: 'input',
          valueType: 'number',
          expression: null,
          rollup: 'none',
        },
        {
          id: 'col_wealth_yield',
          refName: '$Yield',
          displayName: 'Yield',
          kind: 'computed',
          valueType: 'number',
          expression: '= $Amount * $Rate',
          rollup: 'sum',
        },
      ],
      children: [
        {
          id: 'node_savings',
          refName: 'Savings',
          displayName: 'Savings',
          accent: 'sky',
          values: {},
          children: [
            {
              id: 'node_bank_a',
              refName: 'BankA',
              displayName: 'Bank A',
              accent: null,
              children: [],
              values: {
                col_wealth_amount: '120000',
                col_wealth_rate: '0.03',
              },
            },
            {
              id: 'node_bank_b',
              refName: 'BankB',
              displayName: 'Bank B',
              accent: null,
              children: [],
              values: {
                col_wealth_amount: '90000',
                col_wealth_rate: '0.05',
              },
            },
          ],
        },
        {
          id: 'node_cash',
          refName: 'Cash',
          displayName: 'Cash',
          accent: 'emerald',
          children: [],
          values: {
            col_wealth_amount: '5000',
            col_wealth_rate: '0',
          },
        },
      ],
    },
    {
      kind: 'topic',
      id: 'topic_business',
      refName: 'Business',
      displayName: 'Business',
      columns: [
        {
          id: 'col_business_amount',
          refName: '$Amount',
          displayName: 'Amount',
          kind: 'input',
          valueType: 'number',
          expression: null,
          rollup: 'sum',
        },
      ],
      children: [
        {
          id: 'node_dividend',
          refName: 'Dividend',
          displayName: 'Dividend',
          accent: null,
          children: [],
          values: {
            col_business_amount: '30000',
          },
        },
        {
          id: 'node_family',
          refName: 'FamilyCompany',
          displayName: 'Family Company',
          accent: null,
          children: [],
          values: {
            col_business_amount: '45000',
          },
        },
      ],
    },
  ],
  view: {
    collapsedNodeIds: [],
  },
};
