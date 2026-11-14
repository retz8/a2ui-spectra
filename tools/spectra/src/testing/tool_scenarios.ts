/**
 * What the tool capture suite and the tool replay suite share: the client
 * scenarios run through the tool proxy, where each transport's server is,
 * and the comparison of tool call events with the expected record's, once
 * what varies from run to run is normalised.
 */
import assert from 'node:assert/strict';

import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {SSEClientTransport} from '@modelcontextprotocol/sdk/client/sse.js';
import {StreamableHTTPClientTransport} from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import {CreateMessageRequestSchema} from '@modelcontextprotocol/sdk/types.js';

import {isEventOfKind, type ToolCallEvent, type Turn} from '../record/turn_record.js';

export type Transport = 'streamable_http' | 'streamable_http_json' | 'http_sse' | 'http';

/** Where each transport's server is on the tool server. */
export const PATHS: Record<Transport, string> = {
  streamable_http: '/mcp',
  streamable_http_json: '/mcp/json',
  http_sse: '/sse',
  http: '/',
};

/** What Spectra generates rather than reads off the traffic, which the comparison skips. */
const GENERATED_FIELDS = new Set([
  'traceId',
  'spanId',
  'parentSpanId',
  'startTimeUnixNano',
  'endTimeUnixNano',
]);
/** The server's port, and the headers the HTTP client and server add on their own. */
const GENERATED_ATTRIBUTES = new Set([
  'server.port',
  'http.request.header.host',
  'http.request.header.content-length',
  'http.request.header.connection',
  'http.request.header.user-agent',
  'http.request.header.accept-encoding',
  'http.request.header.accept-language',
  'http.request.header.sec-fetch-mode',
  'http.response.header.date',
  'http.response.header.content-length',
  'http.response.header.keep-alive',
]);

/**
 * Runs `use` with a client connected over the transport, which answers
 * sampling with a fixed reply, and closes it after, once every message the
 * client sent has been posted: an answer to a server's request that arrived
 * just before its tool's result, as a replayed stream gives them, is posted
 * before the client goes.
 */
export async function withClient(
  transport: Transport,
  url: URL,
  use: (
    client: Client,
    carrier: SSEClientTransport | StreamableHTTPClientTransport,
  ) => Promise<void>,
): Promise<void> {
  const client = new Client(
    {name: 'spectra-tool-capture', version: '0.0.1'},
    {capabilities: {sampling: {}}},
  );
  client.setRequestHandler(CreateMessageRequestSchema, () => ({
    role: 'assistant' as const,
    model: 'stand-in',
    content: {type: 'text' as const, text: 'Yes.'},
    stopReason: 'endTurn',
  }));
  const carrier =
    transport === 'http_sse' ? new SSEClientTransport(url) : new StreamableHTTPClientTransport(url);
  const sending = new Set<Promise<void>>();
  type Send = (...args: Parameters<SSEClientTransport['send']>) => Promise<void>;
  const send: Send = carrier.send.bind(carrier);
  carrier.send = (...args: Parameters<Send>) => {
    const sent = send(...args);
    sending.add(sent);
    void sent.then(
      () => sending.delete(sent),
      () => sending.delete(sent),
    );
    return sent;
  };
  try {
    await client.connect(carrier);
    await use(client, carrier);
    await new Promise(resolve => setImmediate(resolve));
    await Promise.allSettled([...sending]);
  } finally {
    await client.close();
  }
}

/** A reply a plain HTTP request received: its status, its content type and its body. */
export interface HttpReply {
  status: number;
  contentType: string;
  body: string;
}

/** Each named client scenario, run through the tool proxy at `url`; plain HTTP requests hand back the replies they received. */
export const SCENARIOS: Record<
  string,
  (url: URL, transport: Transport) => Promise<HttpReply[] | void>
