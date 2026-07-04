import { ColumnV2, NodeV2, TopicCardV2, collectLeaves } from '../model/document.model';

/**
 * Seed formula evaluator (milestone: core check-in).
 *
 * Per ADR-0002 a formula belongs to a Computed Column: one expression,
 * evaluated once per Leaf Row. Supported today: arithmetic, same-row input
 * refs (`$Rate`), and whole-column aggregates (`SUM($Amount)`).
 * Subtree refs (`Savings.$Amount`) and cross-topic refs (`Wealth.$Amount`)
 * are reserved in the grammar and rejected with a clear message until the
 * engine milestone lands (ADR-0003).
 *
 * Dependencies and cycles are tracked at column granularity, which is exactly
 * right under ADR-0002 — there are no per-cell formulas to track.
 */

export interface CellComputation {
  value: number | null;
  error: string | null;
}

export interface TopicEvaluation {
  /** leaf node id -> column id -> computation. Present for computed columns only. */
  readonly computedCells: ReadonlyMap<string, ReadonlyMap<string, CellComputation>>;
}

const NOT_YET_SUPPORTED =
  'Subtree and cross-topic references are not available yet — coming in the engine milestone.';

const AGGREGATE_FUNCTIONS = new Set(['SUM', 'AVG', 'MIN', 'MAX']);
const COUNT_FUNCTIONS = new Set(['COUNT', 'COUNTA', 'COUNTBLANK']);

// ---------------------------------------------------------------------------
// Tokenizer
// ---------------------------------------------------------------------------

type TokenType =
  | 'number'
  | 'identifier'
  | 'plus'
  | 'minus'
  | 'star'
  | 'slash'
  | 'lparen'
  | 'rparen'
  | 'comma'
  | 'dot';

interface Token {
  type: TokenType;
  lexeme: string;
}

const SINGLE_CHAR_TOKENS: Readonly<Record<string, TokenType>> = {
  '+': 'plus',
  '-': 'minus',
  '*': 'star',
  '/': 'slash',
  '(': 'lparen',
  ')': 'rparen',
  ',': 'comma',
  '.': 'dot',
};

function tokenize(source: string): { tokens: Token[] } | { error: string } {
  const tokens: Token[] = [];
  let index = 0;

  while (index < source.length) {
    const char = source[index];
    if (!char || /\s/.test(char)) {
      index += 1;
      continue;
    }

    if (/\d/.test(char) || (char === '.' && /\d/.test(source[index + 1] ?? ''))) {
      let end = index + 1;
      while (end < source.length && /[\d.]/.test(source[end] ?? '')) {
        end += 1;
      }
      tokens.push({ type: 'number', lexeme: source.slice(index, end) });
      index = end;
      continue;
    }

    if (/[A-Za-z_$]/.test(char)) {
      let end = index + 1;
      while (end < source.length && /[\w$]/.test(source[end] ?? '')) {
        end += 1;
      }
      tokens.push({ type: 'identifier', lexeme: source.slice(index, end) });
      index = end;
      continue;
    }

    const type = SINGLE_CHAR_TOKENS[char];
    if (type) {
      tokens.push({ type, lexeme: char });
      index += 1;
      continue;
    }

    return { error: `Invalid character in formula: ${char}` };
  }

  return { tokens };
}

// ---------------------------------------------------------------------------
// Parser — produces an AST once per column expression
// ---------------------------------------------------------------------------

export type Expr =
  | { kind: 'number'; value: number }
  | { kind: 'ref'; refName: string }
  | { kind: 'unary'; op: '+' | '-'; operand: Expr }
  | { kind: 'binary'; op: '+' | '-' | '*' | '/'; left: Expr; right: Expr }
  | { kind: 'call'; name: string; args: CallArg[] };

export type CallArg =
  | { kind: 'series'; refName: string }
  | { kind: 'rowRaw'; refName: string }
  | { kind: 'expr'; expr: Expr };

interface ParserState {
  tokens: Token[];
  cursor: number;
}

type ParseOutcome = { expr: Expr } | { error: string };

function isColumnRef(lexeme: string): boolean {
  return /^\$[A-Za-z_]\w*$/.test(lexeme);
}

/** Parses expression source WITHOUT the leading '='. */
export function parseExpressionSource(source: string): ParseOutcome {
  const tokenized = tokenize(source);
  if ('error' in tokenized) {
    return { error: tokenized.error };
  }

  const state: ParserState = { tokens: tokenized.tokens, cursor: 0 };
  const outcome = parseExpression(state);
  if ('error' in outcome) {
    return outcome;
  }
  if (state.cursor < state.tokens.length) {
    return { error: 'Unexpected trailing formula tokens' };
  }
  return outcome;
}

