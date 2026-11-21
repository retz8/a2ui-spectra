import {Tooltip} from 'radix-ui';
import {Fragment, type ReactNode} from 'react';

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
        <h1 className="type-view-title min-w-0 truncate">{title}</h1>
        <OutcomeBadge status={status} />
        {check !== undefined && (
          <CheckChip check={check} checks={checks} filtered={filtered} onFilter={onFilter} />
        )}
        {actions !== undefined && (
          <div className="ml-auto flex shrink-0 items-center gap-2">{actions}</div>
        )}
      </div>
      <div className="type-meta min-w-0 truncate leading-5 whitespace-nowrap">
        {[...meta, ''].join(' · ')}
        <ShortId label="Trace" id={traceId} />
        {conversationId !== undefined && (
          <>
            {' · '}
            <ShortId label="Conversation" id={conversationId} />
          </>
        )}
      </div>
      {inside !== undefined && (
        <div
          aria-label="Inside the turn"
          className="type-meta min-w-0 truncate whitespace-nowrap"
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
    <span title={id}>
      {label} {shortId(id)}
      <CopyButton
        text={id}
        label={`Copy the ${label.toLowerCase()} id`}
        className="-my-1 ml-0.5 align-middle"
      />
    </span>
  );
}

export function OutcomeBadge({status}: {status: TurnStatus}) {
  const icon = STATUS_ICONS[status];
  return (
    <span
      className={cn(
        'inline-flex h-6 shrink-0 items-center gap-1.5 rounded-full bg-tint pr-2.5 pl-2',
        status === 'failed'
          ? 'type-mark-problem'
          : status === 'completed'
            ? 'type-mark-success'
            : 'type-mark',
      )}
    >
      <Icon
        kind={icon}
        size={14}
        className={cn('shrink-0', status === 'completed' ? 'tone-success' : toneOf(icon))}
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
              'ease-quick inline-flex h-6 shrink-0 items-center gap-1.5 rounded-full border',
              problems
                ? 'type-mark-problem cursor-pointer pr-2.5 pl-2'
                : 'type-mark-muted cursor-default px-2.5',
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
              'fade-in-quick z-50 flex flex-col gap-1.5 rounded-lg bg-panel px-2.5 py-2 shadow-float',
              remarked ? 'w-110' : 'w-100',
            )}
          >
            <span className="type-section-label">Checks</span>
            <div className="grid grid-cols-pairs gap-x-3 gap-y-0.5">
              {checks.map((line, index) => (
                <Fragment key={index}>
                  <span className="type-meta leading-5">
                    {line.version === '' ? line.name : `${line.name} · ${line.version}`}
                  </span>
                  <span className="flex min-w-0 flex-col">
                    <span className="type-value leading-5 wrap-anywhere">
                      {line.result.map((run, runIndex) =>
                        run.mono ? (
                          <code key={runIndex} className="type-code-inline">
                            {run.text}
                          </code>
                        ) : run.muted === true ? (
                          <span key={runIndex} className="type-meta">
                            {run.text}
                          </span>
                        ) : (
                          <Fragment key={runIndex}>{run.text}</Fragment>
                        ),
                      )}
                    </span>
                    {line.notes.map(note => (
                      <span key={note} className="type-meta leading-5 break-all">
                        <code className="type-code-inline">{note}</code>
                      </span>
                    ))}
                  </span>
                </Fragment>
              ))}
            </div>
          </Tooltip.Content>
        </Tooltip.Portal>
      </Tooltip.Root>
    </Tooltip.Provider>
  );
}
