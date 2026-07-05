import { describe, expect, it } from 'vitest';
import { NodeV2, TopicCardV2 } from '../model/document.model';
import { ROOT_PILL_ID, computeTopicLattice, hiddenLeavesOf } from './lattice-layout';

function node(id: string, children: NodeV2[] = []): NodeV2 {
  return { id, refName: id, displayName: id, accent: null, children, values: {} };
}

function topicOf(children: NodeV2[]): TopicCardV2 {
  return {
    kind: 'topic',
    id: 'topic',
    refName: 'Topic',
    displayName: 'Topic',
    columns: [],
    children,
  };
}

const TREE = topicOf([node('savings', [node('bankA'), node('bankB')]), node('cash')]);

describe('computeTopicLattice', () => {
  it('assigns one row per visible Leaf, in depth-first order', () => {
    const lattice = computeTopicLattice(TREE, new Set());
    expect(lattice.rows.map((row) => row.nodeId)).toEqual(['bankA', 'bankB', 'cash']);
    expect(lattice.rows.every((row) => row.kind === 'leaf')).toBe(true);
  });

  it('spans Branch pills across their Leaf rows like merged cells', () => {
    const lattice = computeTopicLattice(TREE, new Set());
    const byId = new Map(lattice.pills.map((pill) => [pill.nodeId, pill]));

    expect(byId.get('savings')).toMatchObject({
      depth: 1,
      rowStart: 1,
      rowSpan: 2,
      kind: 'branch',
    });
    expect(byId.get('bankA')).toMatchObject({ depth: 2, rowStart: 1, rowSpan: 1, kind: 'leaf' });
    expect(byId.get('bankB')).toMatchObject({ depth: 2, rowStart: 2, rowSpan: 1, kind: 'leaf' });
    expect(byId.get('cash')).toMatchObject({ depth: 1, rowStart: 3, rowSpan: 1, kind: 'leaf' });
    expect(byId.get(ROOT_PILL_ID)).toMatchObject({
      depth: 0,
      rowStart: 1,
      rowSpan: 3,
      kind: 'root',
    });
    expect(lattice.depthCount).toBe(3);
  });

  it('collapses a Branch into a single row and shrinks the tree with it', () => {
    const lattice = computeTopicLattice(TREE, new Set(['savings']));

    expect(lattice.rows.map((row) => row.nodeId)).toEqual(['savings', 'cash']);
    expect(lattice.rows[0]!.kind).toBe('collapsed');

    const byId = new Map(lattice.pills.map((pill) => [pill.nodeId, pill]));
    expect(byId.get('savings')).toMatchObject({ rowStart: 1, rowSpan: 1, kind: 'collapsed' });
    expect(byId.has('bankA')).toBe(false);
    expect(byId.get(ROOT_PILL_ID)?.rowSpan).toBe(2);
    expect(lattice.depthCount).toBe(2);
  });

  it('omits the root pill and its column when showRoot is false', () => {
    const lattice = computeTopicLattice({ ...TREE, showRoot: false }, new Set());
    const byId = new Map(lattice.pills.map((pill) => [pill.nodeId, pill]));

    expect(byId.has(ROOT_PILL_ID)).toBe(false);
    expect(byId.get('savings')).toMatchObject({ depth: 0, rowStart: 1, rowSpan: 2 });
    expect(byId.get('bankA')).toMatchObject({ depth: 1 });
    expect(lattice.depthCount).toBe(2);
  });

  it('keeps the root pill for an empty Topic even when showRoot is false', () => {
    const lattice = computeTopicLattice({ ...topicOf([]), showRoot: false }, new Set());
    expect(lattice.pills).toHaveLength(1);
    expect(lattice.pills[0]!.nodeId).toBe(ROOT_PILL_ID);
  });

  it('keeps the root pill on a single row for an empty Topic', () => {
    const lattice = computeTopicLattice(topicOf([]), new Set());
    expect(lattice.rows).toEqual([]);
    expect(lattice.pills).toHaveLength(1);
    expect(lattice.pills[0]).toMatchObject({ nodeId: ROOT_PILL_ID, rowStart: 1, rowSpan: 1 });
  });

  it('groups pills by starting row with shallower pills first', () => {
    const lattice = computeTopicLattice(TREE, new Set());
    const firstRow = lattice.pillsByRowStart.get(1)!.map((pill) => pill.nodeId);
    expect(firstRow).toEqual([ROOT_PILL_ID, 'savings', 'bankA']);
  });

  it('lists the Leaves hidden beneath a collapsed Branch', () => {
    const savings = TREE.children[0]!;
    expect(hiddenLeavesOf(savings).map((leaf) => leaf.id)).toEqual(['bankA', 'bankB']);
  });

  it('renders a hidden root over leaves only as a pure table — no tree columns', () => {
    const flat = { ...topicOf([node('r1'), node('r2')]), showRoot: false };
    const lattice = computeTopicLattice(flat, new Set());
    expect(lattice.rows.map((row) => row.nodeId)).toEqual(['r1', 'r2']);
    expect(lattice.pills).toEqual([]);
    expect(lattice.depthCount).toBe(0);
  });

  it('keeps the tree columns when a hidden-root Topic still has branches', () => {
    const lattice = computeTopicLattice({ ...TREE, showRoot: false }, new Set());
    expect(lattice.depthCount).toBeGreaterThan(0);
    expect(lattice.pills.length).toBeGreaterThan(0);
  });
});
