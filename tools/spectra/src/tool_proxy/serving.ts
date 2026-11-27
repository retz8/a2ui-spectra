/**
 * The armed tool proxy as the server: each request answered from the
 * record, or as the protocol fixes, on the path a forwarded reply takes, and
 * a miss where the record has nothing; and an HTTP tool request, forwarded
 * or served.
 */
import type {SseEvent} from '../proxying/sse.js';
import {requestAttributes} from '../proxying/exchange.js';
import {forward, type Relay} from '../proxying/relay.js';
import type {CallEvent} from '../record/turn_record.js';
import {exchangeKey, type ReplayPool, requestMessage} from '../replay/pool.js';
import {
  answer502,
  brokeOff,
  missLine,
  recordedAnswer,
  redirectLine,
  recordedEvents,
  type ServedReply,
  sseText,
  unreachedLine,
  wasStreamed,
} from '../replay/served.js';
import {captured, placementOf, recording, servedFrom} from './capture.js';
import {type Call, forwarderOf, header, type Listener} from './listener.js';
import {
  asJsonRpc,
  idKey,
  isNotification,
  isResponse,
  type JsonRpcMessage,
  sentProgressToken,
} from './mcp.js';
import {
  carrierClosed,
  carrierMessage,
  endpointUrl,
  openSseSession,
  type McpServing,
  type Session,
  sessionById,
} from './sessions.js';

/** An HTTP tool request's key: its exchange's method, URL and body. */
export function httpToolKey(call: Call) {
  return exchangeKey(
    requestAttributes(call.request.method ?? 'GET', call.target, call.headers, call.text),
  );
}

/**
 * An HTTP tool request, recorded raw: the exchange only, named by its method
 * and its path without the query. Armed, it is served the event the pool
 * matched, or missed when none.
 */
export function httpTool(call: Call, armed?: {served: CallEvent | undefined}): void {
  const method = call.request.method ?? 'GET';
  const served = armed?.served;
  const capture = captured(
    call.listener,
    placementOf(call, `a tool call to ${call.target.host}, ${method} ${call.target.pathname}`),
    {
      kind: 3,
      name: `${method} ${call.target.pathname}`,
      attributes: {
        ...requestAttributes(method, call.target, call.headers, call.text),
        ...servedFrom(served),
      },
    },
  );
  const relay = recording(capture);
  if (armed === undefined) forward(call, forwarderOf(call.listener.shared), relay);
  else serve(call, relay, served);
}

/**
 * The origin a listener's recorded MCP calls are matched on in a replay:
 * its original's, when the config names more than one tool server; none,
 * and every recorded call its own, with one.
 */
function ownServer(listener: Listener): string | undefined {
  return listener.shared.options.servers.length > 1 ? listener.origin : undefined;
}

/** Answers a request the record matched nothing for: the 502 line, the terminal's line, and the call failed with `replay_miss`. */
function miss(call: Call, relay: Relay): void {
  const {shared} = call.listener;
  const line = missLine('tool proxy', call.request.method ?? 'GET', call.target);
  shared.options.log?.(line);
  answer502(call.response, line);
  relay.fail({type: 'replay_miss', message: line}, shared.now(), false);
}

/**
 * Serves a recorded event, or misses when there is none: a call with no
 * response recorded is the 502 line with the recorded failure; any other is
 * its reply as recorded, its body and chunks passed through `rewrite`, the
 * chunks of a reply that came on a carrier written on the session's carrier
 * once the POST is answered.
 */
