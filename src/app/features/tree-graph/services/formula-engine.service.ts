import { Injectable } from '@angular/core';
import { CellData, TableColumn } from '../models/tree-table.model';

interface FormulaSuccess {
  value: number;
  error: null;
}

interface FormulaFailure {
  value: null;
  error: string;
}

type FormulaResult = FormulaSuccess | FormulaFailure;

type TokenType =
  | 'number'
  | 'identifier'
  | 'plus'
  | 'minus'
  | 'multiply'
  | 'divide'
  | 'leftParen'
  | 'rightParen'
  | 'comma'
  | 'dot';

interface Token {
  type: TokenType;
  lexeme: string;
}

interface EvalContext {
  resolveColumn: (columnId: string) => FormulaResult;
}

interface ParseState {
  tokens: Token[];
  cursor: number;
  context: EvalContext;
}

type FunctionArgumentResult =
  | { ok: true; value: number | number[] }
  | { ok: false; error: string };

@Injectable({ providedIn: 'root' })
export class FormulaEngineService {
  evaluateRow(columns: TableColumn[], cells: Record<string, CellData>): Record<string, CellData> {
    const next: Record<string, CellData> = structuredClone(cells);
    const cache = new Map<string, FormulaResult>();
    const stack = new Set<string>();

    const resolveColumn = (columnId: string): FormulaResult => {
      const inCache = cache.get(columnId);
      if (inCache) {
        return inCache;
      }

      if (stack.has(columnId)) {
        return { value: null, error: 'Circular reference' };
      }

      const cell = next[columnId];
      if (!cell) {
        return { value: null, error: `Unknown column: ${columnId}` };
      }

      stack.add(columnId);
      const result = this.evaluateRawCell(cell.raw, {
        resolveColumn,
      });
      stack.delete(columnId);

      cache.set(columnId, result);
      return result;
    };

    for (const column of columns) {
      const result = resolveColumn(column.id);
      const current = next[column.id] ?? { raw: '', value: null, error: null };
      if (result.error) {
        next[column.id] = {
          ...current,
          value: null,
          error: result.error,
        };
      } else {
        next[column.id] = {
          ...current,
          value: result.value,
          error: null,
        };
      }
    }

    return next;
  }

  private evaluateRawCell(raw: string, context: EvalContext): FormulaResult {
    if (!raw.trim().startsWith('=')) {
      const parsed = Number(raw);
      if (raw.trim().length === 0) {
        return { value: 0, error: null };
      }
      if (!Number.isNaN(parsed) && Number.isFinite(parsed)) {
        return { value: parsed, error: null };
      }
      return { value: 0, error: null };
    }

    const expression = raw.trim().slice(1);
    const tokens = this.tokenize(expression);
    if (!tokens.ok) {
      return { value: null, error: tokens.error };
    }

    const state: ParseState = { tokens: tokens.value, cursor: 0, context };
    const result = this.parseExpression(state);
    if (result.error) {
      return result;
    }

    if (state.cursor < state.tokens.length) {
      return { value: null, error: 'Unexpected trailing formula tokens' };
    }

    return result;
  }

  private parseExpression(state: ParseState): FormulaResult {
    let left = this.parseTerm(state);
    while (!left.error) {
      const operator = this.readAdditiveOperator(state);
      if (!operator) {
        break;
      }

      const right = this.parseTerm(state);
      if (right.error) {
        return right;
      }

      const rightValue = right.value ?? 0;
      const leftValue = left.value ?? 0;
      left = {
        value: operator === 'plus' ? leftValue + rightValue : leftValue - rightValue,
        error: null,
      };
    }
    return left;
  }

  private parseTerm(state: ParseState): FormulaResult {
    let left = this.parseFactor(state);
    while (!left.error) {
      const operator = this.readMultiplicativeOperator(state);
      if (!operator) {
        break;
      }

      const right = this.parseFactor(state);
      if (right.error) {
        return right;
      }

      const rightValue = right.value ?? 0;
      const leftValue = left.value ?? 0;
      if (operator === 'divide' && rightValue === 0) {
        return { value: null, error: 'Division by zero' };
      }

      left = {
        value: operator === 'multiply' ? leftValue * rightValue : leftValue / rightValue,
        error: null,
      };
    }
    return left;
  }

