/**
 * A model call's detail: its title line, its usage, how it connects to other
 * steps, and its tabs. Prompt holds the request in its order, the settings,
 * the system prompt, the tool definitions and the messages; Reply the
 * response; HTTP the exchange, for a call through the model proxy; Spans
 * the agent's spans linked to it. A call read from spans fills Prompt and
 * Reply from them, a call recorded raw has HTTP and Spans alone.
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
import {formatTokens} from '@/model/cost.ts';
import {apiOf, isReadInFull, methodAndPath, spanApiOf} from '@/model/model_calls.ts';
import {emptyNoteOf, shownParts} from '@/model/empty_parts.ts';
import type {UiSection} from '@/model/a2ui_step.ts';
import {formatNameOf} from '@/model/ranges.ts';
import {catalogName} from '@/model/agent_card.ts';
import type {KnownCatalog} from '@/model/catalogs.ts';
import {type Marker, partName, partText, type PrefixBreak} from '@/model/prefix.ts';
import {type CallReplay, isMissCall, type RecordedCall} from '@/model/provenance.ts';
import {
  type ModelCallEvent,
  readRecordVersionsText,
  type TurnRecordEvent,
  unixMillis,
} from '@/model/record.ts';
import {plural} from '@/model/steps.ts';
import {useBlockFold, useFoldUnless} from '@/state/block_folds.ts';

import {AgentSpans, spansFactsOf} from './AgentSpans.tsx';
import {
  asList,
  type Connection,
  DetailLink,
  Exchange,
  exchangeFactsOf,
  finished,
  Pairs,
  Prose,
  replayConnection,
  type Row,
  RowList,
  TextBlock,
} from './CallParts.tsx';
import {CopyButton} from './CopyButton.tsx';
import {BreakLines, SectionedText} from './SectionedText.tsx';
import {SwitchOnHint} from './SwitchOnHint.tsx';
import {formatDuration, formatOffset, formatTime} from './format.ts';
import {BlockLabel, JsonBlock, JsonLines, ShownSwitch} from './JsonBlock.tsx';

/** One tab of a step's detail: its name, its facts line, and what it holds. */
export interface DetailTab {
  name: string;
  facts?: string;
  content: ReactNode;
}

/** What a step with tabs shows under its head. */
export interface TabbedDetail {
  connections: Connection[];
  /** Shown first in whichever tab is open: a sentence about the whole call. */
  lead?: ReactNode;
  tabs: DetailTab[];
  /** The tab a selection opens. */
  first: string;
}

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

/** What the A2UI step adds to a model call's detail. */
export interface StepOnCall {
  /** The retry's sentence, when the call is a retry. */
  retry?: {lead: string; link?: {text: string; parseSpanId: string}; tail?: string};
  /** The parses that read this call, each a link. */
  readBy: ReadonlyArray<{text: string; parseSpanId: string}>;
  /** The UI sections inside the request. */
  sections: readonly UiSection[];
  /** The hint to switch the wrapper on, on a turn with no A2UI step events: under `run` or `attach`. */
  hint?: 'run' | 'attach';
  /** In the hint's place, on a turn whose A2UI step was reported under a newer turn record: that version. */
  newerStep?: string;
  catalogs: readonly KnownCatalog[];
  /** Selects a parse by its span id. */
  onParse: (parseSpanId: string) => void;
}

/** A source in a tab's facts line, standing alone: "From ADK spans". */
function fromLine(source: string | undefined, rest: readonly string[] = []): string | undefined {
  const parts = [...(source === undefined ? [] : [`from ${source}`]), ...rest];
  if (parts.length === 0) return undefined;
  const line = parts.join(' · ');
  return `${line.charAt(0).toUpperCase()}${line.slice(1)}`;
}

