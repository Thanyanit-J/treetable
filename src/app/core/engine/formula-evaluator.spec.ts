import { describe, expect, it } from 'vitest';
import { ColumnV2, NodeV2, TopicCardV2 } from '../model/document.model';
import { evaluateTopic, formatNumericValue, rollupSum } from './formula-evaluator';

let idCounter = 0;

function inputColumn(refName: string): ColumnV2 {
  idCounter += 1;
  return {
    id: `col_${refName.slice(1)}`,
    refName,
    displayName: refName.slice(1),
    kind: 'input',
    valueType: 'number',
    expression: null,
    rollup: 'none',
  };
}

function computedColumn(refName: string, expression: string): ColumnV2 {
  return { ...inputColumn(refName), kind: 'computed', expression };
}

function leaf(name: string, values: Record<string, string>): NodeV2 {
  idCounter += 1;
  return {
    id: `node_${name}_${idCounter}`,
    refName: name,
    displayName: name,
    accent: null,
    children: [],
    values,
  };
}

function topicOf(columns: ColumnV2[], children: NodeV2[]): TopicCardV2 {
  return {
    kind: 'topic',
    id: 'topic_test',
    refName: 'Test',
    displayName: 'Test',
    columns,
    children,
  };
}

function valuesFor(columns: ColumnV2[], raws: string[]): Record<string, string> {
  const values: Record<string, string> = {};
  for (const [index, raw] of raws.entries()) {
    const column = columns[index];
    if (column && raw.length > 0) {
      values[column.id] = raw;
    }
  }
  return values;
}

function cellValue(topic: TopicCardV2, leafId: string, columnId: string): number | null {
  return evaluateTopic(topic).computedCells.get(leafId)?.get(columnId)?.value ?? null;
}

function cellError(topic: TopicCardV2, leafId: string, columnId: string): string | null {
  return evaluateTopic(topic).computedCells.get(leafId)?.get(columnId)?.error ?? null;
}

