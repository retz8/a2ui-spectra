import assert from 'node:assert/strict';
import {mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync} from 'node:fs';
import {createServer} from 'node:http';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {after, describe, it} from 'node:test';

import {SseParser} from './a2a/sse.js';
import type {LogSnapshot} from './agent_log.js';
import type {AgentSnapshot, RestartCause} from './agent_supervisor.js';
import type {AgentApi, FixturesListing, ListedTurn, SessionContext} from './api.js';
import {CatalogRegistry} from './catalog/registry.js';
import {CONFIG_SCHEMA, type PriceOverride} from './config.js';
import {FixturesFolder} from './fixtures/fixtures.js';
import {MessageBox, type ReplayHooks} from './message_box.js';
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
  fixturesFolder: 'a2ui-spectra-fixtures',
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

/** Replay hooks that do nothing, so the box can be asked to replay against the proxy this test has none of. */
const NO_HOOKS: ReplayHooks = {
  arm: () => {},
  disarm: () => {},
  annotate: () => {},
  amend: async () => {},
  log: () => {},
};

async function serve(
  heartbeatMs = 60_000,
  prices?: Record<string, PriceOverride>,
  options: {replay?: boolean; agent?: AgentApi} = {},
) {
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
    ...(options.replay && {replay: NO_HOOKS}),
    fetch: () => Promise.reject(new Error('No proxy in this test.')),
  });
  const fixtures = new FixturesFolder(path.join(dir, 'a2ui-spectra-fixtures'), dir);
  const port = await freePort();
  const server = await startViewerServer({
    port,
    viewerDir: dir,
    allowedHosts: [],
    api: {
      store,
      turns,
      box,
      fixtures,
      heartbeatMs,
      context: CONTEXT,
      catalogs: CatalogRegistry.builtIn(),
      ...(prices !== undefined && {prices}),
      ...(options.agent !== undefined && {agent: options.agent}),
    },
  });
  servers.push(server);
  const base = `http://127.0.0.1:${port}`;
  return {store, turns, box, fixtures, base, dir};
}

