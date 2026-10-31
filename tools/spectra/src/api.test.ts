import assert from 'node:assert/strict';
import {mkdtempSync, rmSync, writeFileSync} from 'node:fs';
import {createServer} from 'node:http';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {after, describe, it} from 'node:test';

import {SseParser} from './a2a/sse.js';
import type {ListedTurn, SessionContext} from './api.js';
import {CatalogRegistry} from './catalog/registry.js';
import {CONFIG_SCHEMA, type PriceOverride} from './config.js';
import {MessageBox} from './message_box.js';
import type {Turn, TurnRecord, WireInputEvent, WirePart} from './record/turn_record.js';
import {startViewerServer, type ViewerServer} from './server.js';
import {TurnStore} from './store/store.js';
import {TurnHub} from './turn_hub.js';

const dirs: string[] = [];
const servers: ViewerServer[] = [];
after(async () => {
  for (const server of servers) await server.close();
  for (const dir of dirs) rmSync(dir, {recursive: true, force: true});
});

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      server.close(() =>
        typeof address === 'object' && address !== null
          ? resolve(address.port)
          : reject(new Error('No port.')),
      );
    });
  });
}

const trace = (n: number) => String(n).padStart(32, '0');

const CONTEXT: SessionContext = {
  agentName: 'Restaurant Agent',
  agentUrl: 'http://localhost:10002/',
  mode: 'run',
  proxyAddress: 'http://127.0.0.1:1/a2a',
  previewPages: ['http://localhost:5174/spectra-preview'],
  a2aVersions: ['0.3.0'],
  a2uiExtensions: [
    {
      version: 'v0.9',
      catalogIds: ['https://a2ui.org/specification/v0_9/catalogs/basic/catalog.json'],
    },
  ],
  examples: ['Find me the top 10 chinese restaurants in the US'],
};

/** A closed turn: its turn event alone, starting n seconds after 2026-10-21T10:00:00Z. */
function closedTurn(n: number, conversationId?: string): Turn {
  return {
    events: [
      {
        traceId: trace(n),
        spanId: '0000000000000000',
        name: 'invoke_agent',
        kind: 3,
        startTimeUnixNano: `${1792576800 + n}000000000`,
        endTimeUnixNano: `${1792576800 + n}500000000`,
        attributes: {
          'a2ui.event.kind': 'turn',
          'gen_ai.operation.name': 'invoke_agent',
          ...(conversationId !== undefined && {'gen_ai.conversation.id': conversationId}),
          'a2ui.turn.outcome': 'completed',
          'a2ui.turn.capture_paths': ['wire'],
          'a2ui.turn.writer.name': 'a2ui-spectra',
          'a2ui.turn.writer.version': '0.0.1',
        },
        status: {code: 1},
      },
    ],
  };
}

/** The host's message of turn n. */
function wireInput(n: number, ...parts: WirePart[]): WireInputEvent {
  return {
    traceId: trace(n),
    spanId: '0000000000000001',
    parentSpanId: '0000000000000000',
    name: 'wire_input',
    kind: 1,
    startTimeUnixNano: `${1792576800 + n}100000000`,
    attributes: {'a2ui.event.kind': 'wire_input', 'a2ui.wire.message': {role: 'user', parts}},
  };
}

function openTurn(turns: TurnHub, n: number): void {
  turns.onTurn({
    type: 'turn_opened',
    traceId: trace(n),
    spanId: '0'.repeat(16),
    startTimeUnixNano: `${1792576800 + n}000000000`,
  });
}

async function serve(heartbeatMs = 60_000, prices?: Record<string, PriceOverride>) {
  const dir = mkdtempSync(path.join(tmpdir(), 'spectra-api-'));
  dirs.push(dir);
  const store = await TurnStore.open(dir);
  const turns = new TurnHub();
  const box = new MessageBox({
    card: {
      capabilities: {streaming: true},
      supportedInterfaces: [
        {url: 'http://127.0.0.1:1/a2a', protocolBinding: 'JSONRPC', protocolVersion: '1.0'},
      ],
    },
    turns,
    fetch: () => Promise.reject(new Error('No proxy in this test.')),
  });
  const port = await freePort();
  const server = await startViewerServer({
    port,
    viewerDir: dir,
    allowedHosts: [],
    api: {
      store,
      turns,
      box,
      heartbeatMs,
      context: CONTEXT,
      catalogs: CatalogRegistry.builtIn(),
      ...(prices !== undefined && {prices}),
    },
  });
  servers.push(server);
  const base = `http://127.0.0.1:${port}`;
  return {store, turns, box, base};
}

