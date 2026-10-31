/**
 * "From the agent's spans": what the receiver placed for a call, under its
 * other sections. One source line per source and scope of the call's chain;
 * every span above the call, root first, then the call's own chain marked
 * "this call", each with its duration and folding open to its attributes as
 * received; the translated names, each once, the innermost span's value
 * winning; the chain's span events in time order, a received log record
 * marked; and each span of the chain as received.
 */
import {type ReactNode, useState} from 'react';

import {cn} from '@/lib/utils';
import {ancestorsOf, type CallRow, sourceLinesOf} from '@/model/call_rows.ts';
import {isTurnEvent, type SpanEvent, type TurnRecordEvent, unixMillis} from '@/model/record.ts';
import {plural} from '@/model/steps.ts';

import {Pairs, Section} from './CallParts.tsx';
import {formatDuration, formatOffset} from './format.ts';
import {Icon} from './icons.tsx';
import {BlockLabel, JsonBlock, JsonLines} from './JsonBlock.tsx';

/** The names the receiver writes about a span itself, which are not translated names. */
const SPAN_NAMES = new Set([
  'a2ui.event.kind',
  'otel.scope.name',
  'otel.scope.version',
  'a2ui.received.dialect',
  'a2ui.received.attributes',
]);

/** The prefix of the names a log record attached to its span carries. */
const LOG_PREFIX = 'a2ui.received.log.';

/** A value longer than this shows its start until it is opened. */
const LONG_VALUE = 160;

function attributesOf(event: TurnRecordEvent): Record<string, unknown> {
  return event.attributes as Record<string, unknown>;
}

function keyOf(event: TurnRecordEvent): string {
  return `${event.traceId}:${event.spanId}`;
}

/** A span's duration, as a row says it; none for a span with no end. */
function durationOf(event: TurnRecordEvent): string {
  if (event.endTimeUnixNano === undefined) return '';
  return formatDuration(unixMillis(event.endTimeUnixNano) - unixMillis(event.startTimeUnixNano));
}

export function AgentSpans({
  row,
  events,
  startMs,
}: {
  row: CallRow;
  events: readonly TurnRecordEvent[];
  startMs: number;
}) {
  const chain = row.spans;
  const own = new Set(chain.map(keyOf));
  // Every ancestor of the chain's spans within the turn, root first, the turn event not listed.
  const above = new Map<string, {event: TurnRecordEvent; depth: number}>();
  for (const span of chain) {
    const ancestors = ancestorsOf(span, events);
    ancestors.forEach((event, index) => {
      if (own.has(keyOf(event)) || isTurnEvent(event)) return;
      const depth = ancestors.length - index;
      const known = above.get(keyOf(event));
      if (known === undefined || known.depth < depth) above.set(keyOf(event), {event, depth});
    });
  }
  const ancestors = [...above.values()].sort((a, b) => a.depth - b.depth).map(({event}) => event);
  const sources = sourceLinesOf(row);
  const translated = new Map<string, unknown>();
  for (const span of [...chain].reverse()) {
    for (const [name, value] of Object.entries(attributesOf(span))) {
      if (!SPAN_NAMES.has(name) && !translated.has(name)) translated.set(name, value);
    }
  }
  const spanEvents = chain
    .flatMap(span => span.events ?? [])
    .sort((a, b) => {
      const x = BigInt(a.timeUnixNano);
      const y = BigInt(b.timeUnixNano);
      return x === y ? 0 : x < y ? -1 : 1;
    });
  return (
    <section aria-label="From the agent’s spans" className="flex min-w-0 flex-col gap-2.5">
      <Section label="From the agent’s spans" open>
        <div className="flex flex-col gap-0.5">
          {sources.map(line => (
            <p key={line}>{line}</p>
          ))}
        </div>
        <FoldRows
          label="Above this call"
          rows={[
            ...ancestors.map((event, index) => spanRow(event, index, false)),
            ...chain.map((event, index) => spanRow(event, ancestors.length + index, true)),
          ]}
        />
        <Pairs
          label="Translated"
          layout="names"
          pairs={[...translated].map(([key, value]) => ({key, value: <NameValue value={value} />}))}
        />
        {spanEvents.length > 0 && (
          <FoldRows
            label="Events"
            mono
            rows={spanEvents.map((event, index) => eventRow(event, index, startMs))}
          />
        )}
        {chain.map(span => {
          const received = attributesOf(span)['a2ui.received.attributes'];
          const count =
            typeof received === 'object' && received !== null ? Object.keys(received).length : 0;
          return (
            <JsonBlock
              key={keyOf(span)}
              label="As received"
              meta={`${span.name} · ${plural(count, 'attribute')}`}
              value={received ?? {}}
              folded={['']}
            />
          );
        })}
      </Section>
    </section>
  );
}

