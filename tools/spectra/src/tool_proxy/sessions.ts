/**
 * The MCP sessions the tool proxy follows, from everything it forwards: a
 * message the client posts, the session's end, and a `GET` that turns out
 * to be a carrier, whose messages attach to the events they answer, or an
 * HTTP tool call.
 */
import type {IncomingHttpHeaders, IncomingMessage, ServerResponse} from 'node:http';

import type {SseEvent} from '../proxying/sse.js';
import {removeFromUrl} from '../proxying/credentials.js';
import {requestAttributes} from '../proxying/exchange.js';
import {bodyJson} from '../proxying/forwarding.js';
import {type Failure, forward, type Relay, STOPPED} from '../proxying/relay.js';
import type {PlacedCall, Unplaced} from '../placement.js';
import type {CallEvent} from '../record/turn_record.js';
import {servedFrom} from '../replay/served.js';
import {captured, placementOf, placeOf, recording, ToolCapture} from './capture.js';
import {type Call, forwarderOf, header, type Listener} from './listener.js';
import {
  asJsonRpc,
  cancelReason,
  cancelledRequestId,
  eventName,
  idKey,
  isNotification,
  isRequest,
  isResponse,
  type JsonRpcMessage,
  messageAttributes,
  negotiatedVersion,
  progressTokenOf,
  reportedProgressToken,
  traceparentOf,
} from './mcp.js';

const CARRIER_CLOSED = 'The stream its reply was to come on closed.';

/**
 * How the armed proxy answers what a session's client posts, in place of
 * forwarding it; the proxy gives one while a replay's pool is armed.
 */
export interface McpServing {
  /** The recorded event an MCP request other than `ping` is served from; none when the record matches nothing. */
  recordedRequest(listener: Listener, method: string, params: unknown): CallEvent | undefined;
  /** The record's session end; none when it has none. */
  recordedSessionEnd(listener: Listener): CallEvent | undefined;
  /** A request's answer: a `ping`'s empty result; else its recorded event, or a miss. */
  answerRequest(
    call: Call,
    relay: Relay,
    message: JsonRpcMessage,
    served: CallEvent | undefined,
    session: () => Session,
  ): void;
  /** The protocol's 202: a notification's answer, and that of the client's response to a server request. */
  accept(call: Call, relay: Relay): void;
  /** A session end's answer: the record's, else 204. */
  endSession(call: Call, relay: Relay, served: CallEvent | undefined): void;
}

/** A request the client sent, waiting for its reply. */
interface Pending {
  method: string;
  /** Its event; none when it was not placed, whose reply is still matched so it is not taken for another. */
  capture: ToolCapture | undefined;
  progressToken?: string;
  /** When its reply arrived on a carrier, once it has. */
  repliedAt?: bigint;
  /** When its POST's exchange ended with the reply still to come on a carrier. */
  exchangeEndedAt?: bigint;
  /** The map it is filed in: its session's, moved when the server assigns the session. */
  filed: Map<string, Pending>;
}

/** An MCP session as the proxy follows it, from everything it forwards whether or not it records it. */
export interface Session {
  /** The session's key in the listener's map: `sid:<Mcp-Session-Id>`, `endpoint:<path and query>`, or `` for messages with neither. */
  key: string;
  /** The transport the session runs on, or none for the messages that name no session. */
  transport: 'streamable HTTP' | 'HTTP+SSE' | 'none';
  /** `mcp.session.id`: the `Mcp-Session-Id`, or the HTTP+SSE endpoint's `session_id` or `sessionId`. */
  id?: string;
  /** The version the session's `initialize` result negotiated. */
  protocolVersion?: string;
  /** The client's requests waiting for their replies, by id. */
  pending: Map<string, Pending>;
  /** The server's requests on a carrier waiting for the client's response, by id; null when not placed. */
  serverRequests: Map<string, ToolCapture | null>;
  /** The carriers open on the session. */
  carriers: number;
  /** HTTP+SSE: the carrier's opening and its `endpoint` event, where the session's `initialize` starts. */
  opening?: {at: bigint; endpoint: {event: SseEvent; at: bigint}; posted: boolean};
  /** HTTP+SSE: the session's `GET` stream URL on the original server, credentials removed, `a2ui.mcp.stream.url`. */
  streamUrl?: string;
  /** Armed, under HTTP+SSE: the carrier the proxy holds open, where a served reply is written. */
  outlet?: ServerResponse;
}

