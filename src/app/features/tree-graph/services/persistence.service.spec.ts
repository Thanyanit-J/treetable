import { TestBed } from '@angular/core/testing';
import { PersistenceService } from './persistence.service';

describe('PersistenceService', () => {
  beforeEach(() => {
    localStorage.clear();
    TestBed.configureTestingModule({});
  });

  it('migrates legacy topic cells and ensures at least one column', () => {
    const service = TestBed.inject(PersistenceService);

    const legacy = {
      version: 1,
      selectedNodeId: null,
      columns: [],
      topics: [
        {
          id: 'topic_1',
          label: 'Legacy Topic',
          expanded: true,
          cells: {
            old: { raw: '123', value: 123, error: null },
          },
          children: [
            {
              id: 'sub_1',
              topicId: 'topic_1',
              label: 'Legacy Child',
              cells: {},
            },
          ],
        },
      ],
    };

    localStorage.setItem('treetable.v1.state', JSON.stringify(legacy));
    const loaded = service.load();

    expect(loaded.columns.length).toBeGreaterThanOrEqual(1);
    expect('cells' in loaded.topics[0]!).toBe(false);
    const firstColId = loaded.columns[0]?.id ?? '';
    expect(loaded.topics[0]?.children[0]?.cells[firstColId]).toBeDefined();
  });
});
