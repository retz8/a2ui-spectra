/**
 * The render difference: a render carries the full list of a surface's
 * messages, and the page applies what is new. When the new list begins with
 * the one applied last, for the same surface, only its tail is fed into the
 * processor that holds it; otherwise the processor is recreated and the
 * whole list fed.
 */

/** The list a page applied last: its surface and each message as JSON. */
export interface Applied {
  surfaceId: string;
  keys: readonly string[];
}

export type Difference =
  /** Feed the messages from this index on into the processor as it is. */
  | {kind: 'append'; from: number}
  /** Recreate the processor and feed every message. */
  | {kind: 'reset'};

/** Each message as JSON, the form two lists are compared in. */
export function keysOf(messages: readonly unknown[]): string[] {
  return messages.map(message => JSON.stringify(message) ?? 'undefined');
}

export function differenceOf(
  applied: Applied | undefined,
  next: {surfaceId: string; keys: readonly string[]},
): Difference {
  if (
    applied === undefined ||
    applied.surfaceId !== next.surfaceId ||
    next.keys.length < applied.keys.length ||
    applied.keys.some((key, index) => next.keys[index] !== key)
  ) {
    return {kind: 'reset'};
  }
  return {kind: 'append', from: applied.keys.length};
}