function serve(
  call: Call,
  relay: Relay,
  event: CallEvent | undefined,
  rewrite?: (body: unknown) => unknown,
  session?: () => Session,
): void {
  if (event === undefined) {
    miss(call, relay);
    return;
  }
  const {shared} = call.listener;
  const recorded = recordedAnswer(event, {broke: brokeOff(event), rewrite});
  if (recorded.type === 'unreached') {
    answer502(call.response, unreachedLine('tool proxy', call.target.host, recorded.failure));
    relay.fail(recorded.failure, shared.now(), false);
    return;
  }
  if (recorded.type === 'redirect') {
    const line = redirectLine(
      'tool proxy',
      call.request.method ?? 'GET',
      call.target,
      recorded.status,
      recorded.location,
    );
    shared.options.log?.(line);
    answer502(call.response, line);
    relay.fail({type: 'replay_miss', message: line}, shared.now(), false);
    return;
  }
  const carried =
    session === undefined || wasStreamed(event.attributes)
      ? []
      : recordedEvents(event, rewrite).filter(chunk => chunk.event !== 'endpoint');
  forward(
    call,
    forwarderOf(call.listener.shared),
    onCarrier(call.listener, relay, carried, session),
    recorded.reply,
  );
}

/** The relay that, once the POST's exchange ended, writes `events` on the session's carrier and reads them there as a forwarded carrier's are. */
function onCarrier(
  listener: Listener,
  relay: Relay,
  events: SseEvent[],
  session: (() => Session) | undefined,
): Relay {
  if (events.length === 0 || session === undefined) return relay;
  return {
    ...relay,
    end(at, body) {
      relay.end(at, body);
      const carrier = session();
      const outlet = carrier.outlet;
      // With no carrier open, nothing is written; the call ended as its carrier closed.
      if (outlet === undefined || outlet.destroyed || outlet.writableEnded) return;
      for (const event of events) {
        outlet.write(sseText(event));
        carrierMessage(listener, carrier, event, listener.shared.now());
      }
    },
  };
}

/** `202 Accepted` with no body: the protocol's answer to a notification and to a response the client posts. */
const ACCEPTED: ServedReply = {status: 202, headers: {'content-length': '0'}};

/** `204 No Content`: a session end the record has none of. */
const NO_CONTENT: ServedReply = {status: 204, headers: {}};

/**
 * A miss under HTTP+SSE: the 502 line on the POST, as for any miss, and the
 * request's JSON-RPC error on the session's carrier, where its client waits
 * for the reply, so the failed call reaches the agent's code as an MCP
 * error. The error is not recorded: the call is the failed `replay_miss`.
 */
function missOnCarrier(call: Call, relay: Relay, message: JsonRpcMessage, session: Session): void {
  const line = missLine('tool proxy', call.request.method ?? 'GET', call.target);
  miss(call, relay);
  const outlet = session.outlet;
  if (outlet === undefined || outlet.destroyed || outlet.writableEnded) return;
  const error = {jsonrpc: '2.0', id: message.id, error: {code: -32603, message: line}};
  outlet.write(sseText({event: 'message', data: JSON.stringify(error)}));
}

/** A `ping`'s empty result, the protocol's answer: in the POST's reply, or under HTTP+SSE on the carrier after a 202. */
function pong(call: Call, relay: Relay, message: JsonRpcMessage, session: () => Session): void {
  const body = JSON.stringify({jsonrpc: '2.0', id: message.id, result: {}});
  if (session().transport === 'HTTP+SSE') {
    forward(
      call,
      forwarderOf(call.listener.shared),
      onCarrier(call.listener, relay, [{event: 'message', data: body}], session),
      ACCEPTED,
    );
    return;
  }
  forward(call, forwarderOf(call.listener.shared), relay, {
    status: 200,
    headers: {
      'content-type': 'application/json',
      'content-length': String(Buffer.byteLength(body)),
    },
    body,
  });
}

/** The JSON-RPC id of the request a recorded event is, as the key the proxy matches on. */
function recordedRequestId(event: CallEvent): string | undefined {
  return idKey(requestMessage(event)?.id) ?? idKey(event.attributes['jsonrpc.request.id']);
}

/**
 * A served body or chunk with the live request's own identifiers: the
 * response to the recorded request takes the live `id`, and a
 * `notifications/progress` the live progress token, when the live request
 * asked for progress. Nothing else is touched.
 */
