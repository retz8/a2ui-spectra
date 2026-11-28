/**
 * Two parsed JSON values compared by value: the members of an object in any
 * order, the elements of an array in order, and a zero of either sign as
 * zero. JSON text keeps no `-0` once a value has been through
 * `JSON.stringify`, as a record's has, so a recorded `0` and a live `-0` are
 * the same value.
 */
export function jsonEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) return false;
  if (Array.isArray(a) || Array.isArray(b)) {
    return (
      Array.isArray(a) &&
      Array.isArray(b) &&
      a.length === b.length &&
      a.every((element, index) => jsonEqual(element, b[index]))
    );
  }
  const left = a as Record<string, unknown>;
  const right = b as Record<string, unknown>;
  const names = Object.keys(left);
  return (
    names.length === Object.keys(right).length &&
    names.every(name => Object.hasOwn(right, name) && jsonEqual(left[name], right[name]))
  );
}
