/**
 * The A2A capture suite (`conformance/a2a_capture/`): each HAR recording of
 * the coverage roster replayed through the wire proxy, with a replay server
 * standing in for the agent. The host must receive each recorded response as
 * recorded, the card with only its JSON-RPC endpoints pointed at the proxy,
 * and the turns the adapter hands out must match the expected record.
 */
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import {createServer, request as httpRequest, type Server, type ServerResponse} from 'node:http';
import * as path from 'node:path';
import {after, describe, it} from 'node:test';
import {fileURLToPath} from 'node:url';

import * as yaml from 'js-yaml';

import type {Turn, TurnRecord, TurnRecordEvent} from '../record/turn_record.js';
import {turnRecordErrors} from '../testing/turn_record_schema.js';
import {startWireProxy, type WireProxy} from './proxy.js';
import type {TurnNotification} from './turn.js';

interface CaptureA2aCase {
  name: string;
  description: string;
  action: 'capture_a2a';
  traffic: string;
  expect: string;
}

interface HarHeader {
  name: string;
  value: string;
}

interface HarEntry {
  request: {method: string; url: string; headers: HarHeader[]; postData?: {text: string}};
  response: {
    status: number;
    statusText: string;
    headers: HarHeader[];
    content: {text: string};
    /** Set when the connection broke before the response ended: the text is what arrived. */
    _brokenOff?: boolean;
  };
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
const SUITE = path.join(CONFORMANCE_DIR, 'a2a_capture/capture_v0_1.yaml');

const CARD_PATHS = new Set(['/.well-known/agent-card.json', '/.well-known/agent.json']);

/** What Spectra generates rather than reads off the traffic, which the comparison skips. */
const GENERATED_FIELDS = new Set([
  'traceId',
  'spanId',
  'parentSpanId',
  'startTimeUnixNano',
  'endTimeUnixNano',
]);
const GENERATED_ATTRIBUTES = new Set(['a2ui.turn.writer.version']);

/** Bytes per write when the replay server sends a recorded body, so streams arrive in pieces. */
const CHUNK_BYTES = 97;

function readJson<T>(file: string): T {
  return JSON.parse(fs.readFileSync(path.join(CONFORMANCE_DIR, file), 'utf8')) as T;
}

const servers: Server[] = [];
const proxies: WireProxy[] = [];
after(async () => {
  await Promise.all(proxies.map(proxy => proxy.close()));
  for (const server of servers) {
    server.closeAllConnections();
    server.close();
  }
});

function listen(server: Server): Promise<number> {
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      resolve(typeof address === 'object' && address !== null ? address.port : 0);
    });
  });
}

async function freePort(): Promise<number> {
  const server = createServer();
  const port = await listen(server);
  await new Promise(resolve => server.close(resolve));
  return port;
}

function pathOf(url: string): string {
  const {pathname, search} = new URL(url);
  return pathname + search;
}

/** A server answering each request with the next recorded response, failing on any other request. */
async function startReplayServer(
  entries: HarEntry[],
): Promise<{port: number; mismatches: string[]}> {
  const queue = [...entries];
  const mismatches: string[] = [];
  const server = createServer((request, response) => {
    request.resume();
    request.once('end', () => {
      const entry = queue.shift();
      const expected = entry && `${entry.request.method} ${pathOf(entry.request.url)}`;
      const actual = `${request.method} ${request.url}`;
      if (entry === undefined || expected !== actual) {
        mismatches.push(`expected ${expected ?? 'no request'}, received ${actual}`);
        response.writeHead(599).end();
        return;
      }
      const body = Buffer.from(entry.response.content.text, 'utf8');
      const brokenOff = entry.response._brokenOff === true;
      response.writeHead(entry.response.status, entry.response.statusText, [
        ...entry.response.headers.flatMap(({name, value}) => [name, value]),
        ...(brokenOff ? [] : ['content-length', String(body.length)]),
      ]);
      void writeInChunks(response, body, brokenOff);
    });
  });
  servers.push(server);
  return {port: await listen(server), mismatches};
}