export function sessionById(listener: Listener, id: string): Session {
  const key = `sid:${id}`;
  let session = listener.sessions.get(key);
  if (session === undefined) {
    session = {
      key,
      transport: 'streamable HTTP',
      id,
      pending: new Map(),
      serverRequests: new Map(),
      carriers: 0,
    };
    listener.sessions.set(key, session);
  }
  return session;
}

/** A request's session: by its `Mcp-Session-Id`, else by the HTTP+SSE endpoint it posts to. */
function sessionOf(listener: Listener, request: IncomingMessage, target: URL): Session {
  const id = header(request.headers, 'mcp-session-id');
  if (id !== undefined) return sessionById(listener, id);
  return listener.sessions.get(`endpoint:${target.pathname}${target.search}`) ?? listener.loose;
}

/** The session's attributes on an event: its id, its protocol version, else the request's header, and under HTTP+SSE its `GET` stream's URL. */
function sessionAttributes(session: Session, request?: IncomingMessage): Record<string, unknown> {
  const version =
    session.protocolVersion ??
    (request === undefined ? undefined : header(request.headers, 'mcp-protocol-version'));
  return {
    ...(session.id !== undefined && {'mcp.session.id': session.id}),
    ...(version !== undefined && {'mcp.protocol.version': version}),
    ...(session.streamUrl !== undefined && {'a2ui.mcp.stream.url': session.streamUrl}),
  };
}

function serverAttributes(listener: Listener): Record<string, unknown> {
  const original = listener.server.original;
  return {
    'server.address': original.hostname,
    'server.port': Number(original.port || (original.protocol === 'https:' ? 443 : 80)),
  };
}

/** A JSON-RPC message the client posted: a request, a notification, or its response to a server request. */
export function mcpMessage(
  call: Call,
  message: JsonRpcMessage,
  serving: McpServing | undefined,
): void {
  const {listener, request, target} = call;
  const {shared} = listener;
  const method = request.method ?? 'POST';
  const session = sessionOf(listener, request, target);
  if (session.opening !== undefined) session.opening.posted = true;
  const exchangeRequest = requestAttributes(method, target, call.headers, call.text);

  if (isResponse(message)) {
    clientResponse(call, message, session, exchangeRequest, serving);
    return;
  }
  if (isNotification(message) && message.method === 'notifications/cancelled') {
    cancel(call, message, session);
  }

  const asking = isRequest(message);
  const id = idKey(message.id);
  const mcpMethod = typeof message.method === 'string' ? message.method : undefined;
  const attributes = {
    ...messageAttributes(message),
    ...sessionAttributes(session, request),
    ...exchangeRequest,
  };
  const name = mcpMethod === undefined ? method : eventName(attributes);
  // Under HTTP+SSE, the session's initialize starts when its carrier opened, its endpoint event inside it.
  const opening =
    mcpMethod === 'initialize' && session.opening !== undefined ? session.opening : undefined;
  if (opening !== undefined) session.opening = undefined;
  const start = opening?.at ?? call.start;
  // Armed, a request other than ping is served the event the record matches, if any.
  const served =
    serving !== undefined && asking && mcpMethod !== undefined && mcpMethod !== 'ping'
      ? serving.recordedRequest(listener, mcpMethod, message.params)
      : undefined;
  const capture = captured(
    listener,
    {
      ...placementOf(
        call,
        `an MCP ${asking ? 'request' : 'message'} to ${target.host}, ${name}`,
        traceparentOf(message),
      ),
      start,
    },
    {kind: 3, name, attributes: {...attributes, ...servedFrom(served)}, method: mcpMethod},
  );
  if (opening !== undefined) capture?.chunk(opening.endpoint.event, opening.endpoint.at);

  const state: RequestState = {session, id, mcpMethod, capture};
  if (asking && id !== undefined && mcpMethod !== undefined) {
    const progressToken = progressTokenOf(message);
    state.pending = {
      method: mcpMethod,
      capture,
      filed: session.pending,
      ...(progressToken !== undefined && {progressToken}),
    };
    session.pending.set(id, state.pending);
  }
  const relay = requestRelay(listener, state);
  if (serving === undefined) {
    forward(call, forwarderOf(shared), relay);
  } else if (!asking) {
    serving.accept(call, relay);
  } else {
    serving.answerRequest(call, relay, message, served, () => state.session);
  }
}

