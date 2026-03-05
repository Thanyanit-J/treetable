import { TestBed } from '@angular/core/testing';
import { TreeNode } from '../models/tree-table.model';
import { collectLeaves } from '../utils/tree-helpers';
import { TreeTableStoreService } from './tree-table-store.service';

function findNode(nodes: TreeNode[], nodeId: string): TreeNode | null {
  for (const node of nodes) {
    if (node.id === nodeId) {
      return node;
    }
    const found = findNode(node.children, nodeId);
    if (found) {
      return found;
    }
  }
  return null;
}

describe('TreeTableStoreService', () => {
  beforeEach(() => {
    localStorage.clear();
    TestBed.configureTestingModule({});
  });

  it('creates topics without topic-level cells and with default A/B columns + default node', () => {
    const store = TestBed.inject(TreeTableStoreService);

    store.addTopic('Auto Child Topic');
    const created = store.topics().at(-1);
    expect(created?.label).toBe('Auto Child Topic');
    expect(created && 'cells' in created).toBe(false);
    expect(created?.columns.map((column) => column.name)).toEqual(['A', 'B']);
    expect(created?.children.length).toBe(1);
    expect(created?.children[0]?.label).toBe('New Node');
    expect(store.selectedNodeId()).toBe(created?.children[0]?.id ?? null);
  });

  it('new child node inherits active topic-column formulas', () => {
    const store = TestBed.inject(TreeTableStoreService);
    const topic = store.topics()[0];
    if (!topic) {
      throw new Error('Expected starter topic');
    }

    const firstColumn = topic.columns[0];
    const secondColumn = topic.columns[1];
    const firstRow = topic.children[0];
    if (!firstColumn || !secondColumn || !firstRow) {
      throw new Error('Expected starter topic shape');
    }

    store.setCellRaw(topic.id, firstRow.id, secondColumn.id, `=${firstColumn.id}*2`);
    store.addChildNode(topic.id, null, 'Auto Formula Child');

    const created = store.topics().find((candidate) => candidate.id === topic.id)?.children.at(-1);
    expect(created?.label).toBe('Auto Formula Child');
    expect(created?.cells[secondColumn.id]?.raw).toBe(`=${firstColumn.id}*2`);
  });

  it('deleting node supports undo', () => {
    const store = TestBed.inject(TreeTableStoreService);
    const topic = store.topics()[0];
    if (!topic) {
      throw new Error('Expected starter topic');
    }
    const child = topic.children[0];
    if (!child) {
      throw new Error('Expected starter node');
    }

    const beforeRows = topic.children.length;
    store.removeNode(topic.id, child.id);
    const afterDeleteCount = store.topics().find((item) => item.id === topic.id)?.children.length ?? 0;
    expect(afterDeleteCount).toBe(beforeRows - 1);

    store.undo();
    const afterUndoCount = store.topics().find((item) => item.id === topic.id)?.children.length ?? 0;
    expect(afterUndoCount).toBe(beforeRows);
  });

  it('moves parent cells to new child node when adding child to a leaf', () => {
    const store = TestBed.inject(TreeTableStoreService);
    const topic = store.topics()[0];
    if (!topic) {
      throw new Error('Expected starter topic');
    }

    const parent = topic.children[0];
    const column = topic.columns[0];
    if (!parent || !column) {
      throw new Error('Expected starter node and column');
    }

    store.setCellRaw(topic.id, parent.id, column.id, '123');
    store.addChildNode(topic.id, parent.id, 'Child');

    const updatedTopic = store.topics().find((candidate) => candidate.id === topic.id);
    const updatedParent = findNode(updatedTopic?.children ?? [], parent.id);
    const child = updatedParent?.children[0];
    expect(child?.cells[column.id]?.raw).toBe('123');
    expect(updatedParent?.cells[column.id]?.raw).toBe('');
  });

  it('deleting the last child makes parent a leaf with empty cells', () => {
    const store = TestBed.inject(TreeTableStoreService);
    const topic = store.topics()[0];
    if (!topic) {
      throw new Error('Expected starter topic');
    }

    const parent = topic.children[0];
    const column = topic.columns[0];
    if (!parent || !column) {
      throw new Error('Expected starter node and column');
    }

    store.addChildNode(topic.id, parent.id, 'Child');
    const updatedTopic = store.topics().find((candidate) => candidate.id === topic.id);
    const updatedParent = findNode(updatedTopic?.children ?? [], parent.id);
    const childId = updatedParent?.children[0]?.id;
    if (!childId) {
      throw new Error('Expected child');
    }

    store.removeNode(topic.id, childId);
    const afterDeleteTopic = store.topics().find((candidate) => candidate.id === topic.id);
    const afterParent = findNode(afterDeleteTopic?.children ?? [], parent.id);
    expect(afterParent?.children.length).toBe(0);
    expect(afterParent?.cells[column.id]?.raw ?? '').toBe('');
  });

  it('deleting the last child can move the only leaf value to parent', () => {
    const store = TestBed.inject(TreeTableStoreService);
    const topic = store.topics()[0];
    if (!topic) {
      throw new Error('Expected starter topic');
    }

    const parent = topic.children[0];
    const column = topic.columns[0];
    if (!parent || !column) {
      throw new Error('Expected starter node and column');
    }

    store.addChildNode(topic.id, parent.id, 'Child');
    const afterAddTopic = store.topics().find((candidate) => candidate.id === topic.id);
    const childId = findNode(afterAddTopic?.children ?? [], parent.id)?.children[0]?.id;
    if (!childId) {
      throw new Error('Expected child');
    }

    store.setCellRaw(topic.id, childId, column.id, '999');
    store.removeNode(topic.id, childId, { inheritLeafValue: true });

    const afterDeleteTopic = store.topics().find((candidate) => candidate.id === topic.id);
    const afterParent = findNode(afterDeleteTopic?.children ?? [], parent.id);
    expect(afterParent?.children.length).toBe(0);
    expect(afterParent?.cells[column.id]?.raw).toBe('999');
  });

  it('inherits the deepest leaf value when deleting a straight-line subtree', () => {
    const store = TestBed.inject(TreeTableStoreService);
    const topic = store.topics()[0];
    if (!topic) {
      throw new Error('Expected starter topic');
    }

    const parent = topic.children[0];
    const column = topic.columns[0];
    if (!parent || !column) {
      throw new Error('Expected starter node and column');
    }

    store.addChildNode(topic.id, parent.id, 'Child');
    const afterFirstAdd = store.topics().find((candidate) => candidate.id === topic.id);
    const childId = findNode(afterFirstAdd?.children ?? [], parent.id)?.children[0]?.id;
    if (!childId) {
      throw new Error('Expected child');
    }

    store.addChildNode(topic.id, childId, 'Grandchild');
    const afterSecondAdd = store.topics().find((candidate) => candidate.id === topic.id);
    const grandchildId = findNode(afterSecondAdd?.children ?? [], childId)?.children[0]?.id;
    if (!grandchildId) {
      throw new Error('Expected grandchild');
    }

    store.setCellRaw(topic.id, grandchildId, column.id, '456');
    store.removeNode(topic.id, childId, { inheritLeafValue: true });

    const afterDeleteTopic = store.topics().find((candidate) => candidate.id === topic.id);
    const afterParent = findNode(afterDeleteTopic?.children ?? [], parent.id);
    expect(afterParent?.children.length).toBe(0);
    expect(afterParent?.cells[column.id]?.raw).toBe('456');
  });

  it('orders leaf nodes depth-first left-to-right', () => {
    const store = TestBed.inject(TreeTableStoreService);
    const topic = store.topics()[0];
    if (!topic || topic.children.length < 2) {
      throw new Error('Expected starter topic with at least two nodes');
    }

    const rootA = topic.children[0];
    const rootB = topic.children[1];
    if (!rootA || !rootB) {
      throw new Error('Expected starter nodes');
    }

    store.addChildNode(topic.id, rootA.id, 'A1');
    const afterFirst = store.topics().find((candidate) => candidate.id === topic.id);
    const updatedRootA = findNode(afterFirst?.children ?? [], rootA.id);
    const firstChildId = updatedRootA?.children[0]?.id;
    if (!firstChildId) {
      throw new Error('Expected child after addChildNode');
    }

    store.addSiblingNode(topic.id, firstChildId, 'A2');
    const afterSecond = store.topics().find((candidate) => candidate.id === topic.id);
    const leaves = collectLeaves(afterSecond?.children ?? []);

    expect(leaves.map((node) => node.label)).toEqual(['A1', 'A2', rootB.label]);
  });

  it('moves topic cards by index', () => {
    const store = TestBed.inject(TreeTableStoreService);

    store.addTopic('Last Topic');
    const lastTopic = store.topics().at(-1);
    if (!lastTopic) {
      throw new Error('Expected added topic');
    }

    store.moveTopicCard(lastTopic.id, 0);
    expect(store.topics()[0]?.id).toBe(lastTopic.id);
  });

  it('inserts and deletes columns per topic only', () => {
    const store = TestBed.inject(TreeTableStoreService);
    const firstTopic = store.topics()[0];
    const secondTopic = store.topics()[1];
    if (!firstTopic || !secondTopic) {
      throw new Error('Expected starter topics');
    }

    const firstTopicColumn = firstTopic.columns[0];
    if (!firstTopicColumn) {
      throw new Error('Expected first topic column');
    }

    const secondTopicColumnCountBefore = secondTopic.columns.length;

    store.insertColumn(firstTopic.id, firstTopicColumn.id, 'right');

    const updatedFirstTopic = store.topics().find((topic) => topic.id === firstTopic.id);
    const updatedSecondTopic = store.topics().find((topic) => topic.id === secondTopic.id);
    expect(updatedFirstTopic?.columns.length).toBe(firstTopic.columns.length + 1);
    expect(updatedSecondTopic?.columns.length).toBe(secondTopicColumnCountBefore);

    const inserted = updatedFirstTopic?.columns[1];
    expect(inserted).toBeDefined();
    if (!inserted) {
      throw new Error('Expected inserted column');
    }

    store.deleteColumn(firstTopic.id, inserted.id);
    const afterDeleteTopic = store.topics().find((topic) => topic.id === firstTopic.id);
    expect(afterDeleteTopic?.columns.find((column) => column.id === inserted.id)).toBeUndefined();
  });

  it('prevents deleting the last remaining column per topic', () => {
    const store = TestBed.inject(TreeTableStoreService);
    const topic = store.topics()[0];
    if (!topic) {
      throw new Error('Expected topic');
    }

    while ((store.topics().find((candidate) => candidate.id === topic.id)?.columns.length ?? 0) > 1) {
      const current = store.topics().find((candidate) => candidate.id === topic.id);
      const column = current?.columns[current.columns.length - 1];
      if (!column) {
        break;
      }
      store.deleteColumn(topic.id, column.id);
    }

    const onlyColumn = store.topics().find((candidate) => candidate.id === topic.id)?.columns[0];
    if (!onlyColumn) {
      throw new Error('Expected one column');
    }

    const result = store.deleteColumn(topic.id, onlyColumn.id);
    expect(result?.ok).toBe(false);
    expect(result?.error).toContain('At least one column');
  });

  it('renaming topic column updates id and rewrites topic formula references', () => {
    const store = TestBed.inject(TreeTableStoreService);
    const topic = store.topics()[0];
    if (!topic) {
      throw new Error('Expected topic');
    }

    const sourceColumn = topic.columns[0];
    const formulaColumn = topic.columns[1];
    const firstRow = topic.children[0];
    if (!sourceColumn || !formulaColumn || !firstRow) {
      throw new Error('Expected topic shape');
    }

    store.setCellRaw(topic.id, firstRow.id, formulaColumn.id, `=${sourceColumn.id}*2`);
    store.renameColumn(topic.id, sourceColumn.id, 'Principal');

    const updatedTopic = store.topics().find((candidate) => candidate.id === topic.id);
    const renamed = updatedTopic?.columns.find((column) => column.name === 'Principal');
    expect(renamed).toBeDefined();
    expect(renamed?.id).toBe('$Principal');

    const updatedRow = updatedTopic?.children[0];
    expect(updatedRow?.cells[formulaColumn.id]?.raw).toContain('$Principal');
  });

  it('renaming a column only rewrites standalone formula tokens', () => {
    const store = TestBed.inject(TreeTableStoreService);
    const topic = store.topics()[0];
    if (!topic || topic.children.length === 0 || topic.columns.length === 0) {
      throw new Error('Expected starter topic shape');
    }

    const sourceColumn = topic.columns[0];
    const row = topic.children[0];
    if (!sourceColumn || !row) {
      throw new Error('Expected starter topic shape');
    }

    store.setCellRaw(topic.id, row.id, sourceColumn.id, `=${sourceColumn.id}+$AA+$A_1+x${sourceColumn.id}`);
    store.renameColumn(topic.id, sourceColumn.id, 'Renamed');

    const updatedTopic = store.topics().find((candidate) => candidate.id === topic.id);
    const renamed = updatedTopic?.columns.find((column) => column.name === 'Renamed');
    expect(renamed).toBeDefined();
    const renamedId = renamed?.id ?? '$Renamed';
    const updatedRaw = updatedTopic?.children[0]?.cells[renamedId]?.raw ?? '';
    expect(updatedRaw).toContain(`=${renamedId}+`);
    expect(updatedRaw).toContain('+$AA+');
    expect(updatedRaw).toContain('+$A_1+');
    expect(updatedRaw).toContain(`+x${sourceColumn.id}`);
  });

  it('updates title and supports undo/redo', () => {
    const store = TestBed.inject(TreeTableStoreService);

    expect(store.title()).toBe('Untitled');
    store.setTitle('My Plan');
    expect(store.title()).toBe('My Plan');

    store.undo();
    expect(store.title()).toBe('Untitled');

    store.redo();
    expect(store.title()).toBe('My Plan');
  });

  it('applies formulas to the whole column within a topic and keeps literal values row-local', () => {
    const store = TestBed.inject(TreeTableStoreService);
    const topic = store.topics()[0];
    if (!topic || topic.children.length < 2 || topic.columns.length < 2) {
      throw new Error('Expected starter topic with at least two rows and two columns');
    }

    const row1 = topic.children[0];
    const row2 = topic.children[1];
    const formulaColumn = topic.columns[1];
    const literalColumn = topic.columns[0];
    if (!row1 || !row2 || !formulaColumn || !literalColumn) {
      throw new Error('Expected starter topic with at least two rows and two columns');
    }

    store.setCellRaw(topic.id, row1.id, formulaColumn.id, `=${literalColumn.id}*3`);
    const afterFormulaTopic = store.topics().find((candidate) => candidate.id === topic.id);
    expect(afterFormulaTopic?.children[0]?.cells[formulaColumn.id]?.raw).toBe(`=${literalColumn.id}*3`);
    expect(afterFormulaTopic?.children[1]?.cells[formulaColumn.id]?.raw).toBe(`=${literalColumn.id}*3`);

    store.setCellRaw(topic.id, row1.id, literalColumn.id, '777');
    const afterLiteralTopic = store.topics().find((candidate) => candidate.id === topic.id);
    expect(afterLiteralTopic?.children[0]?.cells[literalColumn.id]?.raw).toBe('777');
    expect(afterLiteralTopic?.children[1]?.cells[literalColumn.id]?.raw).not.toBe('777');
  });

  it('removing a formula from a topic column applies to all rows in that topic column', () => {
    const store = TestBed.inject(TreeTableStoreService);
    const topic = store.topics()[0];
    if (!topic || topic.children.length < 2 || topic.columns.length < 2) {
      throw new Error('Expected starter topic with at least two rows and two columns');
    }

    const row1 = topic.children[0];
    const formulaColumn = topic.columns[1];
    const sourceColumn = topic.columns[0];
    if (!row1 || !formulaColumn || !sourceColumn) {
      throw new Error('Expected starter topic with at least two rows and two columns');
    }

    store.setCellRaw(topic.id, row1.id, formulaColumn.id, `=${sourceColumn.id}*2`);
    store.setCellRaw(topic.id, row1.id, formulaColumn.id, '');

    const afterRemoveTopic = store.topics().find((candidate) => candidate.id === topic.id);
    expect(afterRemoveTopic?.children[0]?.cells[formulaColumn.id]?.raw).toBe('');
    expect(afterRemoveTopic?.children[1]?.cells[formulaColumn.id]?.raw).toBe('');
  });

  it('recalculates topic rows with whole-column and row-local aggregate semantics', () => {
    const store = TestBed.inject(TreeTableStoreService);
    const topic = store.topics()[0];
    if (!topic || topic.children.length < 2 || topic.columns.length < 2) {
      throw new Error('Expected starter topic with at least two rows and two columns');
    }

    const sourceColumn = topic.columns[0];
    const targetColumn = topic.columns[1];
    const firstRow = topic.children[0];
    if (!sourceColumn || !targetColumn || !firstRow) {
      throw new Error('Expected starter topic with at least two rows and two columns');
    }

    store.setCellRaw(topic.id, firstRow.id, targetColumn.id, `=SUM(${sourceColumn.id})`);
    const wholeColumnTopic = store.topics().find((candidate) => candidate.id === topic.id);
    const wholeRow1 = wholeColumnTopic?.children[0]?.cells[sourceColumn.id]?.value;
    const wholeRow2 = wholeColumnTopic?.children[1]?.cells[sourceColumn.id]?.value;
    if (typeof wholeRow1 !== 'number' || typeof wholeRow2 !== 'number') {
      throw new TypeError('Expected numeric source values after whole-column formula');
    }
    const expectedWhole = wholeRow1 + wholeRow2;
    expect(wholeColumnTopic?.children[0]?.cells[targetColumn.id]?.value).toBe(expectedWhole);
    expect(wholeColumnTopic?.children[1]?.cells[targetColumn.id]?.value).toBe(expectedWhole);

    store.setCellRaw(topic.id, firstRow.id, targetColumn.id, `=SUM(${sourceColumn.id},1)`);
    const rowLocalTopic = store.topics().find((candidate) => candidate.id === topic.id);
    const row1Source = rowLocalTopic?.children[0]?.cells[sourceColumn.id]?.value;
    const row2Source = rowLocalTopic?.children[1]?.cells[sourceColumn.id]?.value;
    if (typeof row1Source !== 'number' || typeof row2Source !== 'number') {
      throw new TypeError('Expected numeric source values after row-local formula');
    }
    expect(rowLocalTopic?.children[0]?.cells[targetColumn.id]?.value).toBe(row1Source + 1);
    expect(rowLocalTopic?.children[1]?.cells[targetColumn.id]?.value).toBe(row2Source + 1);
  });

  it('updates only target column summary mode and keeps summary metadata through mutations', () => {
    const store = TestBed.inject(TreeTableStoreService);
    const topic = store.topics()[0];
    if (!topic || topic.columns.length < 2 || topic.children.length === 0) {
      throw new Error('Expected starter topic shape');
    }

    const firstColumn = topic.columns[0];
    const secondColumn = topic.columns[1];
    const firstRow = topic.children[0];
    if (!firstColumn || !secondColumn || !firstRow) {
      throw new Error('Expected starter topic shape');
    }

    store.setColumnSummary(topic.id, firstColumn.id, 'sum');
    const afterSummary = store.topics().find((candidate) => candidate.id === topic.id);
    expect(afterSummary?.columns[0]?.summaryMode).toBe('sum');
    expect(afterSummary?.columns[1]?.summaryMode).toBe('none');

    store.addChildNode(topic.id, null, 'Newer');
    store.renameNode(firstRow.id, 'Renamed');
    const afterMutations = store.topics().find((candidate) => candidate.id === topic.id);
    expect(afterMutations?.columns[0]?.summaryMode).toBe('sum');
    expect(afterMutations?.columns[1]?.summaryMode).toBe('none');
  });

  it('keeps formula results unchanged when summary mode is enabled', () => {
    const store = TestBed.inject(TreeTableStoreService);
    const topic = store.topics()[0];
    if (!topic || topic.columns.length < 2 || topic.children.length === 0) {
      throw new Error('Expected starter topic shape');
    }

    const sourceColumn = topic.columns[0];
    const targetColumn = topic.columns[1];
    const firstRow = topic.children[0];
    if (!sourceColumn || !targetColumn || !firstRow) {
      throw new Error('Expected starter topic shape');
    }

    store.setCellRaw(topic.id, firstRow.id, targetColumn.id, `=SUM(${sourceColumn.id})`);
    const withoutSummary = store.topics().find((candidate) => candidate.id === topic.id);
    const rowValuesWithout = withoutSummary?.children.map((child) => child.cells[targetColumn.id]?.value) ?? [];

    store.setColumnSummary(topic.id, sourceColumn.id, 'sum');
    const withSummary = store.topics().find((candidate) => candidate.id === topic.id);
    const rowValuesWith = withSummary?.children.map((child) => child.cells[targetColumn.id]?.value) ?? [];

    expect(rowValuesWith).toEqual(rowValuesWithout);
  });

  it('normalizes malformed topic column ids and rewrites row formulas during recalculation', () => {
    const store = TestBed.inject(TreeTableStoreService);
    const storeInternal = store as unknown as {
      mutate: (mutator: (state: { topics: Array<{ columns: Array<{ id: string; name: string; type: string }>; children: Array<{ cells: Record<string, { raw: string; value: number | string | null; error: string | null }> }> }> }) => void) => void;
    };

    storeInternal.mutate((state) => {
      const topic = state.topics[0];
      if (!topic || topic.children.length === 0) {
        throw new Error('Expected starter topic');
      }

      // Intentionally invalid IDs: they do not match the required "$<word>" column-id format.
      topic.columns = [
        { id: 'bad-1', name: 'A', type: 'number' },
        { id: 'bad-2', name: 'B', type: 'number' },
      ];

      const firstRow = topic.children[0];
      if (!firstRow) {
        throw new Error('Expected starter row');
      }

      firstRow.cells = {
        'bad-1': { raw: '1', value: '1', error: null },
        'bad-2': { raw: '=bad-1+bad-2', value: null, error: null },
      };
    });

    const topic = store.topics()[0];
    expect(topic?.columns.map((column) => column.id)).toEqual(['$A', '$B']);
    const firstRow = topic?.children[0];
    expect(firstRow?.cells['$A']?.raw).toBe('1');
    expect(firstRow?.cells['$B']?.raw).toBe('=$A+$B');
    expect(firstRow?.cells['bad-1']).toBeUndefined();
    expect(firstRow?.cells['bad-2']).toBeUndefined();
  });

  it('applies unique suffixes for normalized id collisions and rewrites formulas', () => {
    const store = TestBed.inject(TreeTableStoreService);
    const storeInternal = store as unknown as {
      mutate: (mutator: (state: { topics: Array<{ columns: Array<{ id: string; name: string; type: string }>; children: Array<{ cells: Record<string, { raw: string; value: number | string | null; error: string | null }> }> }> }) => void) => void;
    };

    storeInternal.mutate((state) => {
      const topic = state.topics[0];
      if (!topic || topic.children.length === 0) {
        throw new Error('Expected starter topic');
      }

      topic.columns = [
        { id: 'bad-a', name: 'A', type: 'number' },
        { id: 'bad-b', name: 'A', type: 'number' },
      ];

      const firstRow = topic.children[0];
      if (!firstRow) {
        throw new Error('Expected starter row');
      }

      firstRow.cells = {
        'bad-a': { raw: '2', value: '2', error: null },
        'bad-b': { raw: '=bad-a+bad-b', value: null, error: null },
      };
    });

    const topic = store.topics()[0];
    expect(topic?.columns.map((column) => column.id)).toEqual(['$A', '$A_2']);
    const firstRow = topic?.children[0];
    expect(firstRow?.cells['$A']?.raw).toBe('2');
    expect(firstRow?.cells['$A_2']?.raw).toBe('=$A+$A_2');
  });

  it('keeps formulas unchanged when column ids are already valid', () => {
    const store = TestBed.inject(TreeTableStoreService);
    const topic = store.topics()[0];
    if (!topic || topic.children.length === 0 || topic.columns.length < 2) {
      throw new Error('Expected starter topic');
    }

    const firstRow = topic.children[0];
    const firstColumn = topic.columns[0];
    const secondColumn = topic.columns[1];
    if (!firstRow || !firstColumn || !secondColumn) {
      throw new Error('Expected starter topic');
    }

    const rawBefore = `=${firstColumn.id}+${secondColumn.id}`;
    store.setCellRaw(topic.id, firstRow.id, secondColumn.id, rawBefore);

    const updatedTopic = store.topics().find((candidate) => candidate.id === topic.id);
    const rawAfter = updatedTopic?.children[0]?.cells[secondColumn.id]?.raw;
    expect(rawAfter).toBe(rawBefore);
  });
});
