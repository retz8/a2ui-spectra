/**
 * What the receiver placed for a step, the Spans tab's content: every span
 * above it, root first, then its own chain marked "this call", each with
 * its duration; one table of the chain's attributes, the innermost span's
 * value winning, by their translated names or as received, the translated
 * names leaving out what another tab shows; and the chain's span events in
 * time order, a received log record marked, each opening to its attributes.
 */
import {type ReactNode, useState} from 'react';

import {
  type CallRow,
  keyOf,
  mergedAttributesOf,
  shownElsewhereOf,
  sourceLinesOf,
  spanEventsOf,
  spansAboveOf,
} from '@/model/call_rows.ts';
import {jsonInString} from '@/model/json_lines.ts';
import {type SpanEvent, type TurnRecordEvent, unixMillis} from '@/model/record.ts';

import {DetailLink, Pairs, type Row, RowList} from './CallParts.tsx';
import {formatDuration, formatOffset} from './format.ts';
import {JsonLines, ShownSwitch} from './JsonBlock.tsx';

/** The prefix of the names a log record attached to its span carries. */
const LOG_PREFIX = 'a2ui.received.log.';

/** A value longer than this shows its start until it is opened. */
const LONG_VALUE = 160;

/** A span's duration, as a row says it; none for a span with no end. */
function durationOf(event: TurnRecordEvent): string {
  if (event.endTimeUnixNano === undefined) return '';
  return formatDuration(unixMillis(event.endTimeUnixNano) - unixMillis(event.startTimeUnixNano));
}

/** The Spans tab's facts: where its spans came from, each source and scope once. */
export function spansFactsOf(row: CallRow): string {
  return sourceLinesOf(row).join(' · ');
}

export function AgentSpans({
  row,
  events,
  startMs,
  subject = 'call',
  present = [],
  lead,
}: {
  row: CallRow;
  events: readonly TurnRecordEvent[];
  startMs: number;
  /** What the row is, as the chain names it: "this call", "this parse". */
  subject?: string;
  /** The detail's other tabs, whose attributes the translated table leaves out. */
  present?: readonly string[];
  /**
   * A span shown first, with its source line and its attributes: the
   * toolset's parse, above the tool call's own spans.
   */
  lead?: {line: string; event: TurnRecordEvent};
}) {
  const chain = row.spans;
  const ancestors = spansAboveOf(chain, events);
  const spanEvents = spanEventsOf(chain);
  return (
    <>
      {lead !== undefined && (
        <>
          <p className="type-quiet">{lead.line}</p>
          <Attributes label="Toolset parse" chain={[lead.event]} present={present} />
        </>
      )}
      <RowList
        label={`Above this ${subject}`}
        rows={[
          ...ancestors.map((event, index) => spanRow(event, index, undefined)),
          ...chain.map((event, index) => spanRow(event, ancestors.length + index, subject)),
        ]}
      />
      <Attributes label="Attributes" chain={chain} present={present} />
      {spanEvents.length > 0 && (
        <RowList
          label="Events"
          rows={spanEvents.map((event, index) => eventRow(event, index, startMs))}
        />
      )}
    </>
  );
}

/**
 * One table of a chain's attributes, the innermost span's value winning: by
 * their translated names, the default, leaving out what another tab shows
 * with a line naming that tab; or as the receiver got them, every one.
 */
function Attributes({
  label,
  chain,
  present,
}: {
  label: string;
  chain: readonly TurnRecordEvent[];
  present: readonly string[];
}) {
  const [asReceived, setAsReceived] = useState(false);
  const merged = mergedAttributesOf(chain, asReceived);
  const {leftOut, tabs} = shownElsewhereOf(merged, present, asReceived);
  const pairs = [...merged]
    .filter(([name]) => !leftOut.includes(name))
    .map(([key, value]) => {
      const parsed = !asReceived && typeof value === 'string' ? jsonInString(value) : undefined;
      return parsed === undefined
        ? {key, value: <NameValue value={value} />}
        : {key, value: <JsonLines value={parsed} />, note: 'JSON in a string'};
    });
  return (
    <Pairs
      label={label}
      pairs={pairs}
      verbatim
      keys="attributes"
      aside={
        <ShownSwitch
          label="Attribute names"
          options={['Translated', 'As received']}
          on={asReceived ? 1 : 0}
          onChange={index => setAsReceived(index === 1)}
        />
      }
      {...(tabs.length > 0 && {
        after: `The ${tabs.join(' and ')} tab${tabs.length === 1 ? ' shows' : 's show'} the attributes left out here.`,
      })}
    />
  );
}

/** A span of the chain above the step, or of its own chain, as a row with its duration. */
function spanRow(event: TurnRecordEvent, index: number, ownChain: string | undefined): Row {
  return {
    key: keyOf(event),
    name: event.name,
    ...(ownChain !== undefined && {tag: `this ${ownChain}`}),
    end: durationOf(event),
    ...(event.status?.code === 2 && {mark: 'status error'}),
    indent: index,
  };
}

/** A span event as a row: its time since the turn's start, its name, "log record" for a received log, opening to its attributes. */
function eventRow(event: SpanEvent, index: number, startMs: number): Row {
  const attributes = event.attributes ?? {};
  const log = Object.keys(attributes).some(name => name.startsWith(LOG_PREFIX));
  return {
    key: `${index}`,
    time: formatOffset(unixMillis(event.timeUnixNano) - startMs),
    name: event.name === '' ? 'event' : event.name,
    ...(log && {tag: 'log record'}),
    opened: <JsonLines value={attributes} className="bg-panel" />,
  };
}

/** An attribute's value: text as it is, anything else as JSON, a long one shown in full once opened. */
function NameValue({value}: {value: unknown}): ReactNode {
  const [whole, setWhole] = useState(false);
  const text = typeof value === 'string' ? value : JSON.stringify(value);
  if (text.length <= LONG_VALUE) return text;
  return (
    <>
      {whole ? text : `${text.slice(0, LONG_VALUE)}…`}{' '}
      <DetailLink onClick={() => setWhole(!whole)}>{whole ? 'Show less' : 'Show all'}</DetailLink>
    </>
  );
}