/**
 * A response the client posted. To a server request on a carrier, the
 * request's event ends at its arrival with this exchange; to one that is no
 * event of its own, such as one inside a POST's own reply, it is an event of
 * its own. Armed, it gets the protocol's 202.
 */
function clientResponse(
  call: Call,
  message: JsonRpcMessage,
  session: Session,
  exchangeRequest: Record<string, unknown>,
  serving: McpServing | undefined,
): void {
  const {listener, request, target} = call;
  const answer = (relay: Relay) => {
    if (serving === undefined) forward(call, forwarderOf(listener.shared), relay);
    else serving.accept(call, relay);
  };
  const id = idKey(message.id) ?? '';
  const asked = session.serverRequests.get(id);
  if (asked !== undefined) {
    session.serverRequests.delete(id);
    if (asked === null) {
      answer({end: () => {}, fail: () => {}});
      return;
    }
    asked.set(exchangeRequest);
    const relay = recording(asked);
    answer({
      ...relay,
      event: undefined,
      end: (_at, body) => relay.end(call.start, body),
      fail: (failure, _at, reached) => relay.fail(failure, call.start, reached),
      agentClosed: drop => drop(),
    });
    return;
  }
  const attributes = {
    'jsonrpc.request.id': id,
    ...sessionAttributes(session, request),
    ...exchangeRequest,
  };
  const capture = captured(
    listener,
    placementOf(
      call,
      `an MCP response to ${target.host}, for request ${id}`,
      traceparentOf(message),
    ),
    {kind: 3, name: 'response', attributes},
  );
  answer(recording(capture));
}

/** A `notifications/cancelled`: the request it names, still waiting, ends as cancelled at its arrival. */
function cancel(call: Call, message: JsonRpcMessage, session: Session): void {
  const id = cancelledRequestId(message);
  const cancelled = id === undefined ? undefined : session.pending.get(id);
  if (id === undefined || cancelled === undefined) return;
  session.pending.delete(id);
  const reason = cancelReason(message);
  cancelled.capture?.end(call.start, {
    type: 'cancelled',
    ...(reason !== undefined && {message: reason}),
  });
}

/** A client's request or notification as its relay follows it. */
interface RequestState {
  /** Its session, which the server's reply to `initialize` may assign. */
  session: Session;
  id: string | undefined;
  mcpMethod: string | undefined;
  capture: ToolCapture | undefined;
  /** Its entry among the session's requests waiting for their replies; none for a notification. */
  pending?: Pending;
}