> = {
  tools: (url, transport) =>
    withClient(transport, url, async client => {
      await client.listTools();
      await client.callTool({name: 'echo', arguments: {text: 'hello'}});
      await client.callTool({name: 'fail', arguments: {}});
      await assert.rejects(client.callTool({name: 'missing', arguments: {}}));
    }),
  resources_and_prompts: (url, transport) =>
    withClient(transport, url, async client => {
      await client.listResources();
      await client.readResource({uri: 'spectra://tool-server/readme'});
      await client.listPrompts();
      await client.getPrompt({name: 'greet', arguments: {name: 'Ada'}});
    }),
  // The SDK's client may handle the reply before progress that arrived just ahead of it on
  // HTTP+SSE's one stream, and drop the progress; the server sends it either way.
  progress_and_logging: (url, transport) =>
    withClient(transport, url, async client => {
      await client.callTool({name: 'progress', arguments: {}}, undefined, {onprogress: () => {}});
    }),
  sampling: (url, transport) =>
    withClient(transport, url, async client => {
      const result = await client.callTool({name: 'ask', arguments: {question: 'Ready?'}});
      assert.deepEqual(result.content, [{type: 'text', text: 'Yes.'}]);
    }),
  session_end: (url, transport) =>
    withClient(transport, url, async (_client, carrier) => {
      assert.ok(carrier instanceof StreamableHTTPClientTransport);
      await carrier.terminateSession();
    }),
  async http_routes(url) {
    const at = (route: string) => new URL(route, url);
    const read = async (response: Response): Promise<HttpReply> => ({
      status: response.status,
      contentType: response.headers.get('content-type') ?? '',
      body: await response.text(),
    });
    return [
      await read(await fetch(at('/api/json?q=1'))),
      await read(
        await fetch(at('/api/json'), {
          method: 'POST',
          headers: {'content-type': 'application/json'},
          body: '{"x": 1}',
        }),
      ),
      await read(await fetch(at('/api/events'))),
      await read(await fetch(at('/missing'))),
    ];
  },
};

/** A label for each distinct value, by order of first appearance. */
export class Labels {
  readonly #labels = new Map<string, string>();
  constructor(readonly prefix: string) {}
  of(value: string): string {
    let label = this.#labels.get(value);
    if (label === undefined) {
      label = `<${this.prefix}-${this.#labels.size + 1}>`;
      this.#labels.set(value, label);
    }
    return label;
  }
}

/** Every JSON-RPC id, progress token and cancelled request id relabelled by order of first appearance. */
export function relabelIds(value: unknown, ids: Labels): unknown {
  if (Array.isArray(value)) return value.map(item => relabelIds(item, ids));
  if (typeof value !== 'object' || value === null) return value;
  const object = value as Record<string, unknown>;
  return Object.fromEntries(
    Object.entries(object).map(([key, item]) => {
      const isId =
        (key === 'id' && object.jsonrpc === '2.0') ||
        key === 'progressToken' ||
        key === 'requestId' ||
        key === 'jsonrpc.request.id';
      return isId && (typeof item === 'string' || typeof item === 'number')
        ? [key, ids.of(String(item))]
        : [key, relabelIds(item, ids)];
    }),
  );
}

/**
 * The tool calls with what varies from run to run normalised: the fields
 * Spectra generates and the headers the HTTP stack adds left out, the
 * server's origin replaced, and each session id and request id relabelled.
 */
export function comparable(events: ToolCallEvent[]): unknown[] {
  const stripped = events.map(event => {
    const attributes = Object.fromEntries(
      Object.entries(event.attributes)
        .filter(([name]) => !GENERATED_ATTRIBUTES.has(name))
        .map(([name, value]) =>
          (name === 'url.full' || name === 'a2ui.mcp.stream.url') && typeof value === 'string'
            ? [name, value.replace(/^https?:\/\/[^/]+/, '<origin>')]
            : [name, value],
        ),
    );
    const fields = Object.fromEntries(
      Object.entries(event).filter(([key]) => !GENERATED_FIELDS.has(key)),
    );
    return {
      ...fields,
      attributes,
      ...(event.events && {
        events: event.events.map(({timeUnixNano: _time, ...rest}) => rest),
      }),
    };
  });
  const sessions = new Labels('session');
  let text = JSON.stringify(stripped);
  const ids = events
    .map(event => event.attributes['mcp.session.id'])
    .filter((id): id is string => typeof id === 'string' && !id.startsWith('<'));
  for (const id of ids) {
    text = text.replaceAll(id, sessions.of(id));
  }
  return relabelIds(JSON.parse(text), new Labels('id')) as unknown[];
}

export function toolCalls(turn: Turn): ToolCallEvent[] {
  return turn.events.filter((event): event is ToolCallEvent => isEventOfKind(event, 'tool_call'));
}
