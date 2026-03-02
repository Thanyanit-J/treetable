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

    const result = service.evaluateRow(columns, row, []);
    expect(result['value']?.value).toBe(50);
    expect(result['value']?.error).toBeNull();
  });

  it('supports children aggregate functions', () => {
    const service = TestBed.inject(FormulaEngineService);
    const columns = [{ id: 'amount', name: 'Amount', type: 'number' as const }];

    const topicRow = { amount: createCellData('=AVG(children.amount)') };
    const childRows = [{ amount: createCellData('20') }, { amount: createCellData('40') }];
    const evalChildren = childRows.map((row) => service.evaluateRow(columns, row, []));

    const result = service.evaluateRow(columns, topicRow, evalChildren);
    expect(result['amount']?.value).toBe(30);
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

    const result = service.evaluateRow(columns, row, []);
    expect(result['a']?.error).toContain('Circular');
    expect(result['b']?.error).toContain('Circular');
  });
});
