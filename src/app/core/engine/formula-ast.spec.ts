import { describe, expect, it } from 'vitest';
import { parseExpressionSource, printExpression, transformRefPaths } from './formula-ast';

function roundTrip(source: string): string {
  const outcome = parseExpressionSource(source);
  if ('error' in outcome) {
    throw new Error(outcome.error);
  }
  return printExpression(outcome.expr);
}

function parseError(source: string): string {
  const outcome = parseExpressionSource(source);
  if (!('error' in outcome)) {
    throw new Error(`expected a parse error for: ${source}`);
  }
  return outcome.error;
}

describe('formula AST', () => {
  it('prints with minimal but sufficient parentheses', () => {
    expect(roundTrip('$A*($B+$C)')).toBe('$A * ($B + $C)');
    expect(roundTrip('(1 - 2) - 3')).toBe('1 - 2 - 3');
    expect(roundTrip('1 - (2 - 3)')).toBe('1 - (2 - 3)');
    expect(roundTrip('1 / (2 / 4)')).toBe('1 / (2 / 4)');
    expect(roundTrip('-($A + 1)')).toBe('-($A + 1)');
    expect(roundTrip('SUM($A,$B) * 2')).toBe('SUM($A, $B) * 2');
  });

  it('prints dotted reference paths verbatim', () => {
    expect(roundTrip('SUM( Wealth.Savings.$Amount )')).toBe('SUM(Wealth.Savings.$Amount)');
    expect(roundTrip('Cash.$Amount + 1')).toBe('Cash.$Amount + 1');
  });

  it('re-parsing a printed expression yields the same print', () => {
    for (const source of ['$A * ($B + $C)', 'SUM(Savings.$A) / COUNT($A)', '1 - (2 - 3) - 4']) {
      expect(roundTrip(roundTrip(source))).toBe(roundTrip(source));
    }
  });

  it('rejects malformed reference paths with specific messages', () => {
    expect(parseError('$A.$B')).toContain('cannot be qualified further');
    expect(parseError('A.B.C.$D')).toContain('nested too deeply');
    expect(parseError('Savings.Bank')).toContain('Expected a column reference after');
    expect(parseError('children')).toContain('reference a Branch by its Reference Name');
    expect(parseError('Savings.')).toContain('Expected a name after');
  });

  it('keeps v1 whole-column semantics for a single bare column argument', () => {
    const sole = parseExpressionSource('SUM($A)');
    if ('error' in sole) {
      throw new Error(sole.error);
    }
    expect(sole.expr).toMatchObject({ kind: 'call', args: [{ kind: 'series', path: ['$A'] }] });

    const multi = parseExpressionSource('SUM($A, $B)');
    if ('error' in multi) {
      throw new Error(multi.error);
    }
    expect(multi.expr).toMatchObject({
      kind: 'call',
      args: [
        { kind: 'expr', expr: { kind: 'ref', path: ['$A'] } },
        { kind: 'expr', expr: { kind: 'ref', path: ['$B'] } },
      ],
    });

    const count = parseExpressionSource('COUNTA($A, $B)');
    if ('error' in count) {
      throw new Error(count.error);
    }
    expect(count.expr).toMatchObject({
      kind: 'call',
      args: [
        { kind: 'rowRaw', path: ['$A'] },
        { kind: 'rowRaw', path: ['$B'] },
      ],
    });
  });

  it('parses dot aggregates as call sugar and prints them back dotted', () => {
    const outcome = parseExpressionSource('$A.sum()');
    if ('error' in outcome) {
      throw new Error(outcome.error);
    }
    expect(outcome.expr).toMatchObject({
      kind: 'call',
      name: 'SUM',
      dotted: true,
      args: [{ kind: 'series', path: ['$A'] }],
    });

    expect(roundTrip('$A.sum()')).toBe('$A.sum()');
    expect(roundTrip('Wealth.Savings.$Amount.avg() + 1')).toBe('Wealth.Savings.$Amount.avg() + 1');
    expect(roundTrip('$A.count() / COUNT($A)')).toBe('$A.count() / COUNT($A)');
  });

  it('keeps the dotted style through ref-path transforms', () => {
    const outcome = parseExpressionSource('$A.sum()');
    if ('error' in outcome) {
      throw new Error(outcome.error);
    }
    const renamed = transformRefPaths(outcome.expr, () => ['$B']);
    expect(printExpression(renamed)).toBe('$B.sum()');
  });

  it('rejects malformed dot aggregates with specific messages', () => {
    expect(parseError('$A.median()')).toContain('Unknown function');
    expect(parseError('$A.sum(1)')).toContain('takes no arguments');
    expect(parseError('Savings.sum()')).toContain('Expected a column reference');
  });

  it('treats dotted paths in aggregates as series regardless of arity', () => {
    const outcome = parseExpressionSource('SUM(Savings.$A, Cash.$A)');
    if ('error' in outcome) {
      throw new Error(outcome.error);
    }
    expect(outcome.expr).toMatchObject({
      kind: 'call',
      args: [
        { kind: 'series', path: ['Savings', '$A'] },
        { kind: 'series', path: ['Cash', '$A'] },
      ],
    });
  });
});
