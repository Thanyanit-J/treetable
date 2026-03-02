import { TestBed } from '@angular/core/testing';
import { createCellData } from '../models/tree-table.model';
import { FormulaEngineService } from './formula-engine.service';

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
});
