import {cn} from '@/lib/utils';
import {deliveryLabel, type TimelineRow} from '@/model/steps.ts';

import {formatOffset, toneOf} from './format.ts';
import {Icon} from './icons.tsx';
import {ProblemMark} from './TurnList.tsx';

/** The turn's steps in the order they came, each delivery with several grouped under its row. */
export function Timeline({
  rows,
  selected,
  problems,
  onSelect,
}: {
  rows: readonly TimelineRow[];
  selected: string;
  /** How many problems each step has, by its id. */
  problems: ReadonlyMap<string, number>;
  onSelect: (id: string) => void;
}) {
  const steps = rows.filter(row => row.row === 'step').length;
  return (
    <section aria-label="Steps" className="flex h-full min-h-0 flex-col">
      <div className="flex h-10 shrink-0 items-center gap-2 pr-3 pl-4">
        <span className="section-label">Steps</span>
        <span className="text-xs text-muted-foreground">{steps}</span>
      </div>
      <div
        role="listbox"
        aria-label="Steps of the turn"
        className="min-h-0 flex-1 overflow-y-auto px-2 pb-2.5"
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
              <Icon kind={row.icon} size={14} className={toneOf(row.icon)} />
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
    </section>
  );
}