function peek(state: ParserState): Token | undefined {
  return state.tokens[state.cursor];
}

function match(state: ParserState, type: TokenType): boolean {
  if (peek(state)?.type === type) {
    state.cursor += 1;
    return true;
  }
  return false;
}

function parseExpression(state: ParserState): ParseOutcome {
  let left = parseTerm(state);
  while (!('error' in left)) {
    let op: '+' | '-';
    if (match(state, 'plus')) {
      op = '+';
    } else if (match(state, 'minus')) {
      op = '-';
    } else {
      break;
    }
    const right = parseTerm(state);
    if ('error' in right) {
      return right;
    }
    left = { expr: { kind: 'binary', op, left: left.expr, right: right.expr } };
  }
  return left;
}

function parseTerm(state: ParserState): ParseOutcome {
  let left = parseFactor(state);
  while (!('error' in left)) {
    let op: '*' | '/';
    if (match(state, 'star')) {
      op = '*';
    } else if (match(state, 'slash')) {
      op = '/';
    } else {
      break;
    }
    const right = parseFactor(state);
    if ('error' in right) {
      return right;
    }
    left = { expr: { kind: 'binary', op, left: left.expr, right: right.expr } };
  }
  return left;
}

function parseFactor(state: ParserState): ParseOutcome {
  if (match(state, 'plus')) {
    const operand = parseFactor(state);
    if ('error' in operand) {
      return operand;
    }
    return { expr: { kind: 'unary', op: '+', operand: operand.expr } };
  }

  if (match(state, 'minus')) {
    const operand = parseFactor(state);
    if ('error' in operand) {
      return operand;
    }
    return { expr: { kind: 'unary', op: '-', operand: operand.expr } };
  }

  const token = peek(state);
  if (!token) {
    return { error: 'Unexpected end of formula' };
  }

  if (token.type === 'number') {
    state.cursor += 1;
    const value = Number(token.lexeme);
    if (!Number.isFinite(value)) {
      return { error: `Invalid number: ${token.lexeme}` };
    }
    return { expr: { kind: 'number', value } };
  }

  if (token.type === 'identifier') {
    state.cursor += 1;
    if (match(state, 'dot')) {
      return { error: NOT_YET_SUPPORTED };
    }
    if (token.lexeme === 'children') {
      return { error: NOT_YET_SUPPORTED };
    }
    if (match(state, 'lparen')) {
      return parseCall(state, token.lexeme);
    }
    if (!isColumnRef(token.lexeme)) {
      return { error: `Unknown identifier: ${token.lexeme}` };
    }
    return { expr: { kind: 'ref', refName: token.lexeme } };
  }

  if (match(state, 'lparen')) {
    const nested = parseExpression(state);
    if ('error' in nested) {
      return nested;
    }
    if (!match(state, 'rparen')) {
      return { error: 'Expected closing parenthesis' };
    }
    return nested;
  }

  return { error: 'Unexpected token in formula' };
}

function parseCall(state: ParserState, name: string): ParseOutcome {
  const upper = name.toUpperCase();
  const isAggregate = AGGREGATE_FUNCTIONS.has(upper);
  const isCount = COUNT_FUNCTIONS.has(upper);
  if (!isAggregate && !isCount) {
    return { error: `Unknown function: ${name}` };
  }

  if (match(state, 'rparen')) {
    if (isCount) {
      return { error: 'Expected function argument' };
    }
    return { expr: { kind: 'call', name: upper, args: [] } };
  }

  const args: CallArg[] = [];
  for (;;) {
    const bare = tryBareColumnArg(state);
    if (bare) {
      // Temporary marker; normalizeCallArgs decides series/rowRaw/expr once
      // the full argument list (and thus arity) is known.
      args.push({ kind: 'rowRaw', refName: bare });
    } else {
      const parsed = parseExpression(state);
      if ('error' in parsed) {
        return parsed;
      }
      args.push({ kind: 'expr', expr: parsed.expr });
    }

    if (match(state, 'rparen')) {
      break;
    }
    if (!match(state, 'comma')) {
      return { error: 'Expected comma between function arguments' };
    }
  }

  return { expr: { kind: 'call', name: upper, args: normalizeCallArgs(upper, args) } };
}

