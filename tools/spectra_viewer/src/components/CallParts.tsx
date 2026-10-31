/**
 * The parts a call's detail is built of, a model call's and a tool call's
 * alike: sections on a rule, keys and values, a text block, and the HTTP
 * exchange with its chunks.
 */
import {type ReactNode, useState} from 'react';

import {cn} from '@/lib/utils';
import {statusLine} from '@/model/model_calls.ts';
import type {ModelCallEvent, OtherEvent, SpanEvent} from '@/model/record.ts';
import {plural} from '@/model/steps.ts';

import {CopyButton} from './CopyButton.tsx';
import {formatOffset} from './format.ts';
import {Icon} from './icons.tsx';
import {BlockLabel, JsonBlock, JsonLines} from './JsonBlock.tsx';

/** A section of the detail: a small label on a rule, folding what follows when it can. */
export function Section({
  label,
  meta,
  open,
  onToggle,
  children,
}: {
  label: string;
  meta?: string;
  open: boolean;
  onToggle?: () => void;
  children: ReactNode;
}) {
  return (
    <>
      <div className="mt-0.5 flex h-[34px] shrink-0 items-center gap-2 border-t px-0.5 text-xs text-muted-foreground">
        {onToggle !== undefined && (
          <button
            type="button"
            aria-expanded={open}
            aria-label={`${open ? 'Fold' : 'Unfold'} ${label.toLowerCase()}`}
            onClick={onToggle}
            className="flex size-[18px] cursor-pointer items-center justify-center rounded hover:bg-tint hover:text-foreground"
          >
            <Icon kind={open ? 'chevronDown' : 'chevronRight'} size={13} />
          </button>
        )}
        <span className="shrink-0 font-semibold tracking-[0.06em] uppercase">{label}</span>
        {meta !== undefined && meta !== '' && <span className="min-w-0 truncate">{meta}</span>}
      </div>
      {open && children}
    </>
  );
}

/**
 * Settings, headers and names: keys and values in two columns. Headers set
 * their values in mono on narrower keys; MCP's names set theirs in mono; the
 * translated names take wider keys.
 */
export function Pairs({
  label,
  pairs,
  monoKeys = false,
  layout,
}: {
  label: string;
  pairs: ReadonlyArray<{key: string; value: ReactNode; removed?: boolean}>;
  /** Headers: values in mono, on narrower keys. */
  monoKeys?: boolean;
  /** MCP's names, values in mono; or the translated names, values in mono on wider keys. */
  layout?: 'mcp' | 'names';
}) {
  if (pairs.length === 0) return null;
  const mono = monoKeys || layout !== undefined;
  return (
    <div className="flex flex-col gap-1.5">
      <BlockLabel label={label} />
      <div
        className={cn(
          'grid gap-x-3 gap-y-0.5 text-xs leading-5',
          layout === 'names'
            ? 'grid-cols-[260px_minmax(0,1fr)]'
            : monoKeys
              ? 'grid-cols-[150px_minmax(0,1fr)]'
              : 'grid-cols-[170px_minmax(0,1fr)]',
        )}
      >
        {pairs.map(({key, value, removed}, index) => (
          <span key={index} className="contents">
            <span className="break-all text-muted-foreground">{key}</span>
            <span
              className={cn('break-all', removed ? 'text-muted-foreground' : mono && 'font-mono')}
            >
              {removed ? 'Removed by Spectra' : value}
            </span>
          </span>
        ))}
      </div>
    </div>
  );
}

/** A labelled text on a tinted block, with a copy button. */
export function TextBlock({label, meta, text}: {label: string; meta?: string; text: string}) {
  return (
    <section className="flex min-w-0 flex-col gap-1.5">
      <BlockLabel label={label} meta={meta}>
        <CopyButton
          text={text}
          label={`Copy the ${label.toLowerCase()}`}
          className="h-[22px] px-1.5 text-xs"
        >
          Copy
        </CopyButton>
      </BlockLabel>
      <p className="rounded-lg bg-tint px-3 py-2.5 break-words whitespace-pre-wrap">{text}</p>
    </section>
  );
}

/**
 * The HTTP exchange as recorded: the request and the response, each with its
 * headers and body or chunks. Folded, its line names the request, the status,
 * and then a model call's chunk count; for a tool call, that its reply came
 * on the server's SSE stream, its chunk count, or the response's media type.
 */
