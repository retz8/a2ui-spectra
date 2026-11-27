/**
 * The parts a step's detail is built of: the connections, sections on a
 * rule, keys and values, a text block, a list of rows, the segmented switch,
 * and the HTTP exchange with its chunks.
 */
import {Fragment, type ReactNode, useState} from 'react';

import {cn} from '@/lib/utils';
import {statusLine} from '@/model/model_calls.ts';
import type {CallReplay, RecordedCall} from '@/model/provenance.ts';
import type {ModelCallEvent, OtherEvent, SpanEvent} from '@/model/record.ts';
import {plural} from '@/model/steps.ts';
import {useBlockFold} from '@/state/block_folds.ts';

import {CopyButton} from './CopyButton.tsx';
import {formatDuration, formatOffset} from './format.ts';
import {Icon} from './icons.tsx';
import {BlockLabel, FoldButton, JsonBlock, JsonLines} from './JsonBlock.tsx';

/** A link in the accent, in a detail's line, which selects another step. */
export function DetailLink({onClick, children}: {onClick: () => void; children: ReactNode}) {
  return (
    <button type="button" onClick={onClick} className="type-link cursor-pointer text-left">
      {children}
    </button>
  );
}

/**
 * How a step connects to others: a key and its target, as "Read from" and
 * the call it read; or a sentence across the grid, as the retry's.
 */
export interface Connection {
  key?: string;
  value: ReactNode;
}

/** A step's connections, one quiet pairs grid under its problems. */
export function Connections({rows}: {rows: readonly Connection[]}) {
  if (rows.length === 0) return null;
  return (
    <div
      role="group"
      aria-label="How this step connects to others"
      className="grid shrink-0 grid-cols-facts gap-x-3 gap-y-0.5"
    >
      {rows.map((row, index) =>
        row.key === undefined ? (
          <span key={index} className="type-meta col-span-2 min-w-0 leading-5 wrap-anywhere">
            {row.value}
          </span>
        ) : (
          <Fragment key={index}>
            <span className="type-meta leading-5">{row.key}</span>
            <span className="type-value min-w-0 leading-5 wrap-anywhere">{row.value}</span>
          </Fragment>
        ),
      )}
    </div>
  );
}

/** A sentence that ends with a full stop, as a connection written as one does. */
export function finished(text: string): string {
  return /[.!?]$/.test(text) ? text : `${text}.`;
}

/**
 * A replayed call's connection: served from the record, the recorded call a
 * link; or gone to the model.
 */
export function replayConnection(
  replay: Extract<CallReplay, {kind: 'served' | 'live'}>,
  onRecorded: (recorded: RecordedCall) => void,
): Connection {
  if (replay.kind === 'live') {
    return {value: 'Went to the model · matched nothing in the record.'};
  }
  const {recorded, name} = replay;
  return {
    value:
      recorded === undefined ? (
        `Served from the record · ${name}.`
      ) : (
        <>
          Served from the record ·{' '}
          <DetailLink onClick={() => onRecorded(recorded)}>
            the call at {formatOffset(recorded.offsetMs)}
          </DetailLink>{' '}
          in {name}.
        </>
      ),
  };
}

/**
 * A section of a column with no tabs: a small label on a rule, its facts
 * beside it, folding what follows when it can. A label that does not fold
 * keeps the chevron's place, so every label lines up.
 */
export function Section({
  label,
  meta,
  mark,
  open,
  onToggle,
  children,
}: {
  label: string;
  meta?: string;
  /** A status in red beside the facts, as a span's error. */
  mark?: string;
  open: boolean;
  onToggle?: () => void;
  children: ReactNode;
}) {
  return (
    <>
      <div className="mt-0.5 flex h-9 shrink-0 items-center gap-2 border-t px-0.5">
        {onToggle === undefined ? (
          <span aria-hidden="true" className="size-4 shrink-0" />
        ) : (
          <FoldButton open={open} label={label} onToggle={onToggle} />
        )}
        <span className="type-section-label shrink-0">{label}</span>
        {meta !== undefined && meta !== '' && (
          <span className="type-meta min-w-0 truncate">{meta}</span>
        )}
        {mark !== undefined && <ErrorMark text={mark} />}
      </div>
      {open && children}
    </>
  );
}

/** A status in red with its icon, as a span's error. */
function ErrorMark({text}: {text: string}) {
  return (
    <span className="type-mark-problem inline-flex shrink-0 items-center gap-1">
      <Icon kind="failed" size={12} />
      {text}
    </span>
  );
}

/** A pairs grid's key column: 96px for short keys, 168px for names and headers, 208px for the longest attribute names. */
export type KeyColumn = 'short' | 'names' | 'attributes';

