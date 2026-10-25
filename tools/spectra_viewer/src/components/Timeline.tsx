import {useEffect, useRef} from 'react';

import {cn} from '@/lib/utils';
import {deliveryLabel, type TimelineRow} from '@/model/steps.ts';

import {formatOffset, toneOf} from './format.ts';
import {Icon} from './icons.tsx';
import {ProblemMark} from './TurnList.tsx';

/**
 * The turn's steps in the order they came, each delivery with several grouped
 * under its row. While the turn is open, the newest step is marked as
 * followed, and a picked step offers Jump to latest. Narrowed to the steps
 * with problems, it counts them out of all the turn's steps and offers Show all.
 */
export function Timeline({
  rows,
  selected,
  problems,
  live,
  following,
  filter,
  onSelect,
  onJump,
}: {
  /** The rows shown: every row, or those the filter keeps. */
  rows: readonly TimelineRow[];
  selected: string;
  /** How many problems each step has, by its id. */
  problems: ReadonlyMap<string, number>;
  /** Whether the turn is open. */
  live: boolean;
  /** Whether the view follows the newest step. */
  following: boolean;
  /** While only the steps with problems are shown: how many steps the turn has, and turning it off. */
  filter?: {steps: number; onShowAll: () => void};
  onSelect: (id: string) => void;
  /** Lets go of the picked step, to follow the newest again. */
  onJump: () => void;
}) {
  const steps = rows.filter(row => row.row === 'step').length;
  const list = useRef<HTMLDivElement>(null);
  useEffect(() => {
    // The step in view is scrolled to as following or landing moves it; a step clicked is in view already.
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    list.current
      ?.querySelector('[aria-selected="true"]')
      ?.scrollIntoView({block: 'nearest', behavior: reduce ? 'auto' : 'smooth'});
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
          <span className="inline-flex items-center gap-[5px] text-xs font-semibold text-brand">
            <Icon kind="dot" size={8} />
            Live
          </span>
        )}
      </div>
      <div
        ref={list}
        role="listbox"
        aria-label="Steps of the turn"
        className={cn(
          'min-h-0 flex-1 overflow-y-auto px-2',
          live && !following ? 'pb-14' : 'pb-2.5',
        )}
      >
        {rows.map(row => {
          const isSelected = row.id === selected;
          const base = cn(
            'ease-quick fade-in-quick flex w-full cursor-pointer items-center gap-2 rounded-lg text-left',
            isSelected ? 'bg-brand-soft shadow-[inset_2px_0_0_var(--brand)]' : 'hover:bg-tint',
          );
          if (row.row === 'delivery') {
            return (
              <button
                key={row.id}
                type="button"
                role="option"
                aria-selected={isSelected}
                onClick={() => onSelect(row.id)}
                className={cn(
                  base,
                  'h-7 px-2 text-xs',
                  isSelected ? 'font-semibold' : 'text-muted-foreground',
                )}
              >
                <span className="w-[52px] shrink-0 text-right">{formatOffset(row.offsetMs)}</span>
                <Icon kind="delivery" size={14} className="text-muted-foreground" />
                <span className="truncate">{deliveryLabel(row)}</span>
              </button>
            );
          }
          const count = problems.get(row.id) ?? 0;
          return (
            <button
              key={row.id}
              type="button"
              role="option"
              aria-selected={isSelected}
              onClick={() => onSelect(row.id)}
              className={cn(base, 'h-8 pr-2', row.grouped ? 'pl-[22px]' : 'pl-2')}
            >
              <span
                className={cn(
                  'shrink-0 text-right text-xs text-muted-foreground',
                  row.grouped ? 'w-[38px]' : 'w-[52px]',
                )}
              >
                {row.offsetMs === undefined ? '' : formatOffset(row.offsetMs)}
              </span>
              <Icon
                kind={row.icon}
                size={14}
                className={following && isSelected ? 'text-brand' : toneOf(row.icon)}
              />
              <span className={cn('shrink-0', isSelected ? 'font-semibold' : 'font-medium')}>
                {row.label}
              </span>
              <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground">
                {row.target}
              </span>
              <ProblemMark count={count} size={13} />
            </button>
          );
        })}
      </div>
      {live && !following && (
        <div className="fade-in-quick pointer-events-none absolute inset-x-0 bottom-3 flex justify-center">
          <button
            type="button"
            onClick={onJump}
            className="ease-quick pointer-events-auto inline-flex h-[30px] cursor-pointer items-center gap-1.5 rounded-full bg-foreground pr-3 pl-2.5 text-xs font-semibold text-panel shadow-float"
          >
            <Icon kind="jump" size={14} />
            Jump to latest
          </button>
        </div>
      )}
    </section>
  );
}
