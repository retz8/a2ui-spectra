/**
 * A parse's detail under its problems: the model call it read, the call
 * that retried it, its raw text with its component ranges, its messages,
 * what the toolset returned to the model, and its spans. A failed prompt
 * generation's detail is its spans alone, its problem block above.
 */
import {useMemo} from 'react';

import type {NodeRef} from '@/model/address.ts';
import {
  parseProblemsOf,
  rangesSentenceOf,
  readFromOf,
  retriedByOf,
  sourceLineOfStep,
} from '@/model/a2ui_step.ts';
import type {CallRow} from '@/model/call_rows.ts';
import {rangesOfParse} from '@/model/ranges.ts';
import type {ReaderCatalog} from '@/model/readers/reading.ts';
import type {
  OtherEvent,
  ParseEvent,
  PromptGenerationEvent,
  TurnRecordEvent,
} from '@/model/record.ts';
import type {Step} from '@/model/steps.ts';

import {AgentSpans} from './AgentSpans.tsx';
import {DetailLink} from './CallParts.tsx';
import {JsonBlock} from './JsonBlock.tsx';
import {type RangeReveal, RawText} from './RawText.tsx';

export function ParseBlocks({
  step,
  events,
  startMs,
  catalog,
  selectedNode,
  onSelectNode,
  onStep,
  reveal,
}: {
  step: Step;
  events: readonly TurnRecordEvent[];
  startMs: number;
  catalog: ReaderCatalog;
  selectedNode: NodeRef | undefined;
  /** Selects a component by its range in the raw text, keeping this parse selected. */
  onSelectNode: (node: NodeRef) => void;
  /** Selects another step of the turn. */
  onStep: (stepId: string) => void;
  reveal: RangeReveal | undefined;
}) {
  const parse = step.parse!;
  const {attributes} = parse;
  const reading = useMemo(() => rangesOfParse(attributes, catalog), [attributes, catalog]);
  const blocks = parseProblemsOf(parse).flatMap(problem =>
    problem.range === undefined ? [] : [problem.range],
  );
  const readFrom = readFromOf(events, parse, startMs);
  const retried = retriedByOf(events, parse, startMs);
  const messages = attributes['a2ui.parse.messages'] ?? [];
  const returned = attributes['gen_ai.tool.call.result'];
  const row: CallRow = step.call ?? {kind: 'tool', id: parse.spanId, spans: [parse as OtherEvent]};
  return (
    <>
      <div className="flex flex-wrap items-baseline gap-x-2.5 gap-y-1">
        <span className="section-label shrink-0">Read from</span>
        {readFrom.stepId === undefined ? (
          <span className="text-muted-foreground">{readFrom.text}</span>
        ) : (
          <DetailLink onClick={() => onStep(readFrom.stepId!)}>{readFrom.text}</DetailLink>
        )}
        {retried !== undefined && (
          <>
            <span className="text-muted-foreground">·</span>
            <DetailLink onClick={() => onStep(retried.stepId)}>{retried.text}</DetailLink>
          </>
        )}
      </div>
      <RawText
        text={attributes['a2ui.parse.input']}
        ranges={reading?.ranges ?? []}
        blocks={blocks}
        selected={selectedNode}
        onSelect={onSelectNode}
        reveal={reveal}
        sentence={rangesSentenceOf(reading, attributes['a2ui.parse.inference_format'])}
      />
      <JsonBlock label="Messages" value={messages} folded={['']} />
      {returned !== undefined && <JsonBlock label="Returned to the model" value={returned} />}
      <AgentSpans
        row={row}
        events={events}
        startMs={startMs}
        subject="parse"
        sources={[
          ...(step.call === undefined ? [] : sourceLinesOfCall(step.call)),
          sourceLineOfStep(parse),
        ]}
      />
    </>
  );
}

/** The sources of the tool call's own spans, the parse's left out. */
function sourceLinesOfCall(call: CallRow): string[] {
  const lines = new Set<string>();
  for (const span of call.spans) {
    if (span.attributes['a2ui.event.kind'] === 'parse') continue;
    const attributes = span.attributes as Record<string, unknown>;
    const dialect = attributes['a2ui.received.dialect'];
    const source =
      dialect === 'adk'
        ? 'ADK spans'
        : dialect === 'openinference'
          ? 'OpenInference spans'
          : dialect === 'genai'
            ? 'GenAI spans'
            : typeof dialect === 'string'
              ? `${dialect} spans`
              : 'Received spans';
    const scope = [attributes['otel.scope.name'], attributes['otel.scope.version']]
      .filter((part): part is string => typeof part === 'string' && part !== '')
      .join(' ');
    lines.add(scope === '' ? source : `${source} · ${scope}`);
  }
  return [...lines];
}

export function GenerationBlocks({
  step,
  events,
  startMs,
}: {
  step: Step;
  events: readonly TurnRecordEvent[];
  startMs: number;
}) {
  const generation: PromptGenerationEvent = step.generation!;
  const row: CallRow = {kind: 'tool', id: generation.spanId, spans: [generation as OtherEvent]};
  return (
    <AgentSpans
      row={row}
      events={events}
      startMs={startMs}
      subject="prompt generation"
      sources={[sourceLineOfStep(generation)]}
    />
  );
}

export type {ParseEvent};
