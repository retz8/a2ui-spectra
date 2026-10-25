import {useEffect, useMemo, useRef, useState} from 'react';

import type {ListedTurn} from '@/api.ts';
import {cn} from '@/lib/utils';
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
}: {
  turns: readonly ListedTurn[];
  loaded: boolean;
  selected: string | undefined;
  onSelect: (traceId: string) => void;
}) {
  const [query, setQuery] = useState('');
  // Each group the user opened or closed; the others are open when they hold the selection or a search's match.
  const [toggled, setToggled] = useState<ReadonlyMap<string, boolean>>(new Map());
  const search = useRef<HTMLInputElement>(null);
  const groups = useMemo(() => groupTurns(turns), [turns]);
  const shown = useMemo(() => searchGroups(groups, query), [groups, query]);

  useEffect(() => {
    // `/` focuses the search, unless the key is typed into a field.
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (event.key !== '/' || target?.closest('input, textarea, [contenteditable]')) return;
      event.preventDefault();
      search.current?.focus();
    };
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('keydown', onKey);
    };
  }, []);

  const isOpen = (group: TurnGroup<ListedTurn>) =>
    toggled.get(group.key) ??
    (query.trim() !== '' || group.turns.some(turn => turn.traceId === selected));

  return (
    <section
      aria-label="Turns"
      className="flex h-full min-h-0 flex-col overflow-hidden rounded-xl bg-panel shadow-panel"
    >
      <div className="flex shrink-0 flex-col gap-2.5 px-3.5 pt-3.5 pb-2.5">
        <div className="flex items-baseline gap-2">
          <h2 className="text-base font-semibold">Turns</h2>
          <span className="text-xs text-muted-foreground">{turns.length}</span>
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
      <div className="min-h-0 flex-1 overflow-y-auto px-1.5 pb-2">
        {shown.map(group => (
          <Group
            key={group.key}
            group={group}
            open={isOpen(group)}
            selected={selected}
            onToggle={() => setToggled(new Map(toggled).set(group.key, !isOpen(group)))}
            onSelect={onSelect}
          />
        ))}
      </div>
    </section>
  );
}

function statusOf(turn: ListedTurn): TurnStatus {
  return turn.open ? 'open' : (turn.outcome ?? 'open');
}

function Group({
  group,
  open,
  selected,
  onToggle,
  onSelect,
}: {
  group: TurnGroup<ListedTurn>;
  open: boolean;
  selected: string | undefined;
  onToggle: () => void;
  onSelect: (traceId: string) => void;
}) {
  const newest = group.turns[0];
  const icon = STATUS_ICONS[statusOf(newest)];
  const meta = [group.agentName, plural(group.turns.length, 'turn')].filter(Boolean).join(' · ');
  return (
    <div className="fade-in-quick pt-0.5 pb-1">
      <button
        type="button"
        aria-expanded={open}
        onClick={onToggle}
        className="ease-quick flex w-full cursor-pointer items-start gap-2 rounded-lg px-2 pt-2 pb-1.5 text-left hover:bg-tint"
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
          role="listbox"
          aria-label={briefText(group.title)}
          className="flex flex-col gap-px pl-3.5"
        >
          {group.turns.map(turn => (
            <Row
              key={turn.traceId}
              turn={turn}
              selected={turn.traceId === selected}
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
  onSelect,
}: {
  turn: ListedTurn;
  selected: boolean;
  onSelect: (traceId: string) => void;
}) {
  const icon = STATUS_ICONS[statusOf(turn)];
  return (
    <button
      type="button"
      role="option"
      aria-selected={selected}
      onClick={() => onSelect(turn.traceId)}
      className={cn(
        'ease-quick fade-in-quick flex h-8 w-full cursor-pointer items-center gap-2 rounded-lg px-2 text-left',
        selected ? 'bg-brand-soft shadow-[inset_2px_0_0_var(--brand)]' : 'hover:bg-tint',
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
