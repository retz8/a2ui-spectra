import {type KeyboardEvent, type RefObject, useEffect, useMemo, useRef, useState} from 'react';

import type {ListedTurn} from '@/api.ts';
import {cn} from '@/lib/utils';
import {groupItemId, type ListKey, listItemsOf, moveInList, turnItemId} from '@/model/list_keys.ts';
import {listedProblemCount} from '@/model/problems.ts';
import {plural} from '@/model/steps.ts';
import {briefText, groupTurns, searchGroups, type TurnGroup} from '@/model/turn_groups.ts';

import {
  formatClock,
  formatDuration,
  formatTime,
  STATUS_ICONS,
  type TurnStatus,
  toneOf,
} from './format.ts';
import {Icon} from './icons.tsx';

/** The turn list: the turns grouped by conversation, newest first, with a search. */
export function TurnList({
  turns,
  loaded,
  selected,
  onSelect,
  searchRef,
  autoFocus,
  onChoose,
  onCollapse,
  className,
}: {
  turns: readonly ListedTurn[];
  loaded: boolean;
  selected: string | undefined;
  /** Selects a turn, pressed or reached with the arrows. */
  onSelect: (traceId: string, how: 'press' | 'key') => void;
  /** The search field, for `/` to focus. */
  searchRef?: RefObject<HTMLInputElement | null>;
  /** What takes focus as the list is shown, as the overlay opens. */
  autoFocus?: 'list' | 'search';
  /** Enter on a turn: the overlay closes on the turn reached. */
  onChoose?: () => void;
  /** Collapses the list to its strip, on a wide window. */
  onCollapse?: () => void;
  className?: string;
}) {
  const [query, setQuery] = useState('');
  // Each group the user opened or closed; the others are open when they hold the selection or a search's match.
  const [toggled, setToggled] = useState<ReadonlyMap<string, boolean>>(new Map());
  const ownSearch = useRef<HTMLInputElement>(null);
  const search = searchRef ?? ownSearch;
  const tree = useRef<HTMLDivElement>(null);
  const groups = useMemo(() => groupTurns(turns), [turns]);
  const shown = useMemo(() => searchGroups(groups, query), [groups, query]);

  // A group that gains the selection opens, even one closed by hand, as when following selects a new turn in it.
  // The keys' place moves to the selection, wherever it came from.
  const [opened, setOpened] = useState(selected);
  const [active, setActive] = useState<string | undefined>();
  if (opened !== selected) {
    setOpened(selected);
    setActive(undefined);
    const holder = groups.find(group => group.turns.some(turn => turn.traceId === selected));
    if (holder !== undefined && toggled.get(holder.key) === false) {
      const next = new Map(toggled);
      next.delete(holder.key);
      setToggled(next);
    }
  }

  useEffect(() => {
    if (autoFocus === 'search') search.current?.focus();
    else if (autoFocus === 'list') tree.current?.focus();
  }, [autoFocus, search]);

  const isOpen = (group: TurnGroup<ListedTurn>) =>
    toggled.get(group.key) ??
    (query.trim() !== '' || group.turns.some(turn => turn.traceId === selected));
  const items = listItemsOf(shown, isOpen);
  // The line the keys move from: the one they last moved to, else the selected turn, else the first.
  const current =
    items.find(item => item.id === active) ??
    items.find(item => item.kind === 'turn' && item.traceId === selected) ??
    items[0];

  const currentId = current?.id;
  useEffect(() => {
    if (currentId !== undefined) {
      document.getElementById(domIdOf(currentId))?.scrollIntoView({block: 'nearest'});
    }
  }, [currentId]);

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Enter' && onChoose !== undefined && current?.kind === 'turn') {
      event.preventDefault();
      onChoose();
      return;
    }
    if (!LIST_KEYS.has(event.key) || current === undefined) return;
    event.preventDefault();
    const move = moveInList(items, current.id, event.key as ListKey);
    if (move === undefined) return;
    setActive(move.active);
    if (move.toggle !== undefined)
      setToggled(new Map(toggled).set(move.toggle.key, move.toggle.open));
    if (move.select !== undefined) onSelect(move.select, 'key');
  };
  // A line pressed takes the keys' place, with focus on the list.
  const press = (id: string) => {
    setActive(id);
    tree.current?.focus({preventScroll: true});
  };

  return (
    <section
      aria-label="Turns"
      className={cn(
        'flex h-full min-h-0 flex-col overflow-hidden rounded-xl bg-panel shadow-panel',
        className,
      )}
    >
      <div className="flex shrink-0 flex-col gap-2.5 px-3.5 pt-3.5 pb-2.5">
        <div className="flex items-baseline gap-2">
          <h2 className="text-base font-semibold">Turns</h2>
          <span className="text-xs text-muted-foreground">{turns.length}</span>
          {onCollapse !== undefined && (
            <button
              type="button"
              aria-label="Collapse the turn list"
              title="Collapse the turn list"
              onClick={onCollapse}
              className="ease-quick ml-auto flex size-[26px] cursor-pointer items-center justify-center self-center rounded-md text-muted-foreground hover:bg-tint hover:text-foreground"
            >
              <Icon kind="chevronLeft" size={14} />
            </button>
          )}
        </div>
        <label className="flex h-8 items-center gap-2 rounded-lg bg-tint pr-2 pl-2.5 text-muted-foreground">
          <Icon kind="search" size={14} />
          <input
            ref={search}
            type="search"
            value={query}
            onChange={event => setQuery(event.target.value)}
            placeholder="Search turns"
            aria-label="Search turns"
            className="min-w-0 flex-1 bg-transparent text-sm text-foreground outline-none placeholder:text-muted-foreground"
          />
          <kbd className="rounded border px-[5px] text-xs leading-4 text-muted-foreground">/</kbd>
        </label>
      </div>
      {groups.length === 0 && (
        <p className="mx-4 my-6 text-muted-foreground">
          {loaded ? 'No turns yet.' : 'Reading the turns…'}
        </p>
      )}
      {groups.length > 0 && shown.length === 0 && (
        <p className="mx-4 my-6 text-muted-foreground">No turn matches “{query.trim()}”.</p>
      )}
      <div
        ref={tree}
        role="tree"
        aria-label="Turns by conversation"
        tabIndex={items.length > 0 ? 0 : -1}
        aria-activedescendant={currentId === undefined ? undefined : domIdOf(currentId)}
        onKeyDown={onKeyDown}
        className="group/tree min-h-0 flex-1 overflow-y-auto px-1.5 pb-2 outline-none"
      >
        {shown.map(group => (
          <Group
            key={group.key}
            group={group}
            open={isOpen(group)}
            selected={selected}
            active={currentId}
            onToggle={() => {
              press(groupItemId(group.key));
              setToggled(new Map(toggled).set(group.key, !isOpen(group)));
            }}
            onSelect={traceId => {
              press(turnItemId(traceId));
              onSelect(traceId, 'press');
            }}
          />
        ))}
      </div>
    </section>
  );
}

