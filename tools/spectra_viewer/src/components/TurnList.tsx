import {DropdownMenu} from 'radix-ui';
import {
  type KeyboardEvent,
  type ReactNode,
  type RefObject,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';

import type {ListedTurn} from '@/api.ts';
import {scrollIntoColumn} from '@/lib/scroll.ts';
import {cn} from '@/lib/utils';
import {type AgentChoice, agentLabel, type AgentShown} from '@/model/agents.ts';
import {groupItemId, type ListKey, listItemsOf, moveInList, turnItemId} from '@/model/list_keys.ts';
import {listedProblemCount} from '@/model/problems.ts';
import {plural} from '@/model/steps.ts';
import {briefText, searchGroups, type TurnGroup} from '@/model/turn_groups.ts';

import {
  formatClock,
  formatDuration,
  formatTime,
  STATUS_ICONS,
  type TurnStatus,
  toneOf,
} from './format.ts';
import {Icon, type IconKind} from './icons.tsx';

/** The agent picker's choices, the agent shown and what picking one does. */
export interface AgentPicker {
  choices: readonly AgentChoice[];
  shown: AgentShown;
  /** How many turns every agent has together. */
  total: number;
  onPick: (shown: AgentShown) => void;
}

/** What a group's header says. */
export interface GroupLine {
  title: string;
  time: string;
  meta: string;
  icon: IconKind;
  /** Stands in place of its rows, for a file that does not read as a turn record. */
  reason?: string;
}

/**
 * A list of groups of turn rows, with a search: the turn list and the
 * fixtures list are each one of these. Each row's `traceId` names it.
 */
export function GroupedList<T extends ListedTurn>({
  heading,
  count,
  headerExtra,
  groups,
  searchOf,
  lineOf,
  searchLabel,
  treeLabel,
  collapseLabel,
  emptyText,
  noMatchText,
  selected,
  onSelect,
  searchRef,
  autoFocus,
  onChoose,
  onCollapse,
  className,
}: {
  heading: string;
  count: number;
  /** Beside the heading: the agent picker. */
  headerExtra?: ReactNode;
  groups: ReadonlyArray<TurnGroup<T>>;
  searchOf: (groups: ReadonlyArray<TurnGroup<T>>, query: string) => Array<TurnGroup<T>>;
  lineOf: (group: TurnGroup<T>) => GroupLine;
  searchLabel: string;
  treeLabel: string;
  collapseLabel: string;
  /** What it says with no group. */
  emptyText: string;
  noMatchText: (query: string) => string;
  selected: string | undefined;
  /** Selects a row, pressed or reached with the arrows. */
  onSelect: (id: string, how: 'press' | 'key') => void;
  /** The search field, for `/` to focus. */
  searchRef?: RefObject<HTMLInputElement | null>;
  /** What takes focus as the list is shown, as the overlay opens. */
  autoFocus?: 'list' | 'search';
  /** Enter on a row: the overlay closes on the row reached. */
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
  const shown = useMemo(() => searchOf(groups, query), [searchOf, groups, query]);

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

  const isOpen = (group: TurnGroup<T>) =>
    toggled.get(group.key) ??
    (query.trim() !== '' ||
      group.turns.some(turn => turn.traceId === selected) ||
      lineOf(group).reason !== undefined);
  const items = listItemsOf(shown, isOpen);
  // The line the keys move from: the one they last moved to, else the selected turn, else the first.
  const current =
    items.find(item => item.id === active) ??
    items.find(item => item.kind === 'turn' && item.traceId === selected) ??
    items[0];

  const currentId = current?.id;
  useEffect(() => {
    if (currentId !== undefined) {
      scrollIntoColumn(tree.current, document.getElementById(domIdOf(currentId)));
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
      aria-label={heading}
      className={cn(
        'flex h-full min-h-0 flex-col overflow-hidden rounded-xl bg-panel shadow-panel',
        className,
      )}
    >
      <div className="flex shrink-0 flex-col gap-2.5 px-3.5 pt-3.5 pb-2.5">
        <div className="flex items-baseline gap-2">
          <h2 className="text-base font-semibold">{heading}</h2>
          {headerExtra}
          <span className="text-xs text-muted-foreground">{count}</span>
          {onCollapse !== undefined && (
            <button
              type="button"
              aria-label={collapseLabel}
              title={collapseLabel}
              onClick={onCollapse}
              className="ease-quick ml-auto flex size-6 cursor-pointer items-center justify-center self-center rounded-md text-muted-foreground hover:bg-tint hover:text-foreground"
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
            placeholder={searchLabel}
            aria-label={searchLabel}
            className="min-w-0 flex-1 bg-transparent text-sm text-foreground outline-none placeholder:text-muted-foreground"
          />
          <kbd className="rounded border px-1.5 text-xs leading-4 text-muted-foreground">/</kbd>
        </label>
      </div>
      {groups.length === 0 && <p className="mx-4 my-6 text-muted-foreground">{emptyText}</p>}
      {groups.length > 0 && shown.length === 0 && (
        <p className="mx-4 my-6 text-muted-foreground">{noMatchText(query.trim())}</p>
      )}
      <div
        ref={tree}
        role="tree"
        aria-label={treeLabel}
        tabIndex={items.length > 0 ? 0 : -1}
        aria-activedescendant={currentId === undefined ? undefined : domIdOf(currentId)}
        onKeyDown={onKeyDown}
        className="group/tree min-h-0 flex-1 overflow-y-auto px-1.5 pb-2 outline-none"
      >
        {shown.map(group => (
          <Group
            key={group.key}
            group={group}
            line={lineOf(group)}
            open={isOpen(group)}
            selected={selected}
            active={currentId}
            onToggle={() => {
              press(groupItemId(group.key));
              setToggled(new Map(toggled).set(group.key, !isOpen(group)));
            }}
            onSelect={id => {
              press(turnItemId(id));
              onSelect(id, 'press');
            }}
          />
        ))}
      </div>
    </section>
  );
}

/** A conversation's header: its first message, its newest turn's status and time, its agent and its turn count. */
function lineOfConversation(group: TurnGroup<ListedTurn>): GroupLine {
  const newest = group.turns[0];
  return {
    title: briefText(group.title) || 'A turn',
    time: formatClock(newest.startTime),
    meta: [group.agentName, plural(group.turns.length, 'turn')].filter(Boolean).join(' · '),
    icon: STATUS_ICONS[statusOf(newest)],
  };
}

/**
 * The turn list: the turns grouped by conversation, newest first, with a
 * search, and the agent picker when the store holds more than one agent's
 * turns.
 */
export function TurnList({
  turns,
  groups,
  loaded,
  agents,
  ...list
}: {
  /** The turns of the agent shown. */
  turns: readonly ListedTurn[];
  /** Those turns grouped. */
  groups: ReadonlyArray<TurnGroup<ListedTurn>>;
  loaded: boolean;
  agents?: AgentPicker;
  selected: string | undefined;
  onSelect: (traceId: string, how: 'press' | 'key') => void;
  searchRef?: RefObject<HTMLInputElement | null>;
  autoFocus?: 'list' | 'search';
  onChoose?: () => void;
  onCollapse?: () => void;
  className?: string;
}) {
  return (
    <GroupedList
      heading="Turns"
      count={turns.length}
      {...(agents !== undefined && {headerExtra: <AgentMenu agents={agents} />})}
      groups={groups}
      searchOf={searchGroups}
      lineOf={lineOfConversation}
      searchLabel="Search turns"
      treeLabel="Turns by conversation"
      collapseLabel="Collapse the turn list"
      emptyText={loaded ? 'No turns yet.' : 'Reading the turns…'}
      noMatchText={query => `No turn matches “${query}”.`}
      {...list}
    />
  );
}

/** The value of a choice in the picker's radio group. */
function valueOf(shown: AgentShown): string {
  return shown === 'all' ? 'all' : `agent:${shown.name}`;
}

/** The agent picker: the agent shown, opening the agents with turns in the store, then every agent. */
function AgentMenu({agents}: {agents: AgentPicker}) {
  const {choices, shown, total, onPick} = agents;
  const value = valueOf(shown);
  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger asChild>
        <button
          type="button"
          className="ease-quick inline-flex h-6 max-w-40 min-w-0 cursor-pointer items-center gap-1 self-center rounded-md pr-1.5 pl-2 text-xs font-medium text-muted-strong hover:bg-tint data-[state=open]:bg-tint"
        >
          <span className="min-w-0 truncate">{agentLabel(shown)}</span>
          <Icon kind="chevronDown" size={12} className="shrink-0 text-muted-foreground" />
        </button>
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content
          align="start"
          sideOffset={6}
          aria-label="Agents"
          className="fade-in-quick z-50 flex w-64 flex-col rounded-xl bg-panel p-1.5 text-foreground shadow-float"
        >
          <DropdownMenu.RadioGroup
            value={value}
            onValueChange={next => {
              const choice = choices.find(agent => valueOf({name: agent.name}) === next);
              onPick(choice === undefined ? 'all' : {name: choice.name});
            }}
          >
            {choices.map(agent => (
              <AgentItem
                key={agent.name}
                value={valueOf({name: agent.name})}
                checked={value === valueOf({name: agent.name})}
                name={agent.name}
                note={agent.connected ? 'connected' : undefined}
                count={agent.turns}
              />
            ))}
            <DropdownMenu.Separator className="mx-1.5 my-1 h-px bg-border" />
            <AgentItem value="all" checked={value === 'all'} name="All agents" count={total} />
          </DropdownMenu.RadioGroup>
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}

function AgentItem({
  value,
  checked,
  name,
  note,
  count,
}: {
  value: string;
  checked: boolean;
  name: string;
  note?: string;
  count: number;
}) {
  return (
    <DropdownMenu.RadioItem
      value={value}
      className="ease-quick flex h-8 cursor-pointer items-center gap-2 rounded-lg px-2 outline-none data-[highlighted]:bg-tint"
    >
      <span className="flex size-3.5 shrink-0 text-brand">
        <DropdownMenu.ItemIndicator>
          <Icon kind="checked" size={14} />
        </DropdownMenu.ItemIndicator>
      </span>
      <span className={cn('min-w-0 flex-1 truncate', checked && 'font-semibold')}>{name}</span>
      {note !== undefined && <span className="shrink-0 text-xs text-muted-foreground">{note}</span>}
      <span className="min-w-4 shrink-0 text-right text-xs text-muted-foreground">{count}</span>
    </DropdownMenu.RadioItem>
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

function Group<T extends ListedTurn>({
  group,
  line,
  open,
  selected,
  active,
  onToggle,
  onSelect,
}: {
  group: TurnGroup<T>;
  line: GroupLine;
  open: boolean;
  selected: string | undefined;
  active: string | undefined;
  onToggle: () => void;
  onSelect: (id: string) => void;
}) {
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
        <Icon kind={line.icon} size={16} className={cn('mt-0.5', toneOf(line.icon))} />
        <span className="min-w-0 flex-1">
          <span className="flex items-baseline gap-2">
            <span className="min-w-0 flex-1 truncate font-medium">{line.title}</span>
            <span className="shrink-0 text-xs text-muted-foreground">{line.time}</span>
          </span>
          <span className="mt-px flex items-center gap-1.5 text-xs text-muted-foreground">
            <span className="truncate">{line.meta}</span>
            <ProblemMark count={group.problems} size={12} />
          </span>
        </span>
        <Icon
          kind={open ? 'chevronDown' : 'chevronRight'}
          size={14}
          className="mt-0.5 text-muted-foreground"
        />
      </button>
      {open && line.reason !== undefined && (
        <p className="mb-1 ml-8 pr-2 text-xs leading-4 wrap-anywhere text-muted-foreground">
          {line.reason}
        </p>
      )}
      {open && (
        <div role="group" aria-label={line.title} className="flex flex-col gap-px pl-3.5">
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
        selected ? 'bg-brand-soft shadow-mark-start' : 'hover:bg-tint',
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
      className="inline-flex shrink-0 items-center gap-1 text-xs font-semibold text-problem"
    >
      <Icon kind="failed" size={size} />
      {count}
    </span>
  );
}
