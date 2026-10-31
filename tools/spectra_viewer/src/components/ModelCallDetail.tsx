import {type ReactNode, useState} from 'react';

import {cn} from '@/lib/utils';
import {callCostOf, formatCost, formatShare, formatTokens, type Prices} from '@/model/cost.ts';
import {
  apiOf,
  figuresOf,
  hitRatioOf,
  isReadInFull,
  methodAndPath,
  statusLine,
  usageOf,
} from '@/model/model_calls.ts';
import {type Marker, partName, partText, type PrefixBreak} from '@/model/prefix.ts';
import {
  type ModelCallEvent,
  type SpanEvent,
  type TurnRecordEvent,
  unixMillis,
} from '@/model/record.ts';
import {plural} from '@/model/steps.ts';

import {CopyButton} from './CopyButton.tsx';
import {formatDuration, formatOffset, formatTime} from './format.ts';
import {Icon} from './icons.tsx';
import {BlockLabel, JsonBlock, JsonLines} from './JsonBlock.tsx';

/** The record's dialects, as a source from the receiver is named. */
const DIALECTS: Record<string, string> = {
  adk: 'ADK spans',
  openinference: 'OpenInference spans',
  genai: 'GenAI spans',
};

/** Where a call was seen: the model proxy, and the agent's spans linked to it as the same call. */
export function sourcesOf(call: ModelCallEvent, events: readonly TurnRecordEvent[]): string[] {
  const linked = new Set((call.links ?? []).map(link => link.spanId));
  const dialects = events.flatMap(event => {
    const dialect = (event.attributes as Record<string, unknown>)['a2ui.received.dialect'];
    return linked.has(event.spanId) && typeof dialect === 'string'
      ? [DIALECTS[dialect] ?? dialect]
      : [];
  });
  return ['Model proxy', ...new Set(dialects)];
}

/** A model call's title line: what it went to and where it was seen, then its times. */
export function callTitleOf(
  call: ModelCallEvent,
  events: readonly TurnRecordEvent[],
  startMs: number,
): {target: string; times: string} {
  const sources = sourcesOf(call, events).join(' · ');
  const status = call.attributes['http.response.status_code'];
  const target = isReadInFull(call)
    ? `${apiOf(call) ?? ''} · ${sources}`
    : [methodAndPath(call), ...(typeof status === 'number' ? [String(status)] : []), sources].join(
        ' · ',
      );
  const start = unixMillis(call.startTimeUnixNano);
  const times = [formatOffset(start - startMs)];
  if (call.endTimeUnixNano !== undefined) {
    times.push(formatDuration(unixMillis(call.endTimeUnixNano) - start));
  }
  const first = call.attributes['gen_ai.response.time_to_first_chunk'];
  if (isReadInFull(call) && typeof first === 'number') {
    times.push(`first token ${formatDuration(first * 1000)}`);
  }
  return {target, times: times.join(' · ')};
}

/**
 * What a model call holds, under its problems: for a call read in full, the
 * usage, the prefix break's sentence, the request, the response and the
 * exchange, folded; for a call recorded raw, one sentence and the exchange,
 * open.
 */
export function ModelCallBlocks({
  call,
  prices,
  prefix,
  onEarlier,
}: {
  call: ModelCallEvent;
  prices: Prices | undefined;
  prefix: PrefixBreak | undefined;
  /** Selects the call the prefix break compared this one with. */
  onEarlier: (found: Exclude<PrefixBreak, {form: 'first'}>) => void;
}) {
  if (!isReadInFull(call)) {
    return (
      <>
        <p className="text-muted-foreground">
          Recorded raw · Spectra reads Gemini, OpenAI and Anthropic on their own hosts only.
        </p>
        <Exchange call={call} startsOpen />
      </>
    );
  }
  const inFlight = call.endTimeUnixNano === undefined;
  const failed = call.status?.code === 2;
  const marker = prefix?.form === 'breaks' ? prefix.marker : undefined;
  return (
    <>
      {usageOf(call).input !== undefined && <UsageFigures call={call} prices={prices} />}
      {prefix !== undefined && <PrefixSentence found={prefix} onEarlier={onEarlier} />}
      <Request call={call} startsOpen={!inFlight && !failed} marker={marker} />
      <Response call={call} inFlight={inFlight} />
      <Exchange call={call} startsOpen={false} />
    </>
  );
}

