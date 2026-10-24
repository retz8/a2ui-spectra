import {CheckIcon, MinusIcon, TriangleAlertIcon} from 'lucide-react';

import type {ListedTurn} from '@/api.ts';
import {cn} from '@/lib/utils.ts';

import {formatStart, inputBriefText, OUTCOME_LABELS, OUTCOME_TONES, shortId} from './format.ts';

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
  return (
    <div className="flex h-full flex-col">
      <div className="flex h-11 shrink-0 items-center justify-between border-b px-3">
        <h2 className="text-sm font-semibold">Turns</h2>
        {loaded && <span className="text-xs text-muted-foreground">{turns.length}</span>}
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto">
        {loaded && turns.length === 0 && (
          <p className="p-3 text-sm text-muted-foreground">
            No turns yet. Send a message from the box, or point a host at the wire proxy.
          </p>
        )}
        <ol>
          {turns.map(turn => (
            <li key={turn.traceId}>
              <TurnRow turn={turn} selected={turn.traceId === selected} onSelect={onSelect} />
            </li>
          ))}
        </ol>
      </div>
    </div>
  );
}

function TurnRow({
  turn,
  selected,
  onSelect,
}: {
  turn: ListedTurn;
  selected: boolean;
  onSelect: (traceId: string) => void;
}) {
  const outcome = turn.open ? 'open' : turn.outcome;
  return (
    <button
      type="button"
      onClick={() => onSelect(turn.traceId)}
      aria-current={selected}
      className={cn(
        'flex w-full flex-col gap-0.5 border-b px-3 py-2 text-left hover:bg-accent/60',
        selected && 'bg-accent',
      )}
    >
      <span className="flex items-center gap-2 text-xs">
        <span className="tabular-nums text-muted-foreground">{formatStart(turn.startTime)}</span>
        {outcome !== undefined && (
          <span className={cn('font-medium', OUTCOME_TONES[outcome])}>
            {outcome === 'open' ? 'open' : OUTCOME_LABELS[outcome]}
          </span>
        )}
        <span className="ml-auto flex items-center gap-2">
          <SchemaCheckMark check={turn.schemaCheck} open={turn.open === true} />
          {turn.conversationId !== undefined && (
            <span className="font-mono text-muted-foreground" title={turn.conversationId}>
              {shortId(turn.conversationId)}
            </span>
          )}
        </span>
      </span>
      <span className={cn('truncate text-sm', turn.input === undefined && 'text-muted-foreground')}>
        {turn.input === undefined ? '…' : inputBriefText(turn.input)}
      </span>
    </button>
  );
}

function SchemaCheckMark({check, open}: {check: ListedTurn['schemaCheck']; open: boolean}) {
  if (open) return null;
  if (check === undefined) {
    return (
      <span title="No schema check" className="text-muted-foreground">
        <MinusIcon className="size-3.5" />
      </span>
    );
  }
  if (check.passed) {
    return (
      <span title="Schema check passed" className="text-emerald-700 dark:text-emerald-400">
        <CheckIcon className="size-3.5" />
      </span>
    );
  }
  return (
    <span
      title={`Schema check: ${check.findings} ${check.findings === 1 ? 'finding' : 'findings'}`}
      className="flex items-center gap-0.5 text-destructive"
    >
      <TriangleAlertIcon className="size-3.5" />
      {check.findings}
    </span>
  );
}
