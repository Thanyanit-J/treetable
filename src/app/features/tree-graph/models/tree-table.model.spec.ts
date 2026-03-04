import { isValidColumnId, slugToColumnId } from './tree-table.model';

describe('tree-table.model regex semantics', () => {
  it('slugToColumnId keeps word chars and strips non-word chars', () => {
    expect(slugToColumnId(' Rate % 2026 ')).toBe('$Rate2026');
    expect(slugToColumnId('net_income')).toBe('$net_income');
    expect(slugToColumnId('a-b.c')).toBe('$abc');
  });

  it('slugToColumnId prefixes with underscore when first char is numeric', () => {
    expect(slugToColumnId('2026 Plan')).toBe('$_2026Plan');
  });

  it('isValidColumnId accepts word-char tail and rejects invalid forms', () => {
    expect(isValidColumnId('$A')).toBe(true);
    expect(isValidColumnId('$A_1')).toBe(true);
    expect(isValidColumnId('$A-1')).toBe(false);
    expect(isValidColumnId('$')).toBe(false);
    expect(isValidColumnId('A')).toBe(false);
  });
});