/** Two groups of labelled figures: the tokens as recorded, then the hit ratio and the estimated cost. */
function UsageFigures({call, prices}: {call: ModelCallEvent; prices: Prices | undefined}) {
  const ratio = hitRatioOf(usageOf(call));
  const cost = callCostOf(call, prices);
  const derived = [
    ...(ratio === undefined ? [] : [{name: 'Hit ratio', value: formatShare(ratio)}]),
    ...(cost.kind === 'priced' ? [{name: 'Estimated cost', value: formatCost(cost.usd)}] : []),
  ];
  const note =
    cost.kind === 'priced'
      ? cost.source === 'config'
        ? 'Price from the config'
        : `LiteLLM prices · ${prices?.date ?? ''}`
      : cost.kind === 'unpriced'
        ? `No price for ${cost.model}`
        : undefined;
  return (
    <div className="flex flex-wrap gap-x-10 gap-y-3">
      <FigureGroup
        label="Tokens"
        figures={figuresOf(call).map(({name, value}) => ({name, value: formatTokens(value)}))}
      />
      <FigureGroup label="Derived" figures={derived} note={note} />
    </div>
  );
}

function FigureGroup({
  label,
  figures,
  note,
}: {
  label: string;
  figures: ReadonlyArray<{name: string; value: string}>;
  note?: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <span className="section-label">{label}</span>
      {figures.length > 0 && (
        <div className="flex flex-wrap gap-x-[22px] gap-y-1.5">
          {figures.map(figure => (
            <div key={figure.name} className="flex flex-col">
              <span className="text-xs text-muted-foreground">{figure.name}</span>
              <span className="font-semibold tabular-nums">{figure.value}</span>
            </div>
          ))}
        </div>
      )}
      {note !== undefined && <span className="text-xs text-muted-foreground">{note}</span>}
    </div>
  );
}

/** The prefix break's sentence, in one of its four forms, the earlier call a link that selects it. */
function PrefixSentence({
  found,
  onEarlier,
}: {
  found: PrefixBreak;
  onEarlier: (found: Exclude<PrefixBreak, {form: 'first'}>) => void;
}) {
  let sentence: ReactNode;
  if (found.form === 'first') {
    sentence = `First ${found.model} call in this conversation`;
  } else {
    const at = formatTime(unixMillis(found.earlier.call.startTimeUnixNano));
    const link = (text: string) => (
      <button
        type="button"
        onClick={() => onEarlier(found)}
        title={`Select the call at ${at}`}
        className="cursor-pointer font-medium text-brand hover:underline"
      >
        {text}
      </button>
    );
    sentence =
      found.form === 'shares_earlier' ? (
        <>Shares all of {link('the earlier call’s request')}</>
      ) : found.form === 'shares_this' ? (
        <>Shares all of its request with {link(`the call at ${at}`)}</>
      ) : (
        <>
          Prefix breaks in {partName(found)} · against {link(`the call at ${at}`)}
        </>
      );
  }
  return (
    <div className="flex items-baseline gap-2.5">
      <span className="section-label shrink-0">Prefix</span>
      <span>{sentence}</span>
    </div>
  );
}

