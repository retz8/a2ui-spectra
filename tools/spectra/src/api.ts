import type {IncomingMessage, ServerResponse} from 'node:http';

import type {CardDetails} from './a2a/card.js';
import type {LogSnapshot} from './agent_log.js';
import type {AgentSnapshot, RestartCause} from './agent_supervisor.js';
import type {CatalogRegistry} from './catalog/registry.js';
import {CONFIG_SCHEMA, type PriceOverride} from './config.js';
import {
  FixtureClashError,
  FixtureNameError,
  FixtureNotFoundError,
  FixtureReadError,
  type FixturesFolder,
} from './fixtures/fixtures.js';
import {type ListingFields, listingFieldsOf} from './listing.js';
import {type MessageBox, MessageBoxError, type ReplaySource} from './message_box.js';
import {pricesAnswer} from './prices.js';
import {isEventOfKind, type ReplayMode, type Turn, type TurnRecord} from './record/turn_record.js';
import type {StoredTurn, TurnStore} from './store/store.js';
import type {HubEvent, TurnHub} from './turn_hub.js';

/**
 * What the context bar, the agent's popover and the first screen show of the
 * session. What the card states is the latest card's, kept until a later card
 * replaces it, and absent under `run` before any card has answered.
 */
export interface SessionContext extends Partial<CardDetails> {
  /** The agent's name, from its latest card. */
  agentName?: string;
  /** The agent's own URL, the one Spectra was given. */
  agentUrl: string;
  mode: 'run' | 'attach';
  /** The wire proxy's address, for a host app to point at. */
  proxyAddress: string;
  /** The config file's preview pages, in config order. */
  previewPages: string[];
  /** The fixtures folder's path as shown, relative to the working directory when under it. */
  fixturesFolder: string;
  /** Under `attach`, the variables and values `attach` prints, to set in the agent's shell. */
  variables?: Array<{name: string; value: string}>;
}

/** The agent's process under `run`, as the API reads and restarts it. */
export interface AgentApi {
  snapshot(): AgentSnapshot;
  restart(cause: RestartCause): void;
  logs(): LogSnapshot;
}

/** What the API serves from. */
export interface Api {
  store: TurnStore;
  turns: TurnHub;
  box: MessageBox;
  fixtures: FixturesFolder;
  /** The catalog definitions Spectra knows. */
  catalogs: CatalogRegistry;
  context: SessionContext;
  /** The agent's process, under `run`; none under `attach`, where Spectra did not start the agent. */
  agent?: AgentApi;
  /** The config file's prices, by model id as requested. */
  prices?: Readonly<Record<string, PriceOverride>>;
  /** How often the live stream sends its heartbeat. */
  heartbeatMs?: number;
}

/** One entry of the turn listing. */
export interface ListedTurn extends Partial<ListingFields> {
  traceId: string;
  conversationId?: string;
  /** The turn's start, as an ISO 8601 UTC time to the millisecond. */
  startTime: string;
  /** Set on a turn still open. */
  open?: true;
}

/** One fixture of the folder, as the fixtures listing gives it. */
export interface ListedFixture {
  /** The path relative to the folder without `.json`, `/` between folders. */
  name: string;
  /** The file's path as shown. */
  path: string;
  /** The file's modification time, as an ISO 8601 UTC time. */
  savedAt: string;
  /** The record's turns in the turn listing's form, oldest first, when the file reads as a record. */
  turns?: ListedTurn[];
  /** Why the file does not read as a record, when it does not. */
  error?: string;
}

export interface FixturesListing {
  /** The folder's path as shown. */
  folder: string;
  /** Every `.json` under the folder, in path order. */
  fixtures: ListedFixture[];
}

/**
 * The listing's fields of each record file read so far, by store and file,
 * with the store's revision of the file they were read at: a file the
 * receiver's spans amend is read again.
 */
const listingCache = new WeakMap<
  TurnStore,
  Map<string, {revision: number; fields: ListingFields | undefined}>
>();

/** The largest request body the API reads. */
const MAX_BODY_BYTES = 64 * 1024;

/**
 * How often the live stream sends a heartbeat event. It keeps an idle
 * connection open, and lets the page tell a stream that went silent, such as
 * one a proxy holds open after Spectra stopped, from one that is quiet.
 */
const HEARTBEAT_MS = 2000;