/** The relay that follows a client's request: its session as the server assigns it, its reply wherever it comes, and its end. */
function requestRelay(listener: Listener, state: RequestState): Relay {
  const {shared} = listener;
  const {id, mcpMethod, capture} = state;
  /** Where a request with no entry of its own is looked for at its end: the session it was posted in. */
  const posted = state.session.pending;
  let status = 0;
  let headers: IncomingHttpHeaders = {};
  let streamed = false;
  let sawEventId = false;
  const replied = (reply: JsonRpcMessage) => {
    if (state.pending === undefined) return;
    state.pending.repliedAt ??= shared.now();
    capture?.reply(reply);
    if (mcpMethod === 'initialize') noteNegotiated(state.session, capture, reply);
  };
  const isOurs = (value: unknown): value is JsonRpcMessage => {
    const reply = asJsonRpc(value);
    return reply !== undefined && isResponse(reply) && idKey(reply.id) === id;
  };
  const finish = (at: bigint, failure?: Failure) => {
    if (id !== undefined) (state.pending?.filed ?? posted).delete(id);
    capture?.end(at, failure);
  };
  return {
    head(replyStatus, replyHeaders, replyStreamed) {
      status = replyStatus;
      headers = replyHeaders;
      streamed = replyStreamed;
      const assigned = header(replyHeaders, 'mcp-session-id');
      if (
        assigned !== undefined &&
        state.session.id === undefined &&
        state.session.transport === 'none'
      ) {
        // The server assigned the session in its reply to initialize.
        const assignedSession = sessionById(listener, assigned);
        if (state.pending !== undefined && id !== undefined) {
          state.pending.filed.delete(id);
          assignedSession.pending.set(id, state.pending);
          state.pending.filed = assignedSession.pending;
        }
        state.session = assignedSession;
        capture?.set({'mcp.session.id': assigned});
      }
    },
    event(event, at) {
      // The POST's own reply: every message in it is a chunk on this event.
      capture?.chunk(event, at);
      if (event.id !== undefined) sawEventId = true;
      const value = bodyJson(event.data);
      if (isOurs(value)) replied(value);
    },
    end(at, body) {
      capture?.exchange(status, headers, body);
      if (body !== undefined) {
        const value = bodyJson(body);
        const reply = Array.isArray(value) ? value.find(isOurs) : isOurs(value) ? value : undefined;
        if (reply !== undefined) replied(reply);
      }
      const {pending} = state;
      if (
        pending !== undefined &&
        pending.repliedAt === undefined &&
        status < 400 &&
        !streamed &&
        state.session.transport === 'HTTP+SSE'
      ) {
        // The reply is to come on a carrier: HTTP+SSE's 202.
        pending.exchangeEndedAt = at;
        if (state.session.carriers === 0) finish(at, {type: 'aborted', message: CARRIER_CLOSED});
        return;
      }
      // Any other transport answers a request on its own exchange.
      finish(at);
    },
    fail(failure, at, reached) {
      if (reached) capture?.exchange(status, headers);
      const {pending} = state;
      if (
        pending !== undefined &&
        pending.repliedAt === undefined &&
        reached &&
        streamed &&
        sawEventId &&
        !shared.closing
      ) {
        // A reply stream that broke after an event id: the reply may come on a resumed stream.
        pending.exchangeEndedAt = at;
        return;
      }
      finish(at, failure);
    },
    agentClosed(drop) {
      if (capture === undefined) drop();
      else capture.agentClosed(drop);
    },
  };
}

/** Records the version an `initialize` reply negotiated, on the session and on the call's event. */
function noteNegotiated(
  session: Session,
  capture: ToolCapture | undefined,
  reply: JsonRpcMessage,
): void {
  const version = negotiatedVersion(reply);
  if (version === undefined) return;
  session.protocolVersion = version;
  capture?.set({'mcp.protocol.version': version});
}