/**
 * A single bare column argument means "the whole column" (v1 semantics):
 * `SUM($Amount)` sums every Row. With multiple arguments, bare columns are
 * same-row references — except in COUNT functions, where they test the
 * current Row's raw for blankness.
 */
function normalizeCallArgs(upperName: string, args: CallArg[]): CallArg[] {
  const isCount = COUNT_FUNCTIONS.has(upperName);
  const soleBare =
    args.length === 1 && args[0] !== undefined && isBareRefArg(args[0])
      ? bareRefName(args[0])
      : null;
  if (soleBare) {
    return [{ kind: 'series', refName: soleBare }];
  }
  return args.map((arg) => {
    const refName = isBareRefArg(arg) ? bareRefName(arg) : null;
    if (refName && isCount) {
      return { kind: 'rowRaw', refName };
    }
    if (refName) {
      return { kind: 'expr', expr: { kind: 'ref', refName } };
    }
    return arg;
  });
}

function tryBareColumnArg(state: ParserState): string | null {
  const first = peek(state);
  const second = state.tokens[state.cursor + 1];
  const terminated = second?.type === 'comma' || second?.type === 'rparen';
  if (first?.type !== 'identifier' || !terminated || !isColumnRef(first.lexeme)) {
    return null;
  }
  state.cursor += 1;
  return first.lexeme;
}

function isBareRefArg(arg: CallArg): boolean {
  // Only args captured by tryBareColumnArg count as bare; a parenthesized
  // ref like `SUM(($A))` stays a same-row expression, matching v1.
  return arg.kind === 'rowRaw';
}

function bareRefName(arg: CallArg): string {
  if (arg.kind !== 'rowRaw') {
    throw new Error('not a bare ref argument');
  }
  return arg.refName;
}

// ---------------------------------------------------------------------------
// Column dependency analysis
// ---------------------------------------------------------------------------

export function collectExpressionRefs(expr: Expr, into = new Set<string>()): Set<string> {
  switch (expr.kind) {
    case 'number':
      break;
    case 'ref':
      into.add(expr.refName);
      break;
    case 'unary':
      collectExpressionRefs(expr.operand, into);
      break;
    case 'binary':
      collectExpressionRefs(expr.left, into);
      collectExpressionRefs(expr.right, into);
      break;
    case 'call':
      for (const arg of expr.args) {
        if (arg.kind === 'expr') {
          collectExpressionRefs(arg.expr, into);
        } else {
          into.add(arg.refName);
        }
      }
      break;
  }
  return into;
}

// ---------------------------------------------------------------------------
// Evaluation
// ---------------------------------------------------------------------------

interface ParsedColumn {
  column: ColumnV2;
  expr: Expr | null;
  parseError: string | null;
  deps: ReadonlySet<string>;
}