export function modelCallDetailOf({
  row,
  events,
  startMs,
  prefix,
  onEarlier,
  step,
  replay,
  onRecorded,
}: {
  row: CallRow;
  events: readonly TurnRecordEvent[];
  startMs: number;
  prefix: PrefixBreak | undefined;
  /** Selects the call the prefix break compared this one with. */
  onEarlier: (found: Exclude<PrefixBreak, {form: 'first'}>) => void;
  step: StepOnCall;
  /** What the call was, in a replayed turn. */
  replay: CallReplay | undefined;
  /** Selects a recorded call in its source. */
  onRecorded: (recorded: RecordedCall) => void;
}): TabbedDetail {
  const {event: call, fromSpans} = modelReadingOf(row);
  const connections: Connection[] = [];
  if (step.retry !== undefined) connections.push(retryConnection(step.retry, step.onParse));
  if (replay?.kind === 'served' || replay?.kind === 'live') {
    connections.push(replayConnection(replay, onRecorded));
  }
  if (prefix !== undefined) {
    connections.push({
      key: 'Prefix',
      value: (
        <PrefixSentence
          found={prefix}
          miss={replay?.kind === 'modelMiss'}
          onEarlier={onEarlier}
          traceId={call.traceId}
          startMs={startMs}
        />
      ),
    });
  }
  for (const line of step.readBy) {
    const [target, ...facts] = line.text.replace(/^Read by /, '').split(' · ');
    connections.push({
      key: 'Read by',
      value: (
        <>
          <DetailLink onClick={() => step.onParse(line.parseSpanId)}>{target}</DetailLink>
          {facts.length > 0 && ` · ${facts.join(' · ')}`}
        </>
      ),
    });
  }
  const trailing =
    step.newerStep !== undefined ? (
      <p className="type-quiet">
        A2UI step reported under turn record {step.newerStep} · this Spectra reads{' '}
        {readRecordVersionsText()} · upgrade a2ui-spectra to see which text became which component.
      </p>
    ) : (
      step.hint !== undefined && <SwitchOnHint mode={step.hint} />
    );
  const sectionLabel = (section: UiSection) => {
    const {attributes} = section.generation;
    const catalogs = (attributes['a2ui.prompt.catalogs'] ?? []).map(ref => {
      const name = catalogName(ref.catalogId, step.catalogs);
      return name.endsWith(ref.protocolVersion) ? name : `${name} ${ref.protocolVersion}`;
    });
    return [
      'Generated by the A2UI SDK',
      formatNameOf(attributes['a2ui.prompt.inference_format']),
      ...catalogs,
    ]
      .filter((part): part is string => part !== undefined)
      .join(' · ');
  };
  const tabs: DetailTab[] = [];
  const spansTab = (present: readonly string[]): DetailTab => ({
    name: 'Spans',
    facts: spansFactsOf(row),
    content: <AgentSpans row={row} events={events} startMs={startMs} present={present} />,
  });
  const inFlight = call.endTimeUnixNano === undefined;
  if (!fromSpans && !isReadInFull(call)) {
    tabs.push({name: 'HTTP', facts: exchangeFactsOf(call), content: <Exchange call={call} />});
    if (row.spans.length > 0) tabs.push(spansTab(tabs.map(tab => tab.name)));
    return {
      connections,
      lead: (
        <p className="type-quiet">
          Recorded raw · Spectra reads Gemini, OpenAI and Anthropic on their own hosts only.
        </p>
      ),
      tabs,
      first: 'HTTP',
    };
  }
  const marker = !fromSpans && prefix?.form === 'breaks' ? prefix.marker : undefined;
  const content = [...REQUEST_NAMES, ...RESPONSE_NAMES].some(
    name => call.attributes[name] !== undefined,
  );
  let lead: ReactNode;
  if (!fromSpans || content) {
    tabs.push({
      name: 'Prompt',
      ...(fromSpans && {facts: fromLine(sourceOfNames(row, REQUEST_NAMES))}),
      content: (
        <Prompt call={call} marker={marker} sections={step.sections} sectionLabel={sectionLabel} />
      ),
    });
    tabs.push({
      name: 'Reply',
      facts: fromLine(
        fromSpans ? sourceOfNames(row, RESPONSE_NAMES) : undefined,
        inFlight ? ['streaming'] : [],
      ),
      content: (
        <>
          <Reply call={call} inFlight={inFlight} />
          {trailing}
        </>
      ),
    });
  } else {
    lead = (
      <p className="type-quiet">
        No prompt or response in this span · its producer’s content capture is off.
      </p>
    );
  }
  const exchange = fromSpans ? row.proxy : call;
  if (exchange !== undefined) {
    tabs.push({
      name: 'HTTP',
      facts: exchangeFactsOf(exchange),
      content: <Exchange call={exchange} />,
    });
  }
  if (row.spans.length > 0) tabs.push(spansTab(tabs.map(tab => tab.name)));
  return {
    connections,
    ...(lead !== undefined && {lead}),
    tabs,
    first: 'Reply',
  };
}