/** MCP's session end: a `DELETE` carrying `Mcp-Session-Id`, named `DELETE`, with the session and the exchange. */
export function sessionEnd(call: Call, serving: McpServing | undefined): void {
  const {listener, request, target} = call;
  const session = sessionById(listener, header(request.headers, 'mcp-session-id') ?? '');
  // Armed, the record's session end, else 204.
  const served = serving?.recordedSessionEnd(listener);
  const capture = captured(
    listener,
    placementOf(call, `an MCP session end to ${target.host}, DELETE`),
    {
      kind: 3,
      name: 'DELETE',
      attributes: {
        ...sessionAttributes(session, request),
        ...requestAttributes('DELETE', target, call.headers, call.text),
        ...servedFrom(served),
      },
    },
  );
  const recorded = recording(capture);
  const relay: Relay = {
    ...recorded,
    end: (at, body) => {
      recorded.end(at, body);
      // The session is over; a carrier still open keeps its own hold on it.
      listener.sessions.delete(session.key);
    },
  };
  if (serving === undefined) forward(call, forwarderOf(call.listener.shared), relay);
  else serving.endSession(call, relay, served);
}

/**
 * A `GET`: a carrier when it is answered with `text/event-stream` and either
 * carries `Mcp-Session-Id` or its first event is `endpoint`; an HTTP tool
 * request otherwise. It is placed at its start, before it shows which.
 */
export function getRequest(call: Call): void {
  const {listener, request, target} = call;
  const {shared} = listener;
  const what = `a tool call to ${target.host}, GET ${target.pathname}`;
  /** The placement held while the GET has not shown what it is; none once released. */
  let tentative: PlacedCall | Unplaced | undefined = placeOf(call, what);
  if (!('line' in tentative)) shared.tentative.add(tentative);
  /** What the GET turned out to be; none while it has not shown it. */
  let phase: GetPhase | undefined;
  const reply: ReplyHead = {status: 0, headers: {}};
  const settleTentative = () => {
    if (tentative !== undefined && !('line' in tentative)) shared.tentative.delete(tentative);
  };
  /** Lets the turn go on without the GET, which may stay open as long as its client does. */
  const releaseTentative = () => {
    settleTentative();
    if (tentative !== undefined && !('line' in tentative)) tentative.release();
    tentative = undefined;
  };
  const becomeTool = (): GetPhase => {
    settleTentative();
    // A stream released at its head is placed anew, at its own start.
    const placed = tentative ?? placeOf(call, what);
    let capture: ToolCapture | undefined;
    if ('line' in placed) {
      shared.options.log?.(placed.line);
    } else {
      capture = new ToolCapture(shared, placed, {
        start: call.start,
        kind: 3,
        name: `GET ${target.pathname}`,
        attributes: requestAttributes('GET', target, call.headers, call.text),
      });
    }
    return (phase = toolPhase(capture, reply));
  };
  const becomeCarrier = (session: Session | undefined) => {
    releaseTentative();
    if (session !== undefined) session.carriers++;
    phase = carrierPhase(listener, session);
  };
  const endpoint = (event: SseEvent, at: bigint) => {
    const data = event.data.trim();
    const read = URL.canParse(data) ? undefined : endpointUrl(call, data);
    if (read === undefined) {
      becomeCarrier(undefined);
      if (!listener.absoluteTold) {
        listener.absoluteTold = true;
        shared.options.log?.(
          `The tool server at ${listener.origin} announces ` +
            (URL.canParse(data)
              ? `an absolute endpoint, ${removeFromUrl(data)}; `
              : `an endpoint the tool proxy cannot read, ${data}; `) +
            'its calls will not pass through the tool proxy.',
        );
      }
      return;
    }
    becomeCarrier(openSseSession(listener, call, read, event, at));
  };

  forward(call, forwarderOf(shared), {
    head(replyStatus, replyHeaders, streamed) {
      reply.status = replyStatus;
      reply.headers = replyHeaders;
      if (!streamed) {
        becomeTool();
        return;
      }
      const id = header(request.headers, 'mcp-session-id');
      if (id !== undefined) becomeCarrier(sessionById(listener, id));
      // A stream that names no session may show nothing for as long as it is open, as a
      // stateless server's carrier does: the turn is not held for it.
      else releaseTentative();
    },
    event(event, at) {
      if (phase === undefined && event.event === 'endpoint') {
        endpoint(event, at);
        return;
      }
      (phase ?? becomeTool()).event(event, at);
    },
    end(at, body) {
      (phase ?? becomeTool()).end(at, body);
    },
    fail(failure, at, reached) {
      (phase ?? becomeTool()).fail(failure, at, reached);
    },
    agentClosed(drop) {
      if (phase === undefined) {
        // It never showed what it is.
        releaseTentative();
        phase = GONE;
      }
      phase.agentClosed(drop);
    },
  });
}