export function evaluateTopic(topic: TopicCardV2): TopicEvaluation {
  const leaves = collectLeaves(topic.children);
  const byRefName = new Map(topic.columns.map((column) => [column.refName, column]));

  const parsedColumns = new Map<string, ParsedColumn>();
  for (const column of topic.columns) {
    if (column.kind !== 'computed') {
      continue;
    }
    const source = (column.expression ?? '').trim().replace(/^=/, '');
    if (source.length === 0) {
      parsedColumns.set(column.refName, {
        column,
        expr: null,
        parseError: 'Empty formula',
        deps: new Set(),
      });
      continue;
    }
    const outcome = parseExpressionSource(source);
    if ('error' in outcome) {
      parsedColumns.set(column.refName, {
        column,
        expr: null,
        parseError: outcome.error,
        deps: new Set(),
      });
      continue;
    }
    parsedColumns.set(column.refName, {
      column,
      expr: outcome.expr,
      parseError: null,
      deps: collectExpressionRefs(outcome.expr),
    });
  }

  const cyclic = findCyclicColumns(parsedColumns);

  const computedCells = new Map<string, Map<string, CellComputation>>();
  for (const leaf of leaves) {
    computedCells.set(leaf.id, new Map<string, CellComputation>());
  }

  // Per-column memo of evaluated results, filled in dependency order on demand.
  const columnResults = new Map<string, Map<string, CellComputation>>();
  const inProgress = new Set<string>();

  const inputCellValue = (column: ColumnV2, leaf: NodeV2): CellComputation => {
    const raw = (leaf.values[column.id] ?? '').trim();
    if (raw.length === 0) {
      return { value: 0, error: null };
    }
    const parsed = Number(raw);
    if (Number.isFinite(parsed)) {
      return { value: parsed, error: null };
    }
    return { value: null, error: `Invalid numeric value in column: ${column.refName}` };
  };

  const evaluateColumn = (refName: string): Map<string, CellComputation> => {
    const memo = columnResults.get(refName);
    if (memo) {
      return memo;
    }

    const results = new Map<string, CellComputation>();
    columnResults.set(refName, results);

    const parsed = parsedColumns.get(refName);
    const column = byRefName.get(refName);

    if (!column) {
      for (const leaf of leaves) {
        results.set(leaf.id, { value: null, error: `Unknown column: ${refName}` });
      }
      return results;
    }

    if (column.kind !== 'computed') {
      for (const leaf of leaves) {
        results.set(leaf.id, inputCellValue(column, leaf));
      }
      return results;
    }

    if (cyclic.has(refName) || inProgress.has(refName)) {
      for (const leaf of leaves) {
        results.set(leaf.id, { value: null, error: 'Circular reference' });
      }
      return results;
    }

    if (!parsed || parsed.parseError !== null || parsed.expr === null) {
      const message = parsed?.parseError ?? 'Empty formula';
      for (const leaf of leaves) {
        results.set(leaf.id, { value: null, error: message });
      }
      return results;
    }

    inProgress.add(refName);
    for (const leaf of leaves) {
      results.set(leaf.id, evaluateExpr(parsed.expr, leaf));
    }
    inProgress.delete(refName);
    return results;
  };

  const cellOf = (refName: string, leaf: NodeV2): CellComputation => {
    const results = evaluateColumn(refName);
    return results.get(leaf.id) ?? { value: null, error: `Unknown column: ${refName}` };
  };

  const seriesOf = (refName: string): { values: number[] } | { error: string } => {
    if (!byRefName.has(refName)) {
      return { error: `Unknown column: ${refName}` };
    }
    const values: number[] = [];
    for (const leaf of leaves) {
      const cell = cellOf(refName, leaf);
      if (cell.error !== null) {
        return { error: cell.error };
      }
      values.push(cell.value ?? 0);
    }
    return { values };
  };

  const rawSeriesOf = (refName: string): { raws: string[] } | { error: string } => {
    const column = byRefName.get(refName);
    if (!column) {
      return { error: `Unknown column: ${refName}` };
    }
    return { raws: leaves.map((leaf) => leaf.values[column.id] ?? '') };
  };

  const evaluateExpr = (expr: Expr, leaf: NodeV2): CellComputation => {
    switch (expr.kind) {
      case 'number':
        return { value: expr.value, error: null };
      case 'ref':
        return cellOf(expr.refName, leaf);
      case 'unary': {
        const operand = evaluateExpr(expr.operand, leaf);
        if (operand.error !== null) {
          return operand;
        }
        const value = operand.value ?? 0;
        return { value: expr.op === '-' ? -value : value, error: null };
      }
      case 'binary': {
        const left = evaluateExpr(expr.left, leaf);
        if (left.error !== null) {
          return left;
        }
        const right = evaluateExpr(expr.right, leaf);
        if (right.error !== null) {
          return right;
        }
        const a = left.value ?? 0;
        const b = right.value ?? 0;
        switch (expr.op) {
          case '+':
            return { value: a + b, error: null };
          case '-':
            return { value: a - b, error: null };
          case '*':
            return { value: a * b, error: null };
          case '/':
            if (b === 0) {
              return { value: null, error: 'Division by zero' };
            }
            return { value: a / b, error: null };
        }
        break;
      }
      case 'call':
        return evaluateCall(expr, leaf);
    }
    return { value: null, error: 'Unexpected formula state' };
  };

  const evaluateCall = (expr: Extract<Expr, { kind: 'call' }>, leaf: NodeV2): CellComputation => {
    const isCount = COUNT_FUNCTIONS.has(expr.name);

    interface FunctionArg {
      numericValue: number;
      isBlank: boolean;
    }
    const args: FunctionArg[] = [];

    for (const arg of expr.args) {
      if (arg.kind === 'series') {
        if (isCount) {
          const rawSeries = rawSeriesOf(arg.refName);
          if ('error' in rawSeries) {
            return { value: null, error: rawSeries.error };
          }
          for (const raw of rawSeries.raws) {
            args.push({ numericValue: 0, isBlank: raw.trim().length === 0 });
          }
        } else {
          const series = seriesOf(arg.refName);
          if ('error' in series) {
            return { value: null, error: series.error };
          }
          for (const value of series.values) {
            args.push({ numericValue: value, isBlank: false });
          }
        }
        continue;
      }

      if (arg.kind === 'rowRaw') {
        const column = byRefName.get(arg.refName);
        if (!column) {
          return { value: null, error: `Unknown column: ${arg.refName}` };
        }
        const raw = leaf.values[column.id] ?? '';
        args.push({ numericValue: 0, isBlank: raw.trim().length === 0 });
        continue;
      }

      const result = evaluateExpr(arg.expr, leaf);
      if (result.error !== null) {
        return result;
      }
      args.push({ numericValue: result.value ?? 0, isBlank: false });
    }

    switch (expr.name) {
      case 'COUNT':
        return { value: args.length, error: null };
      case 'COUNTA':
        return { value: args.filter((arg) => !arg.isBlank).length, error: null };
      case 'COUNTBLANK':
        return { value: args.filter((arg) => arg.isBlank).length, error: null };
      default:
        break;
    }

    const numbers = args.map((arg) => arg.numericValue);
    if (numbers.length === 0) {
      return { value: 0, error: null };
    }
    if (numbers.some((value) => !Number.isFinite(value))) {
      return { value: null, error: `Invalid numeric argument for ${expr.name}` };
    }

    switch (expr.name) {
      case 'SUM':
        return { value: numbers.reduce((sum, value) => sum + value, 0), error: null };
      case 'AVG':
        return {
          value: numbers.reduce((sum, value) => sum + value, 0) / numbers.length,
          error: null,
        };
      case 'MIN':
        return { value: Math.min(...numbers), error: null };
      case 'MAX':
        return { value: Math.max(...numbers), error: null };
      default:
        return { value: null, error: `Unknown function: ${expr.name}` };
    }
  };

  for (const [refName, parsed] of parsedColumns.entries()) {
    const results = evaluateColumn(refName);
    for (const leaf of leaves) {
      const cell = results.get(leaf.id);
      if (cell) {
        computedCells.get(leaf.id)?.set(parsed.column.id, cell);
      }
    }
  }

  return { computedCells };
}

