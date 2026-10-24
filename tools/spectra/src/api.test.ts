import assert from 'node:assert/strict';
import {mkdtempSync, rmSync, writeFileSync} from 'node:fs';
import {createServer} from 'node:http';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {after, describe, it} from 'node:test';

import {SseParser} from './a2a/sse.js';
import type {ListedTurn} from './api.js';
import {MessageBox} from './message_box.js';
import type {Turn, TurnRecord} from './record/turn_record.js';
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

function openTurn(turns: TurnHub, n: number): void {
  turns.onTurn({
    type: 'turn_opened',
    traceId: trace(n),
    startTimeUnixNano: `${1792576800 + n}000000000`,
  });
}

async function serve() {
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
    api: {store, turns, box},
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
      {traceId: trace(3), startTime: '2026-10-21T10:00:03.000Z'},
      {traceId: trace(2), startTime: '2026-10-21T10:00:02.000Z', open: true},
      {traceId: trace(1), conversationId: 'ctx-1', startTime: '2026-10-21T10:00:01.000Z'},
    ]);
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

  it("serves the message box's conversation and its routes", async () => {
    const {base} = await serve();
    assert.deepEqual((await getJson(`${base}/api/message-box`)).body, {});

    const empty = await post(`${base}/api/message-box/messages`, {text: ' '});
    assert.equal(empty.status, 400);
    const unreachable = await post(`${base}/api/message-box/messages`, {text: 'Hi'});
    assert.equal(unreachable.status, 502);
    assert.deepEqual(await unreachable.json(), {
      error: 'The message box could not reach the wire proxy: No proxy in this test.',
    });

    const fresh = await post(`${base}/api/message-box/new-conversation`, {});
    assert.equal(fresh.status, 200);
    assert.deepEqual(await fresh.json(), {});
  });

  it('answers only JSON to its routes that change anything, and only known routes', async () => {
    const {base} = await serve();
    assert.equal((await post(`${base}/api/message-box/messages`, 'Hi', 'text/plain')).status, 415);
    assert.equal((await post(`${base}/api/turns`, {})).status, 405);
    assert.equal((await fetch(`${base}/api/message-box/messages`)).status, 405);
    assert.equal((await fetch(`${base}/api/nothing`)).status, 404);
  });
});
