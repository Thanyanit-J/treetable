import { TestBed } from '@angular/core/testing';
import { createCellData } from '../models/tree-table.model';
import { FormulaEngineService } from './formula-engine.service';

describe('FormulaEngineService', () => {
  it('evaluates column reference formulas', () => {
    const service = TestBed.inject(FormulaEngineService);
    const columns = [
      { id: 'amount', name: 'Amount', type: 'number' as const },
      { id: 'rate', name: 'Rate', type: 'number' as const },
      { id: 'value', name: 'Value', type: 'number' as const },
    ];

    const row = {
      amount: createCellData('100'),
      rate: createCellData('0.5'),
      value: createCellData('=amount*rate'),
    };

    const result = service.evaluateRow(columns, row);
    expect(result['value']?.value).toBe(50);
    expect(result['value']?.error).toBeNull();
  });

  it('rejects children.* formulas in subtopic-only mode', () => {
    const service = TestBed.inject(FormulaEngineService);
    const columns = [{ id: 'amount', name: 'Amount', type: 'number' as const }];

    const row = { amount: createCellData('=SUM(children.amount)') };
    const result = service.evaluateRow(columns, row);

    expect(result['amount']?.error).toContain('children.* is not supported');
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
});
