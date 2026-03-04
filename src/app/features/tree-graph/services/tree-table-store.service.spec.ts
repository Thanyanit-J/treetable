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
});