async function getJson<T = unknown>(url: string): Promise<{status: number; body: T}> {
  const response = await fetch(url);
  assert.match(response.headers.get('content-type') ?? '', /^application\/json/);
  return {status: response.status, body: (await response.json()) as T};
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
    assert.equal((await fetch(`${base}/api/replays`)).status, 405);
    assert.equal((await post(`${base}/api/fixtures/x`, {})).status, 405);
    assert.equal((await fetch(`${base}/api/nothing`)).status, 404);
    assert.equal((await post(`${base}/api/agent`, {})).status, 405);
    assert.equal((await fetch(`${base}/api/agent/restart`)).status, 405);
    assert.equal((await post(`${base}/api/agent/restart`, {}, 'text/plain')).status, 415);
    assert.equal((await post(`${base}/api/agent/logs`, {})).status, 405);
  });

  it("serves the agent's process and its logs and restarts it at once under run, and answers 404 to each where Spectra did not start the agent", async () => {
    const attached = await serve();
    const none = await getJson<{error: string}>(`${attached.base}/api/agent`);
    assert.equal(none.status, 404);
    assert.equal(
      none.body.error,
      'Spectra did not start this agent, so it has no process to report.',
    );
    const refused = await post(`${attached.base}/api/agent/restart`, {});
    assert.equal(refused.status, 404);
    assert.deepEqual(await refused.json(), {
      error: 'Spectra did not start this agent, so it cannot restart it.',
    });

    const noLogs = await getJson<{error: string}>(`${attached.base}/api/agent/logs`);
    assert.deepEqual(noLogs, {
      status: 404,
      body: {error: 'Spectra did not start this agent, so it has no logs to report.'},
    });

    const logs: LogSnapshot = {
      entries: [
        {n: 1, type: 'started', time: '2026-11-10T09:00:00.000Z', command: 'uv run .'},
        {
          n: 2,
          type: 'line',
          time: '2026-11-10T09:00:00.412Z',
          stream: 'stderr',
          text: 'INFO:     Started server process [4242]',
        },
        {
          n: 3,
          type: 'stopped',
          time: '2026-11-10T09:00:04.250Z',
          exit: 'exited with code 143',
          cause: {kind: 'save', file: 'prompt_builder.py'},
        },
      ],
      lines: 1,
      cap: 1000,
    };
    const snapshot: AgentSnapshot = {
      command: 'uv run .',
      state: {state: 'down', exit: 'exited with code 1', seq: 5},
      events: [
        {type: 'agent_restarted', seq: 3, time: '2026-11-10T09:00:00.000Z', cause: {kind: 'press'}},
        {
          type: 'agent_exited',
          seq: 4,
          time: '2026-11-10T09:00:04.250Z',
          exit: 'exited with code 1',
        },
      ],
    };
    const causes: RestartCause[] = [];
    const {base} = await serve(60_000, undefined, {
      agent: {snapshot: () => snapshot, restart: cause => causes.push(cause), logs: () => logs},
    });
    assert.deepEqual(await getJson(`${base}/api/agent`), {status: 200, body: snapshot});
    assert.deepEqual(await getJson(`${base}/api/agent/logs`), {status: 200, body: logs});
    const accepted = await post(`${base}/api/agent/restart`, {});
    assert.equal(accepted.status, 202);
    assert.deepEqual(await accepted.json(), {accepted: true});
    assert.deepEqual(causes, [{kind: 'press'}]);
  });

  it('saves a turn as a fixture by name, answering the path written, and refuses a bad name, a clash, an open turn and an unknown one', async () => {
    const {store, turns, fixtures, base, dir} = await serve();
    const closed = closedTurn(1, 'ctx-1');
    closed.events.push(wireInput(1, {type: 'text', content: 'Book a table for 2'}));
    const {record} = await store.write(closed);
    openTurn(turns, 2);

    const saved = await post(`${base}/api/fixtures`, {
      traceId: trace(1),
      name: 'book-a-table-for-2',
    });
    assert.equal(saved.status, 201);
    assert.deepEqual(await saved.json(), {
      name: 'book-a-table-for-2',
      path: path.join('a2ui-spectra-fixtures', 'book-a-table-for-2.json'),
    });
    const file = path.join(dir, 'a2ui-spectra-fixtures', 'book-a-table-for-2.json');
    assert.deepEqual(JSON.parse(readFileSync(file, 'utf8')), record);
    assert.deepEqual((await fixtures.read('book-a-table-for-2')).record, record);

    const clash = await post(`${base}/api/fixtures`, {
      traceId: trace(1),
      name: 'book-a-table-for-2',
    });
    assert.equal(clash.status, 409);
    assert.deepEqual(await clash.json(), {
      error: 'a2ui-spectra-fixtures/book-a-table-for-2.json exists already.',
      suggested: 'book-a-table-for-2-2',
    });
    const badName = await post(`${base}/api/fixtures`, {traceId: trace(1), name: 'a b'});
    assert.equal(badName.status, 400);
    assert.match(
      ((await badName.json()) as {error: string}).error,
      /^A fixture's name uses letters/,
    );
    const open = await post(`${base}/api/fixtures`, {traceId: trace(2), name: 'open'});
    assert.equal(open.status, 409);
    assert.deepEqual(await open.json(), {
      error: 'The turn is still open, so it has no record yet.',
    });
    const unknown = await post(`${base}/api/fixtures`, {traceId: trace(9), name: 'unknown'});
    assert.equal(unknown.status, 404);
    for (const body of [{}, {traceId: trace(1)}, {name: 'x'}, {traceId: 1, name: 'x'}, []]) {
      assert.equal((await post(`${base}/api/fixtures`, body)).status, 400, JSON.stringify(body));
    }
  });

  it('saves a turn kept in memory after its write failed', async () => {
    const {store, base, dir} = await serve();
    writeFileSync(path.join(store.turnsDir, 'ctx-1'), 'not a folder');
    await assert.rejects(store.write(closedTurn(1, 'ctx-1')));
    const saved = await post(`${base}/api/fixtures`, {traceId: trace(1), name: 'kept'});
    assert.equal(saved.status, 201);
    const file = path.join(dir, 'a2ui-spectra-fixtures', 'kept.json');
    assert.deepEqual((JSON.parse(readFileSync(file, 'utf8')) as TurnRecord).turns, [
      closedTurn(1, 'ctx-1'),
    ]);
  });

  it("lists the fixtures with their turns in the listing's form, a bad file with its reason, and serves each one's record", async () => {
    const {store, fixtures, base, dir} = await serve();
    assert.deepEqual((await getJson(`${base}/api/fixtures`)).body, {
      folder: 'a2ui-spectra-fixtures',
      fixtures: [],
    });
    const first = closedTurn(1, 'ctx-1');
    first.events.push(wireInput(1, {type: 'text', content: 'Hi'}));
    await store.write(first);
    const second = closedTurn(2, 'ctx-1');
    second.events.push(wireInput(2, {type: 'text', content: 'Book a table'}));
    const {record} = await store.write(second);
    await fixtures.save(record, 'booking');
    mkdirSync(path.join(fixtures.dir, 'nested'));
    writeFileSync(path.join(fixtures.dir, 'nested', 'bad.json'), '{');

    const {status, body} = await getJson<FixturesListing>(`${base}/api/fixtures`);
    assert.equal(status, 200);
    assert.equal(body.folder, 'a2ui-spectra-fixtures');
    assert.equal(body.fixtures.length, 2);
    const [booking, bad] = body.fixtures;
    assert.equal(booking.name, 'booking');
    assert.equal(booking.path, path.join('a2ui-spectra-fixtures', 'booking.json'));
    assert.match(booking.savedAt, /^\d{4}-\d{2}-\d{2}T/);
    assert.deepEqual(booking.turns, [
      {
        traceId: trace(1),
        conversationId: 'ctx-1',
        startTime: '2026-10-21T10:00:01.000Z',
        outcome: 'completed',
        durationMs: 500,
        input: {text: 'Hi'},
        rejections: 0,
      },
      {
        traceId: trace(2),
        conversationId: 'ctx-1',
        startTime: '2026-10-21T10:00:02.000Z',
        outcome: 'completed',
        durationMs: 500,
        input: {text: 'Book a table'},
        rejections: 0,
      },
    ]);
    assert.equal(booking.error, undefined);
    assert.equal(bad.name, 'nested/bad');
    assert.equal(bad.turns, undefined);
    assert.match(bad.error ?? '', /^The file is not JSON: /);

    const served = await getJson<TurnRecord>(`${base}/api/fixtures/booking`);
    assert.equal(served.status, 200);
    assert.deepEqual(served.body, record);
    assert.equal((await getJson(`${base}/api/fixtures/missing`)).status, 404);
    const unreadable = await getJson(`${base}/api/fixtures/nested/bad`);
    assert.equal(unreadable.status, 422);
    assert.match((unreadable.body as {error: string}).error, /^The file is not JSON: /);
    assert.equal((await getJson(`${base}/api/fixtures/../x`)).status, 404);
    rmSync(path.join(dir, 'a2ui-spectra-fixtures'), {recursive: true});
    assert.deepEqual((await getJson(`${base}/api/fixtures`)).body, {
      folder: 'a2ui-spectra-fixtures',
      fixtures: [],
    });
  });

  it('starts a replay from a fixture or a store turn, and refuses what the box refuses, a bad body, an unknown source and a turn with no file', async () => {
    const {store, fixtures, base} = await serve(60_000, undefined, {replay: true});
    const closed = closedTurn(1, 'ctx-1');
    closed.events.push(wireInput(1, {type: 'text', content: 'Hi'}));
    const {record} = await store.write(closed);
    await fixtures.save(record, 'hello');

    for (const body of [
      {},
      {mode: 'recorded'},
      {source: {fixture: 'hello'}},
      {source: {fixture: 'hello'}, mode: 'all'},
      {source: {}, mode: 'recorded'},
      {source: {fixture: 'hello', traceId: trace(1)}, mode: 'recorded'},
      {source: 'hello', mode: 'recorded'},
    ]) {
      assert.equal((await post(`${base}/api/replays`, body)).status, 400, JSON.stringify(body));
    }
    assert.equal(
      (await post(`${base}/api/replays`, {source: {fixture: 'missing'}, mode: 'model_live'}))
        .status,
      404,
    );
    assert.equal(
      (await post(`${base}/api/replays`, {source: {traceId: trace(9)}, mode: 'model_live'})).status,
      404,
    );
    const nothing = await post(`${base}/api/replays`, {
      source: {fixture: 'hello'},
      mode: 'recorded',
    });
    assert.equal(nothing.status, 422);
    assert.match(((await nothing.json()) as {error: string}).error, /nothing to serve/);
    // The box sends, and the proxy this test has none of is unreachable: the source was read.
    const fromFixture = await post(`${base}/api/replays`, {
      source: {fixture: 'hello'},
      mode: 'model_live',
    });
    assert.equal(fromFixture.status, 502);
    assert.deepEqual(await fromFixture.json(), {
      error: 'The message box could not reach the wire proxy: No proxy in this test.',
    });
    const fromStore = await post(`${base}/api/replays`, {
      source: {traceId: trace(1)},
      mode: 'model_live',
    });
    assert.equal(fromStore.status, 502);

    writeFileSync(path.join(store.turnsDir, 'ctx-2'), 'not a folder');
    await assert.rejects(store.write(closedTurn(2, 'ctx-2')));
    const unwritten = await post(`${base}/api/replays`, {
      source: {traceId: trace(2)},
      mode: 'model_live',
    });
    assert.equal(unwritten.status, 422);
    assert.deepEqual(await unwritten.json(), {
      error:
        "The turn's record was not written to the store, so there is no file to replay. Save it as a fixture first.",
    });

    const {base: without} = await serve();
    const unavailable = await post(`${without}/api/replays`, {
      source: {fixture: 'hello'},
      mode: 'model_live',
    });
    assert.equal(unavailable.status, 404, 'That session has no such fixture.');
  });

  it("starts a live replay, and cuts a fixture's record after the turn its source names, in every mode", async () => {
    const {store, turns, fixtures, base} = await serve(60_000, undefined, {replay: true});
    const first = closedTurn(1, 'ctx-1');
    first.events.push(wireInput(1, {type: 'text', content: 'Hi'}));
    await store.write(first);
    // The second turn alone holds a call, so the record cut after the first has nothing to serve.
    const second = closedTurn(2, 'ctx-1');
    second.events.push(wireInput(2, {type: 'text', content: 'More'}), {
      traceId: trace(2),
      spanId: '0000000000000002',
      parentSpanId: '0000000000000000',
      name: 'chat',
      kind: 3,
      startTimeUnixNano: '1792576802200000000',
      endTimeUnixNano: '1792576802300000000',
      attributes: {
        'a2ui.event.kind': 'model_call',
        'http.request.method': 'POST',
        'url.full': 'https://api.anthropic.com/v1/messages',
        'a2ui.http.request.body': {model: 'claude'},
      },
      status: {code: 1},
    });
    const {record} = await store.write(second);
    assert.equal(record.turns.length, 2, "The second turn's record embeds the first.");
    await fixtures.save(record, 'two');

    const started: Array<{mode: string; turns: number}> = [];
    turns.subscribe(event => {
      if (event.type === 'replay_started') started.push({mode: event.mode, turns: event.turns});
    });
    // The box sends, and the proxy this test has none of is unreachable: 502 says the replay began.
    const begun = async (body: unknown) => {
      started.length = 0;
      const response = await post(`${base}/api/replays`, body);
      assert.equal(response.status, 502, JSON.stringify(body));
      return started[0];
    };

    assert.deepEqual(await begun({source: {fixture: 'two'}, mode: 'live'}), {
      mode: 'live',
      turns: 2,
    });
    assert.deepEqual(await begun({source: {traceId: trace(2)}, mode: 'live'}), {
      mode: 'live',
      turns: 2,
    });
    assert.deepEqual(await begun({source: {fixture: 'two', turn: trace(1)}, mode: 'live'}), {
      mode: 'live',
      turns: 1,
    });
    assert.deepEqual(await begun({source: {fixture: 'two', turn: trace(1)}, mode: 'model_live'}), {
      mode: 'model_live',
      turns: 1,
    });
    assert.deepEqual(await begun({source: {fixture: 'two', turn: trace(2)}, mode: 'recorded'}), {
      mode: 'recorded',
      turns: 2,
    });
    const cutToNothing = await post(`${base}/api/replays`, {
      source: {fixture: 'two', turn: trace(1)},
      mode: 'recorded',
    });
    assert.equal(cutToNothing.status, 422, 'Nothing to serve is judged on the cut record.');
    assert.match(((await cutToNothing.json()) as {error: string}).error, /nothing to serve/);

    const unknown = await post(`${base}/api/replays`, {
      source: {fixture: 'two', turn: trace(9)},
      mode: 'live',
    });
    assert.equal(unknown.status, 404);
    assert.deepEqual(await unknown.json(), {
      error: 'The fixture two holds no turn with this trace id.',
    });
    for (const body of [
      {source: {traceId: trace(2), turn: trace(1)}, mode: 'live'},
      {source: {fixture: 'two', turn: 1}, mode: 'live'},
    ]) {
      assert.equal((await post(`${base}/api/replays`, body)).status, 400, JSON.stringify(body));
    }
  });

  it("passes a replay's events, the fixtures folder's change and the agent's process on the live stream", async () => {
    const {turns, base} = await serve();
    const response = await fetch(`${base}/api/stream`);
    const reader = response.body!.getReader();
    const sse = new SseParser();
    const text = new TextDecoder();
    const events: Array<{event?: string; data: unknown}> = [];
    turns.notify({type: 'fixtures_changed'});
    turns.notify({
      type: 'replay_started',
      source: 'a2ui-spectra-fixtures/hello.json',
      mode: 'recorded',
      turns: 1,
    });
    turns.notify({type: 'agent_state', state: 'waiting', reason: 'connection refused', seq: 2});
    turns.notify({
      type: 'agent_restarted',
      seq: 3,
      time: '2026-11-10T09:00:00.000Z',
      cause: {kind: 'press'},
    });
    turns.notify({
      type: 'agent_exited',
      seq: 4,
      time: '2026-11-10T09:00:04.250Z',
      exit: 'exited with code 1',
    });
    while (events.length < 5) {
      const {value, done} = await reader.read();
      assert.equal(done, false);
      for (const event of sse.push(text.decode(value, {stream: true}))) {
        events.push({event: event.event, data: JSON.parse(event.data)});
      }
    }
    await reader.cancel();
    assert.deepEqual(events, [
      {event: 'fixtures_changed', data: {}},
      {
        event: 'replay_started',
        data: {source: 'a2ui-spectra-fixtures/hello.json', mode: 'recorded', turns: 1},
      },
      {event: 'agent_state', data: {state: 'waiting', reason: 'connection refused', seq: 2}},
      {
        event: 'agent_restarted',
        data: {seq: 3, time: '2026-11-10T09:00:00.000Z', cause: {kind: 'press'}},
      },
      {
        event: 'agent_exited',
        data: {seq: 4, time: '2026-11-10T09:00:04.250Z', exit: 'exited with code 1'},
      },
    ]);
  });
});