/** A span of the chain above the call, or of the call's own chain, as a row that folds open to its attributes. */
function spanRow(event: TurnRecordEvent, index: number, ownChain: boolean): FoldRow {
  const failed = event.status?.code === 2;
  const duration = durationOf(event);
  return {
    key: keyOf(event),
    name: event.name,
    ...(ownChain && {meta: 'this call'}),
    end: failed ? [duration, 'status error'].filter(Boolean).join(' · ') : duration,
    indent: index,
    value: attributesOf(event)['a2ui.received.attributes'] ?? {},
  };
}

/** A span event as a row: its time since the turn's start, its name, and "log record" for a received log. */
function eventRow(event: SpanEvent, index: number, startMs: number): FoldRow {
  const attributes = event.attributes ?? {};
  const log = Object.keys(attributes).some(name => name.startsWith(LOG_PREFIX));
  return {
    key: `${index}`,
    time: formatOffset(unixMillis(event.timeUnixNano) - startMs),
    name: event.name === '' ? 'event' : event.name,
    ...(log && {meta: 'log record'}),
    value: attributes,
  };
}

interface FoldRow {
  key: string;
  time?: string;
  name: string;
  meta?: string;
  end?: string;
  /** How deep it sits, for the chain above a call. */
  indent?: number;
  value: unknown;
}

/** A labelled list of rows on a tinted block, each folding open to its JSON. */
function FoldRows({label, rows, mono = false}: {label: string; rows: FoldRow[]; mono?: boolean}) {
  const [open, setOpen] = useState<ReadonlySet<string>>(() => new Set());
  if (rows.length === 0) return null;
  return (
    <section className="flex min-w-0 flex-col gap-1.5">
      <BlockLabel label={label} />
      <div className="flex flex-col rounded-lg bg-tint py-1 text-xs">
        {rows.map(row => {
          const unfolded = open.has(row.key);
          return (
            <div key={row.key} className="flex flex-col">
              <div
                className={cn('flex min-w-0 items-center gap-2 pr-3', mono ? 'h-7' : 'h-8')}
                style={{paddingLeft: 10 + (row.indent ?? 0) * 16}}
              >
                <button
                  type="button"
                  aria-expanded={unfolded}
                  aria-label={`${unfolded ? 'Fold' : 'Unfold'} ${row.name}`}
                  onClick={() => {
                    const next = new Set(open);
                    if (!next.delete(row.key)) next.add(row.key);
                    setOpen(next);
                  }}
                  className="flex size-4 shrink-0 cursor-pointer items-center justify-center rounded text-muted-foreground hover:bg-border hover:text-foreground"
                >
                  <Icon kind={unfolded ? 'chevronDown' : 'chevronRight'} size={11} />
                </button>
                {row.time !== undefined && (
                  <span className="w-12 shrink-0 text-right text-muted-foreground">{row.time}</span>
                )}
                <span
                  className={cn(
                    'min-w-0 shrink truncate font-medium',
                    mono ? 'font-mono' : 'text-sm',
                  )}
                >
                  {row.name}
                </span>
                <span className="min-w-0 flex-1 truncate text-muted-foreground">
                  {row.meta ?? ''}
                </span>
                {row.end !== undefined && row.end !== '' && (
                  <span className="shrink-0 text-muted-foreground">{row.end}</span>
                )}
              </div>
              {unfolded && (
                <div className="px-2.5 pb-2">
                  <JsonLines value={row.value} className="bg-panel" />
                </div>
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
}

/** A translated name's value: text as it is, anything else as JSON, a long one shown in full once opened. */
function NameValue({value}: {value: unknown}): ReactNode {
  const [whole, setWhole] = useState(false);
  const text = typeof value === 'string' ? value : JSON.stringify(value);
  if (text.length <= LONG_VALUE) return text;
  return (
    <>
      {whole ? text : `${text.slice(0, LONG_VALUE)}…`}{' '}
      <button
        type="button"
        onClick={() => setWhole(!whole)}
        className="cursor-pointer font-sans font-medium text-brand hover:underline"
      >
        {whole ? 'Show less' : 'Show all'}
      </button>
    </>
  );
}
