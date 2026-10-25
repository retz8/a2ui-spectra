import type {IncomingMessage, ServerResponse} from 'node:http';

import type {CardDetails} from './a2a/card.js';
import {type ListingFields, listingFieldsOf} from './listing.js';
import {type MessageBox, MessageBoxError} from './message_box.js';
import type {StoredTurn, TurnStore} from './store/store.js';
import type {HubEvent, TurnHub} from './turn_hub.js';

/** What the context bar, the agent's popover and the first screen show of the session. */
export interface SessionContext extends CardDetails {
  /** The agent's name, from its card. */
  agentName?: string;
  /** The agent's own URL, the one Spectra was given. */
  agentUrl: string;
  mode: 'run' | 'attach';
  /** The wire proxy's address, for a host app to point at. */
  proxyAddress: string;
}

/** What the API serves from. */
export interface Api {
  store: TurnStore;
  turns: TurnHub;
  box: MessageBox;
  context: SessionContext;
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

/** The listing's fields of each record file read so far, by store and file. A file is written once. */
const listingCache = new WeakMap<TurnStore, Map<string, ListingFields | undefined>>();

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
 *   and what the agent's card states.
 * - `GET /api/turns`: the turns, newest first.
 * - `GET /api/turns/<trace id>`: a closed turn's record.
 * - `GET /api/stream`: the live stream, as server-sent events.
 * - `GET /api/message-box`: the conversations the message box started.
 * - `POST /api/message-box/messages`: sends `{"text": …}`, continuing one of them by its
 *   `conversationId`, or else in a new conversation.
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
  if (route === 'GET /api/context') {
    sendJson(response, 200, api.context);
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
  } else if (isRoute(pathname)) {
    sendJson(response, 405, {error: `${request.method} is not allowed here.`});
  } else {
    sendJson(response, 404, {error: 'Not found.'});
  }
}

function isRoute(pathname: string): boolean {
  return (
    /^\/api\/turns(\/[0-9a-f]{32})?$/.test(pathname) ||
    ['/api/context', '/api/stream', '/api/message-box', '/api/message-box/messages'].includes(
      pathname,
    )
  );
}

/** The store's turns and the open turns, newest first. */
async function listTurns(api: Api): Promise<ListedTurn[]> {
  const stored: ListedTurn[] = await Promise.all(
    (await api.store.list()).map(
      async ({traceId, conversationId, startTime, file}: StoredTurn) => ({
        traceId,
        ...(conversationId !== undefined && {conversationId}),
        startTime,
        ...(await storedFields(api.store, file)),
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
async function storedFields(store: TurnStore, file: string): Promise<ListingFields | undefined> {
  let cache = listingCache.get(store);
  if (cache === undefined) {
    cache = new Map();
    listingCache.set(store, cache);
  }
  if (!cache.has(file)) {
    try {
      const {turns} = await store.read(file);
      cache.set(file, listingFieldsOf(turns[turns.length - 1], turns.slice(0, -1)));
    } catch {
      return undefined;
    }
  }
  return cache.get(file);
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
  const {text, conversationId} =
    typeof body === 'object' && body !== null
      ? (body as {text?: unknown; conversationId?: unknown})
      : {text: '', conversationId: undefined};
  if (typeof text !== 'string' || text.trim() === '') {
    sendJson(response, 400, {error: 'Send {"text": "<the message>"} with some text.'});
    return;
  }
  if (conversationId !== undefined && typeof conversationId !== 'string') {
    sendJson(response, 400, {error: 'A conversationId is a string.'});
    return;
  }
  try {
    sendJson(response, 200, await box.send(text, conversationId));
  } catch (error) {
    if (error instanceof MessageBoxError) {
      sendJson(response, error.status, {error: error.message});
    } else {
      throw error;
    }
  }
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
