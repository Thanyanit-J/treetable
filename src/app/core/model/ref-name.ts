/**
 * Reference Names are the user-facing, formula-addressable identifiers
 * (see CONTEXT.md and ADR-0003). They are distinct from internal ids:
 * internal ids are stable UUIDs, Reference Names are editable text.
 *
 * Column Reference Names look like `$Amount`; Topic and Node Reference
 * Names look like `Savings`. Basenames that would collide with formula
 * keywords are reserved.
 */
export const RESERVED_REF_BASENAMES: ReadonlySet<string> = new Set([
  'SUM',
  'AVG',
  'MIN',
  'MAX',
  'COUNT',
  'COUNTA',
  'COUNTBLANK',
  'children',
]);

const ENTITY_REF_PATTERN = /^[A-Za-z_]\w*$/;
const COLUMN_REF_PATTERN = /^\$[A-Za-z_]\w*$/;

export function isValidColumnRefName(candidate: string): boolean {
  return COLUMN_REF_PATTERN.test(candidate) && !RESERVED_REF_BASENAMES.has(candidate.slice(1));
}

export function isValidEntityRefName(candidate: string): boolean {
  return ENTITY_REF_PATTERN.test(candidate) && !RESERVED_REF_BASENAMES.has(candidate);
}

function slugifyBase(input: string, fallback: string): string {
  const cleaned = input.trim().replaceAll(/\W/g, '');
  let base = cleaned.length > 0 ? cleaned : fallback;
  if (!/^[A-Za-z_]/.test(base)) {
    base = `_${base}`;
  }
  if (RESERVED_REF_BASENAMES.has(base)) {
    base = `${base}_ref`;
  }
  return base;
}

export function slugifyColumnRefName(displayName: string): string {
  return `$${slugifyBase(displayName, 'Column')}`;
}

export function slugifyEntityRefName(displayName: string): string {
  return slugifyBase(displayName, 'Item');
}

/** Returns `base` or the first `base_2`, `base_3`, … not present in `taken`. */
export function uniqueRefName(base: string, taken: ReadonlySet<string>): string {
  if (!taken.has(base)) {
    return base;
  }
  let suffix = 2;
  let candidate = `${base}_${suffix}`;
  while (taken.has(candidate)) {
    suffix += 1;
    candidate = `${base}_${suffix}`;
  }
  return candidate;
}
