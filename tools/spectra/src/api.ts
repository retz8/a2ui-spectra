import type {IncomingMessage, ServerResponse} from 'node:http';

import {type MessageBox, MessageBoxError} from './message_box.js';
import type {StoredTurn, TurnStore} from './store/store.js';
import type {HubEvent, TurnHub} from './turn_hub.js';

/** What the API serves from. */
export interface Api {
  store: TurnStore;
  turns: TurnHub;
  box: MessageBox;
}

/** One entry of the turn listing. */
export interface ListedTurn {
  traceId: string;
  conversationId?: string;
  /** The turn's start, as an ISO 8601 UTC time to the millisecond. */
  startTime: string;
  /** Set on a turn still open. */
  open?: true;
}

/** The largest request body the API reads. */
const MAX_BODY_BYTES = 64 * 1024;

/** How often the live stream sends a comment, so an idle connection stays open. */
const KEEP_ALIVE_MS = 15_000;

/**
 * Answers a request under `/api/`. Returns false for any other path, which
 * the caller serves.
 *
 * - `GET /api/turns`: the turns, newest first.
 * - `GET /api/turns/<trace id>`: a closed turn's record.
 * - `GET /api/stream`: the live stream, as server-sent events.
 * - `GET /api/message-box`: the message box's conversation.
 * - `POST /api/message-box/messages`: sends `{"text": …}` in it.
 * - `POST /api/message-box/new-conversation`: starts a new one.
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
  if (route === 'GET /api/turns') {
    sendJson(response, 200, {turns: await listTurns(api)});
  } else if (turn !== null) {
    await sendRecord(api, turn[1], response);
  } else if (route === 'GET /api/stream') {
    stream(api.turns, request, response);
  } else if (route === 'GET /api/message-box') {
    sendJson(response, 200, api.box.state());
  } else if (route === 'POST /api/message-box/messages') {
    await sendMessage(api.box, request, response);
  } else if (route === 'POST /api/message-box/new-conversation') {
    sendJson(response, 200, api.box.newConversation());
  } else if (isRoute(pathname)) {
    sendJson(response, 405, {error: `${request.method} is not allowed here.`});
  } else {
    sendJson(response, 404, {error: 'Not found.'});
  }
}

function isRoute(pathname: string): boolean {
  return (
    /^\/api\/turns(\/[0-9a-f]{32})?$/.test(pathname) ||
    [
      '/api/stream',
      '/api/message-box',
      '/api/message-box/messages',
      '/api/message-box/new-conversation',
    ].includes(pathname)
  );
}

/** The store's turns and the open turns, newest first. */
async function listTurns(api: Api): Promise<ListedTurn[]> {
  const stored: ListedTurn[] = (await api.store.list()).map(
    ({traceId, conversationId, startTime}: StoredTurn) => ({
      traceId,
      ...(conversationId !== undefined && {conversationId}),
      startTime,
    }),
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

/** The live stream: open turns caught up first, then every event as it comes. */
function stream(turns: TurnHub, request: IncomingMessage, response: ServerResponse): void {
  response.writeHead(200, {
    'content-type': 'text/event-stream; charset=utf-8',
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
  });
  response.write(': Spectra live stream\n\n');
  const unsubscribe = turns.subscribe(event => response.write(sseEvent(event)), {catchUp: true});
  const keepAlive = setInterval(() => response.write(': keep-alive\n\n'), KEEP_ALIVE_MS);
  keepAlive.unref();
  const stop = () => {
    clearInterval(keepAlive);
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
  const text = typeof body === 'object' && body !== null ? (body as {text?: unknown}).text : '';
  if (typeof text !== 'string' || text.trim() === '') {
    sendJson(response, 400, {error: 'Send {"text": "<the message>"} with some text.'});
    return;
  }
  try {
    sendJson(response, 200, await box.send(text));
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