/**
 * Answers a request under `/api/`. Returns false for any other path, which
 * the caller serves.
 *
 * - `GET /api/context`: the session: the agent's name and URL, the mode, the wire proxy's address,
 *   the configured preview pages, and what the agent's latest card states.
 * - `GET /api/agent`: under `run`, the agent's command as launched, its process's state and the
 *   session's restarts and exits.
 * - `POST /api/agent/restart`: under `run`, restarts the agent's process; answers at once.
 * - `GET /api/agent/logs`: under `run`, the agent's output as the buffer holds it, with its dividers.
 * - `GET /api/turns`: the turns, newest first.
 * - `GET /api/turns/<trace id>`: a closed turn's record.
 * - `GET /api/stream`: the live stream, as server-sent events.
 * - `GET /api/message-box`: the conversations the message box started.
 * - `POST /api/message-box/messages`: sends `{"text": …}`, continuing one of them by its
 *   `conversationId`, or else in a new conversation.
 * - `GET /api/fixtures`: the fixtures folder's files, each with its turns in the listing's form.
 * - `GET /api/fixtures/<name>`: a fixture's record.
 * - `POST /api/fixtures`: saves a turn's record as a fixture, `{"traceId": …, "name": …}`.
 * - `POST /api/replays`: replays a fixture or a store turn, `{"source": {"fixture": …} or
 *   {"traceId": …}, "mode": "recorded", "model_live" or "live"}`; a fixture source's `turn`
 *   names the turn of the fixture the replay ends at.
 * - `GET /api/catalogs`: the catalog definitions Spectra knows.
 * - `GET /api/prices`: LiteLLM's price table as copied, its release and date, and the config's prices.
 * - `GET /api/config.schema.json`: the schema the config file is validated against.
 */
export function handleApi(api: Api, request: IncomingMessage, response: ServerResponse): boolean {
  const {pathname} = new URL(request.url ?? '/', 'http://localhost');
  if (pathname !== '/api' && !pathname.startsWith('/api/')) {
    return false;
  }
  const route = `${request.method} ${pathname}`;
  void answer(api, route, pathname, request, response).catch((error: unknown) => {
    if (!response.headersSent) {
      sendJson(response, 500, {error: error instanceof Error ? error.message : String(error)});
    } else {
      response.destroy();
    }
  });
  return true;
}

async function answer(
  api: Api,
  route: string,
  pathname: string,
  request: IncomingMessage,
  response: ServerResponse,
): Promise<void> {
  const turn = /^GET \/api\/turns\/([0-9a-f]{32})$/.exec(route);
  const fixture = /^GET \/api\/fixtures\/(.+)$/.exec(route);
  if (route === 'GET /api/context') {
    sendJson(response, 200, api.context);
  } else if (route === 'GET /api/agent') {
    if (api.agent === undefined) {
      sendJson(response, 404, {
        error: 'Spectra did not start this agent, so it has no process to report.',
      });
    } else {
      sendJson(response, 200, api.agent.snapshot());
    }
  } else if (route === 'POST /api/agent/restart') {
    if (api.agent === undefined) {
      sendJson(response, 404, {
        error: 'Spectra did not start this agent, so it cannot restart it.',
      });
    } else {
      request.resume();
      api.agent.restart({kind: 'press'});
      sendJson(response, 202, {accepted: true});
    }
  } else if (route === 'GET /api/agent/logs') {
    if (api.agent === undefined) {
      sendJson(response, 404, {
        error: 'Spectra did not start this agent, so it has no logs to report.',
      });
    } else {
      sendJson(response, 200, api.agent.logs());
    }
  } else if (route === 'GET /api/turns') {
    sendJson(response, 200, {turns: await listTurns(api)});
  } else if (turn !== null) {
    await sendRecord(api, turn[1], response);
  } else if (route === 'GET /api/stream') {
    stream(api.turns, api.heartbeatMs ?? HEARTBEAT_MS, request, response);
  } else if (route === 'GET /api/message-box') {
    sendJson(response, 200, api.box.state());
  } else if (route === 'POST /api/message-box/messages') {
    await sendMessage(api.box, request, response);
  } else if (route === 'GET /api/fixtures') {
    sendJson(response, 200, await listFixtures(api));
  } else if (fixture !== null) {
    await sendFixture(api, decodeURIComponent(fixture[1]), response);
  } else if (route === 'POST /api/fixtures') {
    await saveFixture(api, request, response);
  } else if (route === 'POST /api/replays') {
    await startReplay(api, request, response);
  } else if (route === 'GET /api/catalogs') {
    sendJson(response, 200, api.catalogs.listing());
  } else if (route === 'GET /api/prices') {
    sendJson(response, 200, pricesAnswer(api.prices ?? {}));
  } else if (route === 'GET /api/config.schema.json') {
    sendJson(response, 200, CONFIG_SCHEMA);
  } else if (isRoute(pathname)) {
    sendJson(response, 405, {error: `${request.method} is not allowed here.`});
  } else {
    sendJson(response, 404, {error: 'Not found.'});
  }
}

