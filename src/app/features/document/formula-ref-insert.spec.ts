import { describe, expect, it } from 'vitest';
import { spliceReference } from './formula-ref-insert';

/** Caret position marked with `|`, e.g. `= $Amt| * 2`. */
function at(marked: string): { value: string; caret: number } {
  const caret = marked.indexOf('|');
  return { value: marked.replace('|', ''), caret };
}

function splice(marked: string, refText: string): string {
  const { value, caret } = at(marked);
  const result = spliceReference(value, caret, caret, refText);
  return result.value.slice(0, result.caret) + '|' + result.value.slice(result.caret);
}

describe('spliceReference', () => {
  it('inserts at the caret in an empty formula', () => {
    expect(splice('= |', '$Amount')).toBe('= $Amount|');
  });

  it('replaces the $token the caret sits inside', () => {
    expect(splice('= $Am|t * 2', '$Amount')).toBe('= $Amount| * 2');
  });

  it('replaces the $token immediately before the caret', () => {
    expect(splice('= $Amt| * 2', '$Amount')).toBe('= $Amount| * 2');
  });

  it('replaces a lone $ the user just typed', () => {
    expect(splice('= $|', '$Rate')).toBe('= $Rate|');
  });

  it('replaces the whole dotted path, qualifiers included', () => {
    expect(splice('= Wealth.Savings.$Amount| + 1', '$B')).toBe('= $B| + 1');
  });

  it('does not eat a number literal in front of a dot', () => {
    expect(splice('= 1.$x|', '$Rate')).toBe('= 1.$Rate|');
  });

  it('completes a dotted path the user started, without padding', () => {
    expect(splice('= Wealth.|', '$Amount')).toBe('= Wealth.$Amount|');
  });

  it('pads with spaces when inserting next to a word', () => {
    expect(splice('= foo|', '$A')).toBe('= foo $A|');
  });

  it('pads on both sides when splitting an operator-free spot', () => {
    const { value, caret } = at('= 2|3');
    const result = spliceReference(value, caret, caret, '$A');
    expect(result.value).toBe('= 2 $A 3');
  });

  it('does not pad after an operator', () => {
    expect(splice('= $A +|', '$B')).toBe('= $A +$B|');
  });

  it('replaces an explicit selection verbatim', () => {
    const result = spliceReference('= 100 * 2', 2, 5, '$Amount');
    expect(result.value).toBe('= $Amount * 2');
    expect(result.caret).toBe(9);
  });

  it('replaces column names that themselves start with $ without doubling it', () => {
    expect(splice('= $$weird|', '$Amount')).toBe('= $Amount|');
  });

  it('inserts qualified cross-topic references as one path', () => {
    expect(splice('= 2 * |', 'Wealth.$Amount')).toBe('= 2 * Wealth.$Amount|');
  });

  it('replaces a local token with a qualified reference', () => {
    expect(splice('= $Amt|', 'Wealth.$Amount')).toBe('= Wealth.$Amount|');
  });

  it('clamps out-of-range caret positions', () => {
    const result = spliceReference('= 1', 99, 99, '$A');
    expect(result.value).toBe('= 1 $A');
  });
});
