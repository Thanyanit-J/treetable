import {
  ColumnV2,
  DocumentV2,
  NodeV2,
  NumberFormatV2,
  TopicCardV2,
  collectLeaves,
  walkNodes,
} from '../model/document.model';
import {
  COUNT_FUNCTIONS,
  CallArg,
  Expr,
  SCALAR_FUNCTIONS,
  parseExpressionSource,
} from './formula-ast';

/**
 * Document-scoped formula evaluation (ADR-0002, ADR-0003).
 *
 * One dependency graph covers every Computed Column in every Topic; cycle
 * detection spans Topic boundaries. Reference paths resolve against the
 * owning Topic first (Node Reference Names shadow Topic Reference Names),
 * then the Document. Evaluated values are derived state — never persisted.
 */

export interface CellComputation {
  value: number | null;
  error: string | null;
}

export interface TopicEvaluation {
  /** leaf node id -> column id -> computation. Present for computed columns only. */
  readonly computedCells: ReadonlyMap<string, ReadonlyMap<string, CellComputation>>;
}

export interface DocumentEvaluation {
  /** topic card id -> evaluation. */
  readonly topics: ReadonlyMap<string, TopicEvaluation>;
}

// ---------------------------------------------------------------------------
// Resolution index
// ---------------------------------------------------------------------------

interface TopicIndex {
  topic: TopicCardV2;
  columnsByRef: Map<string, ColumnV2>;
  nodesByRef: Map<string, NodeV2>;
  leaves: NodeV2[];
}

interface DocumentIndex {
  topicsByRef: Map<string, TopicIndex>;
  topicsById: Map<string, TopicIndex>;
  /** owning topic id by column id — columns are globally unique by id. */
  topicIdByColumnId: Map<string, string>;
}

function indexDocument(document: DocumentV2): DocumentIndex {
  const topicsByRef = new Map<string, TopicIndex>();
  const topicsById = new Map<string, TopicIndex>();
  const topicIdByColumnId = new Map<string, string>();

  for (const card of document.cards) {
    if (card.kind !== 'topic') {
      continue;
    }
    const nodesByRef = new Map<string, NodeV2>();
    walkNodes(card.children, (node) => nodesByRef.set(node.refName, node));
    const index: TopicIndex = {
      topic: card,
      columnsByRef: new Map(card.columns.map((column) => [column.refName, column])),
      nodesByRef,
      leaves: collectLeaves(card.children),
    };
    topicsByRef.set(card.refName, index);
    topicsById.set(card.id, index);
    for (const column of card.columns) {
      topicIdByColumnId.set(column.id, card.id);
    }
  }

  return { topicsByRef, topicsById, topicIdByColumnId };
}

export interface RefBinding {
  kind: 'topic' | 'node' | 'column';
  id: string;
}

type ResolvedRef =
  | { kind: 'rowColumn'; topicId: string; column: ColumnV2; bindings: RefBinding[] }
  | { kind: 'leafCell'; topicId: string; column: ColumnV2; leaf: NodeV2; bindings: RefBinding[] }
  | { kind: 'scope'; topicId: string; column: ColumnV2; leaves: NodeV2[]; bindings: RefBinding[] }
  | { kind: 'error'; message: string };