  private parseFactor(state: ParseState): FormulaResult {
    const unary = this.parseUnaryFactor(state);
    if (unary) {
      return unary;
    }

    const number = this.parseNumberFactor(state);
    if (number) {
      return number;
    }

    const identifier = this.parseIdentifierFactor(state);
    if (identifier) {
      return identifier;
    }

    const grouped = this.parseParenthesizedFactor(state);
    if (grouped) {
      return grouped;
    }

    return { value: null, error: 'Unexpected token in formula' };
  }

  private parseUnaryFactor(state: ParseState): FormulaResult | null {
    if (this.match(state, 'plus')) {
      return this.parseFactor(state);
    }

    if (!this.match(state, 'minus')) {
      return null;
    }

    const factor = this.parseFactor(state);
    if (factor.error) {
      return factor;
    }
    return { value: -(factor.value ?? 0), error: null };
  }

  private parseNumberFactor(state: ParseState): FormulaResult | null {
    const numberToken = this.consumeIf(state, 'number');
    if (!numberToken) {
      return null;
    }
    return { value: Number(numberToken.lexeme), error: null };
  }

  private parseIdentifierFactor(state: ParseState): FormulaResult | null {
    const identifierToken = this.consumeIf(state, 'identifier');
    if (!identifierToken) {
      return null;
    }

    const firstIdentifier = identifierToken.lexeme;
    if (!firstIdentifier) {
      return { value: null, error: 'Missing identifier' };
    }

    if (this.match(state, 'leftParen')) {
      return this.parseFunctionCall(state, firstIdentifier);
    }

    if (firstIdentifier === 'children' && this.match(state, 'dot')) {
      return {
        value: null,
        error: 'children.* is not supported in subtopic-only table mode',
      };
    }

    return state.context.resolveColumn(firstIdentifier);
  }

  private parseParenthesizedFactor(state: ParseState): FormulaResult | null {
    if (!this.match(state, 'leftParen')) {
      return null;
    }

    const nested = this.parseExpression(state);
    if (nested.error) {
      return nested;
    }

    const rightParen = this.expect(state, 'rightParen', 'Expected closing parenthesis');
    if ('error' in rightParen) {
      return rightParen;
    }

    return nested;
  }

  private parseFunctionCall(state: ParseState, functionName: string): FormulaResult {
    const args: Array<number | number[]> = [];
    if (!this.match(state, 'rightParen')) {
      while (true) {
        const parsedArgument = this.parseFunctionArg(state);
        if (!parsedArgument.ok) {
          return { value: null, error: parsedArgument.error };
        }
        args.push(parsedArgument.value);

        if (this.match(state, 'rightParen')) {
          break;
        }

        const comma = this.expect(state, 'comma', 'Expected comma between function arguments');
        if ('error' in comma) {
          return comma;
        }
      }
    }

    return this.runFunction(functionName, args);
  }

  private parseFunctionArg(state: ParseState): FunctionArgumentResult {
    const token = this.peek(state);
    if (token?.type === 'identifier' && token.lexeme === 'children') {
      return {
        ok: false,
        error: 'children.* is not supported in subtopic-only table mode',
      };
    }

    const parsed = this.parseExpression(state);
    if (parsed.error) {
      return { ok: false, error: parsed.error };
    }
    return { ok: true, value: parsed.value ?? 0 };
  }

  private readAdditiveOperator(state: ParseState): 'plus' | 'minus' | null {
    if (this.match(state, 'plus')) {
      return 'plus';
    }
    if (this.match(state, 'minus')) {
      return 'minus';
    }
    return null;
  }

  private readMultiplicativeOperator(state: ParseState): 'multiply' | 'divide' | null {
    if (this.match(state, 'multiply')) {
      return 'multiply';
    }
    if (this.match(state, 'divide')) {
      return 'divide';
    }
    return null;
  }

