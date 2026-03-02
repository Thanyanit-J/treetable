import { TestBed } from '@angular/core/testing';
import { TreeTableStoreService } from './tree-table-store.service';

describe('TreeTableStoreService', () => {
  beforeEach(() => {
    localStorage.clear();
    TestBed.configureTestingModule({});
  });

  it('creates topics without topic-level cells', () => {
    const store = TestBed.inject(TreeTableStoreService);

    store.addTopic('No Topic Cells');
    const created = store.topics().at(-1);
    expect(created?.label).toBe('No Topic Cells');
    expect(created && 'cells' in created).toBe(false);
  });

  it('creates a default subtopic when adding a topic', () => {
    const store = TestBed.inject(TreeTableStoreService);

    store.addTopic('Auto Child Topic');
    const created = store.topics().at(-1);
    expect(created?.children.length).toBe(1);
    expect(created?.children[0]?.label).toBe('New Subtopic');
    expect(store.selectedNodeId()).toBe(created?.children[0]?.id ?? null);
  });

  it('new subtopic inherits active column formulas', () => {
    const store = TestBed.inject(TreeTableStoreService);
    const topic = store.topics()[0];
    const existingRow = store.visibleSubtopicRows()[0];
    if (!topic || !existingRow) {
      throw new Error('Expected starter data');
    }

    store.setCellRaw(existingRow.subtopic.id, '$Value', '=$Amount*$Rate');
    store.addSubtopic(topic.id, 'Auto Formula Child');

    const created = store.topics().find((candidate) => candidate.id === topic.id)?.children.at(-1);
    expect(created?.label).toBe('Auto Formula Child');
    expect(created?.cells['$Value']?.raw).toBe('=$Amount*$Rate');
  });

  it('default subtopic of new topic inherits active column formulas', () => {
    const store = TestBed.inject(TreeTableStoreService);
    const existingRow = store.visibleSubtopicRows()[0];
    if (!existingRow) {
      throw new Error('Expected starter row');
    }

    store.setCellRaw(existingRow.subtopic.id, '$Value', '=$Amount+$Rate');
    store.addTopic('Formula Topic');

    const createdTopic = store.topics().at(-1);
    const createdSubtopic = createdTopic?.children[0];
    expect(createdTopic?.label).toBe('Formula Topic');
    expect(createdSubtopic?.cells['$Value']?.raw).toBe('=$Amount+$Rate');
  });

  it('deleting subtopic removes table row and supports undo', () => {
    const store = TestBed.inject(TreeTableStoreService);
    const topic = store.topics()[0];
    if (!topic) {
      throw new Error('Expected starter topic');
    }
    const child = topic.children[0];
    if (!child) {
      throw new Error('Expected starter subtopic');
    }

    const beforeRows = store.visibleSubtopicRows().length;
    store.removeSubtopic(topic.id, child.id);
    expect(store.visibleSubtopicRows().length).toBe(beforeRows - 1);

    store.undo();
    expect(store.visibleSubtopicRows().length).toBe(beforeRows);
  });

  it('inserts columns to left/right and deletes across subtopic cells', () => {
    const store = TestBed.inject(TreeTableStoreService);
    const firstColumn = store.columns()[0];
    if (!firstColumn) {
      throw new Error('Expected first column');
    }

    store.insertColumn(firstColumn.id, 'right');
    const rightColumn = store.columns()[1];
    expect(rightColumn).toBeDefined();

    store.insertColumn(firstColumn.id, 'left');
    const leftColumn = store.columns()[0];
    expect(leftColumn?.id).not.toBe(firstColumn.id);
    expect(leftColumn?.id.startsWith('$')).toBe(true);

    if (!rightColumn) {
      throw new Error('Expected inserted right column');
    }

    store.deleteColumn(rightColumn.id);
    expect(store.columns().find((column) => column.id === rightColumn.id)).toBeUndefined();

    const row = store.visibleSubtopicRows()[0];
    if (!row) {
      throw new Error('Expected at least one row');
    }
    expect(row.subtopic.cells[rightColumn.id]).toBeUndefined();
  });

  it('prevents deleting the last remaining column', () => {
    const store = TestBed.inject(TreeTableStoreService);

    while (store.columns().length > 1) {
      const column = store.columns()[store.columns().length - 1];
      if (!column) {
        break;
      }
      store.deleteColumn(column.id);
    }

    const onlyColumn = store.columns()[0];
    if (!onlyColumn) {
      throw new Error('Expected one column');
    }

    const result = store.deleteColumn(onlyColumn.id);
    expect(result?.ok).toBe(false);
    expect(result?.error).toContain('At least one column');
  });

  it('renaming column updates id and rewrites formula references', () => {
    const store = TestBed.inject(TreeTableStoreService);
    const amountColumn = store.columns().find((column) => column.name === 'Amount');
    if (!amountColumn) {
      throw new Error('Expected amount column');
    }

    const targetRow = store.visibleSubtopicRows()[0];
    if (!targetRow) {
      throw new Error('Expected subtopic row');
    }

    store.setCellRaw(targetRow.subtopic.id, '$Value', '=$Amount*2');
    store.renameColumn(amountColumn.id, 'Principal');

    const renamed = store.columns().find((column) => column.name === 'Principal');
    expect(renamed).toBeDefined();
    expect(renamed?.id).toBe('$Principal');

    const updatedRow = store.visibleSubtopicRows()[0];
    expect(updatedRow?.subtopic.cells['$Value']?.raw).toContain('$Principal');
    expect(updatedRow?.subtopic.cells['$Amount']).toBeUndefined();
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

  it('applies formulas to the whole column while keeping literal values row-local', () => {
    const store = TestBed.inject(TreeTableStoreService);
    const rows = store.visibleSubtopicRows();
    const firstRow = rows[0];
    const secondRow = rows[1];
    if (!firstRow || !secondRow) {
      throw new Error('Expected at least two rows');
    }

    store.setCellRaw(firstRow.subtopic.id, '$Value', '=$Amount*$Rate');
    const afterFormulaRows = store.visibleSubtopicRows();
    expect(afterFormulaRows[0]?.subtopic.cells['$Value']?.raw).toBe('=$Amount*$Rate');
    expect(afterFormulaRows[1]?.subtopic.cells['$Value']?.raw).toBe('=$Amount*$Rate');

    store.setCellRaw(firstRow.subtopic.id, '$Amount', '777');
    const afterLiteralRows = store.visibleSubtopicRows();
    expect(afterLiteralRows[0]?.subtopic.cells['$Amount']?.raw).toBe('777');
    expect(afterLiteralRows[1]?.subtopic.cells['$Amount']?.raw).not.toBe('777');
  });

  it('removing a formula from a column applies to all rows in that column', () => {
    const store = TestBed.inject(TreeTableStoreService);
    const rows = store.visibleSubtopicRows();
    const firstRow = rows[0];
    const secondRow = rows[1];
    if (!firstRow || !secondRow) {
      throw new Error('Expected at least two rows');
    }

    store.setCellRaw(firstRow.subtopic.id, '$Value', '=$Amount*$Rate');
    store.setCellRaw(firstRow.subtopic.id, '$Value', '');

    const afterRemove = store.visibleSubtopicRows();
    expect(afterRemove[0]?.subtopic.cells['$Value']?.raw).toBe('');
    expect(afterRemove[1]?.subtopic.cells['$Value']?.raw).toBe('');
  });
});
