import {type KeyboardEvent, useEffect, useMemo, useRef} from 'react';

import {cn} from '@/lib/utils';
import type {TimelineKey} from '@/model/follow.ts';
import {type Lane, lanesOf, shareOf} from '@/model/lanes.ts';
import {deliveryLabel, type TimelineRow} from '@/model/steps.ts';
import {takeTimelineFocusRequest} from '@/state/timeline_focus.ts';

import {brandIconOf, formatDurationCompact, formatOffsetCompact, toneOf} from './format.ts';
import {Icon} from './icons.tsx';
import {ProblemMark} from './TurnList.tsx';
import {useNow} from './use_now.ts';

/**
 * The turn's steps and calls by start time, each delivery with several
 * grouped under its row, an MCP housekeeping request drawn as small as a
 * delivery. Every row ends in a narrow lane drawn against the length of the
 * whole turn, a call's bar or a step's dot, with a call's duration beside
 * it. While the turn is open, the newest row is marked as followed, an
 * in-flight call's duration counts up and its bar grows, and a picked step
 * offers Jump to latest. Narrowed to the steps with problems, it counts them
 * out of all the turn's steps and offers Show all. It is one Tab stop: the
 * up and down arrows, Home and End move through it.
 */
export function Timeline({
  rows,
  allRows,
  startMs,
  endMs,
  selected,
  problems,
  tags,
  live,
  following,
  filter,
  onSelect,
  onJump,
  onKey,
}: {
  /** The rows shown: every row, or those the filter keeps. */
  rows: readonly TimelineRow[];
  /** Every row of the turn, which the lanes are drawn against. */
  allRows: readonly TimelineRow[];
  /** The turn's start, in milliseconds since the Unix epoch. */
  startMs: number;
  /** A closed turn's end; a live turn's lanes run to the present. */
  endMs: number | undefined;
  selected: string;
  /** How many problems each step has, by its id. */
  problems: ReadonlyMap<string, number>;
  /** A grey tag on a row, by its id: a retry's "Retry 1". */
  tags?: ReadonlyMap<string, string>;
  /** Whether the turn is open. */
  live: boolean;
  /** Whether the view follows the newest step. */
  following: boolean;
  /** While only the steps with problems are shown: how many steps the turn has, and turning it off. */
  filter?: {steps: number; onShowAll: () => void};
  onSelect: (id: string) => void;
  /** Lets go of the picked step, to follow the newest again. */
  onJump: () => void;
  onKey: (key: TimelineKey) => void;
}) {
  const steps = rows.filter(row => row.row === 'step').length;
  const now = useNow(live);
  const lanes = useMemo(
    () => lanesOf(allRows, startMs, endMs ?? now),
    [allRows, startMs, endMs, now],
  );
  const list = useRef<HTMLDivElement>(null);
  useEffect(() => {
    // The step in view is scrolled to as following or landing moves it; a step clicked is in view already.
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    list.current
      ?.querySelector('[aria-selected="true"]')
      ?.scrollIntoView({block: 'nearest', behavior: reduce ? 'auto' : 'smooth'});
    // A selection made from a link in the step's detail, such as the earlier call a prefix break names,
    // hands focus to the list, so the keys go on from the selected row.
    if (takeTimelineFocusRequest()) list.current?.focus({preventScroll: true});
  }, [selected]);
  return (
    <section aria-label="Steps" className="relative flex h-full min-h-0 flex-col">
      <div className="flex h-10 shrink-0 items-center gap-2 pr-3 pl-4">
        <span className="section-label">Steps</span>
        <span className="text-xs text-muted-foreground">
          {filter === undefined ? steps : `${steps} of ${filter.steps}`}
        </span>
        <div className="flex-1" />
        {filter !== undefined && (
          <>
            <span className="text-xs text-muted-foreground">Problems only</span>
            <button
              type="button"
              onClick={filter.onShowAll}
              className="cursor-pointer text-xs font-semibold text-brand hover:underline"
            >
              Show all
            </button>
          </>
        )}
        {live && (
          <span className="inline-flex items-center gap-1 text-xs font-semibold text-brand">
            <Icon kind="dot" size={8} />
            Live
          </span>
        )}
      </div>
      <div
        ref={list}
        role="listbox"
        aria-label="Steps of the turn"
        tabIndex={0}
        aria-activedescendant={selected === '' ? undefined : domIdOf(selected)}
        onKeyDown={(event: KeyboardEvent<HTMLDivElement>) => {
          if (!TIMELINE_KEYS.has(event.key)) return;
          event.preventDefault();
          onKey(event.key as TimelineKey);
        }}
        className={cn(
          'group/steps min-h-0 flex-1 overflow-x-hidden overflow-y-auto px-2 outline-none',
          live && !following ? 'pb-14' : 'pb-2.5',
        )}
      >
        {rows.map(row => {
          const isSelected = row.id === selected;
          const base = cn(
            'ease-quick fade-in-quick flex w-full cursor-pointer items-center gap-2 rounded-lg text-left',
            isSelected
              ? 'bg-brand-soft shadow-mark-start group-focus-visible/steps:outline-2 group-focus-visible/steps:-outline-offset-2 group-focus-visible/steps:outline-brand'
              : 'hover:bg-tint',
          );
          // A row pressed is selected, with focus on the list.
          const press = {
            id: domIdOf(row.id),
            tabIndex: -1,
            onMouseDown: (event: {preventDefault: () => void}) => event.preventDefault(),
            onClick: () => {
              onSelect(row.id);
              list.current?.focus({preventScroll: true});
            },
          };
          const count = problems.get(row.id) ?? 0;
          const lane = lanes.byRow.get(row.id);
          const end = (
            <>
              <span className="w-12 shrink-0 text-right text-xs font-normal whitespace-nowrap text-muted-foreground">
                {lane?.kind === 'bar' ? formatDurationCompact(lane.end - lane.start) : ''}
              </span>
              <LaneMark
                lane={lane}
                total={lanes.total}
                tone={isSelected ? 'brand' : count > 0 ? 'problem' : 'muted'}
              />
            </>
          );
          if (row.row === 'delivery' || row.housekeeping === true) {
            return (
              <button
                key={row.id}
                type="button"
                role="option"
                aria-selected={isSelected}
                {...press}
                className={cn(
                  base,
                  'h-7 px-2 text-xs',
                  isSelected ? 'font-semibold' : 'text-muted-foreground',
                )}
              >
                <span className="w-13 shrink-0 text-right">
                  {row.offsetMs === undefined ? '' : formatOffsetCompact(row.offsetMs)}
                </span>
                <Icon
                  kind={row.row === 'delivery' ? 'delivery' : 'tool'}
                  size={14}
                  className={following && isSelected ? 'text-brand' : 'text-muted-foreground'}
                />
                <span className="min-w-0 truncate">
                  {row.row === 'delivery' ? deliveryLabel(row) : row.label}
                </span>
                <span className="min-w-0 flex-1 truncate">
                  {row.row === 'delivery' ? '' : row.target}
                </span>
                {row.row === 'step' && <ProblemMark count={count} size={12} />}
                {end}
              </button>
            );
          }
          return (
            <button
              key={row.id}
              type="button"
              role="option"
              aria-selected={isSelected}
              {...press}
              className={cn(base, 'h-8 pr-2', row.grouped ? 'pl-6' : 'pl-2')}
            >
              <span
                className={cn(
                  'shrink-0 text-right text-xs text-muted-foreground',
                  row.grouped ? 'w-9' : 'w-13',
                )}
              >
                {row.offsetMs === undefined ? '' : formatOffsetCompact(row.offsetMs)}
              </span>
              {row.row === 'step' && row.brand !== undefined ? (
                <Icon kind={row.icon} size={14} {...brandIconOf(row.brand)} />
              ) : (
                <Icon
                  kind={row.icon}
                  size={14}
                  className={following && isSelected ? 'text-brand' : toneOf(row.icon)}
                />
              )}
              {/* At the timeline's narrowest, the name truncates before the problem mark is hidden. */}
              <span
                className={cn('min-w-0 truncate', isSelected ? 'font-semibold' : 'font-medium')}
              >
                {row.label}
              </span>
              <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground">
                {row.target}
              </span>
              {tags?.get(row.id) !== undefined && (
                <span className="shrink-0 rounded-sm bg-tint px-1 text-[11px] leading-4 whitespace-nowrap text-muted-foreground">
                  {tags.get(row.id)}
                </span>
              )}
              <ProblemMark count={count} size={12} />
              {end}
            </button>
          );
        })}
      </div>
      {live && !following && (
        <div className="fade-in-quick pointer-events-none absolute inset-x-0 bottom-3 flex justify-center">
          <button
            type="button"
            onClick={onJump}
            className="ease-quick pointer-events-auto inline-flex h-8 cursor-pointer items-center gap-1.5 rounded-full bg-foreground pr-3 pl-2.5 text-xs font-semibold text-panel shadow-float"
          >
            <Icon kind="jump" size={14} />
            Jump to latest
          </button>
        </div>
      )}
    </section>
  );
}

