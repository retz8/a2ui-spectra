/**
 * A tool call's detail, in a model call's order with Arguments and Result in
 * place of the usage, the request and the response: Arguments as JSON;
 * Result, a text block as text and every other block as JSON, labelled
 * "Error" for the tool's own `isError` or a JSON-RPC error; the exchange,
 * folded on MCP and open on an HTTP tool; MCP's names; then the agent's
 * spans. A housekeeping request shows its params and its result in the same
 * places. A call read from spans only takes its arguments and result from
 * the span, each label naming the spans.
 */
import {
  type CallRow,
  isMcpEvent,
  readingOf,
  sourceOfNames,
  timedEventOf,
} from '@/model/call_rows.ts';
import type {CallReplay, RecordedCall, ToolMissList} from '@/model/provenance.ts';
import type {OtherEvent, TurnRecordEvent} from '@/model/record.ts';
import {useBlockFold} from '@/state/block_folds.ts';
import {
  argumentsOf,
  contentBlocksOf,
  isFullToolRow,
  resultOf,
  type ToolResult,
} from '@/model/tool_calls.ts';

import {AgentSpans} from './AgentSpans.tsx';
import {DetailLink, Exchange, Pairs, ReplaySentence, TextBlock} from './CallParts.tsx';
import {formatOffset} from './format.ts';
import {BlockLabel, JsonBlock, JsonLines} from './JsonBlock.tsx';

/** MCP's names, in the order the block lists them; any other MCP or JSON-RPC name follows. */
const MCP_NAMES = [
  'mcp.method.name',
  'mcp.protocol.version',
  'mcp.session.id',
  'jsonrpc.request.id',
];

export function ToolCallBlocks({
  row,
  events,
  startMs,
  replay,
  onRecorded,
}: {
  row: CallRow;
  events: readonly TurnRecordEvent[];
  startMs: number;
  /** What the call was, in a replayed turn. */
  replay?: CallReplay;
  /** Selects a recorded call in its source. */
  onRecorded: (recorded: RecordedCall) => void;
}) {
  const {fromSpans} = readingOf(row);
  const from = (names: readonly string[]) => {
    if (!fromSpans) return '';
    const source = sourceOfNames(row, names);
    return source === undefined ? '' : ` · from ${source}`;
  };
  const proxy = row.proxy;
  const mcp = proxy !== undefined && isMcpEvent(proxy);
  const full = isFullToolRow(row);
  const args = argumentsOf(row);
  const result = resultOf(row);
  const inFlight = timedEventOf(row).endTimeUnixNano === undefined;
  const hasExchange =
    proxy !== undefined &&
    (proxy.attributes['http.request.method'] !== undefined || (proxy.events ?? []).length > 0);
  return (
    <>
      {replay?.kind === 'served' && <ReplaySentence replay={replay} onRecorded={onRecorded} />}
      {replay?.kind === 'toolMiss' && (
        <RecordedRequests list={replay.list} onRecorded={onRecorded} />
      )}
      {args !== undefined && (
        <JsonBlock
          label={`${full ? 'Arguments' : 'Params'}${from(['gen_ai.tool.call.arguments'])}`}
          value={args}
        />
      )}
      {result !== undefined ? (
        <ResultBlock result={result} suffix={from(['gen_ai.tool.call.result'])} />
      ) : (
        inFlight && <p className="text-muted-foreground">No result yet.</p>
      )}
      {replay?.kind === 'toolMiss' && proxy?.status?.message !== undefined && (
        <TextBlock label="Error" meta="HTTP 502" text={proxy.status.message} />
      )}
      {hasExchange && <Exchange call={proxy} startsOpen={!mcp} tool />}
      {mcp && <McpNames proxy={proxy} />}
      {row.spans.length > 0 && <AgentSpans row={row} events={events} startMs={startMs} />}
    </>
  );
}