/** The retry's sentence across the connections: why it is a retry, the failed parse a link that selects it. */
function retryConnection(
  retry: NonNullable<StepOnCall['retry']>,
  onParse: (parseSpanId: string) => void,
): Connection {
  return {
    value: (
      <>
        {retry.link === undefined ? finished(retry.lead) : retry.lead}
        {retry.link !== undefined && (
          <>
            {' '}
            <DetailLink onClick={() => onParse(retry.link!.parseSpanId)}>
              {retry.link.text}
            </DetailLink>
            {retry.tail === undefined ? '.' : ` · ${finished(retry.tail)}`}
          </>
        )}
      </>
    ),
  };
}

/**
 * The prefix break's sentence, in one of its four forms, the earlier call a
 * link that selects it: by its offset in the turn in view, by its time in an
 * earlier turn, and a recorded call by its offset and its record.
 */
function PrefixSentence({
  found,
  miss = false,
  onEarlier,
  traceId,
  startMs,
}: {
  found: PrefixBreak;
  /** Whether the call is a replay's miss: with nothing to compare with, the sentence says so. */
  miss?: boolean;
  onEarlier: (found: Exclude<PrefixBreak, {form: 'first'}>) => void;
  /** The turn in view. */
  traceId: string;
  startMs: number;
}) {
  if (found.form === 'first') {
    return miss
      ? `No recorded call of ${found.model} to compare with`
      : `First ${found.model} call in this conversation`;
  }
  const {recorded} = found.earlier;
  const started = unixMillis(found.earlier.call.startTimeUnixNano);
  const at =
    recorded !== undefined
      ? formatOffset(recorded.offsetMs)
      : found.earlier.traceId === traceId
        ? formatOffset(started - startMs)
        : formatTime(started);
  const link = (text: string) => <DetailLink onClick={() => onEarlier(found)}>{text}</DetailLink>;
  const named = recorded === undefined ? `the call at ${at}` : `the recorded call at ${at}`;
  const source = recorded === undefined ? '' : ` in ${recorded.name}`;
  if (found.form === 'shares_earlier') {
    return (
      <>
        Shares all of {link(recorded === undefined ? 'the earlier call’s request' : named)}
        {source}
      </>
    );
  }
  if (found.form === 'shares_this') {
    return (
      <>
        Shares all of its request with {link(named)}
        {source}
      </>
    );
  }
  return (
    <>
      Prefix breaks in {partName(found)} · against {link(named)}
      {source}
    </>
  );
}

/**
 * A segment's text with the prefix break marked in it: the text up to the
 * line the break is on, a thin grey rule, the line as the earlier call and
 * as this one had it with the differing span tinted, then the rest. With
 * the segment's text, it has Copy, as every other prompt block does.
 */
