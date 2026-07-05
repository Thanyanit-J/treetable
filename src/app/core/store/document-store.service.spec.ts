import { TestBed } from '@angular/core/testing';
import { beforeEach, describe, expect, it } from 'vitest';
import { isTopicCard } from '../model/document.model';
import { DocumentStoreService } from './document-store.service';

/**
 * These tests pin the history contract from CONTEXT.md: one Document-wide
 * stack, one step per committed edit, view state outside history, and
 * auto-expand on undo/redo.
 */
describe('DocumentStoreService', () => {
  let store: DocumentStoreService;

  const topics = () => store.cards().filter(isTopicCard);
  const wealth = () => topics().find((card) => card.refName === 'Wealth')!;
  const savings = () => wealth().children.find((node) => node.refName === 'Savings')!;
  const bankA = () => savings().children.find((node) => node.refName === 'BankA')!;
  const amountColumn = () => wealth().columns.find((column) => column.refName === '$Amount')!;
  const chartCard = () => {
    const card = store.cards().find((candidate) => candidate.kind === 'chartcard');
    if (card?.kind !== 'chartcard') {
      throw new Error('chart card missing');
    }
    return card;
  };

  beforeEach(() => {
    localStorage.clear();
    TestBed.configureTestingModule({});
    store = TestBed.inject(DocumentStoreService);
  });

  it('loads the starter document when storage is empty', () => {
    expect(topics().map((card) => card.refName)).toEqual(['Wealth', 'Business']);
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
    expect(migratedStore.cards().filter(isTopicCard)[0]!.columns[0]!.rollup).toBe('sum');
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

  it('freezes formula results into values when a computed column becomes input', () => {
    const column = amountColumn();
    store.setCellValue(wealth().id, bankA().id, column.id, '= 2 * 3');
    expect(amountColumn().kind).toBe('computed');

    store.setColumnKind(wealth().id, column.id, 'input');
    expect(amountColumn().kind).toBe('input');
    expect(amountColumn().expression).toBeNull();
    expect(bankA().values[column.id]).toBe('6');

    store.undo();
    expect(amountColumn().kind).toBe('computed');
    expect(amountColumn().expression).toBe('= 2 * 3');
  });

  it('materializes the sibling cells when typing a plain value into a computed cell', () => {
    const column = amountColumn();
    store.setCellValue(wealth().id, bankA().id, column.id, '= 2 * 3');
    store.setCellValue(wealth().id, bankA().id, column.id, '9');

    expect(amountColumn().kind).toBe('input');
    expect(bankA().values[column.id]).toBe('9');
    const bankB = savings().children.find((node) => node.refName === 'BankB')!;
    expect(bankB.values[column.id]).toBe('6');
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
    store.select({ kind: 'node', topicId: wealth().id, nodeId: savingsId });

    store.removeNode(wealth().id, savingsId);

    expect(store.collapsedNodeIds().has(savingsId)).toBe(false);
    expect(store.selectedNodeId()).toBeNull();
    expect(store.selection()).toBeNull();
  });

  describe('clipboard', () => {
    it('copies a node with subtree and rows; paste inserts a fresh clone as a child', () => {
      const column = amountColumn();
      const cashId = wealth().children.find((node) => node.refName === 'Cash')!.id;

      store.copyNode(wealth().id, savings().id);
      store.pasteNode(wealth().id, cashId);

      const cash = wealth().children.find((node) => node.refName === 'Cash')!;
      // Cash had data → carrier child spawned, then the pasted clone.
      expect(cash.children.map((node) => node.displayName)).toEqual(['Cash', 'Savings']);
      const pasted = cash.children[1]!;
      expect(pasted.refName).toBe('Savings_2');
      expect(pasted.children.map((node) => node.refName)).toEqual(['BankA_2', 'BankB_2']);
      expect(pasted.children[0]!.values[column.id]).toBe('120000');
      expect(pasted.id).not.toBe(savings().id);

      // Original stays (it was a copy, not a cut).
      expect(wealth().children.map((node) => node.refName)).toEqual(['Savings', 'Cash']);
    });

    it('cut moves on paste — atomically, and only once', () => {
      const cashId = wealth().children.find((node) => node.refName === 'Cash')!.id;
      const stepsBefore = store.canUndo();

      store.copyNode(wealth().id, savings().id, true);
      expect(store.canUndo()).toBe(stepsBefore); // cut alone edits nothing

      store.pasteNode(wealth().id, cashId);
      const cash = wealth().children.find((node) => node.refName === 'Cash')!;
      expect(wealth().children.map((node) => node.refName)).toEqual(['Cash']);
      expect(cash.children.some((node) => node.refName === 'Savings')).toBe(true);

      store.undo();
      expect(wealth().children.map((node) => node.refName)).toEqual(['Savings', 'Cash']);
    });

    it('copies and pastes cell blocks via the selection', () => {
      const column = amountColumn();
      const bankAId = bankA().id;
      const bankBId = savings().children.find((node) => node.refName === 'BankB')!.id;

      store.select({ kind: 'cell', topicId: wealth().id, nodeId: bankAId, columnId: column.id });
      store.copySelection();
      store.select({ kind: 'cell', topicId: wealth().id, nodeId: bankBId, columnId: column.id });
      store.pasteSelection();

      const bankB = savings().children.find((node) => node.refName === 'BankB')!;
      expect(bankB.values[column.id]).toBe('120000');
    });

    it('clears a selected range of input cells', () => {
      const column = amountColumn();
      const bankAId = bankA().id;
      const bankBId = savings().children.find((node) => node.refName === 'BankB')!.id;

      store.select({
        kind: 'range',
        topicId: wealth().id,
        anchor: { nodeId: bankAId, columnId: column.id },
        focus: { nodeId: bankBId, columnId: column.id },
      });
      store.clearSelectedCells();

      expect(bankA().values[column.id]).toBeUndefined();
      expect(savings().children[1]!.values[column.id]).toBeUndefined();
    });
  });

  describe('column ops', () => {
    it('reorders columns', () => {
      const ids = () => wealth().columns.map((column) => column.refName);
      expect(ids()).toEqual(['$Amount', '$Rate', '$Yield']);
      store.moveColumn(wealth().id, amountColumn().id, 2);
      expect(ids()).toEqual(['$Rate', '$Yield', '$Amount']);
      store.undo();
      expect(ids()).toEqual(['$Amount', '$Rate', '$Yield']);
    });

    it('switches column kinds between value and formula', () => {
      const rate = () => wealth().columns.find((column) => column.refName === '$Rate')!;

      store.setColumnKind(wealth().id, rate().id, 'computed');
      expect(rate().kind).toBe('computed');
      expect(rate().expression).toBe('= ');

      store.setColumnKind(wealth().id, rate().id, 'input');
      expect(rate().kind).toBe('input');
      expect(rate().expression).toBeNull();
    });
  });

  describe('reference name sync', () => {
    it('renaming a column re-derives its Reference Name and rewrites formulas', () => {
      const columnId = amountColumn().id;
      store.renameColumn(wealth().id, columnId, 'Cash Total');

      const renamed = wealth().columns.find((column) => column.id === columnId)!;
      expect(renamed.displayName).toBe('Cash Total');
      expect(renamed.refName).toBe('$CashTotal');
      const yieldColumn = wealth().columns.find((column) => column.displayName === 'Yield')!;
      expect(yieldColumn.expression).toBe('= $CashTotal * $Rate');

      store.undo();
      expect(wealth().columns.find((column) => column.id === columnId)!.refName).toBe('$Amount');
      expect(wealth().columns.find((column) => column.displayName === 'Yield')!.expression).toBe(
        '= $Amount * $Rate',
      );
    });

    it('unsynced Reference Names ignore display renames until re-synced', () => {
      const columnId = amountColumn().id;
      const target = { kind: 'column' as const, topicId: wealth().id, entityId: columnId };

      store.setRefNameSync(target, false);
      store.renameColumn(wealth().id, columnId, 'Cash');
      expect(wealth().columns.find((column) => column.id === columnId)!.refName).toBe('$Amount');

      store.setRefNameSync(target, true);
      expect(wealth().columns.find((column) => column.id === columnId)!.refName).toBe('$Cash');
      expect(wealth().columns.find((column) => column.id === columnId)!.customRefName).toBeFalsy();
    });

    it('manual setRefName marks the name custom so later renames keep it', () => {
      const columnId = amountColumn().id;
      store.setRefName({ kind: 'column', topicId: wealth().id, entityId: columnId }, '$Money');
      store.renameColumn(wealth().id, columnId, 'Something Else');
      expect(wealth().columns.find((column) => column.id === columnId)!.refName).toBe('$Money');
    });

    it('node and topic renames keep their Reference Names in sync', () => {
      const bankId = bankA().id;
      store.renameNode(wealth().id, bankId, 'Bank Alpha');
      expect(savings().children.find((node) => node.id === bankId)!.refName).toBe('BankAlpha');

      store.renameCard(wealth().id, 'Fortune');
      expect(topics().find((card) => card.displayName === 'Fortune')!.refName).toBe('Fortune');
    });
  });

  it('guards the last remaining column', () => {
    const business = topics().find((card) => card.refName === 'Business')!;
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

  describe('moveNode / moveCard', () => {
    it('reorders siblings with post-removal index semantics', () => {
      const cash = wealth().children.find((node) => node.refName === 'Cash')!;
      store.moveNode(wealth().id, cash.id, null, 0);
      expect(wealth().children.map((node) => node.refName)).toEqual(['Cash', 'Savings']);

      store.undo();
      expect(wealth().children.map((node) => node.refName)).toEqual(['Savings', 'Cash']);
    });

    it('re-parents a node (with subtree) by appending to the target', () => {
      const cash = wealth().children.find((node) => node.refName === 'Cash')!;
      store.moveNode(wealth().id, cash.id, savings().id, Number.MAX_SAFE_INTEGER);

      expect(wealth().children.map((node) => node.refName)).toEqual(['Savings']);
      expect(savings().children.map((node) => node.refName)).toEqual(['BankA', 'BankB', 'Cash']);
    });

    it('refuses moves into the node’s own subtree without polluting history', () => {
      const before = store.canUndo();
      store.moveNode(wealth().id, savings().id, bankA().id, 0);

      expect(wealth().children.map((node) => node.refName)).toEqual(['Savings', 'Cash']);
      expect(store.canUndo()).toBe(before);
    });

    it('spawns a carrier child when dropping onto a data-bearing Leaf — atomically', () => {
      const column = amountColumn();
      const cash = wealth().children.find((node) => node.refName === 'Cash')!;
      store.moveNode(wealth().id, bankA().id, cash.id, Number.MAX_SAFE_INTEGER);

      const cashAfter = wealth().children.find((node) => node.refName === 'Cash')!;
      expect(cashAfter.values).toEqual({});
      expect(cashAfter.children.map((node) => node.displayName)).toEqual(['Cash', 'Bank A']);
      expect(cashAfter.children[0]!.values[column.id]).toBe('5000');

      store.undo();
      const cashReverted = wealth().children.find((node) => node.refName === 'Cash')!;
      expect(cashReverted.children).toHaveLength(0);
      expect(cashReverted.values[column.id]).toBe('5000');
      expect(savings().children.map((node) => node.refName)).toEqual(['BankA', 'BankB']);
    });

    it('reorders rail stacks on the active page', () => {
      const pageId = store.activePage().id;
      store.moveStack(pageId, 1, 0);
      expect(
        store.activeStacks().map((stack) => stack.cards.filter(isTopicCard)[0]!.refName),
      ).toEqual(['Business', 'Wealth']);

      store.undo();
      expect(
        store.activeStacks().map((stack) => stack.cards.filter(isTopicCard)[0]!.refName),
      ).toEqual(['Wealth', 'Business']);
    });
  });

  describe('pages', () => {
    it('adds, renames, reorders and removes pages (cards die with their page)', () => {
      expect(store.pages().map((page) => page.name)).toEqual(['Page 1']);

      store.addPage();
      expect(store.pages()).toHaveLength(2);
      expect(store.activePage().name).toBe('Page 2');
      expect(store.activeStacks()).toEqual([]);

      store.renamePage(store.activePage().id, 'Scratch');
      expect(store.activePage().name).toBe('Scratch');

      store.movePage(1, 0);
      expect(store.pages().map((page) => page.name)).toEqual(['Scratch', 'Page 1']);

      const dataPageId = store.pages()[1]!.id;
      expect(store.pageCardCount(dataPageId)).toBe(2);
      store.removePage(dataPageId);
      expect(store.pages().map((page) => page.name)).toEqual(['Scratch']);
      expect(store.cards()).toHaveLength(0);

      // The one remaining page can never be deleted.
      store.removePage(store.pages()[0]!.id);
      expect(store.pages()).toHaveLength(1);
    });

    it('keeps the active page valid when undo restores a deleted page', () => {
      store.addPage();
      const scratchId = store.activePage().id;
      store.removePage(scratchId);
      expect(store.activePage().name).toBe('Page 1');

      store.undo();
      expect(store.pages()).toHaveLength(2);
      store.selectPage(scratchId);
      expect(store.activePage().id).toBe(scratchId);
    });

    it('new topics land on the active page', () => {
      store.addPage();
      store.addTopic('Fresh');
      expect(store.activeStacks()).toHaveLength(1);
      const fresh = store.activeStacks()[0]!.cards[0]!;
      expect(fresh.kind === 'topic' ? fresh.displayName : null).toBe('Fresh');
    });
  });

  describe('chart columns', () => {
    it('converts a column to a bar chart, guarding invalid sources', () => {
      const rate = wealth().columns.find((column) => column.refName === '$Rate')!;
      store.setColumnChart(wealth().id, rate.id, '$Amount');
      expect(wealth().columns.find((column) => column.id === rate.id)).toMatchObject({
        kind: 'chart',
        chartSource: '$Amount',
        rollup: 'none',
      });

      // A chart cannot source another chart column.
      const yieldColumn = wealth().columns.find((column) => column.refName === '$Yield')!;
      store.setColumnChart(wealth().id, yieldColumn.id, '$Rate');
      expect(wealth().columns.find((column) => column.id === yieldColumn.id)!.kind).toBe(
        'computed',
      );

      // Chart Columns never change type — re-point or delete them instead.
      store.setColumnKind(wealth().id, rate.id, 'input');
      expect(wealth().columns.find((column) => column.id === rate.id)!.kind).toBe('chart');

      store.undo();
      expect(wealth().columns.find((column) => column.id === rate.id)!.kind).toBe('input');
    });

    it('adds a chart column right after its source', () => {
      const rate = wealth().columns.find((column) => column.refName === '$Rate')!;
      store.addChartColumn(wealth().id, rate.id);

      expect(wealth().columns.map((column) => column.refName)).toEqual([
        '$Amount',
        '$Rate',
        '$Ratechart',
        '$Yield',
      ]);
      expect(wealth().columns[2]).toMatchObject({
        kind: 'chart',
        chartSource: '$Rate',
        displayName: 'Rate chart',
      });

      // Charting a chart is refused.
      store.addChartColumn(wealth().id, wealth().columns[2]!.id);
      expect(wealth().columns).toHaveLength(4);

      store.undo();
      expect(wealth().columns).toHaveLength(3);
    });

    it('keeps chartSource in sync with column Reference Name edits', () => {
      const rate = wealth().columns.find((column) => column.refName === '$Rate')!;
      store.setColumnChart(wealth().id, rate.id, '$Amount');

      const amount = amountColumn();
      store.setRefName({ kind: 'column', topicId: wealth().id, entityId: amount.id }, '$Cash');
      expect(wealth().columns.find((column) => column.id === rate.id)!.chartSource).toBe('$Cash');
    });

    it('keeps Charts card configs in sync with column renames', () => {
      store.addChartCard(wealth().id);
      const chartId = chartCard().charts[0]!.id;
      expect(chartCard().charts[0]!.columns).toEqual(['$Amount']);

      store.setChartColumnsIncluded(chartCard().id, chartId, ['$Rate'], true);
      expect(chartCard().charts[0]!.columns).toEqual(['$Amount', '$Rate']);

      const amount = amountColumn();
      store.setRefName({ kind: 'column', topicId: wealth().id, entityId: amount.id }, '$Cash');
      expect(chartCard().charts[0]!.columns).toEqual(['$Cash', '$Rate']);
    });

    it('batches source include/exclude as one undo step, appending in table order', () => {
      store.addChartCard(wealth().id);
      const chartId = chartCard().charts[0]!.id;

      store.setChartColumnsIncluded(chartCard().id, chartId, ['$Yield', '$Rate'], true);
      expect(chartCard().charts[0]!.columns).toEqual(['$Amount', '$Rate', '$Yield']);

      store.undo();
      expect(chartCard().charts[0]!.columns).toEqual(['$Amount']);
      store.redo();

      // Excluding everything is refused; excluding a real subset is one step.
      store.setChartColumnsIncluded(chartCard().id, chartId, ['$Amount', '$Rate', '$Yield'], false);
      expect(chartCard().charts[0]!.columns).toEqual(['$Amount', '$Rate', '$Yield']);
      store.setChartColumnsIncluded(chartCard().id, chartId, ['$Amount', '$Yield'], false);
      expect(chartCard().charts[0]!.columns).toEqual(['$Rate']);
      store.undo();
      expect(chartCard().charts[0]!.columns).toEqual(['$Amount', '$Rate', '$Yield']);
    });

    it('manages chart rows: all Leaves by default, branches includable, tree-ordered', () => {
      const bankB = () => savings().children.find((node) => node.refName === 'BankB')!;
      const cash = () => wealth().children.find((node) => node.refName === 'Cash')!;
      store.addChartCard(wealth().id);
      const chartId = chartCard().charts[0]!.id;
      expect(chartCard().charts[0]!.rows).toBeUndefined();

      store.setChartRowsIncluded(chartCard().id, chartId, [bankA().id], false);
      expect(chartCard().charts[0]!.rows).toEqual([bankB().id, cash().id]);

      store.setChartRowsIncluded(chartCard().id, chartId, [savings().id, bankA().id], true);
      expect(chartCard().charts[0]!.rows).toEqual([
        savings().id,
        bankA().id,
        bankB().id,
        cash().id,
      ]);

      // Back to exactly "every Leaf" collapses to the default.
      store.setChartRowsIncluded(chartCard().id, chartId, [savings().id], false);
      expect(chartCard().charts[0]!.rows).toBeUndefined();

      // Excluding every row is refused.
      store.setChartRowsIncluded(
        chartCard().id,
        chartId,
        [bankA().id, bankB().id, cash().id],
        false,
      );
      expect(chartCard().charts[0]!.rows).toBeUndefined();
    });

    it('re-syncs chart source order when table columns are reordered', () => {
      store.addChartCard(wealth().id);
      const chartId = chartCard().charts[0]!.id;
      store.setChartColumnsIncluded(chartCard().id, chartId, ['$Rate'], true);
      expect(chartCard().charts[0]!.columns).toEqual(['$Amount', '$Rate']);

      const rate = wealth().columns.find((column) => column.refName === '$Rate')!;
      store.moveColumn(wealth().id, rate.id, 0);
      expect(wealth().columns.map((column) => column.refName)).toEqual([
        '$Rate',
        '$Amount',
        '$Yield',
      ]);
      expect(chartCard().charts[0]!.columns).toEqual(['$Rate', '$Amount']);
    });
  });

  describe('insertColumnsAdjacent', () => {
    it('adds one column per distinct reference, right of each, as one undo step', () => {
      const amount = amountColumn();
      const rate = wealth().columns.find((column) => column.refName === '$Rate')!;

      // Duplicate ids (several cells of one column) collapse to one insert.
      store.insertColumnsAdjacent(wealth().id, [amount.id, rate.id, amount.id], 'right');

      expect(wealth().columns.map((column) => column.displayName)).toEqual([
        'Amount',
        'New Column',
        'Rate',
        'New Column',
        'Yield',
      ]);
      const refNames = wealth().columns.map((column) => column.refName);
      expect(new Set(refNames).size).toBe(refNames.length);

      store.undo();
      expect(wealth().columns).toHaveLength(3);
    });
  });

  describe('bulk summaries', () => {
    it('sets the Summary of several columns as one undo step', () => {
      const ids = [
        wealth().columns.find((column) => column.refName === '$Amount')!.id,
        wealth().columns.find((column) => column.refName === '$Rate')!.id,
      ];
      store.setColumnsRollup(wealth().id, ids, 'avg');
      expect(wealth().columns.map((column) => column.rollup)).toEqual(['avg', 'avg', 'sum']);

      store.undo();
      expect(wealth().columns.map((column) => column.rollup)).toEqual(['sum', 'none', 'sum']);
    });
  });

  describe('chart cards', () => {
    const business = () => topics().find((card) => card.refName === 'Business')!;

    it('lands as its own stack immediately right of the source card, selected', () => {
      store.addChartCard(wealth().id);

      const stacks = store.pages()[0]!.stacks;
      const wealthIndex = stacks.findIndex((stack) => stack.cardIds.includes(wealth().id));
      const chartIndex = stacks.findIndex((stack) => stack.cardIds.includes(chartCard().id));
      expect(wealthIndex).toBeGreaterThanOrEqual(0);
      expect(chartIndex).toBe(wealthIndex + 1);
      expect(stacks[chartIndex]!.cardIds).toEqual([chartCard().id]);

      // Opens straight into chart configuration.
      expect(store.selection()).toEqual({
        kind: 'chart',
        topicId: chartCard().id,
        chartId: chartCard().charts[0]!.id,
      });
    });

    it('migrates embedded topic charts into a Charts card beside the table', () => {
      localStorage.clear();
      localStorage.setItem(
        'treetable.v2.document',
        JSON.stringify({
          version: 2,
          title: 'Legacy',
          cards: [
            {
              kind: 'topic',
              id: 't1',
              refName: 'T1',
              displayName: 'T1',
              columns: [
                {
                  id: 'c1',
                  refName: '$A',
                  displayName: 'A',
                  kind: 'input',
                  valueType: 'number',
                  expression: null,
                  rollup: 'none',
                },
              ],
              children: [],
              charts: [{ id: 'ch1', type: 'pie', columns: ['$A'] }],
            },
            {
              kind: 'topic',
              id: 't2',
              refName: 'T2',
              displayName: 'T2',
              columns: [],
              children: [],
            },
          ],
          pages: [
            {
              id: 'p1',
              name: 'Page 1',
              stacks: [
                { id: 's1', cardIds: ['t1'] },
                { id: 's2', cardIds: ['t2'] },
              ],
            },
          ],
        }),
      );

      TestBed.resetTestingModule();
      TestBed.configureTestingModule({});
      const migrated = TestBed.inject(DocumentStoreService);

      const card = migrated.cards().find((candidate) => candidate.kind === 'chartcard');
      if (card?.kind !== 'chartcard') {
        throw new Error('migrated chart card missing');
      }
      expect(card.sourceTopicId).toBe('t1');
      expect(card.charts).toEqual([{ id: 'ch1', type: 'pie', columns: ['$A'] }]);

      const t1 = migrated.cards().find((candidate) => candidate.id === 't1')!;
      expect('charts' in t1).toBe(false);

      // Laid out between its source table and the next stack.
      const stackCards = migrated.pages()[0]!.stacks.map((stack) => stack.cardIds[0]);
      expect(stackCards).toEqual(['t1', card.id, 't2']);
    });

    it('re-points a Charts card at another Topic, resetting stale rows', () => {
      store.addChartCard(wealth().id);
      const chartId = chartCard().charts[0]!.id;
      store.setChartRowsIncluded(chartCard().id, chartId, [bankA().id], false);
      expect(chartCard().charts[0]!.rows).toBeDefined();

      store.setChartCardSource(chartCard().id, business().id);
      expect(chartCard().sourceTopicId).toBe(business().id);
      const businessRefs = new Set(business().columns.map((column) => column.refName));
      const columns = chartCard().charts[0]!.columns;
      expect(columns.length).toBeGreaterThan(0);
      for (const ref of columns) {
        expect(businessRefs.has(ref)).toBe(true);
      }
      // Old node ids mean nothing in the new tree — back to every Leaf.
      expect(chartCard().charts[0]!.rows).toBeUndefined();
    });

    it('deleting the only chart of a Charts card deletes the card', () => {
      store.addChartCard(wealth().id);
      store.removeOwnedChart(chartCard().id, chartCard().charts[0]!.id);
      expect(store.cards().some((candidate) => candidate.kind === 'chartcard')).toBe(false);

      store.undo();
      expect(chartCard().charts).toHaveLength(1);
    });
  });

  describe('chart axis options', () => {
    it('stores the swapped category axis and horizontal direction sparsely', () => {
      store.addChartCard(wealth().id);
      const chartId = chartCard().charts[0]!.id;

      store.setChartCategoryAxis(chartCard().id, chartId, 'columns');
      store.setChartHorizontal(chartCard().id, chartId, true);
      expect(chartCard().charts[0]).toMatchObject({ categoryAxis: 'columns', horizontal: true });

      store.setChartCategoryAxis(chartCard().id, chartId, 'rows');
      store.setChartHorizontal(chartCard().id, chartId, false);
      expect(chartCard().charts[0]!.categoryAxis).toBeUndefined();
      expect(chartCard().charts[0]!.horizontal).toBeUndefined();
    });

    it('ignores a repeat of the current axis (no history step)', () => {
      store.addChartCard(wealth().id);
      const chartId = chartCard().charts[0]!.id;
      store.setChartCategoryAxis(chartCard().id, chartId, 'rows'); // already the default

      store.undo(); // must undo addChartCard, not an axis no-op
      expect(store.cards().some((candidate) => candidate.kind === 'chartcard')).toBe(false);
    });
  });

  describe('card sizing', () => {
    it('fixes a dragged dimension, clamped to bounds', () => {
      store.setCardSize(wealth().id, { width: 5000 });
      expect(wealth().sizing).toEqual({ width: 1600 });

      store.setCardSize(wealth().id, { height: 12 });
      expect(wealth().sizing).toEqual({ width: 1600, height: 160 });

      store.undo();
      store.undo();
      expect(wealth().sizing).toBeUndefined();
    });

    it('releasing every dimension returns the card to grow-with-content', () => {
      store.setCardSize(wealth().id, { width: 480, height: 400 });
      store.setCardSize(wealth().id, { width: null, height: null });
      expect(wealth().sizing).toBeUndefined();
    });

    it('treats a same-size drag as a no-op', () => {
      store.setCardSize(wealth().id, { width: 480 });
      const steps = store.canUndo();
      store.setCardSize(wealth().id, { width: 480 });
      store.undo();
      expect(steps).toBe(true);
      expect(wealth().sizing).toBeUndefined();
    });
  });

  describe('column sizing', () => {
    it('stores a dragged width (clamped) and releases back to auto', () => {
      const column = amountColumn();
      store.setColumnWidth(wealth().id, column.id, 20);
      expect(amountColumn().width).toBe(48);

      store.setColumnWidth(wealth().id, column.id, 240);
      expect(amountColumn().width).toBe(240);

      store.setColumnWidth(wealth().id, column.id, null);
      expect(amountColumn().width).toBeUndefined();
    });

    it('toggles wrap sparsely with no-op guards', () => {
      const column = amountColumn();
      store.setColumnWrap(wealth().id, column.id, false); // already clipping
      expect(store.canUndo()).toBe(false);

      store.setColumnWrap(wealth().id, column.id, true);
      expect(amountColumn().wrap).toBe(true);

      store.setColumnWrap(wealth().id, column.id, false);
      expect(amountColumn().wrap).toBeUndefined();
    });
  });

  describe('setRefName', () => {
    const REF_FIXTURE = {
      version: 2,
      title: 'Refs',
      pages: [],
      cards: [
        {
          kind: 'topic',
          id: 'topic_wealth',
          refName: 'Wealth',
          displayName: 'Wealth',
          columns: [
            {
              id: 'w_amount',
              refName: '$Amount',
              displayName: 'Amount',
              kind: 'input',
              valueType: 'number',
              expression: null,
              rollup: 'none',
            },
            {
              id: 'w_rate',
              refName: '$Rate',
              displayName: 'Rate',
              kind: 'input',
              valueType: 'number',
              expression: null,
              rollup: 'none',
            },
            {
              id: 'w_yield',
              refName: '$Yield',
              displayName: 'Yield',
              kind: 'computed',
              valueType: 'number',
              expression: '= $Amount * $Rate',
              rollup: 'none',
            },
            {
              id: 'w_savsum',
              refName: '$SavSum',
              displayName: 'SavSum',
              kind: 'computed',
              valueType: 'number',
              expression: '= SUM(Savings.$Amount)',
              rollup: 'none',
            },
          ],
          children: [
            {
              id: 'n_savings',
              refName: 'Savings',
              displayName: 'Savings',
              accent: null,
              values: {},
              children: [
                {
                  id: 'n_bank_a',
                  refName: 'BankA',
                  displayName: 'Bank A',
                  accent: null,
                  values: { w_amount: '120000', w_rate: '0.03' },
                  children: [],
                },
                {
                  id: 'n_bank_b',
                  refName: 'BankB',
                  displayName: 'Bank B',
                  accent: null,
                  values: { w_amount: '90000', w_rate: '0.05' },
                  children: [],
                },
              ],
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
              id: 'b_amount',
              refName: '$Amount',
              displayName: 'Amount',
              kind: 'input',
              valueType: 'number',
              expression: null,
              rollup: 'none',
            },
            {
              id: 'b_mixed',
              refName: '$Mixed',
              displayName: 'Mixed',
              kind: 'computed',
              valueType: 'number',
              expression: '= $Amount + SUM(Wealth.$Amount) + SUM(Wealth.Savings.$Amount)',
              rollup: 'none',
            },
          ],
          children: [
            {
              id: 'n_dividend',
              refName: 'Dividend',
              displayName: 'Dividend',
              accent: null,
              values: { b_amount: '30000' },
              children: [],
            },
          ],
        },
      ],
    };

    const columnExpr = (topicRef: string, columnId: string): string | null =>
      topics()
        .find((card) => card.refName === topicRef || card.displayName === topicRef)!
        .columns.find((column) => column.id === columnId)!.expression;

    beforeEach(() => {
      const imported = store.importDocument(JSON.stringify(REF_FIXTURE));
      expect(imported.ok).toBe(true);
    });

    it('rewrites exactly the references that bind to a renamed column', () => {
      const result = store.setRefName(
        { kind: 'column', topicId: 'topic_wealth', entityId: 'w_amount' },
        '$Cash',
      );
      expect(result.ok).toBe(true);

      expect(columnExpr('Wealth', 'w_yield')).toBe('= $Cash * $Rate');
      expect(columnExpr('Wealth', 'w_savsum')).toBe('= SUM(Savings.$Cash)');
      // Business's own local $Amount must survive untouched.
      expect(columnExpr('Business', 'b_mixed')).toBe(
        '= $Amount + SUM(Wealth.$Cash) + SUM(Wealth.Savings.$Cash)',
      );

      store.undo();
      expect(columnExpr('Wealth', 'w_yield')).toBe('= $Amount * $Rate');
      expect(columnExpr('Business', 'b_mixed')).toBe(
        '= $Amount + SUM(Wealth.$Amount) + SUM(Wealth.Savings.$Amount)',
      );
    });

    it('rewrites node references, including Topic-qualified ones from other Topics', () => {
      const result = store.setRefName(
        { kind: 'node', topicId: 'topic_wealth', entityId: 'n_savings' },
        'Nest',
      );
      expect(result.ok).toBe(true);

      expect(columnExpr('Wealth', 'w_savsum')).toBe('= SUM(Nest.$Amount)');
      expect(columnExpr('Business', 'b_mixed')).toBe(
        '= $Amount + SUM(Wealth.$Amount) + SUM(Wealth.Nest.$Amount)',
      );
    });

    it('rewrites topic references document-wide', () => {
      const result = store.setRefName(
        { kind: 'topic', topicId: 'topic_wealth', entityId: 'topic_wealth' },
        'Assets',
      );
      expect(result.ok).toBe(true);

      expect(topics()[0]!.refName).toBe('Assets');
      expect(columnExpr('Business', 'b_mixed')).toBe(
        '= $Amount + SUM(Assets.$Amount) + SUM(Assets.Savings.$Amount)',
      );
    });

    it('rejects collisions and invalid patterns', () => {
      expect(
        store.setRefName({ kind: 'node', topicId: 'topic_wealth', entityId: 'n_bank_a' }, 'BankB')
          .ok,
      ).toBe(false);
      expect(
        store.setRefName(
          { kind: 'column', topicId: 'topic_wealth', entityId: 'w_amount' },
          'Amount',
        ).ok,
      ).toBe(false);
      expect(
        store.setRefName(
          { kind: 'topic', topicId: 'topic_wealth', entityId: 'topic_wealth' },
          'Business',
        ).ok,
      ).toBe(false);
      // Unchanged expressions prove failed renames rewrote nothing.
      expect(columnExpr('Business', 'b_mixed')).toBe(
        '= $Amount + SUM(Wealth.$Amount) + SUM(Wealth.Savings.$Amount)',
      );
    });
  });
});
