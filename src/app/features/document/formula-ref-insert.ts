/**
 * Caret-aware insertion of column Reference Names into a formula editor
 * (clicking a column while a formula editor is active, see CONTEXT.md).
 *
 * Column Reference Names always carry the `$` prefix, so a `$…` token at the
 * caret is treated as "the reference the user is building" and replaced —
 * together with any dotted qualifiers in front of it (`Wealth.$Amount` is one
 * reference, not two tokens). Anywhere else the reference is inserted at the
 * caret, padded so it never fuses with a neighboring word.
 */

const TOKEN_CHAR = /[\w$]/;

export interface ReferenceSplice {
  value: string;
  caret: number;
}

export function spliceReference(
  value: string,
  selectionStart: number,
  selectionEnd: number,
  refText: string,
): ReferenceSplice {
  const start = clamp(selectionStart, value.length);
  const end = Math.max(start, clamp(selectionEnd, value.length));

  // An explicit selection behaves like typing: replace it.
  if (start !== end) {
    return {
      value: value.slice(0, start) + refText + value.slice(end),
      caret: start + refText.length,
    };
  }

  // Token the caret sits in or immediately after.
  let tokenStart = start;
  while (tokenStart > 0 && TOKEN_CHAR.test(value[tokenStart - 1]!)) {
    tokenStart -= 1;
  }
  let tokenEnd = start;
  while (tokenEnd < value.length && TOKEN_CHAR.test(value[tokenEnd]!)) {
    tokenEnd += 1;
  }

  if (value.slice(tokenStart, tokenEnd).startsWith('$')) {
    const pathStart = consumeQualifiers(value, tokenStart);
    return {
      value: value.slice(0, pathStart) + refText + value.slice(tokenEnd),
      caret: pathStart + refText.length,
    };
  }

  // Plain insert; pad so the reference never glues onto a neighboring token.
  // No padding after a `.` — that completes a dotted path the user started.
  const before = start > 0 ? value[start - 1]! : '';
  const after = start < value.length ? value[start]! : '';
  const prefix = /[\w$)]/.test(before) ? ' ' : '';
  const suffix = /[\w$(]/.test(after) ? ' ' : '';
  return {
    value: value.slice(0, start) + prefix + refText + suffix + value.slice(start),
    caret: start + prefix.length + refText.length,
  };
}

/**
 * Walks left over `Entity.` qualifier segments so replacing `$Amount` in
 * `Wealth.Savings.$Amount` swallows the whole path.
 */
function consumeQualifiers(value: string, tokenStart: number): number {
  let pathStart = tokenStart;
  while (pathStart >= 2 && value[pathStart - 1] === '.') {
    let segmentStart = pathStart - 1;
    while (segmentStart > 0 && TOKEN_CHAR.test(value[segmentStart - 1]!)) {
      segmentStart -= 1;
    }
    const segment = value.slice(segmentStart, pathStart - 1);
    if (!/^[A-Za-z_]/.test(segment)) {
      break; // Not an entity qualifier (e.g. the `1.` of a number literal).
    }
    pathStart = segmentStart;
  }
  return pathStart;
}

/** Applies `spliceReference` to a live input, keeping focus and the caret. */
export function insertReferenceIntoInput(input: HTMLInputElement, refText: string): void {
  const start = input.selectionStart ?? input.value.length;
  const end = input.selectionEnd ?? start;
  const splice = spliceReference(input.value, start, end, refText);
  input.value = splice.value;
  input.setSelectionRange(splice.caret, splice.caret);
  input.focus();
}

function clamp(index: number, max: number): number {
  return Math.max(0, Math.min(index, max));
}
