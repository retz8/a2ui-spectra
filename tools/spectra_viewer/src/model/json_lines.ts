/**
 * JSON as the viewer shows it: one line per value, indented two spaces, and
 * each object or array with a line that folds it. A folded one is a single
 * line that says how many keys or items it holds. The lines a problem marks.
 */

export interface JsonLine {
  text: string;
  /** The JSON Pointer of the object or array this line opens, for its fold toggle. */
  fold?: string;
  folded?: boolean;
  /** The JSON Pointer of the value the line shows. */
  path: string;
}

export function jsonLines(value: unknown, folded: ReadonlySet<string> = new Set()): JsonLine[] {
  const lines: JsonLine[] = [];
  const walk = (item: unknown, depth: number, prefix: string, path: string, comma: boolean) => {
    const indent = '  '.repeat(depth);
    const end = comma ? ',' : '';
    if (item === null || typeof item !== 'object') {
      lines.push({text: `${indent}${prefix}${JSON.stringify(item) ?? 'null'}${end}`, path});
      return;
    }
    const isArray = Array.isArray(item);
    const entries: Array<[string, unknown]> = isArray
      ? item.map((child: unknown, index) => [String(index), child])
      : Object.entries(item);
    const [open, close] = isArray ? ['[', ']'] : ['{', '}'];
    if (entries.length === 0) {
      lines.push({text: `${indent}${prefix}${open}${close}${end}`, path});
      return;
    }
    if (folded.has(path)) {
      const count = `${entries.length} ${isArray ? 'item' : 'key'}${entries.length === 1 ? '' : 's'}`;
      lines.push({
        text: `${indent}${prefix}${open} … ${count} ${close}${end}`,
        fold: path,
        folded: true,
        path,
      });
      return;
    }
    lines.push({text: `${indent}${prefix}${open}`, fold: path, folded: false, path});
    entries.forEach(([key, child], index) =>
      walk(
        child,
        depth + 1,
        isArray ? '' : `${JSON.stringify(key)}: `,
        `${path}/${key.replace(/~/g, '~0').replace(/\//g, '~1')}`,
        index < entries.length - 1,
      ),
    );
    lines.push({text: `${indent}${close}${end}`, path});
  };
  walk(value, 0, '', '', false);
  return lines;
}

/**
 * The path of the value a JSON Pointer marks: the pointer's own value, or,
 * when the pointer names something the JSON lacks, such as a missing
 * property, the deepest value on the way to it.
 */
export function markedPath(value: unknown, pointer: string): string {
  let path = '';
  let at = value;
  for (const segment of pointer.split('/').slice(1)) {
    const key = segment.replace(/~1/g, '/').replace(/~0/g, '~');
    if (at === null || typeof at !== 'object' || !Object.prototype.hasOwnProperty.call(at, key))
      break;
    at = (at as Record<string, unknown>)[key];
    path += `/${segment}`;
  }
  return path;
}

/**
 * The index of the line that shows a marked path: the line of its value, the
 * opening line for an object or array, or the folded line that hides it.
 */
export function markedLine(lines: readonly JsonLine[], path: string): number {
  return lines.findIndex(
    line => line.path === path || (line.folded === true && path.startsWith(`${line.path}/`)),
  );
}

/** How a line is marked: by a problem, soft red; holding a bare envelope key in the legacy form, banded with the hourglass. */
export interface LineMarks {
  marked: boolean;
  legacy: boolean;
}

/**
 * Each line's marks: a line a problem's path marks, and a line that holds,
 * or folds, a bare envelope key in the legacy form. A line can be both: a
 * finding whose pointer ends at an accepted bare key.
 */
export function lineMarksOf(
  lines: readonly JsonLine[],
  marks: readonly string[],
  legacy: readonly string[],
): LineMarks[] {
  const marked = new Set(marks.map(path => markedLine(lines, path)));
  const banded = new Set(legacy.map(path => markedLine(lines, path)));
  return lines.map((_, index) => ({marked: marked.has(index), legacy: banded.has(index)}));
}

/** The folded objects and arrays left once those that hide a marked path are unfolded. */
export function unfoldedTo(folded: ReadonlySet<string>, path: string): Set<string> {
  return new Set([...folded].filter(fold => !path.startsWith(`${fold}/`)));
}