async function getJson(url: string): Promise<{status: number; body: unknown}> {
  const response = await fetch(url);
  assert.match(response.headers.get('content-type') ?? '', /^application\/json/);
  return {status: response.status, body: await response.json()};
}

function post(url: string, body: unknown, type = 'application/json') {
  return fetch(url, {method: 'POST', headers: {'content-type': type}, body: JSON.stringify(body)});
}

describe('the API', () => {
  it('lists the stored turns and the open turns, newest first', async () => {
    const {store, turns, base} = await serve();
    await store.write(closedTurn(1, 'ctx-1'));
    await store.write(closedTurn(3));
    openTurn(turns, 2);
    openTurn(turns, 4);
    const {status, body} = await getJson(`${base}/api/turns`);
    assert.equal(status, 200);
    assert.deepEqual((body as {turns: ListedTurn[]}).turns, [
      {traceId: trace(4), startTime: '2026-10-21T10:00:04.000Z', open: true},
      {
        traceId: trace(3),
        startTime: '2026-10-21T10:00:03.000Z',
        outcome: 'completed',
        durationMs: 500,
        rejections: 0,
      },
      {traceId: trace(2), startTime: '2026-10-21T10:00:02.000Z', open: true},
      {
        traceId: trace(1),
        conversationId: 'ctx-1',
        startTime: '2026-10-21T10:00:01.000Z',
        outcome: 'completed',
        durationMs: 500,
        rejections: 0,
      },
    ]);
  });

  it("lists each turn's outcome, input in brief and schema check, an open turn's input once it arrives", async () => {
    const {store, turns, base} = await serve();
    const closed = closedTurn(1, 'ctx-1');
    closed.events.push(wireInput(1, {type: 'text', content: 'Book a table'}), {
      traceId: trace(1),
      spanId: '0000000000000002',
      parentSpanId: '0000000000000000',
      name: 'check schema',
      kind: 1,
      startTimeUnixNano: `${1792576801}600000000`,
      attributes: {
        'a2ui.event.kind': 'check',
        'a2ui.check.name': 'schema',
        'a2ui.check.passed': false,
        'a2ui.check.protocol_version': 'v0.9',
        'a2ui.check.findings': [{code: 'VALIDATION_FAILED', message: 'Bad.'}],
      },
    });
    await store.write(closed);
    openTurn(turns, 2);
    openTurn(turns, 3);
    turns.onTurn({
      type: 'wire_event',
      traceId: trace(3),
      event: wireInput(3, {type: 'a2ui', content: {version: 'v0.9', action: {name: 'next'}}}),
    });
    const {body} = await getJson(`${base}/api/turns`);
    assert.deepEqual((body as {turns: ListedTurn[]}).turns, [
      {
        traceId: trace(3),
        startTime: '2026-10-21T10:00:03.000Z',
        open: true,
        input: {action: 'next'},
      },
      {traceId: trace(2), startTime: '2026-10-21T10:00:02.000Z', open: true},
      {
        traceId: trace(1),
        conversationId: 'ctx-1',
        startTime: '2026-10-21T10:00:01.000Z',
        outcome: 'completed',
        durationMs: 500,
        input: {text: 'Book a table'},
        findings: 1,
        rejections: 0,
      },
    ]);
  });

  it("lists a turn's failed calls as its record stands, once the receiver's spans amend it", async () => {
    const {store, base} = await serve();
    const turn = closedTurn(1);
    await store.write(turn);
    const listed = async () =>
      ((await getJson(`${base}/api/turns`)).body as {turns: ListedTurn[]}).turns[0];
    assert.equal((await listed()).failedCalls, undefined);
    // A span the receiver placed after the turn was written, read from spans only, ended in error.
    await store.amend(trace(1), stored => ({
      events: [
        ...stored.events,
        {
          traceId: trace(1),
          spanId: '0000000000000005',
          parentSpanId: '0000000000000000',
          name: 'execute_tool get_restaurants',
          kind: 1,
          startTimeUnixNano: `${1792576801}200000000`,
          endTimeUnixNano: `${1792576801}300000000`,
          attributes: {
            'a2ui.event.kind': 'tool_call',
            'otel.scope.name': 'gcp.vertex.agent',
            'a2ui.received.attributes': {},
          },
          status: {code: 2},
        },
      ],
    }));
    assert.equal((await listed()).failedCalls, 1);
  });

  it("returns a closed turn's record, and says an open turn has none", async () => {
    const {store, turns, base} = await serve();
    await store.write(closedTurn(1, 'ctx-1'));
    await store.write(closedTurn(2, 'ctx-1'));
    openTurn(turns, 3);

    const record = await getJson(`${base}/api/turns/${trace(2)}`);
    assert.equal(record.status, 200);
    assert.deepEqual(record.body, {
      version: 'v0.1',
      turns: [closedTurn(1, 'ctx-1'), closedTurn(2, 'ctx-1')],
    } satisfies TurnRecord);

    const open = await getJson(`${base}/api/turns/${trace(3)}`);
    assert.equal(open.status, 409);
    assert.deepEqual(open.body, {error: 'The turn is still open, so it has no record yet.'});

    const missing = await getJson(`${base}/api/turns/${trace(9)}`);
    assert.equal(missing.status, 404);
  });

  it('returns a turn kept in memory after its write failed', async () => {
    const {store, base} = await serve();
    writeFileSync(path.join(store.turnsDir, 'ctx-1'), 'not a folder');
    await assert.rejects(store.write(closedTurn(1, 'ctx-1')));
    const listed = await getJson(`${base}/api/turns`);
    assert.deepEqual(
      (listed.body as {turns: ListedTurn[]}).turns.map(turn => turn.traceId),
      [trace(1)],
    );
    const record = await getJson(`${base}/api/turns/${trace(1)}`);
    assert.equal(record.status, 200);
    assert.deepEqual((record.body as TurnRecord).turns, [closedTurn(1, 'ctx-1')]);
  });

  it('catches the live stream up on open turns, then sends each event as it comes', async () => {
    const {turns, base} = await serve();
    openTurn(turns, 1);
    const response = await fetch(`${base}/api/stream`);
    assert.match(response.headers.get('content-type') ?? '', /^text\/event-stream/);
    const reader = response.body!.getReader();
    const sse = new SseParser();
    const text = new TextDecoder();
    const events: Array<{event?: string; data: unknown}> = [];
    const readUntil = async (count: number) => {
      while (events.length < count) {
        const {value, done} = await reader.read();
        assert.equal(done, false);
        for (const event of sse.push(text.decode(value, {stream: true}))) {
          events.push({event: event.event, data: JSON.parse(event.data)});
        }
      }
    };
    await readUntil(1);
    turns.onRecorded(closedTurn(1));
    await readUntil(2);
    await reader.cancel();
    assert.deepEqual(events, [
      {event: 'turn_opened', data: {traceId: trace(1), startTime: '2026-10-21T10:00:01.000Z'}},
      {event: 'turn_closed', data: {traceId: trace(1), turn: closedTurn(1)}},
    ]);
  });

  it('sends a heartbeat on the live stream, so a stream gone silent can be told apart', async () => {
    const {base} = await serve(20);
    const response = await fetch(`${base}/api/stream`);
    const reader = response.body!.getReader();
    const sse = new SseParser();
    const text = new TextDecoder();
    const events: Array<{event?: string; data: unknown}> = [];
    while (events.length < 2) {
      const {value} = await reader.read();
      for (const event of sse.push(text.decode(value, {stream: true}))) {
        events.push({event: event.event, data: JSON.parse(event.data)});
      }
    }
    await reader.cancel();
    assert.deepEqual(events, [
      {event: 'heartbeat', data: {}},
      {event: 'heartbeat', data: {}},
    ]);
  });

  it("serves the session's context: the agent's name and URL, the mode, the wire proxy's address, the preview pages and the card's details", async () => {
    const {base} = await serve();
    const {status, body} = await getJson(`${base}/api/context`);
    assert.equal(status, 200);
    assert.deepEqual(body, CONTEXT);
  });

  it("serves the message box's conversations and its routes", async () => {
    const {base} = await serve();
    assert.deepEqual((await getJson(`${base}/api/message-box`)).body, {
      conversations: [],
      a2aVersion: '1.0',
    });

    const empty = await post(`${base}/api/message-box/messages`, {text: ' '});
    assert.equal(empty.status, 400);
    const action = {version: 'v0.9', action: {name: 'book', surfaceId: 's', context: {}}};
    for (const body of [
      {},
      {text: 'Hi', action},
      {action: {version: 'v0.9'}},
      {action: {action: {}}},
      {text: 'Hi', dataModel: {version: 'v0.9'}},
      {text: 'Hi', dataModel: []},
    ]) {
      assert.equal((await post(`${base}/api/message-box/messages`, body)).status, 400);
    }
    const startsNone = await post(`${base}/api/message-box/messages`, {action});
    assert.equal(startsNone.status, 400);
    assert.deepEqual(await startsNone.json(), {
      error:
        'An action continues a conversation the message box started. Send it with that conversationId.',
    });
    const withModel = await post(`${base}/api/message-box/messages`, {
      action,
      dataModel: {version: 'v0.9', surfaces: {s: {}}},
      conversationId: 'ctx-9',
    });
    assert.equal(withModel.status, 404);
    const unreachable = await post(`${base}/api/message-box/messages`, {text: 'Hi'});
    assert.equal(unreachable.status, 502);
    assert.deepEqual(await unreachable.json(), {
      error: 'The message box could not reach the wire proxy: No proxy in this test.',
    });

    const notString = await post(`${base}/api/message-box/messages`, {
      text: 'Hi',
      conversationId: 1,
    });
    assert.equal(notString.status, 400);
    const unknown = await post(`${base}/api/message-box/messages`, {
      text: 'Hi',
      conversationId: 'ctx-9',
    });
    assert.equal(unknown.status, 404);
    assert.deepEqual(await unknown.json(), {
      error:
        'The message box did not start this conversation while Spectra runs. Send without a conversation to start a new one.',
    });
    assert.equal((await post(`${base}/api/message-box/new-conversation`, {})).status, 404);
  });

  it('serves the catalog definitions it knows, and the config schema', async () => {
    const {base} = await serve();
    const {status, body} = await getJson(`${base}/api/catalogs`);
    assert.equal(status, 200);
    const {catalogs} = body as {catalogs: Array<Record<string, unknown>>};
    assert.deepEqual(
      catalogs.map(({id, aliases, protocolVersion, source, title}) => ({
        id,
        aliases,
        protocolVersion,
        source,
        title,
      })),
      [
        {
          id: 'https://a2ui.org/specification/v0_9/catalogs/basic/catalog.json',
          aliases: ['https://a2ui.org/specification/v0_9_1/catalogs/basic/catalog.json'],
          protocolVersion: '0.9',
          source: 'built-in',
          title: 'A2UI Basic Catalog',
        },
        {
          id: 'https://a2ui.org/specification/v1_0/catalogs/basic/catalog.json',
          aliases: [],
          protocolVersion: '1.0',
          source: 'built-in',
          title: 'A2UI Basic Catalog',
        },
      ],
    );
    assert.equal(typeof (catalogs[0].definition as {components: unknown}).components, 'object');
    const schema = await getJson(`${base}/api/config.schema.json`);
    assert.equal(schema.status, 200);
    assert.deepEqual(schema.body, CONFIG_SCHEMA);
    const wrongMethod = await post(`${base}/api/catalogs`, {});
    assert.equal(wrongMethod.status, 405);
  });

  it("serves LiteLLM's price table as copied, its release and date, and the config's prices", async () => {
    const overrides = {'my-model': {input: 1, output: 2}};
    const {base} = await serve(60_000, overrides);
    const {status, body} = await getJson(`${base}/api/prices`);
    assert.equal(status, 200);
    const {release, date, entries} = body as {
      release: string;
      date: string;
      entries: Record<string, {litellm_provider: string; input_cost_per_token?: number}>;
    };
    assert.equal(release, 'v1.106.6');
    assert.equal(date, '2026-10-28');
    assert.deepEqual((body as {overrides: unknown}).overrides, overrides);
    assert.deepEqual(
      [...new Set(Object.values(entries).map(entry => entry.litellm_provider))].sort(),
      ['anthropic', 'gemini', 'openai'],
    );
    assert.equal(entries['gemini/gemini-3.6-flash'].input_cost_per_token, 7.5e-7);
    assert.deepEqual((await getJson(`${(await serve()).base}/api/prices`)).body, {
      release,
      date,
      entries,
      overrides: {},
    });
  });

  it('answers only JSON to its routes that change anything, and only known routes', async () => {
    const {base} = await serve();
    assert.equal((await post(`${base}/api/message-box/messages`, 'Hi', 'text/plain')).status, 415);
    assert.equal((await post(`${base}/api/turns`, {})).status, 405);
    assert.equal((await fetch(`${base}/api/message-box/messages`)).status, 405);
    assert.equal((await fetch(`${base}/api/nothing`)).status, 404);
  });
});
