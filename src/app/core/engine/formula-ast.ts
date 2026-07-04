/**
 * Formula language: tokenizer, parser, printer and reference collection.
 *
 * References are dotted paths ending in a column ref (ADR-0003):
 *   $Amount                 same-row column (current Topic)
 *   Savings.$Amount         a Node's subtree (Leaf → scalar, Branch → series)
 *   Wealth.$Amount          another Topic's whole column (series)
 *   Wealth.Savings.$Amount  a Node inside another Topic
 *
 * The printer exists so Reference Name edits can rewrite formulas by AST
 * transformation instead of error-prone text substitution.
 */

export type Expr =
  | { kind: 'number'; value: number }
  | { kind: 'ref'; path: string[] }
  | { kind: 'unary'; op: '+' | '-'; operand: Expr }
  | { kind: 'binary'; op: '+' | '-' | '*' | '/'; left: Expr; right: Expr }
  | { kind: 'call'; name: string; args: CallArg[]; dotted?: boolean };

export type CallArg =
  | { kind: 'series'; path: string[] }
  | { kind: 'rowRaw'; path: string[] }
  | { kind: 'expr'; expr: Expr };

export const AGGREGATE_FUNCTIONS: ReadonlySet<string> = new Set(['SUM', 'AVG', 'MIN', 'MAX']);
export const COUNT_FUNCTIONS: ReadonlySet<string> = new Set(['COUNT', 'COUNTA', 'COUNTBLANK']);

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
// Parser
// ---------------------------------------------------------------------------

interface ParserState {
  tokens: Token[];
  cursor: number;
}

type ParseOutcome = { expr: Expr } | { error: string };

export function isColumnRef(lexeme: string): boolean {
  return /^\$[A-Za-z_]\w*$/.test(lexeme);
}

