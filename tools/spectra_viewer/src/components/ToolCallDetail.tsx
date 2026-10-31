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
import type {OtherEvent, TurnRecordEvent} from '@/model/record.ts';
import {
  argumentsOf,
  contentBlocksOf,
  isFullToolRow,
  resultOf,
  type ToolResult,
} from '@/model/tool_calls.ts';

import {AgentSpans} from './AgentSpans.tsx';
import {Exchange, Pairs, TextBlock} from './CallParts.tsx';
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
}: {
  row: CallRow;
  events: readonly TurnRecordEvent[];
  startMs: number;
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
      {hasExchange && <Exchange call={proxy} startsOpen={!mcp} tool />}
      {mcp && <McpNames proxy={proxy} />}
      {row.spans.length > 0 && <AgentSpans row={row} events={events} startMs={startMs} />}
    </>
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

/** A labelled list of text blocks and JSON blocks. */
function Parts({
  label,
  meta,
  parts,
}: {
  label: string;
  meta: string;
  parts: ReadonlyArray<{text: string} | {json: unknown}>;
}) {
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
      <BlockLabel label={label} meta={meta} />
      {parts.map((part, index) =>
        'text' in part ? (
          <p key={index} className="rounded-lg bg-tint px-3 py-2.5 break-words whitespace-pre-wrap">
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
