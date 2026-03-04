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

    let cursor = 0;

    const peek = () => tokens.value[cursor];
    const match = (type: TokenType): boolean => {
      if (peek()?.type === type) {
        cursor += 1;
        return true;
      }
      return false;
    };

    const expect = (type: TokenType, message: string): Token | FormulaFailure => {
      if (!match(type)) {
        return { value: null, error: message };
      }
      const consumed = tokens.value[cursor - 1];
      if (!consumed) {
        return { value: null, error: message };
      }
      return consumed;
    };

    const parseExpression = (): FormulaResult => {
      let left = parseTerm();
      while (!left.error && (match('plus') || match('minus'))) {
        const operator = tokens.value[cursor - 1]?.type;
        const right = parseTerm();
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
    };

    const parseTerm = (): FormulaResult => {
      let left = parseFactor();
      while (!left.error && (match('multiply') || match('divide'))) {
        const operator = tokens.value[cursor - 1]?.type;
        const right = parseFactor();
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
    };

    const parseFactor = (): FormulaResult => {
      if (match('plus')) {
        return parseFactor();
      }
      if (match('minus')) {
        const factor = parseFactor();
        if (factor.error) {
          return factor;
        }
        return { value: -(factor.value ?? 0), error: null };
      }

      if (match('number')) {
        return { value: Number(tokens.value[cursor - 1]?.lexeme), error: null };
      }

      if (match('identifier')) {
        const firstIdentifier = tokens.value[cursor - 1]?.lexeme;
        if (!firstIdentifier) {
          return { value: null, error: 'Missing identifier' };
        }

        if (match('leftParen')) {
          const args: Array<number | number[]> = [];
          if (!match('rightParen')) {
            while (true) {
              const parsedArgument = parseFunctionArg();
              if (!parsedArgument.ok) {
                return { value: null, error: parsedArgument.error };
              }
              args.push(parsedArgument.value);
              if (match('rightParen')) {
                break;
              }
              const comma = expect('comma', 'Expected comma between function arguments');
              if ('error' in comma) {
                return comma;
              }
            }
          }
          return this.runFunction(firstIdentifier, args);
        }

        if (firstIdentifier === 'children' && match('dot')) {
          return {
            value: null,
            error: 'children.* is not supported in subtopic-only table mode',
          };
        }

        return context.resolveColumn(firstIdentifier);
      }

      if (match('leftParen')) {
        const nested = parseExpression();
        if (nested.error) {
          return nested;
        }
        const rightParen = expect('rightParen', 'Expected closing parenthesis');
        if ('error' in rightParen) {
          return rightParen;
        }
        return nested;
      }

      return { value: null, error: 'Unexpected token in formula' };
    };

    const parseFunctionArg = (): FunctionArgumentResult => {
      if (peek()?.type === 'identifier' && peek()?.lexeme === 'children') {
        return {
          ok: false,
          error: 'children.* is not supported in subtopic-only table mode',
        };
      }
      const parsed = parseExpression();
      if (parsed.error) {
        return { ok: false, error: parsed.error };
      }
      return { ok: true, value: parsed.value ?? 0 };
    };

    const result = parseExpression();
    if (result.error) {
      return result;
    }

    if (cursor < tokens.value.length) {
      return { value: null, error: 'Unexpected trailing formula tokens' };
    }

    return result;
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
