import { TestBed } from '@angular/core/testing';
import { createCellData } from '../models/tree-table.model';
import { FormulaEngineService } from './formula-engine.service';

function evaluateSingleFormula(raw: string): ReturnType<FormulaEngineService['evaluateRow']>['$Value'] {
  const service = TestBed.inject(FormulaEngineService);
  const columns = [{ id: '$Value', name: 'Value', type: 'number' as const }];
  const row = { $Value: createCellData(raw) };
  const result = service.evaluateRow(columns, row);
  return result['$Value'];
}

describe('FormulaEngineService', () => {
  it('evaluates column reference formulas', () => {
    const service = TestBed.inject(FormulaEngineService);
    const columns = [
      { id: '$Amount', name: 'Amount', type: 'number' as const },
      { id: '$Rate', name: 'Rate', type: 'number' as const },
      { id: '$Value', name: 'Value', type: 'number' as const },
    ];

    const row = {
      $Amount: createCellData('100'),
      $Rate: createCellData('0.5'),
      $Value: createCellData('=$Amount*$Rate'),
    };

    const result = service.evaluateRow(columns, row);
    expect(result['$Value']?.value).toBe(50);
    expect(result['$Value']?.error).toBeNull();
  });

  it('rejects children.* formulas in subtopic-only mode', () => {
    const service = TestBed.inject(FormulaEngineService);
    const columns = [{ id: '$Amount', name: 'Amount', type: 'number' as const }];

    const row = { $Amount: createCellData('=SUM(children.$Amount)') };
    const result = service.evaluateRow(columns, row);

    expect(result['$Amount']?.error).toContain('children.* is not supported');
  });

  it('returns error on circular references', () => {
    const service = TestBed.inject(FormulaEngineService);
    const columns = [
      { id: 'a', name: 'A', type: 'number' as const },
      { id: 'b', name: 'B', type: 'number' as const },
    ];

    const row = {
      a: createCellData('=b'),
      b: createCellData('=a'),
    };

    const result = service.evaluateRow(columns, row);
    expect(result['a']?.error).toContain('Circular');
    expect(result['b']?.error).toContain('Circular');
  });

  it('handles unary operators', () => {
    expect(evaluateSingleFormula('=+5')?.value).toBe(5);
    expect(evaluateSingleFormula('=-5')?.value).toBe(-5);
    expect(evaluateSingleFormula('=--5')?.value).toBe(5);
  });

  it('evaluates parenthesized expressions and reports missing closing parenthesis', () => {
    expect(evaluateSingleFormula('=(2+3)*4')?.value).toBe(20);
    expect(evaluateSingleFormula('=(2+3')?.error).toBe('Expected closing parenthesis');
  });

  it('evaluates built-in functions SUM AVG MIN MAX', () => {
    expect(evaluateSingleFormula('=SUM(1,2,3)')?.value).toBe(6);
    expect(evaluateSingleFormula('=AVG(2,4)')?.value).toBe(3);
    expect(evaluateSingleFormula('=MIN(3,1,2)')?.value).toBe(1);
    expect(evaluateSingleFormula('=MAX(3,1,2)')?.value).toBe(3);
  });

  it('returns unknown function error', () => {
    expect(evaluateSingleFormula('=FOO(1)')?.error).toBe('Unknown function: FOO');
  });

  it('reports function argument syntax errors and trailing tokens', () => {
    expect(evaluateSingleFormula('=SUM(1 2)')?.error).toBe('Expected comma between function arguments');
    expect(evaluateSingleFormula('=1+2 3')?.error).toBe('Unexpected trailing formula tokens');
  });

  it('resolves identifiers and reports unknown columns', () => {
    const service = TestBed.inject(FormulaEngineService);
    const columns = [
      { id: '$Amount', name: 'Amount', type: 'number' as const },
      { id: '$Value', name: 'Value', type: 'number' as const },
    ];
    const row = {
      $Amount: createCellData('8'),
      $Value: createCellData('=$Amount'),
    };
    const resolved = service.evaluateRow(columns, row);
    expect(resolved['$Value']?.value).toBe(8);
    expect(evaluateSingleFormula('=$Unknown')?.error).toBe('Unknown column: $Unknown');
  });

  it('reports unexpected tokens and division by zero', () => {
    expect(evaluateSingleFormula('=)')?.error).toBe('Unexpected token in formula');
    expect(evaluateSingleFormula('=10/0')?.error).toBe('Division by zero');
  });
});