const KEY_COLUMNS: Record<KeyColumn, string> = {
  short: 'grid-cols-facts',
  names: 'grid-cols-pairs',
  attributes: 'grid-cols-pairs-wide',
};

/**
 * Keys and values in two columns, under a label: settings with sans keys;
 * headers, URL parameters, MCP's names and span attributes verbatim, their
 * keys in muted monospace and their values in monospace.
 */
export function Pairs({
  label,
  meta,
  pairs,
  verbatim = false,
  keys = 'names',
  aside,
  after,
}: {
  label: string;
  meta?: string;
  pairs: ReadonlyArray<{key: string; value: ReactNode; removed?: boolean; note?: string}>;
  /** Keys and values shown as a machine wrote them. */
  verbatim?: boolean;
  keys?: KeyColumn;
  /** What sits at the right of the label line, as a switch. */
  aside?: ReactNode;
  /** A quiet line under the grid. */
  after?: string;
}) {
  const fold = useBlockFold(label);
  if (pairs.length === 0 && after === undefined) return null;
  return (
    <div className="flex flex-col gap-1.5">
      <BlockLabel label={label} meta={meta} fold={fold}>
        {aside}
      </BlockLabel>
      {fold.open && (
        <>
          <div className={cn('grid gap-x-3 gap-y-0.5', KEY_COLUMNS[keys])}>
            {pairs.map(({key, value, removed, note}, index) => (
              <Fragment key={index}>
                <span className="flex min-w-0 flex-col">
                  <span
                    className={cn(
                      'leading-5 wrap-anywhere',
                      verbatim ? 'type-code-muted' : 'type-meta',
                    )}
                  >
                    {key}
                  </span>
                  {note !== undefined && <span className="type-meta leading-5">{note}</span>}
                </span>
                <span
                  className={cn(
                    'min-w-0 leading-5 wrap-anywhere',
                    removed ? 'type-meta' : verbatim ? 'type-code' : 'type-value',
                  )}
                >
                  {removed ? 'Removed by Spectra' : value}
                </span>
              </Fragment>
            ))}
          </div>
          {after !== undefined && <span className="type-meta leading-5">{after}</span>}
        </>
      )}
    </div>
  );
}

/** A labelled text on a tinted block, with a copy button. */
export function TextBlock({label, meta, text}: {label: string; meta?: string; text: string}) {
  const fold = useBlockFold(label);
  return (
    <section className="flex min-w-0 flex-col gap-1.5">
      <BlockLabel label={label} meta={meta} fold={fold}>
        <CopyButton text={text} label={`Copy the ${label.toLowerCase()}`}>
          Copy
        </CopyButton>
      </BlockLabel>
      {fold.open && <Prose text={text} />}
    </section>
  );
}

/** Text that is read, on a tinted block. */
export function Prose({text}: {text: string}) {
  return (
    <p className="type-body rounded-lg bg-tint px-3 py-2.5 break-words whitespace-pre-wrap">
      {text}
    </p>
  );
}

/** One row of a list on a tinted block. */
export interface Row {
  key: string;
  /** A time in the row's time column: a chunk's since its call's start, a span event's since the turn's. */
  time?: string;
  name: string;
  /** The name shown as a machine wrote it, as a recorded request's arguments. */
  verbatim?: boolean;
  /** A tag on the panel's colour, as "this call" or "log record". */
  tag?: string;
  /** The facts after the name; a chunk's body in muted monospace. */
  meta?: string;
  metaVerbatim?: boolean;
  /** At the row's end: a span's duration. */
  end?: string;
  /** A status in red after the end, as a span's error. */
  mark?: string;
  /** A link at the row's end. */
  link?: {text: string; onClick: () => void};
  /** How deep it sits, for the chain above a call. */
  indent?: number;
  /** What the row opens to; a row with none does not fold. */
  opened?: ReactNode;
  /** Whether the facts after the name hide while it is open. */
  metaWhileShut?: boolean;
  /** Open at first, as the tool whose definition the prefix breaks in. */
  startsOpen?: boolean;
}

