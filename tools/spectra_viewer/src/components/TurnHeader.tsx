import {Tooltip} from 'radix-ui';

import {cn} from '@/lib/utils';
import type {CheckLine, CheckState} from '@/model/check_state.ts';
import {plural} from '@/model/steps.ts';

import {CopyButton} from './CopyButton.tsx';
import {STATUS_ICONS, STATUS_LABELS, type TurnStatus, shortId, toneOf} from './format.ts';
import {Icon} from './icons.tsx';

/**
 * The turn's header: its input as the title, the outcome and the check state
 * beside it, the problem count pressed to keep only the steps with problems,
 * one quiet line of the start, the duration, the A2UI version, the agent
 * and the short ids, and, for a turn with model calls, a second quiet line
 * of their times, tokens, cache use and estimated cost.
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
}) {
  return (
    <header className="flex shrink-0 flex-col gap-1.5 border-b px-[18px] pt-3.5 pb-3">
      <div className="flex min-w-0 items-center gap-3">
        <h1 className="min-w-0 truncate text-lg leading-[1.3] font-semibold">{title}</h1>
        <OutcomeBadge status={status} />
        {check !== undefined && (
          <CheckChip check={check} checks={checks} filtered={filtered} onFilter={onFilter} />
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
        'inline-flex h-6 shrink-0 items-center gap-1.5 rounded-full bg-tint pr-2.5 pl-[7px] text-xs font-medium',
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
 * ran, with the checks that ran in its tooltip.
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
  const label =
    check.state === 'problems'
      ? plural(check.count, 'problem')
      : check.state === 'clean'
        ? 'No problems'
        : check.state === 'partial'
          ? 'No problems · not fully checked'
          : `Not checked · ${check.reason}`;
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
            className="fade-in-quick z-50 flex w-80 flex-col gap-1.5 rounded-[10px] bg-panel px-3 py-2.5 text-xs text-foreground shadow-float"
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
                        <span key={runIndex}>{run.text}</span>
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