function MarkedText({
  label,
  meta,
  marker,
  mono,
  text,
}: {
  label: string;
  meta?: string;
  marker: Marker;
  mono: boolean;
  /** This call's text of the segment, which Copy copies; none in a tool's definition, which has no Copy. */
  text?: string;
}) {
  const fold = useFoldUnless(label, true);
  return (
    <section data-anchor="prefix-break" className="flex min-w-0 flex-col gap-1.5">
      <BlockLabel label={label} meta={meta} fold={fold}>
        {text !== undefined && (
          <CopyButton text={text} label={`Copy the ${label.toLowerCase()}`}>
            Copy
          </CopyButton>
        )}
      </BlockLabel>
      {fold.open && (
        <div
          className={cn(
            'flex flex-col rounded-lg bg-tint px-3 py-2.5 break-words whitespace-pre-wrap',
            mono ? 'type-code leading-relaxed' : 'type-body',
          )}
        >
          {marker.before !== '' && <span>{marker.before.replace(/\n$/, '')}</span>}
          <BreakLines marker={marker} />
          {marker.after !== '' && <span>{marker.after.replace(/^\n/, '')}</span>}
        </div>
      )}
    </section>
  );
}

/**
 * The request in its order: the settings and the messages open, the system
 * prompt and the tool definitions folded to their label and facts; the
 * system prompt opens at the marker when the prefix breaks inside it.
 */
function Prompt({
  call,
  marker,
  sections = [],
  sectionLabel,
}: {
  call: ModelCallEvent;
  marker: Marker | undefined;
  /** The UI sections the A2UI SDK generated, found in the request. */
  sections?: readonly UiSection[];
  sectionLabel?: (section: UiSection) => string;
}) {
  const sectionsIn = (segment: number) => sections.filter(section => section.segment === segment);
  const labelOf = sectionLabel ?? (() => 'Generated by the A2UI SDK');
  const {attributes} = call;
  const tools = asList(attributes['gen_ai.tool.definitions']);
  const system = asList(attributes['gen_ai.system_instructions']);
  const messages = asList(attributes['gen_ai.input.messages']);
  // A segment's index among the call's segments: the tools, the system prompt, then the messages.
  const systemSegment = tools.length;
  const firstMessage = tools.length + (system.length > 0 ? 1 : 0);
  const systemText = system.map(partText).join('\n\n');
  return (
    <>
      <Pairs label="Settings" pairs={settingsOf(call)} />
      {system.length > 0 &&
        (sectionsIn(systemSegment).length > 0 ? (
          <SectionedText
            label="System prompt"
            text={systemText}
            sections={sectionsIn(systemSegment)}
            labelOf={labelOf}
            marker={marker?.segment === systemSegment ? marker : undefined}
            mono={false}
            startsFolded
          />
        ) : marker?.segment === systemSegment ? (
          <MarkedText label="System prompt" marker={marker} mono={false} text={systemText} />
        ) : (
          <FoldedText label="System prompt" text={systemText} />
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
        const roleMeta = messageMeta(role, shownParts(list));
        const inMessage = sectionsIn(firstMessage + index);
        const only =
          list.length === 1 ? (list[0] as {type?: unknown; content?: unknown}) : undefined;
        if (inMessage.length > 0 && only?.type === 'text' && typeof only.content === 'string') {
          return (
            <SectionedText
              key={index}
              label={label}
              meta={roleMeta}
              text={only.content}
              sections={inMessage}
              labelOf={labelOf}
              marker={marker?.segment === firstMessage + index ? marker : undefined}
              mono={false}
            />
          );
        }
        if (marker?.segment === firstMessage + index) {
          const mono = list.some(part => (part as {type?: unknown})?.type !== 'text');
          return (
            <MarkedText
              key={index}
              label={label}
              meta={roleMeta}
              marker={marker}
              mono={mono}
              text={list.map(partText).join('\n\n')}
            />
          );
        }
        return <PartsBlock key={index} label={label} meta={roleMeta} parts={list} />;
      })}
    </>
  );
}