function resolvePath(index: DocumentIndex, ownerTopicId: string, path: string[]): ResolvedRef {
  const owner = index.topicsById.get(ownerTopicId);
  if (!owner) {
    return { kind: 'error', message: 'Unknown topic' };
  }

  const columnRef = path.at(-1);
  if (!columnRef) {
    return { kind: 'error', message: 'Empty reference' };
  }

  if (path.length === 1) {
    const column = owner.columnsByRef.get(columnRef);
    if (!column) {
      return { kind: 'error', message: `Unknown column: ${columnRef}` };
    }
    return {
      kind: 'rowColumn',
      topicId: owner.topic.id,
      column,
      bindings: [{ kind: 'column', id: column.id }],
    };
  }

  if (path.length === 2) {
    const qualifier = path[0]!;
    // Node Reference Names shadow Topic Reference Names inside their Topic.
    const node = owner.nodesByRef.get(qualifier);
    if (node) {
      const column = owner.columnsByRef.get(columnRef);
      if (!column) {
        return { kind: 'error', message: `Unknown column: ${columnRef}` };
      }
      return scopeOrLeaf(owner.topic.id, column, node, [
        { kind: 'node', id: node.id },
        { kind: 'column', id: column.id },
      ]);
    }

    const topic = index.topicsByRef.get(qualifier);
    if (topic) {
      const column = topic.columnsByRef.get(columnRef);
      if (!column) {
        return { kind: 'error', message: `Unknown column in ${qualifier}: ${columnRef}` };
      }
      return {
        kind: 'scope',
        topicId: topic.topic.id,
        column,
        leaves: topic.leaves,
        bindings: [
          { kind: 'topic', id: topic.topic.id },
          { kind: 'column', id: column.id },
        ],
      };
    }

    return { kind: 'error', message: `Unknown reference: ${qualifier}` };
  }

  const topicRef = path[0]!;
  const nodeRef = path[1]!;
  const topic = index.topicsByRef.get(topicRef);
  if (!topic) {
    return { kind: 'error', message: `Unknown topic: ${topicRef}` };
  }
  const node = topic.nodesByRef.get(nodeRef);
  if (!node) {
    return { kind: 'error', message: `Unknown node in ${topicRef}: ${nodeRef}` };
  }
  const column = topic.columnsByRef.get(columnRef);
  if (!column) {
    return { kind: 'error', message: `Unknown column in ${topicRef}: ${columnRef}` };
  }
  return scopeOrLeaf(topic.topic.id, column, node, [
    { kind: 'topic', id: topic.topic.id },
    { kind: 'node', id: node.id },
    { kind: 'column', id: column.id },
  ]);
}

function scopeOrLeaf(
  topicId: string,
  column: ColumnV2,
  node: NodeV2,
  bindings: RefBinding[],
): ResolvedRef {
  if (node.children.length === 0) {
    return { kind: 'leafCell', topicId, column, leaf: node, bindings };
  }
  return { kind: 'scope', topicId, column, leaves: collectLeaves(node.children), bindings };
}

/**
 * Resolves each segment of a reference path to the entity it binds to, for
 * Reference Name rewriting. Returns null when the path does not resolve.
 */
export function resolveRefBindings(
  document: DocumentV2,
  ownerTopicId: string,
  path: string[],
): RefBinding[] | null {
  const resolved = resolvePath(indexDocument(document), ownerTopicId, path);
  return resolved.kind === 'error' ? null : resolved.bindings;
}

// ---------------------------------------------------------------------------
// Evaluation
// ---------------------------------------------------------------------------

interface ParsedColumn {
  topicId: string;
  column: ColumnV2;
  expr: Expr | null;
  parseError: string | null;
  deps: ReadonlySet<string>;
}