function rewriteIds(
  value: unknown,
  recordedId: string | undefined,
  liveId: unknown,
  liveToken: string | number | undefined,
): unknown {
  if (Array.isArray(value)) {
    return value.map(item => rewriteIds(item, recordedId, liveId, liveToken));
  }
  const message = asJsonRpc(value);
  if (message === undefined) return value;
  if (isResponse(message) && recordedId !== undefined && idKey(message.id) === recordedId) {
    return {...message, id: liveId};
  }
  if (
    liveToken !== undefined &&
    isNotification(message) &&
    message.method === 'notifications/progress' &&
    typeof message.params === 'object' &&
    message.params !== null &&
    !Array.isArray(message.params)
  ) {
    return {...message, params: {...message.params, progressToken: liveToken}};
  }
  return value;
}

/**
 * An armed proxy's `GET`, with no server to ask: one whose key matches a
 * recorded HTTP tool call is served as one; one carrying `Mcp-Session-Id` is
 * a streamable HTTP carrier, held open with nothing written; one at the
 * stream path of a recorded HTTP+SSE `initialize` is that session's carrier,
 * its `endpoint` event written as recorded; anything else is a miss.
 */
export function armedGet(call: Call, pool: ReplayPool): void {
  const {listener, request, target} = call;
  const served = pool.httpTool(httpToolKey(call));
  if (served !== undefined) {
    httpTool(call, {served});
    return;
  }
  const id = header(request.headers, 'mcp-session-id');
  if (id !== undefined) {
    holdCarrier(listener, call, sessionById(listener, id));
    return;
  }
  const opening = pool.sseOpening(target.pathname, ownServer(listener));
  if (opening !== undefined) {
    const [endpoint] = recordedEvents({...opening.event, events: [opening.endpoint]});
    const url = endpointUrl(call, endpoint.data.trim());
    if (url !== undefined) {
      const session = openSseSession(listener, call, url, endpoint, listener.shared.now());
      holdCarrier(listener, call, session, endpoint);
      return;
    }
  }
  httpTool(call, {served: undefined});
}

/** Answers a `GET` as a carrier the proxy holds open, `200` `text/event-stream`, writing `first` when given, until the client closes it or the proxy is disarmed. */
function holdCarrier(listener: Listener, call: Call, session: Session, first?: SseEvent): void {
  const {shared} = listener;
  const {response} = call;
  response.writeHead(200, {'content-type': 'text/event-stream', 'cache-control': 'no-cache'});
  response.flushHeaders();
  if (first !== undefined) response.write(sseText(first));
  shared.held.add(response);
  session.carriers++;
  if (first !== undefined) session.outlet = response;
  response.once('close', () => {
    shared.held.delete(response);
    if (session.outlet === response) session.outlet = undefined;
    carrierClosed(listener, session, shared.now());
  });
}

/** The serving the sessions are given while `pool` is armed. */
export function servingOf(pool: ReplayPool): McpServing {
  return {
    recordedRequest: (listener, method, params) =>
      pool.mcpRequest(method, params, ownServer(listener)),
    recordedSessionEnd: listener => pool.sessionEnd(ownServer(listener)),
    answerRequest,
    accept: (call, relay) => forward(call, forwarderOf(call.listener.shared), relay, ACCEPTED),
    endSession: (call, relay, served) => {
      if (served === undefined) forward(call, forwarderOf(call.listener.shared), relay, NO_CONTENT);
      else serve(call, relay, served);
    },
  };
}

/**
 * An armed request's answer: a `ping`'s empty result; a miss under HTTP+SSE
 * with its error on the carrier; else the recorded event with the live
 * request's identifiers, or a miss.
 */
function answerRequest(
  call: Call,
  relay: Relay,
  message: JsonRpcMessage,
  served: CallEvent | undefined,
  session: () => Session,
): void {
  if (message.method === 'ping') {
    pong(call, relay, message, session);
    return;
  }
  if (served === undefined && session().transport === 'HTTP+SSE') {
    missOnCarrier(call, relay, message, session());
    return;
  }
  const recordedId = served === undefined ? undefined : recordedRequestId(served);
  const token = sentProgressToken(message);
  serve(call, relay, served, body => rewriteIds(body, recordedId, message.id, token), session);
}
