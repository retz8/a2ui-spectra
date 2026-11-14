import {Tooltip} from 'radix-ui';
import type {ReactNode} from 'react';

import {cn} from '@/lib/utils';
import {type CheckLine, type CheckState, checkLabelOf} from '@/model/check_state.ts';

import {CopyButton} from './CopyButton.tsx';
import {STATUS_ICONS, STATUS_LABELS, type TurnStatus, shortId, toneOf} from './format.ts';
import {Icon} from './icons.tsx';

/**
 * The turn's header: its input as the title, the outcome and the check state
 * beside it, the problem count pressed to keep only the steps with problems,
 * one quiet line of the start, the duration, the A2UI version, the agent
 * and the short ids, and, for a turn with model calls, a second quiet line
 * of their times, tokens, cache use and estimated cost. Save as fixture and
 * Replay sit on the right of the first line; in the fixture view, the fixture
 * line sits above it; on a replayed turn, a third quiet line says where from.
 */
export function TurnHeader({
  title,
  status,
  check,
  checks,
  filtered,
  onFilter,
  meta,
  traceId,
  conversationId,
  inside,
  fixtureLine,
  actions,
  replayLine,
}: {
  title: string;
  status: TurnStatus;
  /** None while the turn is open: its checks run when it closes. */
  check: CheckState | undefined;
  checks: readonly CheckLine[];
  /** Whether the timeline keeps only the steps with problems. */
  filtered: boolean;
  onFilter: () => void;
  meta: readonly string[];
  traceId: string;
  conversationId: string | undefined;
  /** The second line's parts, for a turn with model calls. */
  inside?: readonly string[];
  /** The line above the title, in the fixture view. */
  fixtureLine?: ReactNode;
  /** The header's action area. */
  actions?: ReactNode;
  /** The third line, on a replayed turn. */
  replayLine?: ReactNode;
}) {
  return (
    <header className="flex shrink-0 flex-col gap-1.5 border-b px-4 pt-3.5 pb-3">
      {fixtureLine}
      <div className="flex min-w-0 items-center gap-3">
        <h1 className="min-w-0 truncate text-lg leading-tight font-semibold">{title}</h1>
        <OutcomeBadge status={status} />
        {check !== undefined && (
          <CheckChip check={check} checks={checks} filtered={filtered} onFilter={onFilter} />
        )}
        {actions !== undefined && (
          <div className="ml-auto flex shrink-0 items-center gap-2">{actions}</div>
        )}
      </div>
      <div className="flex min-w-0 items-center gap-1.5 overflow-hidden text-xs whitespace-nowrap text-muted-foreground">
        {meta.map((part, index) => (
          <span key={index} className="contents">
            {index > 0 && <span>·</span>}
            <span>{part}</span>
          </span>
        ))}
        <span>·</span>
        <ShortId label="Trace" id={traceId} />
        {conversationId !== undefined && (
          <>
            <span>·</span>
            <ShortId label="Conversation" id={conversationId} />
          </>
        )}
      </div>
      {inside !== undefined && (
        <div
          aria-label="Inside the turn"
          className="min-w-0 truncate text-xs whitespace-nowrap text-muted-foreground"
          title={inside.join(' · ')}
        >
          {inside.join(' · ')}
        </div>
      )}
      {replayLine}
    </header>
  );
}

function ShortId({label, id}: {label: string; id: string}) {
  return (
    <span className="inline-flex items-center gap-1" title={id}>
      {label} {shortId(id)}
      <CopyButton text={id} label={`Copy the ${label.toLowerCase()} id`} className="size-5" />
    </span>
  );
}

export function OutcomeBadge({status}: {status: TurnStatus}) {
  const icon = STATUS_ICONS[status];
  return (
    <span
      className={cn(
        'inline-flex h-6 shrink-0 items-center gap-1.5 rounded-full bg-tint pr-2.5 pl-2 text-xs font-medium',
        status === 'failed'
          ? 'text-problem'
          : status === 'completed'
            ? 'text-success'
            : 'text-foreground',
      )}
    >
      <Icon
        kind={icon}
        size={14}
        className={status === 'completed' ? 'text-success' : toneOf(icon)}
      />
      {STATUS_LABELS[status]}
    </span>
  );
}

/**
 * The problem count, pressed to keep only the steps with problems, or that
 * there are none, none but a surface a check could not judge, or no checks
 * ran, with "legacy form" chained after "No problems" when components came
 * in it, and the checks that ran in its tooltip, wider while a row carries
 * the legacy form's remark.
 */
function CheckChip({
  check,
  checks,
  filtered,
  onFilter,
}: {
  check: CheckState;
  checks: readonly CheckLine[];
  filtered: boolean;
  onFilter: () => void;
}) {
  const problems = check.state === 'problems';
  const label = checkLabelOf(check);
  const remarked = checks.some(line => line.result.some(run => run.muted === true));
  return (
    <Tooltip.Provider delayDuration={200}>
      <Tooltip.Root>
        <Tooltip.Trigger asChild>
          <button
            type="button"
            {...(problems && {
              'aria-pressed': filtered,
              'aria-label': `${label}: show only the steps with problems`,
              onClick: onFilter,
            })}
            className={cn(
              'ease-quick inline-flex h-6 shrink-0 items-center gap-1.5 rounded-full border pr-2.5 pl-2 text-xs',
              problems
                ? 'cursor-pointer font-semibold text-problem'
                : 'cursor-default font-medium text-muted-strong',
              problems && filtered && 'border-problem bg-problem-soft',
            )}
          >
            <Icon
              kind={
                check.state === 'problems'
                  ? 'failed'
                  : check.state === 'clean' || check.state === 'partial'
                    ? 'checked'
                    : 'unchecked'
              }
              size={14}
            />
            {label}
          </button>
        </Tooltip.Trigger>
        <Tooltip.Portal>
          <Tooltip.Content
            side="bottom"
            align="start"
            sideOffset={6}
            className={cn(
              'fade-in-quick z-50 flex flex-col gap-1.5 rounded-xl bg-panel px-3 py-2.5 text-xs text-foreground shadow-float',
              remarked ? 'w-110' : 'w-80',
            )}
          >
            <span className="section-label">Checks</span>
            {checks.map((line, index) => (
              <div key={index} className="flex flex-col gap-px">
                <div className="flex items-baseline gap-2">
                  <span className="shrink-0 font-medium">{line.name}</span>
                  <span className="shrink-0 text-muted-foreground">{line.version}</span>
                  <span className="flex-1" />
                  <span className="text-right text-muted-strong">
                    {line.result.map((run, runIndex) =>
                      run.mono ? (
                        <code key={runIndex} className="font-mono">
                          {run.text}
                        </code>
                      ) : (
                        <span
                          key={runIndex}
                          className={run.muted === true ? 'text-muted-foreground' : undefined}
                        >
                          {run.text}
                        </span>
                      ),
                    )}
                  </span>
                </div>
                {line.notes.map(note => (
                  <span key={note} className="text-right font-mono break-all text-muted-foreground">
                    {note}
                  </span>
                ))}
              </div>
            ))}
          </Tooltip.Content>
        </Tooltip.Portal>
      </Tooltip.Root>
    </Tooltip.Provider>
  );
}