  private peek(state: ParseState): Token | undefined {
    return state.tokens[state.cursor];
  }

  private match(state: ParseState, type: TokenType): boolean {
    if (this.peek(state)?.type === type) {
      state.cursor += 1;
      return true;
    }
    return false;
  }

  private consumeIf(state: ParseState, type: TokenType): Token | null {
    if (!this.match(state, type)) {
      return null;
    }
    return this.lastConsumed(state);
  }

  private expect(state: ParseState, type: TokenType, message: string): Token | FormulaFailure {
    if (!this.match(state, type)) {
      return { value: null, error: message };
    }

    const consumed = this.lastConsumed(state);
    if (!consumed) {
      return { value: null, error: message };
    }

    return consumed;
  }

  private lastConsumed(state: ParseState): Token | null {
    return state.tokens[state.cursor - 1] ?? null;
  }

  private runFunction(name: string, args: Array<number | number[]>): FormulaResult {
    const functionName = name.toUpperCase();
    const flattened = args.flatMap((arg) => (Array.isArray(arg) ? arg : [arg]));

    if (flattened.length === 0) {
      return { value: 0, error: null };
    }

    if (flattened.some((value) => !Number.isFinite(value))) {
      return { value: null, error: `Invalid numeric argument for ${functionName}` };
    }

    if (functionName === 'SUM') {
      return { value: flattened.reduce((sum, value) => sum + value, 0), error: null };
    }

    if (functionName === 'AVG') {
      return { value: flattened.reduce((sum, value) => sum + value, 0) / flattened.length, error: null };
    }

    if (functionName === 'MIN') {
      return { value: Math.min(...flattened), error: null };
    }

    if (functionName === 'MAX') {
      return { value: Math.max(...flattened), error: null };
    }

    return { value: null, error: `Unknown function: ${name}` };
  }

  private tokenize(expression: string): { ok: true; value: Token[] } | { ok: false; error: string } {
    const tokens: Token[] = [];
    let index = 0;

    while (index < expression.length) {
      const char = expression[index];

      if (!char) {
        break;
      }

      if (/\s/.test(char)) {
        index += 1;
        continue;
      }

      if (/\d/.test(char) || (char === '.' && /\d/.test(expression[index + 1] ?? ''))) {
        let end = index + 1;
        while (end < expression.length && /[\d.]/.test(expression[end] ?? '')) {
          end += 1;
        }
        tokens.push({ type: 'number', lexeme: expression.slice(index, end) });
        index = end;
        continue;
      }

      if (/[A-Za-z_$]/.test(char)) {
        let end = index + 1;
        while (end < expression.length && /[\w$]/.test(expression[end] ?? '')) {
          end += 1;
        }
        tokens.push({ type: 'identifier', lexeme: expression.slice(index, end) });
        index = end;
        continue;
      }

      if (char === '+') {
        tokens.push({ type: 'plus', lexeme: char });
        index += 1;
        continue;
      }
      if (char === '-') {
        tokens.push({ type: 'minus', lexeme: char });
        index += 1;
        continue;
      }
      if (char === '*') {
        tokens.push({ type: 'multiply', lexeme: char });
        index += 1;
        continue;
      }
      if (char === '/') {
        tokens.push({ type: 'divide', lexeme: char });
        index += 1;
        continue;
      }
      if (char === '(') {
        tokens.push({ type: 'leftParen', lexeme: char });
        index += 1;
        continue;
      }
      if (char === ')') {
        tokens.push({ type: 'rightParen', lexeme: char });
        index += 1;
        continue;
      }
      if (char === ',') {
        tokens.push({ type: 'comma', lexeme: char });
        index += 1;
        continue;
      }
      if (char === '.') {
        tokens.push({ type: 'dot', lexeme: char });
        index += 1;
        continue;
      }

      return { ok: false, error: `Invalid character in formula: ${char}` };
    }

    return { ok: true, value: tokens };
  }
}
