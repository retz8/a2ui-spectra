import {type KeyboardEvent, type RefObject, useEffect, useMemo, useRef} from 'react';

import type {ListedTurn} from '@/api.ts';
import {cn} from '@/lib/utils';
import {groupTurns, stripOf} from '@/model/turn_groups.ts';

import {STATUS_ICONS, toneOf} from './format.ts';
import {Icon} from './icons.tsx';

/**
 * The turn list on a small window: a strip of each turn's status icon, in
 * the list's order, each selecting its turn, a dot on a turn with problems;
 * its button opens the full list over the turn view, or, on a wide window
 * where the list was collapsed, expands it back in place. The icons are one
 * Tab stop, and the up and down arrows select their turns.
 */
export function Strip({
  turns,
  selected,
  onSelect,
  open,
  onOpen,
  buttonRef,
  expands = false,
}: {
  turns: readonly ListedTurn[];
  selected: string | undefined;
  onSelect: (traceId: string) => void;
  /** Whether the full list is open over the turn view. */
  open: boolean;
  onOpen: () => void;
  buttonRef: RefObject<HTMLButtonElement | null>;
  /** Whether the button expands the list in place rather than opening it over the turn view. */
  expands?: boolean;
}) {
  const strip = useMemo(() => stripOf(groupTurns(turns)), [turns]);
  const list = useRef<HTMLDivElement>(null);
  const index = strip.findIndex(({turn}) => turn.traceId === selected);

  useEffect(() => {
    if (selected !== undefined) {
      document.getElementById(domIdOf(selected))?.scrollIntoView({block: 'nearest'});
    }
  }, [selected]);

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') return;
    event.preventDefault();
    const next =
      strip[Math.max(0, Math.min(strip.length - 1, index + (event.key === 'ArrowUp' ? -1 : 1)))];
    if (next !== undefined && next.turn.traceId !== selected) onSelect(next.turn.traceId);
  };

  return (
    <section
      aria-label="Turns"
      className="flex w-[52px] shrink-0 flex-col items-center gap-1 rounded-xl bg-panel py-2.5 shadow-panel"
    >
      <button
        ref={buttonRef}
        type="button"
        aria-label={expands ? 'Expand the turn list' : 'Open the turn list'}
        title={expands ? 'Expand the turn list' : 'Open the turn list'}
        aria-expanded={open}
        onClick={onOpen}
        className={cn(
          'ease-quick flex h-[30px] w-[34px] shrink-0 cursor-pointer items-center justify-center rounded-lg',
          open ? 'bg-brand-soft text-brand' : 'bg-tint text-foreground hover:bg-border',
        )}
      >
        <Icon kind="turns" size={16} />
      </button>
      <div className="my-1 h-px w-6 shrink-0 bg-border" />
      <div
        ref={list}
        role="listbox"
        aria-label="Turns"
        tabIndex={strip.length > 0 ? 0 : -1}
        aria-activedescendant={index === -1 ? undefined : domIdOf(strip[index].turn.traceId)}
        onKeyDown={onKeyDown}
        className="group/strip flex min-h-0 flex-col items-center gap-1 overflow-y-auto px-[9px] outline-none"
      >
        {strip.map(({turn, problems, title}) => {
          const isSelected = turn.traceId === selected;
          const icon = STATUS_ICONS[turn.open ? 'open' : (turn.outcome ?? 'open')];
          return (
            <button
              key={turn.traceId}
              id={domIdOf(turn.traceId)}
              type="button"
              role="option"
              aria-selected={isSelected}
              aria-label={title}
              title={title}
              tabIndex={-1}
              onMouseDown={event => event.preventDefault()}
              onClick={() => {
                onSelect(turn.traceId);
                list.current?.focus({preventScroll: true});
              }}
              className={cn(
                'ease-quick fade-in-quick relative flex h-7 w-[34px] shrink-0 cursor-pointer items-center justify-center rounded-lg',
                isSelected
                  ? 'bg-brand-soft shadow-[inset_2px_0_0_var(--brand)] group-focus-visible/strip:outline-2 group-focus-visible/strip:-outline-offset-2 group-focus-visible/strip:outline-brand'
                  : 'hover:bg-tint',
              )}
            >
              <Icon kind={icon} size={14} className={toneOf(icon)} />
              {problems > 0 && (
                <span
                  aria-hidden="true"
                  className={cn(
                    'absolute top-[3px] right-[5px] size-1.5 rounded-full bg-problem',
                    isSelected ? 'ring-2 ring-brand-soft' : 'ring-2 ring-panel',
                  )}
                />
              )}
            </button>
          );
        })}
      </div>
    </section>
  );
}

/** The element id of a turn's icon. */
function domIdOf(traceId: string): string {
  return `strip-${traceId}`;
}
