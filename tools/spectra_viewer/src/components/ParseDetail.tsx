/**
 * A parse's detail: what it read from and what retried it, as connections;
 * then its tabs. Raw text holds the text it read with its component ranges
 * and the marks of its problems; Messages the A2UI messages it produced, and
 * for the toolset's parse what it returned to the model; Spans its own span,
 * and for the toolset's parse the tool call's. A failed prompt generation's
 * detail is its span alone, in one column, its problem block above.
 */
import {useMemo} from 'react';

import {
  parseProblemsOf,
  rangesSentenceOf,
  readerCatalogOf,
  readFromOf,
  retriedByOf,
  sourceLineOfStep,
} from '@/model/a2ui_step.ts';
import {type CallRow, sourceLineOf} from '@/model/call_rows.ts';
import {rangesOfParse} from '@/model/ranges.ts';
import type {KnownCatalog} from '@/model/catalogs.ts';
import type {
  OtherEvent,
  ParseEvent,
  PromptGenerationEvent,
  TurnRecordEvent,
} from '@/model/record.ts';
import {plural, type Step} from '@/model/steps.ts';

import {AgentSpans} from './AgentSpans.tsx';
import {type Connection, DetailLink, Section} from './CallParts.tsx';
import {JsonBlock} from './JsonBlock.tsx';
import type {DetailTab, TabbedDetail} from './ModelCallDetail.tsx';
import {type RangeReveal, RawText} from './RawText.tsx';

export function parseDetailOf({
  step,
  parse,
  events,
  startMs,
  catalogs,
  onStep,
  reveal,
}: {
  step: Step;
  /** The step's parse. */
  parse: ParseEvent;
  events: readonly TurnRecordEvent[];
  startMs: number;
  /** The catalog definitions the viewer holds, which the parse's own catalogs are read from. */
  catalogs: readonly KnownCatalog[] | undefined;
  /** Selects another step of the turn. */
  onStep: (stepId: string) => void;
  reveal: RangeReveal | undefined;
}): TabbedDetail {
  const {attributes} = parse;
  const readFrom = readFromOf(events, parse, startMs);
  const retried = retriedByOf(events, parse, startMs);
  const messages = attributes['a2ui.parse.messages'] ?? [];
  const returned = attributes['gen_ai.tool.call.result'];
  const row: CallRow = {kind: 'tool', id: parse.spanId, spans: [parse as OtherEvent]};
  const connections: Connection[] = [
    {
      key: 'Read from',
      value:
        readFrom.stepId === undefined ? (
          readFrom.text
        ) : (
          <DetailLink onClick={() => onStep(readFrom.stepId!)}>{readFrom.text}</DetailLink>
        ),
    },
    ...(retried === undefined
      ? []
      : [
          {
            key: 'Retried by',
            value: (
              <DetailLink onClick={() => onStep(retried.stepId)}>
                {retried.text.replace(/^Retried by /, '')}
              </DetailLink>
            ),
          },
        ]),
  ];
  const tabs: DetailTab[] = [
    {
      name: 'Raw text',
      content: <ParseRawText parse={parse} catalogs={catalogs} reveal={reveal} />,
    },
    {
      name: 'Messages',
      content: (
        <>
          {returned !== undefined && (
            <JsonBlock
              label="Returned to the model"
              value={returned}
              folded={['/validated_a2ui_json']}
            />
          )}
          <JsonBlock label="Messages" meta={plural(messages.length, 'message')} value={messages} />
        </>
      ),
    },
  ];
  const spans =
    step.call === undefined
      ? {row, sources: [sourceLineOfStep(parse)], subject: 'parse'}
      : {row: step.call, sources: sourceLinesOfCall(step.call), subject: 'tool call'};
  tabs.push({
    name: 'Spans',
    facts: spans.sources.join(' · '),
    content: (
      <AgentSpans
        row={spans.row}
        events={events}
        startMs={startMs}
        subject={spans.subject}
        present={['Raw text', 'Messages']}
        {...(step.call !== undefined && {lead: {line: sourceLineOfStep(parse), event: parse}})}
      />
    ),
  });
  return {connections, tabs, first: 'Raw text'};
}

/** The parse's raw text, its component ranges read once for its catalogs. */
function ParseRawText({
  parse,
  catalogs,
  reveal,
}: {
  parse: ParseEvent;
  catalogs: readonly KnownCatalog[] | undefined;
  reveal: RangeReveal | undefined;
}) {
  const {attributes} = parse;
  const reading = useMemo(
    () => rangesOfParse(attributes, readerCatalogOf(catalogs, attributes)),
    [attributes, catalogs],
  );
  const blocks = parseProblemsOf(parse).flatMap(problem =>
    problem.range === undefined ? [] : [problem.range],
  );
  return (
    <RawText
      text={attributes['a2ui.parse.input']}
      ranges={reading?.ranges ?? []}
      blocks={blocks}
      reveal={reveal}
      sentence={rangesSentenceOf(reading, attributes['a2ui.parse.inference_format'])}
    />
  );
}

/** The sources of the tool call's own spans, the parse's left out. */
function sourceLinesOfCall(call: CallRow): string[] {
  return [
    ...new Set(
      call.spans.filter(span => span.attributes['a2ui.event.kind'] !== 'parse').map(sourceLineOf),
    ),
  ];
}

/** A failed prompt generation's span, in one column under its section. */
export function GenerationBlocks({
  generation,
  events,
  startMs,
}: {
  generation: PromptGenerationEvent;
  events: readonly TurnRecordEvent[];
  startMs: number;
}) {
  const row: CallRow = {kind: 'tool', id: generation.spanId, spans: [generation as OtherEvent]};
  return (
    <Section label="From the agent’s spans" meta={sourceLineOfStep(generation)} open>
      <AgentSpans row={row} events={events} startMs={startMs} subject="prompt generation" />
    </Section>
  );
}