function isEntityRef(lexeme: string): boolean {
  return /^[A-Za-z_]\w*$/.test(lexeme);
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

/** True when the upcoming tokens are `.name(` — a dot-aggregate suffix. */
function peekDotMethod(state: ParserState): boolean {
  return (
    state.tokens[state.cursor]?.type === 'dot' &&
    state.tokens[state.cursor + 1]?.type === 'identifier' &&
    state.tokens[state.cursor + 2]?.type === 'lparen'
  );
}

/**
 * Parses a dotted reference path starting at an identifier token that has
 * already been consumed: `Entity(.Entity)*.$Column` or a bare `$Column`.
 * Stops (without consuming) before a `.name(` suffix — parseFactor turns
 * that into a dot aggregate.
 */
function parseRefPath(state: ParserState, first: string): { path: string[] } | { error: string } {
  if (isColumnRef(first)) {
    if (peek(state)?.type === 'dot' && !peekDotMethod(state)) {
      return { error: `A column reference cannot be qualified further: ${first}` };
    }
    return { path: [first] };
  }

  if (first === 'children') {
    return {
      error:
        'children is not part of the formula language — reference a Branch by its Reference Name instead',
    };
  }

  if (!isEntityRef(first)) {
    return { error: `Unknown identifier: ${first}` };
  }

  const path = [first];
  while (!peekDotMethod(state) && match(state, 'dot')) {
    const segment = peek(state);
    if (segment?.type !== 'identifier') {
      return { error: `Expected a name after "${path.join('.')}."` };
    }
    state.cursor += 1;

    if (isColumnRef(segment.lexeme)) {
      path.push(segment.lexeme);
      if (peek(state)?.type === 'dot' && !peekDotMethod(state)) {
        return { error: `A column reference cannot be qualified further: ${segment.lexeme}` };
      }
      return { path };
    }

    if (!isEntityRef(segment.lexeme)) {
      return { error: `Unknown identifier: ${segment.lexeme}` };
    }
    path.push(segment.lexeme);
    if (path.length > 2) {
      return {
        error: `Reference is nested too deeply: ${path.join('.')} (use Topic.Node.$Column at most)`,
      };
    }
  }

  return {
    error: `Expected a column reference after "${path.join('.')}" (e.g. ${path.join('.')}.$Amount)`,
  };
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
    if (match(state, 'lparen')) {
      return parseCall(state, token.lexeme);
    }
    const ref = parseRefPath(state, token.lexeme);
    if ('error' in ref) {
      return ref;
    }
    if (peekDotMethod(state)) {
      return parseDotAggregate(state, ref.path);
    }
    return { expr: { kind: 'ref', path: ref.path } };
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

/**
 * `.sum()`-style aggregate suffix on a column-terminated path — sugar for
 * the equivalent call over the same series: `$Amount.sum()` ≡ `SUM($Amount)`,
 * `Savings.$Amount.avg()` ≡ `AVG(Savings.$Amount)`. The `dotted` flag keeps
 * the printer (and thus Reference Name rewrites) in the user's style.
 */
function parseDotAggregate(state: ParserState, path: string[]): ParseOutcome {
  state.cursor += 1; // '.'
  const name = state.tokens[state.cursor]!.lexeme;
  state.cursor += 2; // identifier '('
  const upper = name.toUpperCase();
  if (!AGGREGATE_FUNCTIONS.has(upper) && !COUNT_FUNCTIONS.has(upper)) {
    return { error: `Unknown function: .${name}()` };
  }
  if (!match(state, 'rparen')) {
    return { error: `.${name.toLowerCase()}() takes no arguments` };
  }
  return { expr: { kind: 'call', name: upper, dotted: true, args: [{ kind: 'series', path }] } };
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
    const bare = tryBareRefArg(state);
    if (bare) {
      // Temporary marker; normalizeCallArgs decides series/rowRaw/expr once
      // the full argument list (and thus arity) is known.
      args.push({ kind: 'rowRaw', path: bare });
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
 * Argument semantics:
 * - A dotted path argument is always a series over the referenced scope.
 * - A single bare `$Column` argument means the whole column (v1 semantics).
 * - With multiple arguments, bare `$Column`s are same-row references —
 *   except in COUNT functions, where they test the current Row's raw.
 */
function normalizeCallArgs(upperName: string, args: CallArg[]): CallArg[] {
  const isCount = COUNT_FUNCTIONS.has(upperName);
  return args.map((arg) => {
    if (arg.kind !== 'rowRaw') {
      return arg;
    }
    const { path } = arg;
    if (path.length > 1) {
      return { kind: 'series', path };
    }
    if (args.length === 1) {
      return { kind: 'series', path };
    }
    if (isCount) {
      return { kind: 'rowRaw', path };
    }
    return { kind: 'expr', expr: { kind: 'ref', path } };
  });
}

/** Captures a reference path immediately followed by `,` or `)`. */
function tryBareRefArg(state: ParserState): string[] | null {
  const start = state.cursor;
  const first = peek(state);
  if (first?.type !== 'identifier') {
    return null;
  }
  state.cursor += 1;
  const ref = parseRefPath(state, first.lexeme);
  const next = peek(state)?.type;
  if ('error' in ref || (next !== 'comma' && next !== 'rparen')) {
    state.cursor = start;
    return null;
  }
  return ref.path;
}

// ---------------------------------------------------------------------------
// Printer (used by Reference Name rewriting)
// ---------------------------------------------------------------------------

const PRECEDENCE: Record<string, number> = { '+': 1, '-': 1, '*': 2, '/': 2 };

export function printExpression(expr: Expr): string {
  switch (expr.kind) {
    case 'number':
      return String(expr.value);
    case 'ref':
      return expr.path.join('.');
    case 'unary':
      return `${expr.op}${wrapIf(expr.operand, expr.operand.kind === 'binary')}`;
    case 'binary': {
      const precedence = PRECEDENCE[expr.op] ?? 0;
      const left = wrapIf(expr.left, precedenceOf(expr.left) < precedence);
      const rightNeedsParens =
        precedenceOf(expr.right) < precedence ||
        (precedenceOf(expr.right) === precedence && (expr.op === '-' || expr.op === '/'));
      const right = wrapIf(expr.right, rightNeedsParens);
      return `${left} ${expr.op} ${right}`;
    }
    case 'call': {
      const sole = expr.args.length === 1 ? expr.args[0] : undefined;
      if (expr.dotted && sole?.kind === 'series') {
        return `${sole.path.join('.')}.${expr.name.toLowerCase()}()`;
      }
      const args = expr.args
        .map((arg) => (arg.kind === 'expr' ? printExpression(arg.expr) : arg.path.join('.')))
        .join(', ');
      return `${expr.name}(${args})`;
    }
  }
}

function precedenceOf(expr: Expr): number {
  return expr.kind === 'binary' ? (PRECEDENCE[expr.op] ?? 0) : 3;
}

function wrapIf(expr: Expr, needed: boolean): string {
  const printed = printExpression(expr);
  return needed ? `(${printed})` : printed;
}

// ---------------------------------------------------------------------------
// Reference traversal / transformation
// ---------------------------------------------------------------------------

export function collectRefPaths(expr: Expr, into: string[][] = []): string[][] {
  switch (expr.kind) {
    case 'number':
      break;
    case 'ref':
      into.push(expr.path);
      break;
    case 'unary':
      collectRefPaths(expr.operand, into);
      break;
    case 'binary':
      collectRefPaths(expr.left, into);
      collectRefPaths(expr.right, into);
      break;
    case 'call':
      for (const arg of expr.args) {
        if (arg.kind === 'expr') {
          collectRefPaths(arg.expr, into);
        } else {
          into.push(arg.path);
        }
      }
      break;
  }
  return into;
}

/** Returns a copy of the expression with every ref path mapped through `transform`. */
export function transformRefPaths(expr: Expr, transform: (path: string[]) => string[]): Expr {
  switch (expr.kind) {
    case 'number':
      return expr;
    case 'ref':
      return { kind: 'ref', path: transform(expr.path) };
    case 'unary':
      return { kind: 'unary', op: expr.op, operand: transformRefPaths(expr.operand, transform) };
    case 'binary':
      return {
        kind: 'binary',
        op: expr.op,
        left: transformRefPaths(expr.left, transform),
        right: transformRefPaths(expr.right, transform),
      };
    case 'call':
      return {
        kind: 'call',
        name: expr.name,
        ...(expr.dotted ? { dotted: true } : {}),
        args: expr.args.map((arg) =>
          arg.kind === 'expr'
            ? { kind: 'expr', expr: transformRefPaths(arg.expr, transform) }
            : { kind: arg.kind, path: transform(arg.path) },
        ),
      };
  }
}