/** Sends a recorded body in pieces, then ends it, or breaks the connection where the recording broke off. */
async function writeInChunks(
  response: ServerResponse,
  body: Buffer,
  brokenOff: boolean,
): Promise<void> {
  for (let start = 0; start < body.length; start += CHUNK_BYTES) {
    response.write(body.subarray(start, start + CHUNK_BYTES));
    await new Promise(resolve => setImmediate(resolve));
  }
  if (brokenOff) {
    await new Promise(resolve => setTimeout(resolve, 20));
    response.socket?.destroy();
  } else {
    response.end();
  }
}

/**
 * One recorded request sent to the proxy; resolves with the status and body
 * the host received, and whether its connection broke before the reply ended.
 */
function send(
  proxy: WireProxy,
  entry: HarEntry,
): Promise<{status: number; body: string; brokenOff: boolean}> {
  const origin = new URL(proxy.origin);
  const body = entry.request.postData?.text;
  const headers = Object.fromEntries(entry.request.headers.map(({name, value}) => [name, value]));
  if (body !== undefined) {
    headers['content-length'] = String(Buffer.byteLength(body));
  }
  return new Promise((resolve, reject) => {
    const request = httpRequest(
      {
        host: origin.hostname,
        port: origin.port,
        method: entry.request.method,
        path: pathOf(entry.request.url),
        headers,
      },
      response => {
        const chunks: Buffer[] = [];
        const answer = (brokenOff: boolean) =>
          resolve({
            status: response.statusCode ?? 0,
            body: Buffer.concat(chunks).toString('utf8'),
            brokenOff,
          });
        response.on('data', (chunk: Buffer) => chunks.push(chunk));
        response.once('end', () => answer(false));
        response.once('aborted', () => answer(true));
        response.once('error', () => answer(true));
      },
    );
    request.on('error', reject);
    request.end(body);
  });
}

function isCardFetch(entry: HarEntry): boolean {
  return entry.request.method === 'GET' && CARD_PATHS.has(new URL(entry.request.url).pathname);
}

function isJsonRpcBinding(value: unknown): boolean {
  return typeof value === 'string' && /^json-?rpc$/i.test(value);
}

/**
 * A card with the origin of each JSON-RPC endpoint replaced by a marker, and
 * the origins it replaced: the card's `url` (A2A 0.3), and the `url` of each
 * JSON-RPC entry in `additionalInterfaces` (A2A 0.3) or `supportedInterfaces`
 * (A2A 1.0).
 */
function withEndpointOrigins(card: Record<string, unknown>): {
  card: Record<string, unknown>;
  origins: string[];
} {
  const copy = structuredClone(card);
  const origins: string[] = [];
  const mark = (holder: Record<string, unknown>) => {
    const url = holder.url as string;
    origins.push(new URL(url).origin);
    holder.url = url.replace(/^https?:\/\/[^/]+/, '<origin>');
  };
  if (typeof copy.url === 'string' && isJsonRpcBinding(copy.preferredTransport ?? 'JSONRPC')) {
    mark(copy);
  }
  for (const [key, binding] of [
    ['additionalInterfaces', 'transport'],
    ['supportedInterfaces', 'protocolBinding'],
  ] as const) {
    const interfaces = copy[key];
    if (!Array.isArray(interfaces)) {
      continue;
    }
    for (const entry of interfaces as Record<string, unknown>[]) {
      if (isJsonRpcBinding(entry[binding]) && typeof entry.url === 'string') {
        mark(entry);
      }
    }
  }
  return {card: copy, origins};
}

/** The record with what Spectra generates left out. */
function traffic(record: {turns: Turn[]}): unknown {
  return record.turns.map(turn =>
    turn.events.map(event =>
      Object.fromEntries(
        Object.entries(event)
          .filter(([key]) => !GENERATED_FIELDS.has(key))
          .map(([key, value]) =>
            key === 'attributes'
              ? [
                  key,
                  Object.fromEntries(
                    Object.entries(value as Record<string, unknown>).filter(
                      ([name]) => !GENERATED_ATTRIBUTES.has(name),
                    ),
                  ),
                ]
              : [key, value],
          ),
      ),
    ),
  );
}

