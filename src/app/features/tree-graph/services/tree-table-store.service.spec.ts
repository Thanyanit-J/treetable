import { TestBed } from '@angular/core/testing';
import { TreeTableStoreService } from './tree-table-store.service';

describe('TreeTableStoreService', () => {
  beforeEach(() => {
    localStorage.clear();
    TestBed.configureTestingModule({});
  });

  it('adds and removes topics', () => {
    const store = TestBed.inject(TreeTableStoreService);
    const initialCount = store.topics().length;

    store.addTopic('Test Topic');
    expect(store.topics().length).toBe(initialCount + 1);

    const created = store.topics().at(-1);
    expect(created?.label).toBe('Test Topic');
    if (!created) {
      throw new Error('Created topic should exist');
    }

    store.removeTopic(created.id);
    expect(store.topics().length).toBe(initialCount);
  });

  it('deleting subtopic removes child row and supports undo', () => {
    const store = TestBed.inject(TreeTableStoreService);
    const topic = store.topics()[0];
    if (!topic) {
      throw new Error('Expected starter topic');
    }
    const child = topic.children[0];
    if (!child) {
      throw new Error('Expected starter subtopic');
    }

    const before = topic.children.length;
    store.removeSubtopic(topic.id, child.id);
    expect(store.topics()[0]?.children.length).toBe(before - 1);

    store.undo();
    expect(store.topics()[0]?.children.length).toBe(before);
  });

  it('renames and removes columns', () => {
    const store = TestBed.inject(TreeTableStoreService);
    store.addColumn('Profit %', 'number');
    const created = store.columns().at(-1);
    if (!created) {
      throw new Error('Expected created column');
    }

    expect(created.id).toMatch(/^[A-Za-z_][A-Za-z0-9_]*$/);

    store.renameColumn(created.id, 'Profit Ratio');
    const renamed = store.columns().find((column) => column.id === created.id);
    expect(renamed?.name).toBe('Profit Ratio');

    store.removeColumn(created.id);
    expect(store.columns().find((column) => column.id === created.id)).toBeUndefined();
  });

  it('imports exported state', () => {
    const store = TestBed.inject(TreeTableStoreService);
    store.addTopic('Import Me');
    const exported = store.exportState();

    const store2 = TestBed.inject(TreeTableStoreService);
    const result = store2.importState(exported);
    expect(result.ok).toBe(true);
    expect(store2.topics().some((topic) => topic.label === 'Import Me')).toBe(true);
  });
});