/**
 * A row's lane: a narrow track with a call's bar from its start to its end,
 * lighter until a streamed model call's first token and darker after, or a
 * step's or a delivery's dot at its moment. Grey at rest, teal on the
 * selected or followed row, red for a row with a problem.
 */
function LaneMark({
  lane,
  total,
  tone,
}: {
  lane: Lane | undefined;
  total: number;
  tone: 'brand' | 'problem' | 'muted';
}) {
  const colour =
    tone === 'brand'
      ? 'var(--brand)'
      : tone === 'problem'
        ? 'var(--problem)'
        : 'var(--muted-foreground)';
  const at = (ms: number) => `${shareOf(ms, total).toFixed(2)}%`;
  const width = (from: number, to: number) => `max(4px, ${shareOf(to - from, total).toFixed(2)}%)`;
  return (
    <span aria-hidden="true" className="relative h-3 w-12 shrink-0">
      <span className="absolute inset-x-0 top-1/2 h-0.5 -translate-y-1/2 rounded-full bg-border" />
      {lane?.kind === 'bar' && (
        <>
          <span
            className="absolute top-0.5 h-2 rounded-xs"
            style={{
              left: at(lane.start),
              width: width(lane.start, lane.end),
              background: `color-mix(in srgb, ${colour} 32%, transparent)`,
            }}
          />
          {!lane.waitsForToken && (
            <span
              className="absolute top-0.5 h-2 rounded-xs"
              style={{
                left: at(lane.firstToken ?? lane.start),
                width: width(lane.firstToken ?? lane.start, lane.end),
                background: colour,
              }}
            />
          )}
        </>
      )}
      {lane?.kind === 'dot' && (
        <span
          className="absolute top-1/2 size-1.5 -translate-x-1/2 -translate-y-1/2 rounded-full"
          style={{left: at(lane.at), background: colour}}
        />
      )}
    </span>
  );
}

const TIMELINE_KEYS: ReadonlySet<string> = new Set<TimelineKey>([
  'ArrowUp',
  'ArrowDown',
  'Home',
  'End',
]);

/** The element id of a row of the timeline. */
function domIdOf(rowId: string): string {
  return `step-${rowId}`;
}