function isRoute(pathname: string): boolean {
  return (
    /^\/api\/turns(\/[0-9a-f]{32})?$/.test(pathname) ||
    /^\/api\/fixtures(\/.+)?$/.test(pathname) ||
    [
      '/api/context',
      '/api/agent',
      '/api/agent/restart',
      '/api/agent/logs',
      '/api/stream',
      '/api/message-box',
      '/api/message-box/messages',
      '/api/replays',
      '/api/catalogs',
      '/api/prices',
      '/api/config.schema.json',
    ].includes(pathname)
  );
}

/** The fixtures folder's files, each one's turns in the listing's form. */
async function listFixtures(api: Api): Promise<FixturesListing> {
  const {folder, fixtures} = await api.fixtures.list();
  return {
    folder,
    fixtures: fixtures.map(({name, path, savedAt, record, error}) => ({
      name,
      path,
      savedAt,
      ...(record !== undefined && {turns: listedTurnsOf(record, api.catalogs)}),
      ...(error !== undefined && {error}),
    })),
  };
}

/** A record's turns in the listing's form, oldest first, each after the turns before it. */
function listedTurnsOf(record: TurnRecord, catalogs: CatalogRegistry): ListedTurn[] {
  const listed: ListedTurn[] = [];
  record.turns.forEach((turn: Turn, index) => {
    const turnEvent = turn.events.find(event => isEventOfKind(event, 'turn'));
    if (turnEvent === undefined) return;
    const conversationId = turnEvent.attributes['gen_ai.conversation.id'];
    listed.push({
      traceId: turnEvent.traceId,
      ...(conversationId !== undefined && {conversationId}),
      startTime: new Date(Number(BigInt(turnEvent.startTimeUnixNano) / 1_000_000n)).toISOString(),
      ...listingFieldsOf(turn, record.turns.slice(0, index), catalogs),
    });
  });
  return listed;
}

async function sendFixture(api: Api, name: string, response: ServerResponse): Promise<void> {
  try {
    sendJson(response, 200, (await api.fixtures.read(name)).record);
  } catch (error) {
    if (error instanceof FixtureNotFoundError || error instanceof FixtureNameError) {
      sendJson(response, 404, {error: `No fixture is named ${name}.`});
    } else if (error instanceof FixtureReadError) {
      sendJson(response, 422, {error: error.message});
    } else {
      throw error;
    }
  }
}

/** The record of a stored turn, or the answer that says why there is none. */
async function storedRecord(
  api: Api,
  traceId: string,
  response: ServerResponse,
): Promise<{record: TurnRecord; stored: StoredTurn} | undefined> {
  if (api.turns.isOpen(traceId)) {
    sendJson(response, 409, {error: 'The turn is still open, so it has no record yet.'});
    return undefined;
  }
  const stored = (await api.store.list()).find(turn => turn.traceId === traceId);
  if (stored === undefined) {
    sendJson(response, 404, {error: 'No turn has this trace id.'});
    return undefined;
  }
  return {record: await api.store.read(stored.file), stored};
}

async function saveFixture(
  api: Api,
  request: IncomingMessage,
  response: ServerResponse,
): Promise<void> {
  const body = await readJson(request);
  const {traceId, name} = (isObject(body) ? body : {}) as {traceId?: unknown; name?: unknown};
  if (typeof traceId !== 'string' || typeof name !== 'string') {
    sendJson(response, 400, {
      error: 'Save with {"traceId": "<the turn\'s trace id>", "name": "<the fixture\'s name>"}.',
    });
    return;
  }
  const found = await storedRecord(api, traceId, response);
  if (found === undefined) return;
  try {
    sendJson(response, 201, await api.fixtures.save(found.record, name));
  } catch (error) {
    if (error instanceof FixtureNameError) {
      sendJson(response, 400, {error: error.message});
    } else if (error instanceof FixtureClashError) {
      sendJson(response, 409, {error: error.message, suggested: error.suggested});
    } else {
      throw error;
    }
  }
}