/** A reply's status and headers, as its head gave them. */
interface ReplyHead {
  status: number;
  headers: IncomingHttpHeaders;
}

/** What a `GET` turned out to be, and how the rest of its reply is read. */
interface GetPhase {
  event(event: SseEvent, at: bigint): void;
  end(at: bigint, body: string | undefined): void;
  fail(failure: Failure, at: bigint, reached: boolean): void;
  agentClosed(drop: () => void): void;
}

/** A `GET` that is an HTTP tool call: its exchange and its chunks recorded on its capture, if it was placed. */
function toolPhase(capture: ToolCapture | undefined, reply: ReplyHead): GetPhase {
  return {
    event(event, at) {
      capture?.chunk(event, at);
    },
    end(at, body) {
      capture?.exchange(reply.status, reply.headers, body);
      capture?.end(at);
    },
    fail(failure, at, reached) {
      if (reached) capture?.exchange(reply.status, reply.headers);
      capture?.end(at, failure);
    },
    agentClosed(drop) {
      if (capture === undefined) drop();
      else capture.agentClosed(drop);
    },
  };
}

/** A `GET` that is a carrier: its messages read into its session, none for one whose endpoint is not read. */
function carrierPhase(listener: Listener, carried: Session | undefined): GetPhase {
  return {
    event(event, at) {
      if (carried !== undefined) carrierMessage(listener, carried, event, at);
    },
    end(at) {
      carrierClosed(listener, carried, at);
    },
    fail(_failure, at) {
      carrierClosed(listener, carried, at);
    },
    agentClosed: drop => drop(),
  };
}

/** A `GET` whose agent left before it showed what it is: nothing more is read. */
const GONE: GetPhase = {
  event: () => {},
  end: () => {},
  fail: () => {},
  agentClosed: drop => drop(),
};

/**
 * A relative endpoint as the client resolves it, against the stream's URL on
 * the listener; none when it does not resolve.
 */
export function endpointUrl(call: Call, data: string): URL | undefined {
  const stream = new URL(
    `${call.target.pathname}${call.target.search}`,
    call.listener.server.proxyOrigin,
  );
  try {
    return new URL(data, stream);
  } catch {
    return undefined;
  }
}

/**
 * Registers the HTTP+SSE session a carrier's relative `endpoint` event
 * opens, keyed by the endpoint's path and query, its `initialize` to start
 * at the carrier's opening with the event as its first chunk.
 */
export function openSseSession(
  listener: Listener,
  call: Call,
  url: URL,
  event: SseEvent,
  at: bigint,
): Session {
  const key = `endpoint:${url.pathname}${url.search}`;
  const id = url.searchParams.get('session_id') ?? url.searchParams.get('sessionId') ?? undefined;
  const session: Session = {
    key,
    transport: 'HTTP+SSE',
    ...(id !== undefined && {id}),
    pending: new Map(),
    serverRequests: new Map(),
    carriers: 0,
    opening: {at: call.start, endpoint: {event, at}, posted: false},
    streamUrl: removeFromUrl(call.target.href),
  };
  listener.sessions.set(key, session);
  return session;
}