/** The rules on what Spectra generates: one trace per turn, the wire events under the turn event, times in order. */
function assertGeneratedFields(turn: Turn, label: string): void {
  const [turnEvent, ...wireEvents] = turn.events as [TurnRecordEvent, ...TurnRecordEvent[]];
  assert.equal(
    turnEvent.attributes['a2ui.event.kind'],
    'turn',
    `${label}: the turn event is first`,
  );
  assert.match(turnEvent.traceId, /^[0-9a-f]{32}$/, `${label}: the trace id`);
  const spanIds = new Set<string>();
  let previous = BigInt(turnEvent.startTimeUnixNano);
  for (const event of turn.events) {
    assert.equal(event.traceId, turnEvent.traceId, `${label}: every event shares the trace id`);
    assert.match(event.spanId, /^[0-9a-f]{16}$/, `${label}: the span id of ${event.name}`);
    spanIds.add(event.spanId);
  }
  assert.equal(spanIds.size, turn.events.length, `${label}: every span id is distinct`);
  for (const event of wireEvents) {
    assert.equal(event.parentSpanId, turnEvent.spanId, `${label}: ${event.name}'s parent`);
    const time = BigInt(event.startTimeUnixNano);
    assert.ok(time >= previous, `${label}: ${event.name} is in time order`);
    previous = time;
  }
  assert.ok(
    BigInt(turnEvent.endTimeUnixNano ?? '0') >= previous,
    `${label}: the turn ends after its last wire event`,
  );
}

async function runCase(c: CaptureA2aCase): Promise<void> {
  const entries = readJson<{log: {entries: HarEntry[]}}>(c.traffic).log.entries;
  const expected = readJson<TurnRecord>(c.expect);
  const recordedCard = entries.find(entry => isCardFetch(entry));
  const agentName = recordedCard
    ? (JSON.parse(recordedCard.response.content.text) as {name?: string}).name
    : undefined;

  const replay = await startReplayServer(entries);
  const turns: Turn[] = [];
  const proxy = await startWireProxy({
    port: await freePort(),
    agentUrl: new URL(`http://127.0.0.1:${replay.port}`),
    agentName,
    onTurn: (notification: TurnNotification) => {
      if (notification.type === 'turn_closed') {
        turns.push(notification.turn);
      }
    },
  });
  proxies.push(proxy);

  for (const [index, entry] of entries.entries()) {
    const received = await send(proxy, entry);
    const label = `exchange ${index + 1}, ${entry.request.method} ${pathOf(entry.request.url)}`;
    assert.equal(received.status, entry.response.status, `${label}: the status`);
    if (isCardFetch(entry) && entry.response.status === 200) {
      const sent = withEndpointOrigins(JSON.parse(received.body) as Record<string, unknown>);
      const recorded = withEndpointOrigins(
        JSON.parse(entry.response.content.text) as Record<string, unknown>,
      );
      assert.deepEqual(sent.card, recorded.card, `${label}: the card, endpoints aside`);
      assert.deepEqual(
        sent.origins,
        recorded.origins.map(() => proxy.origin),
        `${label}: the card's JSON-RPC endpoints point at the proxy`,
      );
    } else if (entry.response._brokenOff === true) {
      assert.ok(received.brokenOff, `${label}: the reply breaks off for the host too`);
      assert.ok(
        entry.response.content.text.startsWith(received.body),
        `${label}: what the host received before the break is as recorded`,
      );
    } else {
      assert.equal(received.body, entry.response.content.text, `${label}: the body as recorded`);
    }
  }
  assert.deepEqual(replay.mismatches, [], 'the requests the replay server received');

  const record = {version: 'v0.1', turns} as TurnRecord;
  assert.deepEqual(turnRecordErrors(record), [], 'the captured record validates');
  turns.forEach((turn, index) => assertGeneratedFields(turn, `turn ${index + 1}`));
  assert.deepEqual(traffic(record), traffic(expected), 'the turns match the expected record');
}

const cases = yaml.load(fs.readFileSync(SUITE, 'utf8')) as CaptureA2aCase[];

describe('A2A capture v0.1', () => {
  for (const c of cases) {
    it(c.name, () => runCase(c));
  }
});