/** A tool miss's list: the recorded requests of the same method and tool, each its arguments in brief and a link to it. */
function RecordedRequests({
  list,
  onRecorded,
}: {
  list: ToolMissList;
  onRecorded: (recorded: RecordedCall) => void;
}) {
  const fold = useBlockFold('Recorded requests');
  if (list.rows.length === 0) {
    return (
      <p className="text-muted-foreground">No recorded request of this tool to compare with.</p>
    );
  }
  return (
    <section className="flex min-w-0 flex-col gap-1.5">
      <BlockLabel label="Recorded requests" meta={list.of} fold={fold} />
      {fold.open && (
        <div className="flex flex-col rounded-lg bg-tint py-1 text-xs">
          {list.rows.map(({args, recorded}) => (
            <div
              key={recorded.call.spanId}
              className="flex h-7 min-w-0 items-center gap-2 pr-3 pl-8.5"
            >
              <span className="min-w-0 flex-1 truncate font-mono font-medium">{args}</span>
              <span className="shrink-0">
                <DetailLink onClick={() => onRecorded(recorded)}>
                  the call at {formatOffset(recorded.offsetMs)}, turn {recorded.turn}
                </DetailLink>
              </span>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * The result: the tool's content, a text block as text and every other
 * block as JSON, the tool's own text first; a resource's contents, text as
 * text, with its media type and URI; anything else as JSON. Labelled "Error"
 * for the tool's own `isError` or a JSON-RPC error.
 */
function ResultBlock({result, suffix}: {result: ToolResult; suffix: string}) {
  const label = `${result.error ? 'Error' : 'Result'}${suffix}`;
  if (result.code !== undefined) {
    return <JsonBlock label={label} meta={`JSON-RPC ${result.code}`} value={result.value} />;
  }
  const blocks = contentBlocksOf(result.value);
  if (blocks !== undefined) {
    const isText = (block: unknown) =>
      isRecord(block) && block.type === 'text' && typeof block.text === 'string';
    const ordered = [...blocks.filter(isText), ...blocks.filter(block => !isText(block))];
    const types = [
      ...new Set(blocks.map(block => (isRecord(block) ? String(block.type ?? '') : ''))),
    ].filter(Boolean);
    const structured = isRecord(result.value) ? result.value.structuredContent : undefined;
    return (
      <Parts
        label={label}
        meta={types.join(', ')}
        parts={[
          ...ordered.map(block =>
            isText(block) ? {text: (block as {text: string}).text} : {json: block},
          ),
          ...(structured !== undefined ? [{json: structured}] : []),
        ]}
      />
    );
  }
  const contents =
    isRecord(result.value) && Array.isArray(result.value.contents)
      ? result.value.contents
      : undefined;
  if (contents !== undefined) {
    const first = isRecord(contents[0]) ? contents[0] : {};
    const meta = [first.mimeType, first.uri]
      .filter((part): part is string => typeof part === 'string')
      .join(' · ');
    return (
      <Parts
        label={label}
        meta={meta}
        parts={contents.map(content =>
          isRecord(content) && typeof content.text === 'string'
            ? {text: content.text}
            : {json: content},
        )}
      />
    );
  }
  return <JsonBlock label={label} value={result.value} />;
}

/**
 * A labelled list of text blocks and JSON blocks, with no block for empty
 * text; a list of empty text alone is its label line.
 */
function Parts({
  label,
  meta,
  parts: all,
}: {
  label: string;
  meta: string;
  parts: ReadonlyArray<{text: string} | {json: unknown}>;
}) {
  const fold = useBlockFold(label);
  const parts = all.filter(part => !('text' in part) || part.text !== '');
  if (parts.length === 0 && all.length > 0) {
    // Indented by the fold chevron's width and gap, so its label lines up with the labels that fold.
    return (
      <div className="pl-6">
        <BlockLabel
          label={label}
          meta={meta === '' || meta === 'text' ? 'empty text' : `${meta} · empty text`}
        />
      </div>
    );
  }
  if (parts.length === 1) {
    const [part] = parts;
    return 'text' in part ? (
      <TextBlock label={label} meta={meta} text={part.text} />
    ) : (
      <JsonBlock label={label} meta={meta} value={part.json} />
    );
  }
  return (
    <section className="flex min-w-0 flex-col gap-1.5">
      <BlockLabel label={label} meta={meta} fold={fold} />
      {fold.open &&
        parts.map((part, index) =>
          'text' in part ? (
            <p
              key={index}
              className="rounded-lg bg-tint px-3 py-2.5 break-words whitespace-pre-wrap"
            >
              {part.text}
            </p>
          ) : (
            <JsonLines key={index} value={part.json} />
          ),
        )}
    </section>
  );
}

/** MCP's names the tool proxy recorded: the method, the protocol version, the session and the request id. */
function McpNames({proxy}: {proxy: OtherEvent}) {
  const attributes = proxy.attributes as Record<string, unknown>;
  const others = Object.keys(attributes).filter(
    name =>
      !MCP_NAMES.includes(name) &&
      (name.startsWith('mcp.') || name.startsWith('jsonrpc.') || name.startsWith('rpc.')),
  );
  const pairs = [...MCP_NAMES, ...others].flatMap(name =>
    attributes[name] === undefined ? [] : [{key: name, value: String(attributes[name])}],
  );
  return <Pairs label="MCP" layout="mcp" pairs={pairs} />;
}
