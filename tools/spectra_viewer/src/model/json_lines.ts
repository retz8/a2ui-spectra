/**
 * JSON as the viewer shows it: one line per value, indented two spaces, and
 * each object or array with a line that folds it. A folded one is a single
 * line that says how many keys or items it holds.
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