async function startReplay(
  api: Api,
  request: IncomingMessage,
  response: ServerResponse,
): Promise<void> {
  const body = await readJson(request);
  const {source, mode} = (isObject(body) ? body : {}) as {source?: unknown; mode?: unknown};
  const fixtureName =
    isObject(source) && typeof source.fixture === 'string' ? source.fixture : undefined;
  const traceId =
    isObject(source) && typeof source.traceId === 'string' ? source.traceId : undefined;
  const lastTurn = isObject(source) ? source.turn : undefined;
  if (
    (fixtureName === undefined) === (traceId === undefined) ||
    // A store turn's record ends at that turn, so only a fixture has a turn to name.
    (lastTurn !== undefined && (typeof lastTurn !== 'string' || fixtureName === undefined)) ||
    (mode !== 'recorded' && mode !== 'model_live' && mode !== 'live')
  ) {
    sendJson(response, 400, {
      error:
        'Replay with {"source": {"fixture": "<name>"} or {"traceId": "<a turn\'s trace id>"}, "mode": "recorded", "model_live" or "live"}. ' +
        'A fixture source may carry "turn", the trace id of the turn of the fixture to end at.',
    });
    return;
  }
  let replaySource: ReplaySource;
  if (fixtureName !== undefined) {
    try {
      replaySource = await api.fixtures.read(fixtureName);
    } catch (error) {
      if (error instanceof FixtureNotFoundError || error instanceof FixtureNameError) {
        sendJson(response, 404, {error: `No fixture is named ${fixtureName}.`});
      } else if (error instanceof FixtureReadError) {
        sendJson(response, 422, {error: error.message});
      } else {
        throw error;
      }
      return;
    }
    if (typeof lastTurn === 'string') {
      const record = cutAfter(replaySource.record, lastTurn);
      if (record === undefined) {
        sendJson(response, 404, {
          error: `The fixture ${fixtureName} holds no turn with this trace id.`,
        });
        return;
      }
      replaySource = {...replaySource, record};
    }
  } else {
    const found = await storedRecord(api, traceId as string, response);
    if (found === undefined) return;
    if (api.store.isUnwritten(found.stored.file)) {
      sendJson(response, 422, {
        error:
          "The turn's record was not written to the store, so there is no file to replay. Save it as a fixture first.",
      });
      return;
    }
    replaySource = {record: found.record, path: api.store.displayPathOf(found.stored.file)};
  }
  try {
    sendJson(response, 202, await api.box.replay(replaySource, mode as ReplayMode));
  } catch (error) {
    if (error instanceof MessageBoxError) {
      sendJson(response, error.status, {error: error.message});
    } else {
      throw error;
    }
  }
}

/**
 * A record's turns from its first up to and including the one with the trace
 * id, itself a record, the one the store wrote for that turn; nothing when
 * the record holds no such turn.
 */
function cutAfter(record: TurnRecord, traceId: string): TurnRecord | undefined {
  const index = record.turns.findIndex(
    turn => turn.events.find(event => isEventOfKind(event, 'turn'))?.traceId === traceId,
  );
  if (index === -1) return undefined;
  return {...record, turns: record.turns.slice(0, index + 1) as TurnRecord['turns']};
}

/** The store's turns and the open turns, newest first. */
async function listTurns(api: Api): Promise<ListedTurn[]> {
  const stored: ListedTurn[] = await Promise.all(
    (await api.store.list()).map(
      async ({traceId, conversationId, startTime, file}: StoredTurn) => ({
        traceId,
        ...(conversationId !== undefined && {conversationId}),
        startTime,
        ...(await storedFields(api, file)),
      }),
    ),
  );
  const listed = new Set(stored.map(turn => turn.traceId));
  const open: ListedTurn[] = api.turns
    .openTurns()
    .filter(turn => !listed.has(turn.traceId))
    .map(turn => ({...turn, open: true}));
  // Stable, so turns that started in the same millisecond keep the order they came in.
  return [...open.reverse(), ...stored].sort((a, b) =>
    a.startTime === b.startTime ? 0 : a.startTime < b.startTime ? 1 : -1,
  );
}

/** The listing's fields of a stored turn, read from its record; none when it does not read as one. */
async function storedFields(
  {store, catalogs}: Api,
  file: string,
): Promise<ListingFields | undefined> {
  let cache = listingCache.get(store);
  if (cache === undefined) {
    cache = new Map();
    listingCache.set(store, cache);
  }
  const revision = store.revisionOf(file);
  const cached = cache.get(file);
  if (cached !== undefined && cached.revision === revision) return cached.fields;
  try {
    const {turns} = await store.read(file);
    const fields = listingFieldsOf(turns[turns.length - 1], turns.slice(0, -1), catalogs);
    cache.set(file, {revision, fields});
    return fields;
  } catch {
    return undefined;
  }
}

