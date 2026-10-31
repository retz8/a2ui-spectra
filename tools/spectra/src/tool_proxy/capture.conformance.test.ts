/**
 * The tool capture suite (`conformance/tool_capture/`): each named client
 * scenario run with the MCP SDK's own client, or plain HTTP requests, through
 * the tool proxy to the conformance workspace's tool server, over each
 * transport its case names. The `tool_call` events the proxy writes into the
 * turn must match the transport's expected record once times, span ids,
 * session ids, request ids and the server's port are normalised.
 *
 * With `SPECTRA_WRITE_TOOL_CAPTURE=1` the harness writes each expected record
 * from what it captures instead of comparing, for a case being added; the
 * record written is then checked by hand.
 */
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import {createServer, type Server} from 'node:http';
import * as path from 'node:path';
import {before, describe, it} from 'node:test';
import {fileURLToPath} from 'node:url';

import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {SSEClientTransport} from '@modelcontextprotocol/sdk/client/sse.js';
import {StreamableHTTPClientTransport} from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import {CreateMessageRequestSchema} from '@modelcontextprotocol/sdk/types.js';
import * as yaml from 'js-yaml';

import {CallPlacer} from '../placement.js';
import {
  isEventOfKind,
  type ToolCallEvent,
  type Turn,
  type TurnEvent,
  type TurnRecord,
} from '../record/turn_record.js';
import {startToolServer} from '../testing/tool_server.js';
import {turnRecordErrors} from '../testing/turn_record_schema.js';
import {startToolProxy} from './proxy.js';
import type {ToolServer} from './servers.js';

type Transport = 'streamable_http' | 'streamable_http_json' | 'http_sse' | 'http';

interface CaptureToolCase {
  name: string;
  description: string;
  action: 'capture_tool';
  scenario: string;
  expect: Partial<Record<Transport, string>>;
}

/** Walks up from this file until it finds the shared conformance directory. */
function findConformanceDir(): string {
  let dir = path.dirname(fileURLToPath(import.meta.url));
  while (dir !== path.parse(dir).root) {
    const candidate = path.join(dir, 'conformance', 'conformance_schema.json');
    if (fs.existsSync(candidate)) {
      return path.dirname(candidate);
    }
    dir = path.dirname(dir);
  }
  throw new Error('Could not find conformance/conformance_schema.json');
}

const CONFORMANCE_DIR = findConformanceDir();
const SUITE = path.join(CONFORMANCE_DIR, 'tool_capture/capture_v0_1.yaml');
const WRITE = process.env.SPECTRA_WRITE_TOOL_CAPTURE === '1';

const TRACE_ID = 'c'.repeat(32);
const TURN_SPAN_ID = 'd'.repeat(16);

/** Where each transport's server is on the tool server. */
const PATHS: Record<Transport, string> = {
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

/** Runs `use` with a client connected over the transport, which answers sampling with a fixed reply, and closes it after. */
async function withClient(
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
  try {
    await client.connect(carrier);
    await use(client, carrier);
  } finally {
    await client.close();
  }
}

/** Each named client scenario, run through the tool proxy at `url`. */
const SCENARIOS: Record<string, (url: URL, transport: Transport) => Promise<void>> = {
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
    await (await fetch(at('/api/json?q=1'))).text();
    await (
      await fetch(at('/api/json'), {
        method: 'POST',
        headers: {'content-type': 'application/json'},
        body: '{"x": 1}',
      })
    ).text();
    await (await fetch(at('/api/events'))).text();
    await (await fetch(at('/missing'))).text();
  },
};

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server: Server = createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      const port = typeof address === 'object' && address !== null ? address.port : 0;
      server.close(() => resolve(port));
    });
  });
}