/** A message the server sent on a carrier: attached to the event it answers, else an event of its own. */
export function carrierMessage(
  listener: Listener,
  session: Session,
  event: SseEvent,
  at: bigint,
): void {
  const message = asJsonRpc(bodyJson(event.data));
  if (message === undefined) return;
  if (isResponse(message)) {
    const id = idKey(message.id) ?? '';
    const pending = session.pending.get(id);
    if (pending !== undefined) {
      pending.capture?.chunk(event, at);
      pending.capture?.reply(message);
      pending.repliedAt ??= at;
      if (pending.method === 'initialize') noteNegotiated(session, pending.capture, message);
      if (pending.exchangeEndedAt !== undefined) {
        session.pending.delete(id);
        pending.capture?.end(at);
      }
      return;
    }
    serverEvent(listener, session, event, at, message, {
      what: `an MCP response from ${listener.server.original.host}, for request ${id}`,
      name: 'response',
      attributes: {'jsonrpc.request.id': id},
      ends: true,
    });
    return;
  }
  if (isNotification(message)) {
    if (message.method === 'notifications/progress') {
      const token = reportedProgressToken(message);
      const progressed = [...session.pending.values()].find(
        pending => token !== undefined && pending.progressToken === token,
      );
      if (progressed !== undefined) {
        progressed.capture?.chunk(event, at);
        return;
      }
    }
    const attributes = messageAttributes(message);
    const name = eventName(attributes);
    serverEvent(listener, session, event, at, message, {
      what: `an MCP message from ${listener.server.original.host}, ${name}`,
      name,
      attributes,
      ends: true,
    });
    return;
  }
  if (isRequest(message)) {
    const attributes = messageAttributes(message);
    const name = eventName(attributes);
    const capture = serverEvent(listener, session, event, at, message, {
      what: `an MCP request from ${listener.server.original.host}, ${name}`,
      name,
      attributes,
      ends: false,
    });
    session.serverRequests.set(idKey(message.id) ?? '', capture ?? null);
  }
}

/**
 * An event the server initiated, placed by its message's `_meta` trace
 * context, else by the time window at its arrival: a notification starts and
 * ends at its arrival; a request ends when the client's response arrives.
 */
function serverEvent(
  listener: Listener,
  session: Session,
  event: SseEvent,
  at: bigint,
  message: JsonRpcMessage,
  {
    what,
    name,
    attributes,
    ends,
  }: {what: string; name: string; attributes: Record<string, unknown>; ends: boolean},
): ToolCapture | undefined {
  const capture = captured(
    listener,
    {what, start: at, traceparent: traceparentOf(message)},
    {
      kind: 2,
      name,
      attributes: {...attributes, ...sessionAttributes(session), ...serverAttributes(listener)},
    },
  );
  if (capture === undefined) return undefined;
  capture.chunk(event, at);
  if (ends) {
    if (isResponse(message)) capture.reply(message);
    capture.end(at);
  }
  return capture;
}

/**
 * A carrier closed: with no other carrier open on the session, each request
 * whose reply was to come on one ends as aborted. An HTTP+SSE carrier that
 * closes before any request was posted leaves one terminal line.
 */
export function carrierClosed(listener: Listener, session: Session | undefined, at: bigint): void {
  if (session === undefined) return;
  const {shared} = listener;
  session.carriers--;
  if (session.opening !== undefined && !session.opening.posted) {
    session.opening = undefined;
    listener.sessions.delete(session.key);
    shared.options.log?.(
      `The tool server at ${listener.origin} closed an HTTP+SSE stream before any request was posted on it; ` +
        'nothing is recorded.',
    );
    return;
  }
  if (session.carriers > 0) return;
  for (const [id, pending] of session.pending) {
    if (pending.exchangeEndedAt === undefined) continue;
    session.pending.delete(id);
    pending.capture?.end(
      at,
      shared.closing
        ? {type: 'aborted', message: STOPPED}
        : {type: 'aborted', message: CARRIER_CLOSED},
    );
  }
  // An HTTP+SSE session lives as long as its one stream.
  if (session.transport === 'HTTP+SSE') listener.sessions.delete(session.key);
}