export function Exchange({
  call,
  startsOpen,
  tool = false,
}: {
  call: OtherEvent | ModelCallEvent;
  startsOpen: boolean;
  /** A tool call's exchange. */
  tool?: boolean;
}) {
  const [open, setOpen] = useState(startsOpen);
  const attributes = call.attributes as Record<string, unknown>;
  const method = String(attributes['http.request.method'] ?? '');
  const url = typeof attributes['url.full'] === 'string' ? attributes['url.full'] : '';
  const status = attributes['http.response.status_code'];
  const chunks = (call.events ?? []).filter(event => event.name === 'a2ui.http.response.chunk');
  let host = '';
  let parameters: Array<{key: string; value: string; removed?: boolean}> = [];
  try {
    const parsed = new URL(url);
    host = `${parsed.host}${parsed.pathname}`;
    parameters = [...parsed.searchParams].map(([key, value]) => ({
      key,
      value,
      removed: value === 'REMOVED',
    }));
  } catch {
    host = url;
  }
  const meta = [
    `${method} ${host}`,
    ...(typeof status === 'number' ? [String(status)] : []),
    ...(tool
      ? toolTail(attributes, chunks.length)
      : chunks.length > 0
        ? [plural(chunks.length, 'chunk')]
        : []),
  ].join(' · ');
  const requestBody = attributes['a2ui.http.request.body'];
  const responseBody = attributes['a2ui.http.response.body'];
  const start = BigInt(call.startTimeUnixNano);
  return (
    <Section
      label="Exchange"
      meta={open ? undefined : meta}
      open={open}
      onToggle={() => setOpen(!open)}
    >
      <MonoLine label="Request" text={`${method} ${url}`} />
      {parameters.length > 0 && <Pairs label="URL parameters" pairs={parameters} monoKeys />}
      <Pairs label="Headers" pairs={headersOf(attributes, 'request')} monoKeys />
      {requestBody !== undefined && <Body value={requestBody} />}
      <MonoLine
        label="Response"
        text={typeof status === 'number' ? statusLine(status) : 'No response'}
      />
      <Pairs label="Headers" pairs={headersOf(attributes, 'response')} monoKeys />
      {responseBody !== undefined && <Body value={responseBody} />}
      {chunks.length > 0 && (
        <Chunks chunks={chunks} start={start} inFlight={call.endTimeUnixNano === undefined} />
      )}
    </Section>
  );
}

export function MonoLine({label, text}: {label: string; text: string}) {
  return (
    <div className="flex flex-col gap-1.5">
      <BlockLabel label={label} />
      <div className="rounded-lg bg-tint px-3 py-1.5 font-mono text-xs leading-[1.6] break-all">
        {text}
      </div>
    </div>
  );
}

/** A body as recorded: JSON as a block with its objects and arrays folded below the top, text as text. */
export function Body({value}: {value: unknown}) {
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
 * What a tool call's folded exchange adds after its status: that its reply
 * came on the server's SSE stream, as an HTTP+SSE request's does; its chunks
 * when its own response streamed; else its response's media type.
 */
function toolTail(attributes: Record<string, unknown>, chunks: number): string[] {
  const type = headersOf(attributes, 'response').find(({key}) => key === 'content-type')?.value;
  const mediaType = type?.split(';')[0]?.trim();
  if (chunks > 0) {
    return mediaType === 'text/event-stream'
      ? [plural(chunks, 'chunk')]
      : ['reply on the SSE stream'];
  }
  return mediaType === undefined || mediaType === '' ? [] : [mediaType];
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

/** A stream's chunks, each with its time since the call started and its event name, its data folded. */
function Chunks({
  chunks,
  start,
  inFlight,
}: {
  chunks: readonly SpanEvent[];
  start: bigint;
  inFlight: boolean;
}) {
  const [open, setOpen] = useState<ReadonlySet<number>>(() => new Set());
  return (
    <section className="flex min-w-0 flex-col gap-1.5">
      <BlockLabel
        label="Chunks"
        meta={inFlight ? `${chunks.length} so far` : plural(chunks.length, 'chunk')}
      />
      <div className="flex flex-col rounded-lg bg-tint py-1 text-xs">
        {chunks.map((chunk, index) => {
          const body = chunk.attributes?.['a2ui.http.response.chunk.body'];
          const event = chunk.attributes?.['a2ui.http.response.chunk.event'];
          const unfolded = open.has(index);
          const ms = Number((BigInt(chunk.timeUnixNano) - start) / 1_000_000n);
          return (
            <div key={index} className="flex flex-col">
              <div className="flex h-7 min-w-0 items-center gap-2 pr-3 pl-2.5">
                <button
                  type="button"
                  aria-expanded={unfolded}
                  aria-label={`${unfolded ? 'Fold' : 'Unfold'} chunk ${index + 1}`}
                  onClick={() => {
                    const next = new Set(open);
                    if (!next.delete(index)) next.add(index);
                    setOpen(next);
                  }}
                  className="flex size-4 shrink-0 cursor-pointer items-center justify-center rounded text-muted-foreground hover:bg-border hover:text-foreground"
                >
                  <Icon kind={unfolded ? 'chevronDown' : 'chevronRight'} size={11} />
                </button>
                <span className="w-12 shrink-0 text-right text-muted-foreground">
                  {formatOffset(ms)}
                </span>
                <span className="shrink-0 font-mono font-medium">
                  {typeof event === 'string' ? event : 'data'}
                </span>
                <span className="min-w-0 flex-1 truncate font-mono text-muted-foreground">
                  {typeof body === 'string' ? body : JSON.stringify(body)}
                </span>
              </div>
              {unfolded && (
                <div className="px-2.5 pb-2">
                  <JsonLines value={body} className="bg-panel" />
                </div>
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
}

export function asList(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}
