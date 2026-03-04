import { TestBed } from '@angular/core/testing';
import { TableColumn, TreeSubtopic, createCellData } from '../models/tree-table.model';
import { FormulaEngineService } from './formula-engine.service';

function evaluateSingleFormula(raw: string): ReturnType<FormulaEngineService['evaluateRow']>['$Value'] {
  const service = TestBed.inject(FormulaEngineService);
  const columns = [{ id: '$Value', name: 'Value', type: 'number' as const }];
  const row = { $Value: createCellData(raw) };
  const result = service.evaluateRow(columns, row);
  return result['$Value'];
}

function evaluateTopicRows(columns: TableColumn[], rows: TreeSubtopic[]): TreeSubtopic[] {
  const service = TestBed.inject(FormulaEngineService);
  return service.evaluateTopicRows(columns, rows);
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

  it('evaluates SUM AVG MIN MAX in whole-column mode with a single bare column id', () => {
    const columns: TableColumn[] = [
      { id: '$A', name: 'A', type: 'number' },
      { id: '$Sum', name: 'Sum', type: 'number' },
      { id: '$Avg', name: 'Avg', type: 'number' },
      { id: '$Min', name: 'Min', type: 'number' },
      { id: '$Max', name: 'Max', type: 'number' },
    ];
    const rows: TreeSubtopic[] = [
      {
        id: 'row-1',
        topicId: 'topic-1',
        label: 'Row 1',
        cells: {
          $A: createCellData('1'),
          $Sum: createCellData('=SUM($A)'),
          $Avg: createCellData('=AVG($A)'),
          $Min: createCellData('=MIN($A)'),
          $Max: createCellData('=MAX($A)'),
        },
      },
      {
        id: 'row-2',
        topicId: 'topic-1',
        label: 'Row 2',
        cells: {
          $A: createCellData('2'),
          $Sum: createCellData('=SUM($A)'),
          $Avg: createCellData('=AVG($A)'),
          $Min: createCellData('=MIN($A)'),
          $Max: createCellData('=MAX($A)'),
        },
      },
      {
        id: 'row-3',
        topicId: 'topic-1',
        label: 'Row 3',
        cells: {
          $A: createCellData('3'),
          $Sum: createCellData('=SUM($A)'),
          $Avg: createCellData('=AVG($A)'),
          $Min: createCellData('=MIN($A)'),
          $Max: createCellData('=MAX($A)'),
        },
      },
    ];

    const evaluated = evaluateTopicRows(columns, rows);
    for (const row of evaluated) {
      expect(row.cells['$Sum']?.value).toBe(6);
      expect(row.cells['$Avg']?.value).toBe(2);
      expect(row.cells['$Min']?.value).toBe(1);
      expect(row.cells['$Max']?.value).toBe(3);
      expect(row.cells['$Sum']?.error).toBeNull();
    }
  });

  it('keeps function evaluation row-local when args are not exactly one bare column id', () => {
    const columns: TableColumn[] = [
      { id: '$A', name: 'A', type: 'number' },
      { id: '$B', name: 'B', type: 'number' },
      { id: '$C', name: 'C', type: 'number' },
      { id: '$D', name: 'D', type: 'number' },
      { id: '$E', name: 'E', type: 'number' },
      { id: '$F', name: 'F', type: 'number' },
    ];
    const rows: TreeSubtopic[] = [
      {
        id: 'row-1',
        topicId: 'topic-1',
        label: 'Row 1',
        cells: {
          $A: createCellData('2'),
          $B: createCellData('3'),
          $C: createCellData('=SUM($A,1)'),
          $D: createCellData('=SUM($A,$B)'),
          $E: createCellData('=SUM($A,SUM($A))'),
          $F: createCellData('=SUM(($A))'),
        },
      },
      {
        id: 'row-2',
        topicId: 'topic-1',
        label: 'Row 2',
        cells: {
          $A: createCellData('4'),
          $B: createCellData('5'),
          $C: createCellData('=SUM($A,1)'),
          $D: createCellData('=SUM($A,$B)'),
          $E: createCellData('=SUM($A,SUM($A))'),
          $F: createCellData('=SUM(($A))'),
        },
      },
    ];

    const evaluated = evaluateTopicRows(columns, rows);
    expect(evaluated[0]?.cells['$C']?.value).toBe(3);
    expect(evaluated[1]?.cells['$C']?.value).toBe(5);
    expect(evaluated[0]?.cells['$D']?.value).toBe(5);
    expect(evaluated[1]?.cells['$D']?.value).toBe(9);
    expect(evaluated[0]?.cells['$E']?.value).toBe(8);
    expect(evaluated[1]?.cells['$E']?.value).toBe(10);
    expect(evaluated[0]?.cells['$F']?.value).toBe(2);
    expect(evaluated[1]?.cells['$F']?.value).toBe(4);
  });

  it('fails fast when whole-column aggregation includes an errored row', () => {
    const columns: TableColumn[] = [
      { id: '$A', name: 'A', type: 'number' },
      { id: '$B', name: 'B', type: 'number' },
    ];
    const rows: TreeSubtopic[] = [
      {
        id: 'row-1',
        topicId: 'topic-1',
        label: 'Row 1',
        cells: {
          $A: createCellData('=10/0'),
          $B: createCellData('=SUM($A)'),
        },
      },
      {
        id: 'row-2',
        topicId: 'topic-1',
        label: 'Row 2',
        cells: {
          $A: createCellData('2'),
          $B: createCellData('=SUM($A)'),
        },
      },
    ];

    const evaluated = evaluateTopicRows(columns, rows);
    expect(evaluated[0]?.cells['$B']?.error).toBe('Division by zero');
    expect(evaluated[1]?.cells['$B']?.error).toBe('Division by zero');
  });

  it('detects circular references involving whole-column aggregation', () => {
    const columns: TableColumn[] = [{ id: '$A', name: 'A', type: 'number' }];
    const rows: TreeSubtopic[] = [
      {
        id: 'row-1',
        topicId: 'topic-1',
        label: 'Row 1',
        cells: {
          $A: createCellData('=SUM($A)'),
        },
      },
      {
        id: 'row-2',
        topicId: 'topic-1',
        label: 'Row 2',
        cells: {
          $A: createCellData('2'),
        },
      },
    ];

    const evaluated = evaluateTopicRows(columns, rows);
    expect(evaluated[0]?.cells['$A']?.error).toContain('Circular');
  });
});