export function evaluateDocument(document: DocumentV2): DocumentEvaluation {
  const index = indexDocument(document);

  // Parse every computed column once and resolve its column-level deps.
  const parsedColumns = new Map<string, ParsedColumn>();
  for (const card of document.cards) {
    if (card.kind !== 'topic') {
      continue;
    }
    for (const column of card.columns) {
      if (column.kind !== 'computed') {
        continue;
      }
      const source = (column.expression ?? '').trim().replace(/^=/, '');
      if (source.length === 0) {
        parsedColumns.set(column.id, {
          topicId: card.id,
          column,
          expr: null,
          parseError: 'Empty formula',
          deps: new Set(),
        });
        continue;
      }
      const outcome = parseExpressionSource(source);
      if ('error' in outcome) {
        parsedColumns.set(column.id, {
          topicId: card.id,
          column,
          expr: null,
          parseError: outcome.error,
          deps: new Set(),
        });
        continue;
      }
      const deps = new Set<string>();
      collectColumnDeps(outcome.expr, index, card.id, deps);
      parsedColumns.set(column.id, {
        topicId: card.id,
        column,
        expr: outcome.expr,
        parseError: null,
        deps,
      });
    }
  }

  const cyclic = findCyclicColumns(parsedColumns);

  // Per-column memo of per-leaf results, filled on demand in dependency order.
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

  const evaluateColumn = (column: ColumnV2): Map<string, CellComputation> => {
    const memo = columnResults.get(column.id);
    if (memo) {
      return memo;
    }

    const results = new Map<string, CellComputation>();
    columnResults.set(column.id, results);

    const owningTopicId = index.topicIdByColumnId.get(column.id);
    const owner = owningTopicId ? index.topicsById.get(owningTopicId) : undefined;
    if (!owner) {
      return results;
    }

    if (column.kind === 'chart') {
      for (const leaf of owner.leaves) {
        results.set(leaf.id, {
          value: null,
          error: `Chart column ${column.refName} cannot be used in formulas`,
        });
      }
      return results;
    }

    if (column.kind !== 'computed') {
      for (const leaf of owner.leaves) {
        results.set(leaf.id, inputCellValue(column, leaf));
      }
      return results;
    }

    const parsed = parsedColumns.get(column.id);
    if (cyclic.has(column.id) || inProgress.has(column.id)) {
      for (const leaf of owner.leaves) {
        results.set(leaf.id, { value: null, error: 'Circular reference' });
      }
      return results;
    }

    if (!parsed || parsed.parseError !== null || parsed.expr === null) {
      const message = parsed?.parseError ?? 'Empty formula';
      for (const leaf of owner.leaves) {
        results.set(leaf.id, { value: null, error: message });
      }
      return results;
    }

    inProgress.add(column.id);
    for (const leaf of owner.leaves) {
      results.set(leaf.id, evaluateExpr(parsed.expr, owner.topic.id, leaf));
    }
    inProgress.delete(column.id);
    return results;
  };

  const cellOf = (column: ColumnV2, leaf: NodeV2): CellComputation => {
    const results = evaluateColumn(column);
    return (
      results.get(leaf.id) ?? { value: null, error: `Unknown row for column: ${column.refName}` }
    );
  };

  const seriesOf = (
    column: ColumnV2,
    leaves: readonly NodeV2[],
  ): { values: number[] } | { error: string } => {
    const values: number[] = [];
    for (const leaf of leaves) {
      const cell = cellOf(column, leaf);
      if (cell.error !== null) {
        return { error: cell.error };
      }
      values.push(cell.value ?? 0);
    }
    return { values };
  };

  const rawOf = (column: ColumnV2, leaf: NodeV2): string => {
    // Computed cells always produce a value, so they count as non-blank.
    if (column.kind === 'computed') {
      return '0';
    }
    return leaf.values[column.id] ?? '';
  };

  const evaluateExpr = (expr: Expr, topicId: string, leaf: NodeV2): CellComputation => {
    switch (expr.kind) {
      case 'number':
        return { value: expr.value, error: null };
      case 'ref': {
        const resolved = resolvePath(index, topicId, expr.path);
        switch (resolved.kind) {
          case 'error':
            return { value: null, error: resolved.message };
          case 'rowColumn':
            return cellOf(resolved.column, leaf);
          case 'leafCell':
            return cellOf(resolved.column, resolved.leaf);
          case 'scope':
            return {
              value: null,
              error: `${expr.path.join('.')} refers to ${resolved.leaves.length} rows — wrap it in an aggregate like SUM(${expr.path.join('.')})`,
            };
        }
        break;
      }
      case 'unary': {
        const operand = evaluateExpr(expr.operand, topicId, leaf);
        if (operand.error !== null) {
          return operand;
        }
        const value = operand.value ?? 0;
        return { value: expr.op === '-' ? -value : value, error: null };
      }
      case 'binary': {
        const left = evaluateExpr(expr.left, topicId, leaf);
        if (left.error !== null) {
          return left;
        }
        const right = evaluateExpr(expr.right, topicId, leaf);
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
        return evaluateCall(expr, topicId, leaf);
    }
    return { value: null, error: 'Unexpected formula state' };
  };

  interface FunctionArg {
    numericValue: number;
    isBlank: boolean;
  }

  const seriesArgs = (
    arg: Extract<CallArg, { kind: 'series' }>,
    topicId: string,
    isCount: boolean,
  ): { args: FunctionArg[] } | { error: string } => {
    const resolved = resolvePath(index, topicId, arg.path);
    if (resolved.kind === 'error') {
      return { error: resolved.message };
    }

    const leaves =
      resolved.kind === 'scope'
        ? resolved.leaves
        : resolved.kind === 'leafCell'
          ? [resolved.leaf]
          : (index.topicsById.get(resolved.topicId)?.leaves ?? []);

    if (isCount) {
      return {
        args: leaves.map((leaf) => ({
          numericValue: 0,
          isBlank: rawOf(resolved.column, leaf).trim().length === 0,
        })),
      };
    }

    const series = seriesOf(resolved.column, leaves);
    if ('error' in series) {
      return { error: series.error };
    }
    return { args: series.values.map((value) => ({ numericValue: value, isBlank: false })) };
  };

  const evaluateCall = (
    expr: Extract<Expr, { kind: 'call' }>,
    topicId: string,
    leaf: NodeV2,
  ): CellComputation => {
    const isCount = COUNT_FUNCTIONS.has(expr.name);
    const args: FunctionArg[] = [];

    for (const arg of expr.args) {
      if (arg.kind === 'series') {
        const resolved = seriesArgs(arg, topicId, isCount);
        if ('error' in resolved) {
          return { value: null, error: resolved.error };
        }
        args.push(...resolved.args);
        continue;
      }

      if (arg.kind === 'rowRaw') {
        const resolved = resolvePath(index, topicId, arg.path);
        if (resolved.kind === 'error') {
          return { value: null, error: resolved.message };
        }
        if (resolved.kind !== 'rowColumn') {
          return {
            value: null,
            error: `Unexpected reference in ${expr.name}: ${arg.path.join('.')}`,
          };
        }
        args.push({ numericValue: 0, isBlank: rawOf(resolved.column, leaf).trim().length === 0 });
        continue;
      }

      const result = evaluateExpr(arg.expr, topicId, leaf);
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
    if (numbers.some((value) => !Number.isFinite(value))) {
      return { value: null, error: `Invalid numeric argument for ${expr.name}` };
    }

    const scalar = SCALAR_FUNCTIONS.get(expr.name);
    if (scalar) {
      // Series arguments expand to one value per Row, so arity lives here.
      if (numbers.length < scalar.min || numbers.length > scalar.max) {
        const expected =
          scalar.min === scalar.max ? `${scalar.min}` : `${scalar.min}–${scalar.max}`;
        return {
          value: null,
          error: `${expr.name} expects ${expected} argument${scalar.max === 1 ? '' : 's'}`,
        };
      }
      return evaluateScalarFunction(expr.name, numbers);
    }

    if (numbers.length === 0) {
      return { value: 0, error: null };
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
      case 'MEDIAN': {
        const sorted = [...numbers].sort((a, b) => a - b);
        const middle = Math.floor(sorted.length / 2);
        return {
          value:
            sorted.length % 2 === 1 ? sorted[middle]! : (sorted[middle - 1]! + sorted[middle]!) / 2,
          error: null,
        };
      }
      case 'PRODUCT':
        return { value: numbers.reduce((product, value) => product * value, 1), error: null };
      default:
        return { value: null, error: `Unknown function: ${expr.name}` };
    }
  };

  // Drive evaluation for every computed column, then project per topic.
  const topics = new Map<string, TopicEvaluation>();
  for (const card of document.cards) {
    if (card.kind !== 'topic') {
      continue;
    }
    const computedCells = new Map<string, Map<string, CellComputation>>();
    const topicIndex = index.topicsById.get(card.id);
    for (const leaf of topicIndex?.leaves ?? []) {
      computedCells.set(leaf.id, new Map());
    }
    for (const column of card.columns) {
      if (column.kind !== 'computed') {
        continue;
      }
      const results = evaluateColumn(column);
      for (const [leafId, cell] of results) {
        computedCells.get(leafId)?.set(column.id, cell);
      }
    }
    topics.set(card.id, { computedCells });
  }

  return { topics };
}

/** Convenience for single-topic evaluation (tests, isolated tools). */
export function evaluateTopic(topic: TopicCardV2): TopicEvaluation {
  const document: DocumentV2 = { version: 2, title: '', cards: [topic], pages: [] };
  return (
    evaluateDocument(document).topics.get(topic.id) ?? {
      computedCells: new Map<string, ReadonlyMap<string, CellComputation>>(),
    }
  );
}

/** Row-scalar math (SCALAR_FUNCTIONS); arity is already checked. */
function evaluateScalarFunction(name: string, args: number[]): CellComputation {
  const [a = 0, b = 0, c = 0] = args;
  switch (name) {
    case 'SQRT':
      if (a < 0) {
        return { value: null, error: 'SQRT of a negative number' };
      }
      return finiteResult(name, Math.sqrt(a));
    case 'ABS':
      return finiteResult(name, Math.abs(a));
    case 'SIGN':
      return finiteResult(name, Math.sign(a));
    case 'ROUND': {
      // Optional digit count, Excel-style: negative rounds left of the point.
      const digits = Math.max(-10, Math.min(10, Math.trunc(args.length > 1 ? b : 0)));
      const factor = 10 ** digits;
      return finiteResult(name, Math.round(a * factor) / factor);
    }
    case 'FLOOR':
      return finiteResult(name, Math.floor(a));
    case 'CEIL':
      return finiteResult(name, Math.ceil(a));
    case 'POW':
      return finiteResult(name, a ** b);
    case 'EXP':
      return finiteResult(name, Math.exp(a));
    case 'LN':
      if (a <= 0) {
        return { value: null, error: 'LN of a non-positive number' };
      }
      return finiteResult(name, Math.log(a));
    case 'LOG': {
      const base = args.length > 1 ? b : 10;
      if (a <= 0) {
        return { value: null, error: 'LOG of a non-positive number' };
      }
      if (base <= 0 || base === 1) {
        return { value: null, error: 'Invalid LOG base' };
      }
      return finiteResult(name, Math.log(a) / Math.log(base));
    }
    case 'MOD':
      if (b === 0) {
        return { value: null, error: 'Division by zero' };
      }
      // Excel-style: the sign follows the divisor.
      return finiteResult(name, a - b * Math.floor(a / b));
    case 'CLAMP':
      if (b > c) {
        return { value: null, error: 'CLAMP minimum exceeds maximum' };
      }
      return finiteResult(name, Math.min(c, Math.max(b, a)));
    default:
      return { value: null, error: `Unknown function: ${name}` };
  }
}

function finiteResult(name: string, value: number): CellComputation {
  if (!Number.isFinite(value)) {
    return { value: null, error: `Result of ${name} is not a finite number` };
  }
  return { value, error: null };
}

function collectColumnDeps(
  expr: Expr,
  index: DocumentIndex,
  ownerTopicId: string,
  into: Set<string>,
): void {
  const paths: string[][] = [];
  collectPathsInto(expr, paths);
  for (const path of paths) {
    const resolved = resolvePath(index, ownerTopicId, path);
    if (resolved.kind !== 'error') {
      into.add(resolved.column.id);
    }
  }
}

function collectPathsInto(expr: Expr, into: string[][]): void {
  switch (expr.kind) {
    case 'number':
      break;
    case 'ref':
      into.push(expr.path);
      break;
    case 'unary':
      collectPathsInto(expr.operand, into);
      break;
    case 'binary':
      collectPathsInto(expr.left, into);
      collectPathsInto(expr.right, into);
      break;
    case 'call':
      for (const arg of expr.args) {
        if (arg.kind === 'expr') {
          collectPathsInto(arg.expr, into);
        } else {
          into.push(arg.path);
        }
      }
      break;
  }
}

function findCyclicColumns(parsedColumns: ReadonlyMap<string, ParsedColumn>): Set<string> {
  const cyclic = new Set<string>();
  const visiting = new Set<string>();
  const done = new Set<string>();

  const visit = (columnId: string): boolean => {
    if (cyclic.has(columnId) || visiting.has(columnId)) {
      return true;
    }
    if (done.has(columnId)) {
      return false;
    }
    const parsed = parsedColumns.get(columnId);
    if (!parsed) {
      return false;
    }
    visiting.add(columnId);
    let inCycle = false;
    for (const dep of parsed.deps) {
      if (parsedColumns.has(dep) && visit(dep)) {
        inCycle = true;
      }
    }
    visiting.delete(columnId);
    done.add(columnId);
    if (inCycle) {
      cyclic.add(columnId);
    }
    return inCycle;
  };

  for (const columnId of parsedColumns.keys()) {
    visit(columnId);
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
 * The column's configured summary over the given Leaves (footer and
 * collapsed Rollup Rows). Blank cells don't participate — except in Count,
 * which counts the non-blank ones. Returns null when any involved cell is
 * errored/non-numeric (a silently wrong summary would be worse than none)
 * or when a value-based summary has nothing to summarize.
 */
export function rollupValue(
  column: ColumnV2,
  leaves: readonly NodeV2[],
  evaluation: TopicEvaluation,
): number | null {
  if (column.rollup === 'none') {
    return null;
  }

  if (column.rollup === 'count') {
    let count = 0;
    for (const leaf of leaves) {
      if (!isBlankCell(column, leaf, evaluation)) {
        count += 1;
      }
    }
    return count;
  }

  const values: number[] = [];
  for (const leaf of leaves) {
    if (isBlankCell(column, leaf, evaluation)) {
      continue;
    }
    const value = leafNumericValue(column, leaf, evaluation);
    if (value === null) {
      return null;
    }
    values.push(value);
  }

  switch (column.rollup) {
    case 'sum':
      return values.reduce((total, value) => total + value, 0);
    case 'avg':
      return values.length > 0
        ? values.reduce((total, value) => total + value, 0) / values.length
        : null;
    case 'min':
      return values.length > 0 ? Math.min(...values) : null;
    case 'max':
      return values.length > 0 ? Math.max(...values) : null;
    default:
      return null;
  }
}

function isBlankCell(column: ColumnV2, leaf: NodeV2, evaluation: TopicEvaluation): boolean {
  if (column.kind === 'computed') {
    const cell = evaluation.computedCells.get(leaf.id)?.get(column.id);
    return !cell || (cell.error === null && cell.value === null);
  }
  return (leaf.values[column.id] ?? '').trim().length === 0;
}

/** Formats a numeric value for display, trimming binary floating-point noise. */
export function formatNumericValue(value: number): string {
  const rounded = Number(value.toFixed(10));
  return String(rounded);
}

/**
 * Formats a numeric value through a column's display format (CONTEXT.md:
 * presentation only — raw values and copy stay unformatted). No format
 * falls back to formatNumericValue.
 */
export function formatCellNumber(value: number, format?: NumberFormatV2): string {
  if (!format) {
    return formatNumericValue(value);
  }
  // Round at display precision first so e.g. -0.4 at 0 decimals is "0", not "-0".
  const rounded =
    format.decimals !== undefined
      ? Number(value.toFixed(format.decimals))
      : Number(value.toFixed(10));
  const magnitude = Math.abs(rounded);
  let text = format.decimals !== undefined ? magnitude.toFixed(format.decimals) : String(magnitude);
  if (format.thousands === true) {
    const [integer = '', fraction] = text.split('.');
    // Very large magnitudes render exponentially ("1e+21") — nothing to group.
    if (/^\d+$/.test(integer)) {
      const grouped = integer.replace(/\B(?=(\d{3})+$)/g, ',');
      text = fraction === undefined ? grouped : `${grouped}.${fraction}`;
    }
  }
  if (rounded < 0) {
    return format.negativeParens === true ? `(${text})` : `-${text}`;
  }
  return text;
}
