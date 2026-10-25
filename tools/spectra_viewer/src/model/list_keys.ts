/**
 * The turn list's keys, a tree's: the up and down arrows move through the
 * group headers and the turns of open groups, selecting a turn they land on;
 * the right arrow opens a group, and the left arrow closes it, or moves from
 * a turn to its group's header.
 */
import type {GroupedTurn, TurnGroup} from './turn_groups.ts';

/** A line of the turn list the keys move through. */
export type ListItem =
  | {kind: 'group'; id: string; key: string; open: boolean}
  | {kind: 'turn'; id: string; traceId: string; group: string};

/** What a key does: the item it moves to, the turn it selects, the group it opens or closes. */
export interface ListMove {
  active: string;
  select?: string;
  toggle?: {key: string; open: boolean};
}

export type ListKey = 'ArrowUp' | 'ArrowDown' | 'ArrowLeft' | 'ArrowRight';

export const groupItemId = (key: string) => `group:${key}`;
export const turnItemId = (traceId: string) => `turn:${traceId}`;

/** The lines shown: each group's header, then its turns while it is open. */
export function listItemsOf<T extends GroupedTurn>(
  groups: ReadonlyArray<TurnGroup<T>>,
  isOpen: (group: TurnGroup<T>) => boolean,
): ListItem[] {
  return groups.flatMap(group => {
    const open = isOpen(group);
    const header: ListItem = {kind: 'group', id: groupItemId(group.key), key: group.key, open};
    if (!open) return [header];
    return [
      header,
      ...group.turns.map((turn): ListItem => ({
        kind: 'turn',
        id: turnItemId(turn.traceId),
        traceId: turn.traceId,
        group: group.key,
      })),
    ];
  });
}

/**
 * Where a key moves from the item it starts on, or nothing when it moves
 * nowhere: past either end, the right arrow on an open group or a turn, the
 * left arrow on a closed group.
 */
export function moveInList(
  items: readonly ListItem[],
  active: string,
  key: ListKey,
): ListMove | undefined {
  const index = items.findIndex(item => item.id === active);
  const item = items[index];
  if (item === undefined) return undefined;
  switch (key) {
    case 'ArrowUp':
    case 'ArrowDown': {
      const next = items[index + (key === 'ArrowUp' ? -1 : 1)];
      if (next === undefined) return undefined;
      return next.kind === 'turn' ? {active: next.id, select: next.traceId} : {active: next.id};
    }
    case 'ArrowRight':
      return item.kind === 'group' && !item.open
        ? {active: item.id, toggle: {key: item.key, open: true}}
        : undefined;
    case 'ArrowLeft':
      if (item.kind === 'turn') return {active: groupItemId(item.group)};
      return item.open ? {active: item.id, toggle: {key: item.key, open: false}} : undefined;
  }
}