const LIST_KEYS: ReadonlySet<string> = new Set<ListKey>([
  'ArrowUp',
  'ArrowDown',
  'ArrowLeft',
  'ArrowRight',
]);

/** The element id of a line of the list. */
function domIdOf(itemId: string): string {
  return `turn-list-${itemId}`;
}

/** The keys' place, outlined while the list has focus from the keyboard. */
const ACTIVE =
  'group-focus-visible/tree:outline-2 group-focus-visible/tree:-outline-offset-2 group-focus-visible/tree:outline-brand';

function statusOf(turn: ListedTurn): TurnStatus {
  return turn.open ? 'open' : (turn.outcome ?? 'open');
}

function Group({
  group,
  open,
  selected,
  active,
  onToggle,
  onSelect,
}: {
  group: TurnGroup<ListedTurn>;
  open: boolean;
  selected: string | undefined;
  active: string | undefined;
  onToggle: () => void;
  onSelect: (traceId: string) => void;
}) {
  const newest = group.turns[0];
  const icon = STATUS_ICONS[statusOf(newest)];
  const meta = [group.agentName, plural(group.turns.length, 'turn')].filter(Boolean).join(' · ');
  const id = groupItemId(group.key);
  return (
    <div className="fade-in-quick pt-0.5 pb-1">
      <button
        id={domIdOf(id)}
        type="button"
        role="treeitem"
        aria-level={1}
        aria-expanded={open}
        tabIndex={-1}
        onMouseDown={event => event.preventDefault()}
        onClick={onToggle}
        className={cn(
          'ease-quick flex w-full cursor-pointer items-start gap-2 rounded-lg px-2 pt-2 pb-1.5 text-left hover:bg-tint',
          active === id && ACTIVE,
        )}
      >
        <Icon kind={icon} size={15} className={cn('mt-0.5', toneOf(icon))} />
        <span className="min-w-0 flex-1">
          <span className="flex items-baseline gap-2">
            <span className="min-w-0 flex-1 truncate font-medium">
              {briefText(group.title) || 'A turn'}
            </span>
            <span className="shrink-0 text-xs text-muted-foreground">
              {formatClock(newest.startTime)}
            </span>
          </span>
          <span className="mt-px flex items-center gap-1.5 text-xs text-muted-foreground">
            <span className="truncate">{meta}</span>
            <ProblemMark count={group.problems} size={12} />
          </span>
        </span>
        <Icon
          kind={open ? 'chevronDown' : 'chevronRight'}
          size={14}
          className="mt-0.5 text-muted-foreground"
        />
      </button>
      {open && (
        <div
          role="group"
          aria-label={briefText(group.title)}
          className="flex flex-col gap-px pl-3.5"
        >
          {group.turns.map(turn => (
            <Row
              key={turn.traceId}
              turn={turn}
              selected={turn.traceId === selected}
              active={active === turnItemId(turn.traceId)}
              onSelect={onSelect}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function Row({
  turn,
  selected,
  active,
  onSelect,
}: {
  turn: ListedTurn;
  selected: boolean;
  active: boolean;
  onSelect: (traceId: string) => void;
}) {
  const icon = STATUS_ICONS[statusOf(turn)];
  return (
    <button
      id={domIdOf(turnItemId(turn.traceId))}
      type="button"
      role="treeitem"
      aria-level={2}
      aria-selected={selected}
      tabIndex={-1}
      onMouseDown={event => event.preventDefault()}
      onClick={() => onSelect(turn.traceId)}
      className={cn(
        'ease-quick fade-in-quick flex h-8 w-full cursor-pointer items-center gap-2 rounded-lg px-2 text-left',
        selected ? 'bg-brand-soft shadow-[inset_2px_0_0_var(--brand)]' : 'hover:bg-tint',
        active && ACTIVE,
      )}
    >
      <Icon kind={icon} size={14} className={toneOf(icon)} />
      <span className="shrink-0 text-xs text-muted-foreground">{formatTime(turn.startTime)}</span>
      <span className={cn('min-w-0 flex-1 truncate', selected && 'font-semibold')}>
        {briefText(turn.input) || 'Waiting for its input'}
      </span>
      {turn.durationMs !== undefined && (
        <span className="shrink-0 text-xs text-muted-foreground">
          {formatDuration(turn.durationMs)}
        </span>
      )}
      <ProblemMark count={listedProblemCount(turn)} size={12} />
    </button>
  );
}

/** A problem count in red; nothing when there are none. */
export function ProblemMark({count, size}: {count: number; size: number}) {
  if (count === 0) return null;
  return (
    <span
      title={plural(count, 'problem')}
      className="inline-flex shrink-0 items-center gap-[3px] text-xs font-semibold text-problem"
    >
      <Icon kind="failed" size={size} />
      {count}
    </span>
  );
}
