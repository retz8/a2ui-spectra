/**
 * Message parts with nothing in them: text or reasoning whose content is the
 * empty string, such as the text Gemini sends after a tool call or to carry
 * a thought signature, and empty reasoning from Claude. The record keeps
 * them; the viewer draws no block for them.
 */

function isEmpty(part: unknown): boolean {
  if (typeof part !== 'object' || part === null) return false;
  const {type, content} = part as {type?: unknown; content?: unknown};
  return (type === 'text' || type === 'reasoning') && content === '';
}

/** A message's parts as the viewer draws them: every part but those with nothing in them. */
export function shownParts(parts: readonly unknown[]): unknown[] {
  return parts.filter(part => !isEmpty(part));
}

/** What a message whose parts all hold nothing says beside its label. */
export function emptyNoteOf(parts: readonly unknown[]): string {
  return parts.every(part => (part as {type?: unknown})?.type === 'reasoning')
    ? 'empty reasoning'
    : 'empty text';
}