/** A label for each distinct value, by order of first appearance. */
class Labels {
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
function relabelIds(value: unknown, ids: Labels): unknown {
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
function comparable(events: ToolCallEvent[]): unknown[] {
  const stripped = events.map(event => {
    const attributes = Object.fromEntries(
      Object.entries(event.attributes)
        .filter(([name]) => !GENERATED_ATTRIBUTES.has(name))
        .map(([name, value]) =>
          name === 'url.full' && typeof value === 'string'
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

function toolCalls(turn: Turn): ToolCallEvent[] {
  return turn.events.filter((event): event is ToolCallEvent => isEventOfKind(event, 'tool_call'));
}

function turnEvent(): TurnEvent {
  return {
    traceId: TRACE_ID,
    spanId: TURN_SPAN_ID,
    name: 'invoke_agent',
    kind: 3,
    startTimeUnixNano: '1792577000000000000',
    endTimeUnixNano: '1792577001000000000',
    attributes: {
      'a2ui.event.kind': 'turn',
      'gen_ai.operation.name': 'invoke_agent',
      'a2ui.turn.outcome': 'completed',
      'a2ui.turn.capture_paths': ['wire', 'tool_proxy'],
      'a2ui.turn.writer.name': 'a2ui-spectra',
      'a2ui.turn.writer.version': '0.0.0',
    },
    status: {code: 1},
  };
}

/** The expected record a capture gives: the stand-in turn event and the normalised calls, with schema-valid stand-ins for what Spectra generates. */
function expectedRecord(events: ToolCallEvent[]): TurnRecord {
  const calls = comparable(events) as Array<Omit<ToolCallEvent, 'traceId' | 'spanId'>>;
  return {
    version: 'v0.1',
    turns: [
      {
        events: [
          turnEvent(),
          ...calls.map((call, index) => {
            const start = 1792577000100000000n + BigInt(index) * 10_000_000n;
            // A notification the server sent starts and ends at its arrival.
            const instant = call.kind === 4 && call.attributes['jsonrpc.request.id'] === undefined;
            return {
              traceId: TRACE_ID,
              spanId: (index + 1).toString(16).padStart(16, '0'),
              parentSpanId: TURN_SPAN_ID,
              ...call,
              startTimeUnixNano: start.toString(),
              endTimeUnixNano: (instant ? start : start + 5_000_000n).toString(),
              ...(call.events && {
                events: call.events.map(chunk => ({...chunk, timeUnixNano: start.toString()})),
              }),
            } as ToolCallEvent;
          }),
        ],
      },
    ],
  };
}

let toolServerOrigin = '';
before(async () => {
  toolServerOrigin = (await startToolServer(await freePort())).origin;
});

async function runCase(
  c: CaptureToolCase,
  transport: Transport,
  expectFile: string,
): Promise<void> {
  const handedOn: Turn[] = [];
  const unplaced: string[] = [];
  const placer = new CallPlacer({
    onTurn: notification => {
      if (notification.type === 'turn_closed') handedOn.push(notification.turn);
    },
    log: line => unplaced.push(line),
  });
  placer.onTurn({
    type: 'turn_opened',
    traceId: TRACE_ID,
    spanId: TURN_SPAN_ID,
    startTimeUnixNano: String(BigInt(Date.now()) * 1_000_000n),
  });
  const port = await freePort();
  const proxyOrigin = `http://127.0.0.1:${port}`;
  const original = new URL(`${toolServerOrigin}${PATHS[transport]}`);
  const server: ToolServer = {
    variable: 'TOOL_SERVER_URL',
    port,
    proxyOrigin,
    value: `${proxyOrigin}${original.pathname}`,
    original,
  };
  const lines: string[] = [];
  const proxy = await startToolProxy({
    servers: [server],
    place: call => placer.tryPlace(call),
    log: line => lines.push(line),
  });
  try {
    const scenario = SCENARIOS[c.scenario];
    assert.ok(scenario !== undefined, `the scenario ${c.scenario} exists`);
    await scenario(new URL(server.value), transport);
    placer.onTurn({type: 'turn_closed', traceId: TRACE_ID, turn: {events: [turnEvent()]}});
    const deadline = Date.now() + 5000;
    while (handedOn.length === 0) {
      assert.ok(
        Date.now() < deadline,
        `The turn was not handed on; the proxy said:\n${lines.join('\n')}`,
      );
      await new Promise(resolve => setTimeout(resolve, 10));
    }
  } finally {
    await proxy.close();
  }
  assert.deepEqual(unplaced, [], 'every call was placed');
  assert.deepEqual(lines, [], 'the proxy had nothing to say');
  const [turn] = handedOn;
  const record: TurnRecord = {version: 'v0.1', turns: [turn]};
  assert.deepEqual(turnRecordErrors(record), [], 'the captured record validates');
  const captured = toolCalls(turn);
  for (const [index, event] of captured.entries()) {
    assert.equal(event.traceId, TRACE_ID, `call ${index + 1}: the turn's trace id`);
    assert.equal(event.parentSpanId, TURN_SPAN_ID, `call ${index + 1}: under the turn event`);
    assert.match(event.spanId, /^[0-9a-f]{16}$/);
    assert.ok(
      BigInt(event.endTimeUnixNano ?? '0') >= BigInt(event.startTimeUnixNano),
      `call ${index + 1}: ends after it starts`,
    );
    assert.equal(
      event.attributes['server.port'],
      Number(original.port),
      `call ${index + 1}: the server's port`,
    );
  }
  const file = path.join(CONFORMANCE_DIR, expectFile);
  if (WRITE) {
    fs.mkdirSync(path.dirname(file), {recursive: true});
    fs.writeFileSync(file, `${JSON.stringify(expectedRecord(captured), null, 2)}\n`);
    return;
  }
  const expected = JSON.parse(fs.readFileSync(file, 'utf8')) as TurnRecord;
  assert.deepEqual(turnRecordErrors(expected), [], 'the expected record validates');
  assert.deepEqual(
    comparable(captured),
    comparable(toolCalls(expected.turns[expected.turns.length - 1])),
    'the calls match the expected record',
  );
}

const cases = yaml.load(fs.readFileSync(SUITE, 'utf8')) as CaptureToolCase[];

describe('tool capture v0.1', () => {
  for (const c of cases) {
    for (const [transport, expectFile] of Object.entries(c.expect) as Array<[Transport, string]>) {
      it(`${c.name} over ${transport}`, () => runCase(c, transport, expectFile));
    }
  }
});
