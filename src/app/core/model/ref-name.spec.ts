import { describe, expect, it } from 'vitest';
import {
  isValidColumnRefName,
  isValidEntityRefName,
  slugifyColumnRefName,
  slugifyEntityRefName,
  uniqueRefName,
} from './ref-name';

describe('ref-name', () => {
  it('validates column reference names', () => {
    expect(isValidColumnRefName('$Amount')).toBe(true);
    expect(isValidColumnRefName('$_a1')).toBe(true);
    expect(isValidColumnRefName('Amount')).toBe(false);
    expect(isValidColumnRefName('$1a')).toBe(false);
    expect(isValidColumnRefName('$SUM')).toBe(false);
  });

  it('validates entity reference names', () => {
    expect(isValidEntityRefName('Savings')).toBe(true);
    expect(isValidEntityRefName('_hidden')).toBe(true);
    expect(isValidEntityRefName('$Savings')).toBe(false);
    expect(isValidEntityRefName('9lives')).toBe(false);
    expect(isValidEntityRefName('children')).toBe(false);
    expect(isValidEntityRefName('COUNT')).toBe(false);
  });

  it('slugifies display names into reference names', () => {
    expect(slugifyColumnRefName('Interest Rate (%)')).toBe('$InterestRate');
    expect(slugifyColumnRefName('  ')).toBe('$Column');
    expect(slugifyColumnRefName('42')).toBe('$_42');
    expect(slugifyColumnRefName('SUM')).toBe('$SUM_ref');
    expect(slugifyEntityRefName('Family Company')).toBe('FamilyCompany');
    expect(slugifyEntityRefName('儲蓄')).toBe('Item');
    expect(slugifyEntityRefName('children')).toBe('children_ref');
  });

  it('uniquifies against taken names', () => {
    expect(uniqueRefName('Savings', new Set())).toBe('Savings');
    expect(uniqueRefName('Savings', new Set(['Savings']))).toBe('Savings_2');
    expect(uniqueRefName('Savings', new Set(['Savings', 'Savings_2']))).toBe('Savings_3');
  });
});
