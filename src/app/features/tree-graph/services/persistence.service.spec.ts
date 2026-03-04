import { TestBed } from '@angular/core/testing';
import { PersistenceService } from './persistence.service';

describe('PersistenceService', () => {
  beforeEach(() => {
    localStorage.clear();
    TestBed.configureTestingModule({});
  });

  it('migrates legacy global columns into topic columns and ensures A/B fallback', () => {
    const service = TestBed.inject(PersistenceService);

    const legacy = {
      version: 1,
      selectedNodeId: null,
      columns: [
        { id: '$Amount', name: 'Amount', type: 'number' },
      ],
      topics: [
        {
          id: 'topic_1',
          label: 'Legacy Topic',
          children: [
            {
              id: 'sub_1',
              topicId: 'topic_1',
              label: 'Legacy Child',
              cells: {
                $Amount: { raw: '123', value: 123, error: null },
              },
            },
          ],
        },
      ],
    };

    localStorage.setItem('treetable.v1.state', JSON.stringify(legacy));
    const loaded = service.load();

    expect(loaded.topics[0]?.columns.length).toBeGreaterThanOrEqual(1);
    expect((loaded as { columns?: unknown }).columns).toBeUndefined();
    expect(loaded.title).toBe('Untitled');
    const firstColId = loaded.topics[0]?.columns[0]?.id ?? '';
    expect(loaded.topics[0]?.children[0]?.cells[firstColId]).toBeDefined();
  });

  it('preserves topic-scoped columns and row cells in export/import roundtrip', () => {
    const service = TestBed.inject(PersistenceService);
    const state = service.load();
    const firstTopic = state.topics[0];
    if (!firstTopic) {
      throw new Error('Expected starter topic');
    }
    const firstChild = firstTopic.children[0];
    if (!firstChild) {
      throw new Error('Expected starter child');
    }

    firstTopic.columns = [
      { id: '$A', name: 'A', type: 'number' },
      { id: '$B', name: 'B', type: 'number' },
      { id: '$C', name: 'C', type: 'number' },
    ];
    firstChild.cells['$C'] = { raw: '=$A+$B', value: null, error: null };

    const json = service.export(state);
    const imported = service.import(json);
    expect(imported.result.ok).toBe(true);
    expect(imported.state?.topics[0]?.columns.map((column) => column.id)).toEqual(['$A', '$B', '$C']);
    expect(imported.state?.topics[0]?.children[0]?.cells['$C']?.raw).toBe('=$A+$B');
  });

  it('rewrites only standalone formula references during migration', () => {
    const service = TestBed.inject(PersistenceService);

    const legacy = {
      version: 1,
      title: 'Legacy',
      selectedNodeId: null,
      topics: [
        {
          id: 'topic_1',
          label: 'Topic',
          columns: [{ id: '$A-1', name: 'A1', type: 'number' }],
          children: [
            {
              id: 'sub_1',
              topicId: 'topic_1',
              label: 'Row',
              cells: {
                '$A-1': {
                  raw: '=$A-1+$A-10+x$A-1',
                  value: null,
                  error: null,
                },
              },
            },
          ],
        },
      ],
    };

    const result = service.import(JSON.stringify(legacy));
    expect(result.result.ok).toBe(true);
    const migratedTopic = result.state?.topics[0];
    const migratedColumnId = migratedTopic?.columns[0]?.id;
    expect(migratedColumnId).toBe('$A1');
    const migratedRaw = migratedTopic?.children[0]?.cells[migratedColumnId ?? '']?.raw;
    expect(migratedRaw).toBe('=$A1+$A-10+x$A-1');
  });

  it('prefers raw by normalized id and falls back to source id when normalized raw is missing', () => {
    const service = TestBed.inject(PersistenceService);

    const legacy = {
      version: 1,
      title: 'Legacy',
      selectedNodeId: null,
      topics: [
        {
          id: 'topic_1',
          label: 'Topic',
          columns: [{ id: '$A-1', name: 'A1', type: 'number' }],
          children: [
            {
              id: 'sub_1',
              topicId: 'topic_1',
              label: 'Row 1',
              cells: {
                '$A-1': { raw: 'old-value', value: null, error: null },
                $A1: { raw: 'new-value', value: null, error: null },
              },
            },
            {
              id: 'sub_2',
              topicId: 'topic_1',
              label: 'Row 2',
              cells: {
                '$A-1': { raw: 'old-only', value: null, error: null },
              },
            },
          ],
        },
      ],
    };

    const result = service.import(JSON.stringify(legacy));
    expect(result.result.ok).toBe(true);
    const migratedTopic = result.state?.topics[0];
    expect(migratedTopic?.columns[0]?.id).toBe('$A1');
    expect(migratedTopic?.children[0]?.cells['$A1']?.raw).toBe('new-value');
    expect(migratedTopic?.children[1]?.cells['$A1']?.raw).toBe('old-only');
  });
});
