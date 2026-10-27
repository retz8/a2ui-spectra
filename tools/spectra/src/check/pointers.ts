/** JSON Pointers as the checks write them: from the turn object to the offending value. */

/** One reference token, with `~` and `/` escaped as RFC 6901 has it. */
export function token(key: string | number): string {
  return String(key).replaceAll('~', '~0').replaceAll('/', '~1');
}

/**
 * Web core's property path of a child reference as a JSON Pointer inside the
 * component: `children[2]` is `/children/2`, `tabs[0].child` is
 * `/tabs/0/child`, and a template's `children.componentId` is
 * `/children/componentId`.
 */
export function propertyPathPointer(propertyPath: string): string {
  const tokens: string[] = [];
  for (const segment of propertyPath.split('.')) {
    const match = /^([^[]*)((?:\[\d+\])*)$/.exec(segment);
    if (match === null) {
      tokens.push(segment);
      continue;
    }
    if (match[1] !== '') tokens.push(match[1]);
    for (const index of match[2].matchAll(/\[(\d+)\]/g)) tokens.push(index[1]);
  }
  return tokens.map(part => `/${token(part)}`).join('');
}

/**
 * Orders two pointers by the message and the value they point at: token by
 * token, numeric tokens as numbers. A missing pointer sorts last.
 */
export function comparePointers(a: string | undefined, b: string | undefined): number {
  if (a === undefined || b === undefined) return a === undefined ? (b === undefined ? 0 : 1) : -1;
  const left = a.split('/');
  const right = b.split('/');
  for (let i = 0; i < Math.min(left.length, right.length); i++) {
    if (left[i] === right[i]) continue;
    const numbers = /^\d+$/.test(left[i]) && /^\d+$/.test(right[i]);
    return numbers ? Number(left[i]) - Number(right[i]) : left[i] < right[i] ? -1 : 1;
  }
  return left.length - right.length;
}
