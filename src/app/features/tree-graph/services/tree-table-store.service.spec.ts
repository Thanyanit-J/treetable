import { TestBed } from '@angular/core/testing';
import { TreeTableStoreService } from './tree-table-store.service';

describe('TreeTableStoreService', () => {
  beforeEach(() => {
    localStorage.clear();
    TestBed.configureTestingModule({});
  });

  it('creates topics without topic-level cells and with default A/B columns + default subtopic', () => {
    const store = TestBed.inject(TreeTableStoreService);

    store.addTopic('Auto Child Topic');
    const created = store.topics().at(-1);
    expect(created?.label).toBe('Auto Child Topic');
    expect(created && 'cells' in created).toBe(false);
    expect(created?.columns.map((column) => column.name)).toEqual(['A', 'B']);
    expect(created?.children.length).toBe(1);
    expect(created?.children[0]?.label).toBe('New Subtopic');
    expect(store.selectedNodeId()).toBe(created?.children[0]?.id ?? null);
  });

  it('new subtopic inherits active topic-column formulas', () => {
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
    store.addSubtopic(topic.id, 'Auto Formula Child');

    const created = store.topics().find((candidate) => candidate.id === topic.id)?.children.at(-1);
    expect(created?.label).toBe('Auto Formula Child');
    expect(created?.cells[secondColumn.id]?.raw).toBe(`=${firstColumn.id}*2`);
  });

  it('deleting subtopic supports undo', () => {
    const store = TestBed.inject(TreeTableStoreService);
    const topic = store.topics()[0];
    if (!topic) {
      throw new Error('Expected starter topic');
    }
    const child = topic.children[0];
    if (!child) {
      throw new Error('Expected starter subtopic');
    }

    const beforeRows = topic.children.length;
    store.removeSubtopic(topic.id, child.id);
    const afterDeleteCount = store.topics().find((item) => item.id === topic.id)?.children.length ?? 0;
    expect(afterDeleteCount).toBe(beforeRows - 1);

    store.undo();
    const afterUndoCount = store.topics().find((item) => item.id === topic.id)?.children.length ?? 0;
    expect(afterUndoCount).toBe(beforeRows);
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
      throw new Error('Expected numeric source values after whole-column formula');
    }
    const expectedWhole = wholeRow1 + wholeRow2;
    expect(wholeColumnTopic?.children[0]?.cells[targetColumn.id]?.value).toBe(expectedWhole);
    expect(wholeColumnTopic?.children[1]?.cells[targetColumn.id]?.value).toBe(expectedWhole);

    store.setCellRaw(topic.id, firstRow.id, targetColumn.id, `=SUM(${sourceColumn.id},1)`);
    const rowLocalTopic = store.topics().find((candidate) => candidate.id === topic.id);
    const row1Source = rowLocalTopic?.children[0]?.cells[sourceColumn.id]?.value;
    const row2Source = rowLocalTopic?.children[1]?.cells[sourceColumn.id]?.value;
    if (typeof row1Source !== 'number' || typeof row2Source !== 'number') {
      throw new Error('Expected numeric source values after row-local formula');
    }
    expect(rowLocalTopic?.children[0]?.cells[targetColumn.id]?.value).toBe(row1Source + 1);
    expect(rowLocalTopic?.children[1]?.cells[targetColumn.id]?.value).toBe(row2Source + 1);
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