describe('formula evaluator', () => {
  it('evaluates arithmetic with same-row refs per Row', () => {
    const columns = [inputColumn('$A'), inputColumn('$B'), computedColumn('$C', '= $A * $B + 1')];
    const rows = [
      leaf('r1', valuesFor(columns, ['3', '4'])),
      leaf('r2', valuesFor(columns, ['10', '0.5'])),
    ];
    const topic = topicOf(columns, rows);

    expect(cellValue(topic, rows[0]!.id, columns[2]!.id)).toBe(13);
    expect(cellValue(topic, rows[1]!.id, columns[2]!.id)).toBe(6);
  });

  it('treats a single bare column argument as the whole column', () => {
    const columns = [inputColumn('$A'), computedColumn('$T', '=SUM($A)')];
    const rows = [
      leaf('r1', valuesFor(columns, ['1'])),
      leaf('r2', valuesFor(columns, ['2'])),
      leaf('r3', valuesFor(columns, ['3'])),
    ];
    const topic = topicOf(columns, rows);

    for (const row of rows) {
      expect(cellValue(topic, row.id, columns[1]!.id)).toBe(6);
    }
  });

  it('treats multiple bare column arguments as same-row references', () => {
    const columns = [inputColumn('$A'), inputColumn('$B'), computedColumn('$S', '=SUM($A, $B)')];
    const rows = [
      leaf('r1', valuesFor(columns, ['1', '10'])),
      leaf('r2', valuesFor(columns, ['2', '20'])),
    ];
    const topic = topicOf(columns, rows);

    expect(cellValue(topic, rows[0]!.id, columns[2]!.id)).toBe(11);
    expect(cellValue(topic, rows[1]!.id, columns[2]!.id)).toBe(22);
  });

  it('implements COUNT / COUNTA / COUNTBLANK over a whole column', () => {
    const columns = [
      inputColumn('$A'),
      computedColumn('$N', '=COUNT($A)'),
      computedColumn('$F', '=COUNTA($A)'),
      computedColumn('$E', '=COUNTBLANK($A)'),
    ];
    const rows = [
      leaf('r1', valuesFor(columns, ['5'])),
      leaf('r2', valuesFor(columns, [''])),
      leaf('r3', valuesFor(columns, ['7'])),
    ];
    const topic = topicOf(columns, rows);
    const first = rows[0]!.id;

    expect(cellValue(topic, first, columns[1]!.id)).toBe(3);
    expect(cellValue(topic, first, columns[2]!.id)).toBe(2);
    expect(cellValue(topic, first, columns[3]!.id)).toBe(1);
  });

  it('supports AVG, MIN and MAX', () => {
    const columns = [
      inputColumn('$A'),
      computedColumn('$Avg', '=AVG($A)'),
      computedColumn('$Min', '=MIN($A)'),
      computedColumn('$Max', '=MAX($A)'),
    ];
    const rows = [leaf('r1', valuesFor(columns, ['2'])), leaf('r2', valuesFor(columns, ['8']))];
    const topic = topicOf(columns, rows);
    const first = rows[0]!.id;

    expect(cellValue(topic, first, columns[1]!.id)).toBe(5);
    expect(cellValue(topic, first, columns[2]!.id)).toBe(2);
    expect(cellValue(topic, first, columns[3]!.id)).toBe(8);
  });

  it('evaluates chained computed columns in dependency order', () => {
    const columns = [
      inputColumn('$A'),
      computedColumn('$D', '= $C + 1'),
      computedColumn('$C', '= $A * 2'),
    ];
    const rows = [leaf('r1', valuesFor(columns, ['5']))];
    const topic = topicOf(columns, rows);

    expect(cellValue(topic, rows[0]!.id, columns[1]!.id)).toBe(11);
  });

  it('flags circular references at column granularity', () => {
    const columns = [computedColumn('$X', '= $Y + 1'), computedColumn('$Y', '= $X + 1')];
    const rows = [leaf('r1', {})];
    const topic = topicOf(columns, rows);

    expect(cellError(topic, rows[0]!.id, columns[0]!.id)).toBe('Circular reference');
    expect(cellError(topic, rows[0]!.id, columns[1]!.id)).toBe('Circular reference');
  });

  it('reports division by zero', () => {
    const columns = [inputColumn('$A'), computedColumn('$C', '= 1 / $A')];
    const rows = [leaf('r1', valuesFor(columns, ['0']))];
    const topic = topicOf(columns, rows);

    expect(cellError(topic, rows[0]!.id, columns[1]!.id)).toBe('Division by zero');
  });

  it('errors when referencing a non-numeric literal', () => {
    const columns = [inputColumn('$A'), computedColumn('$C', '= $A * 2')];
    const rows = [leaf('r1', valuesFor(columns, ['abc']))];
    const topic = topicOf(columns, rows);

    expect(cellError(topic, rows[0]!.id, columns[1]!.id)).toBe(
      'Invalid numeric value in column: $A',
    );
  });

  it('rejects unknown references and functions', () => {
    const columns = [computedColumn('$C', '= $Nope'), computedColumn('$D', '=MEDIAN(1, 2)')];
    const rows = [leaf('r1', {})];
    const topic = topicOf(columns, rows);

    expect(cellError(topic, rows[0]!.id, columns[0]!.id)).toBe('Unknown column: $Nope');
    expect(cellError(topic, rows[0]!.id, columns[1]!.id)).toBe('Unknown function: MEDIAN');
  });

  it('reports unknown dotted references by name', () => {
    const columns = [computedColumn('$C', '= SUM(Savings.$A)')];
    const rows = [leaf('r1', {})];
    const topic = topicOf(columns, rows);

    expect(cellError(topic, rows[0]!.id, columns[0]!.id)).toBe('Unknown reference: Savings');
  });

  it('rolls up sums across input and computed columns', () => {
    const columns = [inputColumn('$A'), computedColumn('$C', '= $A * 2')];
    const rows = [leaf('r1', valuesFor(columns, ['3'])), leaf('r2', valuesFor(columns, ['4']))];
    const topic = topicOf(columns, rows);
    const evaluation = evaluateTopic(topic);

    expect(rollupSum(columns[0]!, rows, evaluation)).toBe(7);
    expect(rollupSum(columns[1]!, rows, evaluation)).toBe(14);
  });

  it('refuses to roll up when any involved cell is errored', () => {
    const columns = [inputColumn('$A'), computedColumn('$C', '= 1 / $A')];
    const rows = [leaf('r1', valuesFor(columns, ['0']))];
    const topic = topicOf(columns, rows);
    const evaluation = evaluateTopic(topic);

    expect(rollupSum(columns[1]!, rows, evaluation)).toBeNull();
  });

  it('formats numbers without binary floating-point noise', () => {
    expect(formatNumericValue(0.1 + 0.2)).toBe('0.3');
    expect(formatNumericValue(3600)).toBe('3600');
  });
});
