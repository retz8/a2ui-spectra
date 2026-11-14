/**
 * The legacy form: a v1.0 component's bare envelope key, such as `checks`,
 * which the catalog check accepted as the `@` key and listed in its event's
 * `a2ui.check.legacy_form`. It is not a problem. The turn counts the distinct
 * components among its entries; a step counts the components of its own
 * message and names their bare keys in the order they first appear there; a
 * bare key's line in the message carries its band. A stored turn is shown as
 * recorded, and a catalog check event without the attribute reads as one
 * with no entry.
 */
import {locateFinding} from './messages.ts';
import {isCheck, type LegacyFormEntry, type TurnRecordEvent} from './record.ts';
import type {SurfaceView} from './replay.ts';
import {plural, type TimelineRow} from './steps.ts';

/** The turn's legacy-form entries, from its catalog check events, in order. */
export function legacyEntriesOf(events: readonly TurnRecordEvent[]): LegacyFormEntry[] {
  return events.flatMap(event =>
    isCheck(event) && event.attributes['a2ui.check.name'] === 'catalog'
      ? (event.attributes['a2ui.check.legacy_form'] ?? [])
      : [],
  );
}

/**
 * How many components the entries name: distinct surface-and-component-id
 * pairs, so a component sent twice in the legacy form counts once.
 */
export function legacyComponentCount(entries: readonly LegacyFormEntry[]): number {
  return new Set(entries.map(entry => JSON.stringify([entry.surfaceId, entry.componentId]))).size;
}

/** The legacy form in one step's message. */
export interface StepLegacy {
  /** The components of the message in the legacy form. */
  count: number;
  /** Their bare keys, each once, in the order they first appear in the message. */
  keys: string[];
  /** A JSON Pointer inside the message to each bare key. */
  paths: string[];
}

/** The legacy form of each step whose message carried a component in it, by the step's id. */
export function legacyByStep(
  events: readonly TurnRecordEvent[],
  timeline: readonly TimelineRow[],
  entries: readonly LegacyFormEntry[],
): Map<string, StepLegacy> {
  const stepOfMessage = new Map<string, string>();
  for (const row of timeline) {
    if (row.row === 'step' && row.messageKey !== undefined)
      stepOfMessage.set(row.messageKey, row.id);
  }
  const located = new Map<string, Array<{entry: LegacyFormEntry; inner: string}>>();
  for (const entry of entries) {
    const location = locateFinding(events, entry.path);
    const stepId = location === undefined ? undefined : stepOfMessage.get(location.key);
    if (location === undefined || stepId === undefined) continue;
    const list = located.get(stepId);
    if (list === undefined) located.set(stepId, [{entry, inner: location.inner}]);
    else list.push({entry, inner: location.inner});
  }
  const byStep = new Map<string, StepLegacy>();
  for (const [stepId, list] of located) {
    // The components read top to bottom, as the message writes them.
    const ordered = [...list].sort((a, b) => comparePointers(a.inner, b.inner));
    const keys: string[] = [];
    const paths: string[] = [];
    for (const {entry, inner} of ordered) {
      for (const key of entry.keys) {
        if (!keys.includes(key)) keys.push(key);
        paths.push(`${inner}/${escapePointer(key)}`);
      }
    }
    const components = new Set(ordered.map(({entry}) => entry.componentId));
    byStep.set(stepId, {count: components.size, keys, paths});
  }
  return byStep;
}

/** The bare keys of each component object in the legacy form, by its JSON Pointer from the turn. */
export function legacyKeysByPath(entries: readonly LegacyFormEntry[]): Map<string, string[]> {
  const byPath = new Map<string, string[]>();
  for (const entry of entries) {
    const keys = byPath.get(entry.path) ?? [];
    for (const key of entry.keys) if (!keys.includes(key)) keys.push(key);
    byPath.set(entry.path, keys);
  }
  return byPath;
}

/**
 * The bare keys of a node in Structure: those of its standing component
 * object, when a message of this turn carried that very object in the
 * legacy form. A component sent again later in the turn with the `@` key has
 * none after that step; one standing from an earlier turn has none.
 */
export function legacyKeysOfNode(
  surface: SurfaceView,
  componentId: string,
  keysByPath: ReadonlyMap<string, string[]>,
): string[] | undefined {
  const path = surface.written?.get(componentId)?.path;
  return path === undefined ? undefined : keysByPath.get(path);
}

/**
 * The step's detail's two lines, each a lead, the keys in monospace and what
 * follows: the verb follows the number of components and the noun the number
 * of distinct keys.
 */
export interface LegacyLines {
  first: {lead: string; keys: string[]};
  second: {lead: string; keys: string[]; after: string};
}

export function legacyLinesOf(count: number, keys: readonly string[]): LegacyLines {
  const one = keys.length === 1;
  return {
    first: {
      lead: `${plural(count, 'component')} ${count === 1 ? 'carries' : 'carry'} ${one ? 'a bare envelope key' : 'bare envelope keys'}, the legacy form: `,
      keys: [...keys],
    },
    second: {
      lead: 'The v1.0 form is ',
      keys: keys.map(key => `@${key}`),
      after: one
        ? '. The bare key is accepted during upstream’s transition.'
        : '. The bare keys are accepted during upstream’s transition.',
    },
  };
}

/** The Catalog check row's remark. */
export function legacyRemarkOf(count: number): string {
  return `${plural(count, 'component')} in the legacy form`;
}

/** Two JSON Pointers compared segment by segment, array indices as numbers. */
function comparePointers(a: string, b: string): number {
  const left = a.split('/');
  const right = b.split('/');
  for (let index = 0; index < Math.min(left.length, right.length); index++) {
    if (left[index] === right[index]) continue;
    const [x, y] = [Number(left[index]), Number(right[index])];
    if (/^\d+$/.test(left[index]) && /^\d+$/.test(right[index])) return x - y;
    return left[index] < right[index] ? -1 : 1;
  }
  return left.length - right.length;
}

function escapePointer(segment: string): string {
  return segment.replace(/~/g, '~0').replace(/\//g, '~1');
}