/** A labelled list of rows on a tinted block, 32px each, a row with something under it folding open to it. */
export function RowList({
  label,
  meta,
  rows,
  startsFolded = false,
}: {
  label: string;
  meta?: string;
  rows: readonly Row[];
  startsFolded?: boolean;
}) {
  const [open, setOpen] = useState<ReadonlySet<string>>(
    () => new Set(rows.filter(row => row.startsOpen === true).map(row => row.key)),
  );
  const fold = useBlockFold(label, startsFolded);
  if (rows.length === 0) return null;
  return (
    <section className="flex min-w-0 flex-col gap-1.5">
      <BlockLabel label={label} meta={meta} fold={fold} />
      {fold.open && (
        <div className="flex flex-col rounded-lg bg-tint py-1">
          {rows.map(row => {
            const unfolded = open.has(row.key);
            return (
              <div key={row.key} className="flex flex-col">
                <div
                  className="flex h-8 min-w-0 items-center gap-2 pr-3"
                  style={{paddingLeft: 10 + (row.indent ?? 0) * 16}}
                >
                  <span className="flex w-4 shrink-0 items-center justify-center">
                    {row.opened !== undefined && (
                      <FoldButton
                        open={unfolded}
                        label={row.name}
                        onTint
                        onToggle={() => {
                          const next = new Set(open);
                          if (!next.delete(row.key)) next.add(row.key);
                          setOpen(next);
                        }}
                      />
                    )}
                  </span>
                  {row.time !== undefined && (
                    <span className="type-meta w-19 shrink-0 text-right whitespace-nowrap">
                      {row.time}
                    </span>
                  )}
                  <span
                    className={cn(
                      'max-w-[70%] min-w-0 shrink-0 truncate',
                      row.verbatim === true ? 'type-code' : 'type-name',
                    )}
                  >
                    {row.name}
                  </span>
                  {row.tag !== undefined && (
                    <span className="type-meta inline-flex h-5 shrink-0 items-center rounded-sm bg-panel px-1.5">
                      {row.tag}
                    </span>
                  )}
                  <span
                    className={cn(
                      'min-w-0 flex-1 truncate',
                      row.metaVerbatim === true ? 'type-code-muted' : 'type-meta',
                    )}
                  >
                    {unfolded && row.metaWhileShut === true ? '' : (row.meta ?? '')}
                  </span>
                  {row.end !== undefined && row.end !== '' && (
                    <span className="type-meta shrink-0">{row.end}</span>
                  )}
                  {row.mark !== undefined && <ErrorMark text={row.mark} />}
                  {row.link !== undefined && (
                    <button
                      type="button"
                      onClick={row.link.onClick}
                      className="type-link shrink-0 cursor-pointer text-xs"
                    >
                      {row.link.text}
                    </button>
                  )}
                </div>
                {unfolded && row.opened !== undefined && (
                  <div className="flex flex-col gap-1.5 pr-3 pb-2.5 pl-8.5">{row.opened}</div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}

/** A line as a machine wrote it, under a label, on a tinted block: an HTTP request's or response's line. */
function MonoLine({label, text}: {label: string; text: string}) {
  const fold = useBlockFold(label);
  return (
    <div className="flex flex-col gap-1.5">
      <BlockLabel label={label} fold={fold} />
      {fold.open && (
        <div className="type-code rounded-lg bg-tint px-3 py-2.5 leading-relaxed break-all">
          {text}
        </div>
      )}
    </div>
  );
}

/** The HTTP exchange's facts, as the HTTP tab's line says them: the request, the status, then a model call's chunks or a tool call's reply. */
export function exchangeFactsOf(call: OtherEvent | ModelCallEvent, tool = false): string {
  const attributes = call.attributes as Record<string, unknown>;
  const method = String(attributes['http.request.method'] ?? '');
  const url = typeof attributes['url.full'] === 'string' ? attributes['url.full'] : '';
  const status = statusOf(attributes);
  const chunks = chunksOf(call);
  let host = url;
  try {
    const parsed = new URL(url);
    host = `${parsed.host}${parsed.pathname}`;
  } catch {
    // Not a URL: shown as recorded.
  }
  return [
    `${method} ${host}`,
    ...(typeof status === 'number' ? [String(status)] : []),
    ...(tool
      ? toolTail(attributes, chunks.length)
      : chunks.length > 0
        ? [plural(chunks.length, 'chunk')]
        : []),
  ].join(' · ');
}

/** A miss holds no response attributes; the proxy answered it with its `502` line. */
function statusOf(attributes: Record<string, unknown>): unknown {
  return (
    attributes['http.response.status_code'] ??
    (attributes['error.type'] === 'replay_miss' ? 502 : undefined)
  );
}

function chunksOf(call: OtherEvent | ModelCallEvent): SpanEvent[] {
  return (call.events ?? []).filter(event => event.name === 'a2ui.http.response.chunk');
}

/**
 * The HTTP exchange as recorded: the request and the response, each with its
 * line, its headers and its body or chunks.
 */
export function Exchange({call}: {call: OtherEvent | ModelCallEvent}) {
  const attributes = call.attributes as Record<string, unknown>;
  const method = String(attributes['http.request.method'] ?? '');
  const url = typeof attributes['url.full'] === 'string' ? attributes['url.full'] : '';
  const status = statusOf(attributes);
  const chunks = chunksOf(call);
  let parameters: Array<{key: string; value: string; removed?: boolean}> = [];
  try {
    parameters = [...new URL(url).searchParams].map(([key, value]) => ({
      key,
      value,
      removed: value === 'REMOVED',
    }));
  } catch {
    // Not a URL: no parameters to list.
  }
  const requestBody = attributes['a2ui.http.request.body'];
  const responseBody = attributes['a2ui.http.response.body'];
  const start = BigInt(call.startTimeUnixNano);
  return (
    <>
      <MonoLine label="Request" text={`${method} ${url}`} />
      {parameters.length > 0 && <Pairs label="URL parameters" pairs={parameters} verbatim />}
      <Pairs label="Headers" pairs={headersOf(attributes, 'request')} verbatim />
      {requestBody !== undefined && <Body value={requestBody} />}
      <MonoLine
        label="Response"
        text={typeof status === 'number' ? statusLine(status) : 'No response'}
      />
      <Pairs label="Headers" pairs={headersOf(attributes, 'response')} verbatim />
      {responseBody !== undefined && <Body value={responseBody} />}
      {chunks.length > 0 && (
        <Chunks chunks={chunks} start={start} inFlight={call.endTimeUnixNano === undefined} />
      )}
    </>
  );
}

/** A body as recorded: JSON as a block with its objects and arrays folded below the top, text as text. */
function Body({value}: {value: unknown}) {
  if (typeof value === 'string') return <TextBlock label="Body" text={value} />;
  const folded =
    typeof value === 'object' && value !== null
      ? Object.entries(value).flatMap(([key, child]) =>
          typeof child === 'object' && child !== null
            ? [`/${key.replace(/~/g, '~0').replace(/\//g, '~1')}`]
            : [],
        )
      : [];
  return <JsonBlock label="Body" value={value} folded={folded} />;
}

/**
 * What a tool call's exchange line adds after its status: that its reply
 * came on the server's `GET` stream, named by its path, as an HTTP+SSE
 * request's does; its chunks when its own response streamed; else its
 * response's media type.
 */
function toolTail(attributes: Record<string, unknown>, chunks: number): string[] {
  const type = headersOf(attributes, 'response').find(({key}) => key === 'content-type')?.value;
  const mediaType = type?.split(';')[0]?.trim();
  if (chunks > 0) {
    return mediaType === 'text/event-stream'
      ? [plural(chunks, 'chunk')]
      : [`reply on GET ${streamPathOf(attributes) ?? 'the SSE stream'}`];
  }
  return mediaType === undefined || mediaType === '' ? [] : [mediaType];
}

/** The path of an HTTP+SSE session's `GET` stream, from `a2ui.mcp.stream.url`; none on a record without it. */
function streamPathOf(attributes: Record<string, unknown>): string | undefined {
  const url = attributes['a2ui.mcp.stream.url'];
  if (typeof url !== 'string') return undefined;
  try {
    return new URL(url).pathname;
  } catch {
    return url;
  }
}

/** The headers of one side of the exchange, a removed credential by its name. */
function headersOf(
  attributes: Record<string, unknown>,
  side: 'request' | 'response',
): Array<{key: string; value: string; removed?: boolean}> {
  const prefix = `http.${side}.header.`;
  return Object.entries(attributes).flatMap(([name, value]) => {
    if (!name.startsWith(prefix)) return [];
    const values = Array.isArray(value) ? value.map(String) : [String(value)];
    const removed = values.every(item => item === 'REMOVED');
    return [{key: name.slice(prefix.length), value: values.join(', '), removed}];
  });
}

/** A stream's chunks, each with its time since the call started as a duration, its event name and its data, which it opens to. */
function Chunks({
  chunks,
  start,
  inFlight,
}: {
  chunks: readonly SpanEvent[];
  start: bigint;
  inFlight: boolean;
}) {
  return (
    <RowList
      label="Chunks"
      meta={inFlight ? `${chunks.length} so far` : plural(chunks.length, 'chunk')}
      rows={chunks.map((chunk, index) => {
        const body = chunk.attributes?.['a2ui.http.response.chunk.body'];
        const event = chunk.attributes?.['a2ui.http.response.chunk.event'];
        const ms = Number((BigInt(chunk.timeUnixNano) - start) / 1_000_000n);
        return {
          key: String(index),
          time: formatDuration(ms),
          name: typeof event === 'string' ? event : 'data',
          meta: typeof body === 'string' ? body : JSON.stringify(body),
          metaVerbatim: true,
          metaWhileShut: true,
          opened: <JsonLines value={body} className="bg-panel" />,
        };
      })}
    />
  );
}

export function asList(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}
