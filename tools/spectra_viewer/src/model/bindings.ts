/**
 * What a tree node shows beside its type and id: its text, the data model
 * path it binds to, the list it repeats over, or the event it sends.
 */

export function bindingOf(properties: Readonly<Record<string, unknown>>): string {
  const {text, children, action} = properties;
  if (typeof text === 'string') return `“${text}”`;
  const textPath = pathOf(text);
  if (textPath !== undefined) return textPath;
  if (typeof children === 'object' && children !== null && !Array.isArray(children)) {
    const listPath = pathOf(children);
    if (listPath !== undefined) return `each of ${listPath}`;
  }
  const event = (action as {event?: {name?: unknown}} | undefined)?.event?.name;
  if (typeof event === 'string') return event;
  for (const [key, value] of Object.entries(properties)) {
    if (key === 'children' || key === 'child') continue;
    const path = pathOf(value);
    if (path !== undefined) return path;
  }
  return '';
}

/** The path of a binding: v0.9's `{"path": …}`, or `{"@path": …}` as v1.0's surfaces hold it. */
function pathOf(value: unknown): string | undefined {
  if (typeof value !== 'object' || value === null) return undefined;
  const {path, '@path': atPath} = value as {path?: unknown; '@path'?: unknown};
  return typeof path === 'string' ? path : typeof atPath === 'string' ? atPath : undefined;
}