/** A labelled text that starts folded, with a copy button: a system prompt with no UI section. */
function FoldedText({label, text}: {label: string; text: string}) {
  const fold = useBlockFold(label, true);
  return (
    <section className="flex min-w-0 flex-col gap-1.5">
      <BlockLabel label={label} fold={fold}>
        <CopyButton text={text} label={`Copy the ${label.toLowerCase()}`}>
          Copy
        </CopyButton>
      </BlockLabel>
      {fold.open && <Prose text={text} />}
    </section>
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

/**
 * A message's parts in order: text as text, every other part as a JSON
 * block, and no block for a part with nothing in it; a message whose parts
 * all hold nothing is its label line alone.
 */
function PartsBlock({
  label,
  meta,
  parts: all,
}: {
  label: string;
  meta: string;
  parts: readonly unknown[];
}) {
  const fold = useBlockFold(label);
  const parts = shownParts(all);
  if (parts.length === 0 && all.length > 0) {
    return <BlockLabel label={label} meta={`${meta} · ${emptyNoteOf(all)}`} />;
  }
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
      <BlockLabel label={label} meta={meta} fold={fold} />
      {fold.open &&
        parts.map((part, index) => {
          const {type, content} = (part ?? {}) as {type?: unknown; content?: unknown};
          return (type === 'text' || type === 'reasoning') && typeof content === 'string' ? (
            <Prose key={index} text={content} />
          ) : (
            <JsonLines key={index} value={part} folded={foldedOf(part)} />
          );
        })}
    </section>
  );
}

/** A tool result's response starts folded. */
function foldedOf(part: unknown): string[] {
  return (part as {type?: unknown})?.type === 'tool_call_response' ? ['/response'] : [];
}

/**
 * The tool definitions, folded at first: a row each, its name and the start
 * of its description; opened, the whole description as text, then its
 * parameters as JSON, or the definition as sent.
 */
function ToolDefinitions({
  tools,
  marked,
}: {
  tools: readonly unknown[];
  marked: {index: number; marker: Marker} | undefined;
}) {
  const rows: Row[] = tools.map((tool, index) => {
    const {name, description} = (tool ?? {}) as {name?: unknown; description?: unknown};
    return {
      key: String(index),
      name: String(name ?? ''),
      meta: typeof description === 'string' ? description : '',
      metaWhileShut: true,
      opened:
        marked?.index === index ? (
          <MarkedText label="Definition" marker={marked.marker} mono />
        ) : (
          <Definition tool={tool} />
        ),
      ...(marked?.index === index && {startsOpen: true}),
    };
  });
  return (
    <RowList
      label="Tool definitions"
      meta={plural(tools.length, 'tool')}
      rows={rows}
      startsFolded={marked === undefined}
    />
  );
}

/** A tool's definition opened: its description as text, then its parameters as JSON; or as sent. */
function Definition({tool}: {tool: unknown}) {
  const [asReceived, setAsReceived] = useState(false);
  const definition = (tool ?? {}) as Record<string, unknown>;
  const {description} = definition;
  const parameters =
    definition.parameters ??
    definition.input_schema ??
    Object.fromEntries(
      Object.entries(definition).filter(([key]) => !['name', 'description', 'type'].includes(key)),
    );
  return (
    <>
      <div className="flex items-start gap-3">
        <p className="type-body min-w-0 flex-1 whitespace-pre-wrap">
          {asReceived || typeof description !== 'string' ? '' : description}
        </p>
        <ShownSwitch
          label="How the definition shows"
          on={asReceived ? 1 : 0}
          onChange={index => setAsReceived(index === 1)}
        />
      </div>
      <JsonLines
        key={asReceived ? 'sent' : 'read'}
        value={asReceived ? tool : parameters}
        className="bg-panel"
      />
    </>
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
function Reply({call, inFlight}: {call: ModelCallEvent; inFlight: boolean}) {
  const {attributes} = call;
  const messages = asList(attributes['gen_ai.output.messages']);
  const status = attributes['http.response.status_code'];
  const errorBody = call.status?.code === 2 ? attributes['a2ui.http.response.body'] : undefined;
  const missed = isMissCall(call) && call.status?.message !== undefined;
  return (
    <>
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
      {missed && <TextBlock label="Error" meta="HTTP 502" text={call.status!.message!} />}
      {messages.length === 0 && errorBody === undefined && !missed && (
        <p className="type-quiet">
          {inFlight ? 'Nothing from the stream yet.' : 'The response holds no message.'}
        </p>
      )}
    </>
  );
}