/** A section of the detail: a small label on a rule, folding what follows when it can. */
function Section({
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

/** Settings and headers: keys and values in two columns. */
function Pairs({
  label,
  pairs,
  monoKeys = false,
}: {
  label: string;
  pairs: ReadonlyArray<{key: string; value: string; removed?: boolean}>;
  monoKeys?: boolean;
}) {
  if (pairs.length === 0) return null;
  return (
    <div className="flex flex-col gap-1.5">
      <BlockLabel label={label} />
      <div
        className={cn(
          'grid gap-x-3 gap-y-0.5 text-xs leading-5',
          monoKeys ? 'grid-cols-[150px_minmax(0,1fr)]' : 'grid-cols-[170px_minmax(0,1fr)]',
        )}
      >
        {pairs.map(({key, value, removed}, index) => (
          <span key={index} className="contents">
            <span className="break-all text-muted-foreground">{key}</span>
            <span
              className={cn(
                'break-all',
                removed ? 'text-muted-foreground' : monoKeys && 'font-mono',
              )}
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
function TextBlock({label, meta, text}: {label: string; meta?: string; text: string}) {
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
 * A segment's text with the prefix break marked in it: the text up to the
 * line the break is on, a thin grey rule, the line as the earlier call and
 * as this one had it with the differing span tinted, then the rest.
 */
function MarkedText({
  label,
  meta,
  marker,
  mono,
}: {
  label: string;
  meta?: string;
  marker: Marker;
  mono: boolean;
}) {
  const line = ([before, differing, after]: readonly [string, string, string]) => (
    <span className="min-w-0 break-words whitespace-pre-wrap">
      {before}
      <span className="rounded-[3px] bg-[color-mix(in_srgb,var(--muted-foreground)_24%,transparent)] px-0.5">
        {differing}
      </span>
      {after}
    </span>
  );
  return (
    <section data-anchor="prefix-break" className="flex min-w-0 flex-col gap-1.5">
      <BlockLabel label={label} meta={meta} />
      <div
        className={cn(
          'flex flex-col rounded-lg bg-tint px-3 py-2.5 break-words whitespace-pre-wrap',
          mono && 'font-mono text-xs leading-[1.6]',
        )}
      >
        {marker.before !== '' && <span>{marker.before.replace(/\n$/, '')}</span>}
        <span
          role="separator"
          aria-label="Shared prefix ends"
          className="my-1 mb-1.5 flex items-center gap-2 font-sans text-xs font-semibold whitespace-nowrap text-muted-strong"
        >
          <span className="h-px flex-1 bg-muted-foreground" />
          Shared prefix ends
          <span className="h-px flex-1 bg-muted-foreground" />
        </span>
        <span className="mb-1.5 grid grid-cols-[84px_minmax(0,1fr)] gap-x-2.5 gap-y-0.5">
          <span className="font-sans text-xs leading-[21px] text-muted-foreground">
            Earlier call
          </span>
          {line(marker.earlier)}
          <span className="font-sans text-xs leading-[21px] text-muted-foreground">This call</span>
          {line(marker.current)}
        </span>
        {marker.after !== '' && <span>{marker.after.replace(/^\n/, '')}</span>}
      </div>
    </section>
  );
}

/** The request read as sections from the GenAI names: the settings, the system prompt, the tools and the messages. */
function Request({
  call,
  startsOpen,
  marker,
}: {
  call: ModelCallEvent;
  startsOpen: boolean;
  marker: Marker | undefined;
}) {
  const [open, setOpen] = useState(startsOpen || marker !== undefined);
  const {attributes} = call;
  const tools = asList(attributes['gen_ai.tool.definitions']);
  const system = asList(attributes['gen_ai.system_instructions']);
  const messages = asList(attributes['gen_ai.input.messages']);
  const meta = [
    ...(system.length > 0 ? ['system prompt'] : []),
    ...(tools.length > 0 ? [plural(tools.length, 'tool')] : []),
    plural(messages.length, 'message'),
  ].join(', ');
  // A segment's index among the call's segments: the tools, the system prompt, then the messages.
  const systemSegment = tools.length;
  const firstMessage = tools.length + (system.length > 0 ? 1 : 0);
  return (
    <Section
      label="Request"
      meta={open ? undefined : meta}
      open={open}
      onToggle={() => setOpen(!open)}
    >
      <Pairs label="Settings" pairs={settingsOf(call)} />
      {system.length > 0 &&
        (marker?.segment === systemSegment ? (
          <MarkedText label="System prompt" marker={marker} mono={false} />
        ) : (
          <TextBlock label="System prompt" text={system.map(partText).join('\n\n')} />
        ))}
      {tools.length > 0 && (
        <ToolDefinitions
          tools={tools}
          marked={
            marker !== undefined && marker.segment < tools.length
              ? {index: marker.segment, marker}
              : undefined
          }
        />
      )}
      {messages.map((message, index) => {
        const {role, parts} = (message ?? {}) as {role?: unknown; parts?: unknown};
        const list = asList(parts);
        const label = `Message ${index + 1}`;
        const roleMeta = messageMeta(role, list);
        if (marker?.segment === firstMessage + index) {
          const mono = list.some(part => (part as {type?: unknown})?.type !== 'text');
          return (
            <MarkedText key={index} label={label} meta={roleMeta} marker={marker} mono={mono} />
          );
        }
        return <PartsBlock key={index} label={label} meta={roleMeta} parts={list} />;
      })}
    </Section>
  );
}

/** A message's role, with its part's type when it holds one part that is not text. */
function messageMeta(role: unknown, parts: readonly unknown[]): string {
  const name = typeof role === 'string' ? role : 'message';
  const type = parts.length === 1 ? (parts[0] as {type?: unknown})?.type : undefined;
  return typeof type === 'string' && type !== 'text'
    ? `${name} · ${type.replace(/_/g, ' ')}`
    : name;
}

/** A message's parts in order: text as text, every other part as a JSON block. */
function PartsBlock({
  label,
  meta,
  parts,
}: {
  label: string;
  meta: string;
  parts: readonly unknown[];
}) {
  if (parts.length === 1) {
    const [part] = parts;
    const {type, content} = (part ?? {}) as {type?: unknown; content?: unknown};
    if ((type === 'text' || type === 'reasoning') && typeof content === 'string') {
      return <TextBlock label={label} meta={meta} text={content} />;
    }
    return <JsonBlock label={label} meta={meta} value={part} folded={foldedOf(part)} />;
  }
  return (
    <section className="flex min-w-0 flex-col gap-1.5">
      <BlockLabel label={label} meta={meta} />
      {parts.map((part, index) => {
        const {type, content} = (part ?? {}) as {type?: unknown; content?: unknown};
        return (type === 'text' || type === 'reasoning') && typeof content === 'string' ? (
          <p key={index} className="rounded-lg bg-tint px-3 py-2.5 break-words whitespace-pre-wrap">
            {content}
          </p>
        ) : (
          <JsonLines key={index} value={part} folded={foldedOf(part)} />
        );
      })}
    </section>
  );
}

/** A tool result's response starts folded, as the canvas draws it. */
function foldedOf(part: unknown): string[] {
  return (part as {type?: unknown})?.type === 'tool_call_response' ? ['/response'] : [];
}

/** The tool definitions as a foldable list by name, each opening to its JSON. */
function ToolDefinitions({
  tools,
  marked,
}: {
  tools: readonly unknown[];
  marked: {index: number; marker: Marker} | undefined;
}) {
  const [open, setOpen] = useState<ReadonlySet<number>>(() => new Set());
  return (
    <section className="flex min-w-0 flex-col gap-1.5">
      <BlockLabel label="Tool definitions" meta={plural(tools.length, 'tool')} />
      <div className="flex flex-col rounded-lg bg-tint py-1 text-xs">
        {tools.map((tool, index) => {
          const {name, description} = (tool ?? {}) as {name?: unknown; description?: unknown};
          const unfolded = open.has(index) || marked?.index === index;
          return (
            <div key={index} className="flex flex-col">
              <div className="flex h-7 min-w-0 items-center gap-2 pr-3 pl-2.5">
                <button
                  type="button"
                  aria-expanded={unfolded}
                  aria-label={`${unfolded ? 'Fold' : 'Unfold'} ${String(name ?? 'the tool')}`}
                  onClick={() => {
                    const next = new Set(open);
                    if (!next.delete(index)) next.add(index);
                    setOpen(next);
                  }}
                  className="flex size-4 shrink-0 cursor-pointer items-center justify-center rounded text-muted-foreground hover:bg-border hover:text-foreground"
                >
                  <Icon kind={unfolded ? 'chevronDown' : 'chevronRight'} size={11} />
                </button>
                <span className="shrink-0 font-mono font-medium">{String(name ?? '')}</span>
                <span className="min-w-0 flex-1 truncate text-muted-foreground">
                  {typeof description === 'string' ? description : ''}
                </span>
              </div>
              {unfolded &&
                (marked?.index === index ? (
                  <div className="px-2.5 pb-2">
                    <MarkedText label="Definition" marker={marked.marker} mono />
                  </div>
                ) : (
                  <div className="px-2.5 pb-2">
                    <JsonLines value={tool} className="bg-panel" />
                  </div>
                ))}
            </div>
          );
        })}
      </div>
    </section>
  );
}

/** The settings as a short list: the model id, the stream switch, and the settings the request names. */
function settingsOf(call: ModelCallEvent): Array<{key: string; value: string}> {
  const {attributes} = call;
  const gemini = attributes['gen_ai.provider.name'] === 'gcp.gemini';
  const settings: Array<[string, string]> = [
    ['gen_ai.request.model', 'Model'],
    ['gen_ai.request.stream', 'Stream'],
    ['gen_ai.request.temperature', 'Temperature'],
    ['gen_ai.request.top_p', 'Top p'],
    ['gen_ai.request.top_k', 'Top k'],
    ['gen_ai.request.max_tokens', gemini ? 'Maximum output tokens' : 'Maximum tokens'],
    ['gen_ai.request.stop_sequences', 'Stop sequences'],
    ['gen_ai.request.choice.count', 'Choices'],
    ['gen_ai.request.seed', 'Seed'],
    ['gen_ai.request.frequency_penalty', 'Frequency penalty'],
    ['gen_ai.request.presence_penalty', 'Presence penalty'],
    ['gen_ai.output.type', 'Output type'],
  ];
  return settings.flatMap(([name, key]) => {
    const value = attributes[name];
    if (value === undefined) return [];
    const shown =
      typeof value === 'number' && Number.isInteger(value)
        ? formatTokens(value)
        : Array.isArray(value)
          ? value.map(String).join(', ')
          : String(value);
    return [{key, value: shown}];
  });
}

/**
 * The response: each output message, text as text and every other part as
 * JSON, with its finish reason; while the call is in flight, what the stream
 * has given so far. A failed call shows the error body the API answered.
 */
function Response({call, inFlight}: {call: ModelCallEvent; inFlight: boolean}) {
  const [open, setOpen] = useState(true);
  const {attributes} = call;
  const messages = asList(attributes['gen_ai.output.messages']);
  const status = attributes['http.response.status_code'];
  const errorBody = call.status?.code === 2 ? attributes['a2ui.http.response.body'] : undefined;
  return (
    <Section
      label="Response"
      meta={inFlight ? 'streaming' : undefined}
      open={open}
      onToggle={() => setOpen(!open)}
    >
      {messages.map((message, index) => {
        const {
          role,
          parts,
          finish_reason: finish,
        } = (message ?? {}) as {
          role?: unknown;
          parts?: unknown;
          finish_reason?: unknown;
        };
        const meta = [
          typeof role === 'string' ? role : 'assistant',
          inFlight ? 'so far' : typeof finish === 'string' ? `finish reason ${finish}` : undefined,
        ]
          .filter(Boolean)
          .join(' · ');
        const label = messages.length === 1 ? 'Output' : `Output ${index + 1}`;
        return <PartsBlock key={index} label={label} meta={meta} parts={asList(parts)} />;
      })}
      {errorBody !== undefined && (
        <JsonBlock
          label="Error"
          meta={typeof status === 'number' ? `HTTP ${status}` : undefined}
          value={errorBody}
        />
      )}
      {messages.length === 0 && errorBody === undefined && (
        <p className="text-muted-foreground">
          {inFlight ? 'Nothing from the stream yet.' : 'The response holds no message.'}
        </p>
      )}
    </Section>
  );
}

/** The HTTP exchange as recorded: the request and the response, each with its headers and body or chunks. */
function Exchange({call, startsOpen}: {call: ModelCallEvent; startsOpen: boolean}) {
  const [open, setOpen] = useState(startsOpen);
  const {attributes} = call;
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
    ...(chunks.length > 0 ? [plural(chunks.length, 'chunk')] : []),
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

function MonoLine({label, text}: {label: string; text: string}) {
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

function asList(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}