function findCyclicColumns(parsedColumns: ReadonlyMap<string, ParsedColumn>): Set<string> {
  const cyclic = new Set<string>();
  const visiting = new Set<string>();
  const done = new Set<string>();

  const visit = (refName: string): boolean => {
    if (cyclic.has(refName) || visiting.has(refName)) {
      return true;
    }
    if (done.has(refName)) {
      return false;
    }
    const parsed = parsedColumns.get(refName);
    if (!parsed) {
      return false;
    }
    visiting.add(refName);
    let inCycle = false;
    for (const dep of parsed.deps) {
      if (parsedColumns.has(dep) && visit(dep)) {
        inCycle = true;
      }
    }
    visiting.delete(refName);
    done.add(refName);
    if (inCycle) {
      cyclic.add(refName);
    }
    return inCycle;
  };

  for (const refName of parsedColumns.keys()) {
    visit(refName);
  }
  return cyclic;
}

// ---------------------------------------------------------------------------
// Rollups (see CONTEXT.md: one concept for the footer and collapsed Branches)
// ---------------------------------------------------------------------------

/**
 * Numeric value a Leaf contributes to rollups for a column: parsed raw for
 * input columns, computed value for computed columns. Errors yield null.
 */
export function leafNumericValue(
  column: ColumnV2,
  leaf: NodeV2,
  evaluation: TopicEvaluation,
): number | null {
  if (column.kind === 'computed') {
    const cell = evaluation.computedCells.get(leaf.id)?.get(column.id);
    if (!cell || cell.error !== null || cell.value === null) {
      return null;
    }
    return cell.value;
  }
  const raw = (leaf.values[column.id] ?? '').trim();
  if (raw.length === 0) {
    return 0;
  }
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : null;
}

/**
 * Sum rollup over the given Leaves. Returns null when any involved cell is
 * errored/non-numeric — a silently wrong total would be worse than no total.
 */
export function rollupSum(
  column: ColumnV2,
  leaves: readonly NodeV2[],
  evaluation: TopicEvaluation,
): number | null {
  let total = 0;
  for (const leaf of leaves) {
    const value = leafNumericValue(column, leaf, evaluation);
    if (value === null) {
      return null;
    }
    total += value;
  }
  return total;
}

/** Formats a numeric value for display, trimming binary floating-point noise. */
export function formatNumericValue(value: number): string {
  const rounded = Number(value.toFixed(10));
  return String(rounded);
}
