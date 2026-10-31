/**
 * A model call's detail: its title line, its usage, its prefix break, its
 * request and response, its exchange, and the agent's spans linked to it.
 * Its sections are filled by the model proxy's reading when it read the call
 * in full, else from the spans of its chain, each section's label naming
 * the spans it came from.
 */
import {type ReactNode, useState} from 'react';

import {cn} from '@/lib/utils';
import {
  type CallRow,
  modelReadingOf,
  sourceOfNames,
  sourcesOfRow,
  timedEventOf,
} from '@/model/call_rows.ts';
import {callCostOf, formatCost, formatShare, formatTokens, type Prices} from '@/model/cost.ts';
import {
  apiOf,
  figuresOf,
  hitRatioOf,
  isReadInFull,
  methodAndPath,
  spanApiOf,
  usageOf,
} from '@/model/model_calls.ts';
import {type Marker, partName, partText, type PrefixBreak} from '@/model/prefix.ts';
import {type ModelCallEvent, type TurnRecordEvent, unixMillis} from '@/model/record.ts';
import {plural} from '@/model/steps.ts';

import {AgentSpans} from './AgentSpans.tsx';
import {asList, Exchange, Pairs, Section, TextBlock} from './CallParts.tsx';
import {formatDuration, formatOffset, formatTime} from './format.ts';
import {Icon} from './icons.tsx';
import {BlockLabel, JsonBlock, JsonLines} from './JsonBlock.tsx';

/**
 * A call's title line: what it went to and where it was seen, then its
 * times. A model call read in full names its API; one recorded raw its
 * method, path and status; one read from spans the API its provider
 * implies. A tool call names its target. The sources follow: the proxy, then
 * each dialect of its spans.
 */
export function callTitleOf(
  row: CallRow,
  target: string,
  startMs: number,
): {target: string; times: string} {
  const sources = sourcesOfRow(row);
  let what: string[];
  if (row.kind === 'tool') {
    what = [target];
  } else if (row.proxy !== undefined && isReadInFull(row.proxy as ModelCallEvent)) {
    what = [apiOf(row.proxy as ModelCallEvent) ?? ''];
  } else if (row.proxy !== undefined) {
    const status = row.proxy.attributes['http.response.status_code'];
    what = [
      methodAndPath(row.proxy as ModelCallEvent),
      ...(typeof status === 'number' ? [String(status)] : []),
    ];
  } else {
    const api = spanApiOf(modelReadingOf(row).event);
    what = api === undefined ? [] : [api];
  }
  const timed = timedEventOf(row);
  const start = unixMillis(timed.startTimeUnixNano);
  const times = [formatOffset(start - startMs)];
  if (timed.endTimeUnixNano !== undefined) {
    times.push(formatDuration(unixMillis(timed.endTimeUnixNano) - start));
  }
  const first =
    row.kind === 'model'
      ? modelReadingOf(row).event.attributes['gen_ai.response.time_to_first_chunk']
      : undefined;
  if (typeof first === 'number') times.push(`first token ${formatDuration(first * 1000)}`);
  return {
    target: [...what.filter(part => part !== ''), ...sources].join(' · '),
    times: times.join(' · '),
  };
}

/** The names a call's request is read from, and its response's. */
const REQUEST_NAMES = [
  'gen_ai.system_instructions',
  'gen_ai.input.messages',
  'gen_ai.tool.definitions',
];
const RESPONSE_NAMES = ['gen_ai.output.messages'];

/**
 * What a model call holds, under its problems: for a call read in full, the
 * usage, the prefix break's sentence, the request, the response and the
 * exchange, folded; for a call recorded raw with no span, one sentence and
 * the exchange, open; for a call read from spans, the usage, the request and
 * the response from the spans, or one grey sentence when they carry no
 * content, and the exchange when the proxy recorded it raw. The agent's
 * spans follow, when any is linked.
 */
export function ModelCallBlocks({
  row,
  events,
  startMs,
  prices,
  prefix,
  onEarlier,
}: {
  row: CallRow;
  events: readonly TurnRecordEvent[];
  startMs: number;
  prices: Prices | undefined;
  prefix: PrefixBreak | undefined;
  /** Selects the call the prefix break compared this one with. */
  onEarlier: (found: Exclude<PrefixBreak, {form: 'first'}>) => void;
}) {
  const {event: call, fromSpans} = modelReadingOf(row);
  const spans = row.spans.length > 0 && <AgentSpans row={row} events={events} startMs={startMs} />;
  if (!fromSpans && !isReadInFull(call)) {
    return (
      <>
        <p className="text-muted-foreground">
          Recorded raw · Spectra reads Gemini, OpenAI and Anthropic on their own hosts only.
        </p>
        <Exchange call={call} startsOpen />
        {spans}
      </>
    );
  }
  const inFlight = call.endTimeUnixNano === undefined;
  const failed = call.status?.code === 2;
  if (fromSpans) {
    const from = (names: readonly string[]) => {
      const source = sourceOfNames(row, names);
      return source === undefined ? '' : ` · from ${source}`;
    };
    const content = [...REQUEST_NAMES, ...RESPONSE_NAMES].some(
      name => call.attributes[name] !== undefined,
    );
    return (
      <>
        {usageOf(call).input !== undefined && (
          <UsageFigures
            call={call}
            prices={prices}
            label={`Tokens${from(['gen_ai.usage.input_tokens'])}`}
          />
        )}
        {content ? (
          <>
            <Request
              call={call}
              startsOpen={!inFlight && !failed}
              marker={undefined}
              label={`Request${from(REQUEST_NAMES)}`}
            />
            <Response call={call} inFlight={inFlight} label={`Response${from(RESPONSE_NAMES)}`} />
          </>
        ) : (
          <p className="rounded-lg bg-tint px-3 py-2.5 text-muted-foreground">
            No prompt or response in this span · its producer’s content capture is off.
          </p>
        )}
        {row.proxy !== undefined && <Exchange call={row.proxy} startsOpen={false} />}
        {spans}
      </>
    );
  }
  const marker = prefix?.form === 'breaks' ? prefix.marker : undefined;
  return (
    <>
      {usageOf(call).input !== undefined && <UsageFigures call={call} prices={prices} />}
      {prefix !== undefined && <PrefixSentence found={prefix} onEarlier={onEarlier} />}
      <Request call={call} startsOpen={!inFlight && !failed} marker={marker} />
      <Response call={call} inFlight={inFlight} />
      <Exchange call={call} startsOpen={false} />
      {spans}
    </>
  );
}

/** Two groups of labelled figures: the tokens as recorded, then the hit ratio and the estimated cost. */
function UsageFigures({
  call,
  prices,
  label = 'Tokens',
}: {
  call: ModelCallEvent;
  prices: Prices | undefined;
  /** "Tokens", or with the spans it was read from. */
  label?: string;
}) {
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
        label={label}
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
  label = 'Request',
}: {
  call: ModelCallEvent;
  startsOpen: boolean;
  marker: Marker | undefined;
  /** "Request", or with the spans it was read from. */
  label?: string;
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
      label={label}
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
function Response({
  call,
  inFlight,
  label = 'Response',
}: {
  call: ModelCallEvent;
  inFlight: boolean;
  /** "Response", or with the spans it was read from. */
  label?: string;
}) {
  const [open, setOpen] = useState(true);
  const {attributes} = call;
  const messages = asList(attributes['gen_ai.output.messages']);
  const status = attributes['http.response.status_code'];
  const errorBody = call.status?.code === 2 ? attributes['a2ui.http.response.body'] : undefined;
  return (
    <Section
      label={label}
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