async function sendRecord(api: Api, traceId: string, response: ServerResponse): Promise<void> {
  if (api.turns.isOpen(traceId)) {
    sendJson(response, 409, {error: 'The turn is still open, so it has no record yet.'});
    return;
  }
  const stored = (await api.store.list()).find(turn => turn.traceId === traceId);
  if (stored === undefined) {
    sendJson(response, 404, {error: 'No turn has this trace id.'});
    return;
  }
  sendJson(response, 200, await api.store.read(stored.file));
}

/** The live stream: open turns caught up first, then every event as it comes, and a heartbeat. */
function stream(
  turns: TurnHub,
  heartbeatMs: number,
  request: IncomingMessage,
  response: ServerResponse,
): void {
  response.writeHead(200, {
    'content-type': 'text/event-stream; charset=utf-8',
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
  });
  response.write(': Spectra live stream\n\n');
  const unsubscribe = turns.subscribe(event => response.write(sseEvent(event)), {catchUp: true});
  const heartbeat = setInterval(
    () => response.write('event: heartbeat\ndata: {}\n\n'),
    heartbeatMs,
  );
  heartbeat.unref();
  const stop = () => {
    clearInterval(heartbeat);
    unsubscribe();
  };
  request.once('close', stop);
  response.once('close', stop);
}

/** One live event as a server-sent event, named by its type. The host's message id stays out. */
function sseEvent(event: HubEvent): string {
  const fields: Partial<HubEvent> = {...event};
  delete fields.type;
  delete fields.messageId;
  return `event: ${event.type}\ndata: ${JSON.stringify(fields)}\n\n`;
}

async function sendMessage(
  box: MessageBox,
  request: IncomingMessage,
  response: ServerResponse,
): Promise<void> {
  const body = await readJson(request);
  if (body === undefined) {
    sendJson(response, 400, {error: 'The body is not JSON, or is too large.'});
    return;
  }
  const {text, action, dataModel, conversationId} = (isObject(body) ? body : {}) as {
    text?: unknown;
    action?: unknown;
    dataModel?: unknown;
    conversationId?: unknown;
  };
  if (action !== undefined && text !== undefined) {
    sendJson(response, 400, {error: 'Send a text or an action, not both.'});
    return;
  }
  if (action !== undefined && !isA2uiMessage(action, 'action')) {
    sendJson(response, 400, {
      error: 'An action is an A2UI action message: {"version": "<its version>", "action": {…}}.',
    });
    return;
  }
  if (action === undefined && (typeof text !== 'string' || text.trim() === '')) {
    sendJson(response, 400, {error: 'Send {"text": "<the message>"} with some text.'});
    return;
  }
  if (dataModel !== undefined && !isA2uiMessage(dataModel, 'surfaces')) {
    sendJson(response, 400, {
      error: 'A dataModel is an A2UI data model: {"version": "<its version>", "surfaces": {…}}.',
    });
    return;
  }
  if (conversationId !== undefined && typeof conversationId !== 'string') {
    sendJson(response, 400, {error: 'A conversationId is a string.'});
    return;
  }
  try {
    const content = action === undefined ? {text: text as string} : {action};
    sendJson(
      response,
      200,
      await box.send({...content, ...(dataModel !== undefined && {dataModel})}, conversationId),
    );
  } catch (error) {
    if (error instanceof MessageBoxError) {
      sendJson(response, error.status, {error: error.message});
    } else {
      throw error;
    }
  }
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** An A2UI message of the kind its key names: a string `version`, and an object under the key. */
function isA2uiMessage(value: unknown, key: string): value is Record<string, unknown> {
  return isObject(value) && typeof value.version === 'string' && isObject(value[key]);
}

/** The request's body as JSON; nothing when it is not JSON or is too large. */
function readJson(request: IncomingMessage): Promise<unknown> {
  return new Promise(resolve => {
    const chunks: Buffer[] = [];
    let size = 0;
    request.on('data', (chunk: Buffer) => {
      size += chunk.length;
      if (size <= MAX_BODY_BYTES) chunks.push(chunk);
    });
    request.once('end', () => {
      if (size > MAX_BODY_BYTES) {
        resolve(undefined);
        return;
      }
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown);
      } catch {
        resolve(undefined);
      }
    });
    request.once('error', () => resolve(undefined));
  });
}

function sendJson(response: ServerResponse, status: number, value: unknown): void {
  const body = Buffer.from(JSON.stringify(value), 'utf8');
  response.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': body.length,
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
  });
  response.end(body);
}
