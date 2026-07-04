import { TestBed } from '@angular/core/testing';
import { beforeEach, describe, expect, it } from 'vitest';
import { DocumentStoreService } from './document-store.service';

/**
 * These tests pin the history contract from CONTEXT.md: one Document-wide
 * stack, one step per committed edit, view state outside history, and
 * auto-expand on undo/redo.
 */
describe('DocumentStoreService', () => {
  let store: DocumentStoreService;

  const wealth = () => store.cards().find((card) => card.refName === 'Wealth')!;
  const savings = () => wealth().children.find((node) => node.refName === 'Savings')!;
  const bankA = () => savings().children.find((node) => node.refName === 'BankA')!;
  const amountColumn = () => wealth().columns.find((column) => column.refName === '$Amount')!;

  beforeEach(() => {
    localStorage.clear();
    TestBed.configureTestingModule({});
    store = TestBed.inject(DocumentStoreService);
  });

  it('loads the starter document when storage is empty', () => {
    expect(store.cards().map((card) => card.refName)).toEqual(['Wealth', 'Business']);
    expect(store.canUndo()).toBe(false);
  });

  it('migrates v1 localStorage data silently', () => {
    localStorage.clear();
    localStorage.setItem(
      'treetable.v1.state',
      JSON.stringify({
        version: 1,
        title: 'Migrated',
        selectedNodeId: null,
        topics: [
          {
            id: 't1',
            label: 'Old Topic',
            columns: [{ id: '$A', name: 'A', type: 'number', summaryMode: 'sum' }],
            children: [
              {
                id: 'n1',
                topicId: 't1',
                label: 'Leaf',
                children: [],
                cells: { $A: { raw: '42', value: 42, error: null } },
              },
            ],
          },
        ],
      }),
    );

    TestBed.resetTestingModule();
    TestBed.configureTestingModule({});
    const migratedStore = TestBed.inject(DocumentStoreService);

    expect(migratedStore.title()).toBe('Migrated');
    expect(migratedStore.cards()).toHaveLength(1);
    expect(migratedStore.cards()[0]!.columns[0]!.rollup).toBe('sum');
    expect(localStorage.getItem('treetable.v2.document')).not.toBeNull();
  });

  it('records one undo step per committed cell edit', () => {
    const column = amountColumn();
    store.setCellValue(wealth().id, bankA().id, column.id, '999');
    expect(bankA().values[column.id]).toBe('999');
    expect(store.canUndo()).toBe(true);

    store.undo();
    expect(bankA().values[column.id]).toBe('120000');

    store.redo();
    expect(bankA().values[column.id]).toBe('999');
  });

  it('converts a column to computed when a formula is committed — as one atomic step', () => {
    const column = amountColumn();
    store.setCellValue(wealth().id, bankA().id, column.id, '= $Rate * 2');

    expect(amountColumn().kind).toBe('computed');
    expect(amountColumn().expression).toBe('= $Rate * 2');
    expect(bankA().values[column.id]).toBe('120000');

    store.undo();
    expect(amountColumn().kind).toBe('input');
    expect(amountColumn().expression).toBeNull();
  });

  it('keeps collapse outside the undo stack', () => {
    expect(store.canUndo()).toBe(false);
    store.toggleCollapse(savings().id);
    expect(store.collapsedNodeIds().has(savings().id)).toBe(true);
    expect(store.canUndo()).toBe(false);
  });

  it('auto-expands collapsed ancestors when undo changes hidden rows, and redo never re-collapses', () => {
    const column = amountColumn();
    const savingsId = savings().id;

    store.setCellValue(wealth().id, bankA().id, column.id, '777');
    store.toggleCollapse(savingsId);
    expect(store.collapsedNodeIds().has(savingsId)).toBe(true);

    store.undo();
    expect(bankA().values[column.id]).toBe('120000');
    expect(store.collapsedNodeIds().has(savingsId)).toBe(false);

    store.redo();
    expect(bankA().values[column.id]).toBe('777');
    expect(store.collapsedNodeIds().has(savingsId)).toBe(false);
  });

  it('moves a data-bearing Leaf’s values into its first child — atomically', () => {
    const column = amountColumn();
    const cashBefore = wealth().children.find((node) => node.refName === 'Cash')!;
    expect(cashBefore.values[column.id]).toBe('5000');

    store.addChildNode(wealth().id, cashBefore.id);

    const cashAfter = wealth().children.find((node) => node.refName === 'Cash')!;
    expect(cashAfter.children).toHaveLength(1);
    expect(cashAfter.values).toEqual({});
    expect(cashAfter.children[0]!.values[column.id]).toBe('5000');

    store.undo();
    const cashReverted = wealth().children.find((node) => node.refName === 'Cash')!;
    expect(cashReverted.children).toHaveLength(0);
    expect(cashReverted.values[column.id]).toBe('5000');
  });

  it('offers keep-data deletion that hoists values into the parent', () => {
    const column = amountColumn();
    const cash = wealth().children.find((node) => node.refName === 'Cash')!;
    store.addChildNode(wealth().id, cash.id);
    const child = wealth().children.find((node) => node.refName === 'Cash')!.children[0]!;

    expect(store.canOfferKeepDataOnDelete(wealth().id, child.id)).toBe(true);
    store.removeNode(wealth().id, child.id, { keepDataInParent: true });

    const cashAfter = wealth().children.find((node) => node.refName === 'Cash')!;
    expect(cashAfter.children).toHaveLength(0);
    expect(cashAfter.values[column.id]).toBe('5000');
  });

  it('prunes selection and collapse when their nodes are deleted', () => {
    const savingsId = savings().id;
    store.toggleCollapse(savingsId);
    store.selectNode(savingsId);

    store.removeNode(wealth().id, savingsId);

    expect(store.collapsedNodeIds().has(savingsId)).toBe(false);
    expect(store.selectedNodeId()).toBeNull();
  });

  it('guards the last remaining column', () => {
    const business = store.cards().find((card) => card.refName === 'Business')!;
    const result = store.deleteColumn(business.id, business.columns[0]!.id);
    expect(result).toMatchObject({ ok: false });
  });

  it('rejects v1 files on import with a clear message', () => {
    const result = store.importDocument(JSON.stringify({ version: 1, topics: [] }));
    expect(result.ok).toBe(false);
    expect(result.error).toContain('v1');
  });

  it('imports v2 documents as one undoable step', () => {
    const exported = store.exportDocument();
    store.setTitle('Changed');
    const result = store.importDocument(exported);

    expect(result.ok).toBe(true);
    expect(store.title()).toBe('Untitled');

    store.undo();
    expect(store.title()).toBe('Changed');
  });
});
