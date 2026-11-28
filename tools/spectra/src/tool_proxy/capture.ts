/**
 * What a tool call records, from its start to its end: where it is placed
 * in its turn, and its event as the exchange's relay fills it.
 */
import type {IncomingHttpHeaders} from 'node:http';

import type {SseEvent} from '../proxying/sse.js';
import {chunkEvent, responseAttributes} from '../proxying/exchange.js';
import {AGENT_CLOSED, type Failure, type Relay} from '../proxying/relay.js';
import type {PlacedCall, Unplaced} from '../placement.js';
import type {SpanEvent, ToolCallEvent} from '../record/turn_record.js';
import {type Call, header, type Listener, type Shared} from './listener.js';
import {type JsonRpcMessage, readReply} from './mcp.js';

/** Where a call is placed from: what it is, its start, and the trace context it carries. */
interface Placement {
  what: string;
  start: bigint;
  traceparent: string | undefined;
}

/** A request's placement: at its start, by its `traceparent` header, else the trace context its message carries. */
export function placementOf(call: Call, what: string, traceparent?: string): Placement {
  return {
    what,
    start: call.start,
    traceparent: header(call.request.headers, 'traceparent') ?? traceparent,
  };
}

export function placeOf(call: Call, what: string): PlacedCall | Unplaced {
  return place(call.listener, placementOf(call, what));
}

function place(listener: Listener, {what, start, traceparent}: Placement): PlacedCall | Unplaced {
  return listener.shared.options.place({what, startTimeUnixNano: start.toString(), traceparent});
}

/**
 * Places a call in its turn and starts its capture at the placement's
 * start; none, with the line saying why logged, when no turn takes it.
 */
export function captured(
  listener: Listener,
  placement: Placement,
  init: Omit<ConstructorParameters<typeof ToolCapture>[2], 'start'>,
): ToolCapture | undefined {
  const placed = logged(listener, place(listener, placement));
  return placed === undefined
    ? undefined
    : new ToolCapture(listener.shared, placed, {start: placement.start, ...init});
}

/** The placed call, or nothing with the line saying why logged. */
function logged(listener: Listener, result: PlacedCall | Unplaced): PlacedCall | undefined {
  if ('line' in result) {
    listener.shared.options.log?.(result.line);
    return undefined;
  }
  return result;
}

/** What a tool call records, from its start to its end. */
export class ToolCapture {
  readonly event: ToolCallEvent;
  readonly spanEvents: SpanEvent[] = [];
  private readonly shared: Shared;
  private readonly placed: PlacedCall;
  /** The MCP method of the request it is, for reading its reply. */
  private readonly method: string | undefined;
  private hasEnded = false;
  /** Attributes learned after the start, such as the session a server assigned. */
  private late: Record<string, unknown> = {};
  private exchangeAttributes: Record<string, unknown> | undefined;
  private status: number | undefined;
  private firstReply: JsonRpcMessage | undefined;
  private closedAt: bigint | undefined;
  private chunksAtClose = 0;
  private graceTimer: NodeJS.Timeout | undefined;

  constructor(
    shared: Shared,
    placed: PlacedCall,
    init: {
      start: bigint;
      kind: 2 | 3;
      name: string;
      attributes: Record<string, unknown>;
      method?: string;
    },
  ) {
    this.shared = shared;
    this.placed = placed;
    this.method = init.method;
    this.event = {
      traceId: placed.traceId,
      spanId: shared.newSpanId(),
      parentSpanId: placed.parentSpanId,
      name: init.name,
      kind: init.kind,
      startTimeUnixNano: init.start.toString(),
      attributes: {'a2ui.event.kind': 'tool_call', ...init.attributes},
    };
    shared.open.add(this);
    shared.options.onCall?.({type: 'call_started', traceId: placed.traceId, event: this.event});
  }

  get ended(): boolean {
    return this.hasEnded;
  }

  chunk(event: SseEvent, at: bigint): void {
    if (this.hasEnded) return;
    const spanEvent = chunkEvent(at.toString(), event);
    this.spanEvents.push(spanEvent);
    this.shared.options.onCall?.({
      type: 'call_chunk',
      traceId: this.placed.traceId,
      spanId: this.event.spanId,
      chunk: spanEvent,
    });
  }

  set(attributes: Record<string, unknown>): void {
    Object.assign(this.late, attributes);
  }

  /** The JSON-RPC response to the request it is. */
  reply(message: JsonRpcMessage): void {
    this.firstReply ??= message;
  }

  /** The exchange's response: its status, its headers and, when it was not streamed, its body. */
  exchange(status: number, headers: IncomingHttpHeaders, body?: string): void {
    this.status = status;
    this.exchangeAttributes = responseAttributes(status, headers, body);
  }

  /**
   * Notes that the agent closed its connection before the response ended.
   * The reply is read on for the grace: one that ends by then is complete;
   * one that has not ends the call as aborted at the close, with the chunks
   * before it, and `drop` drops the reply.
   */
  agentClosed(drop: () => void): void {
    if (this.hasEnded || this.closedAt !== undefined) return;
    const at = this.shared.now();
    this.closedAt = at;
    this.chunksAtClose = this.spanEvents.length;
    this.graceTimer = setTimeout(() => {
      this.spanEvents.length = this.chunksAtClose;
      this.closedAt = undefined;
      this.end(at, {type: 'aborted', message: AGENT_CLOSED});
      drop();
    }, this.shared.closeGraceMs);
  }

  /**
   * Ends the call at `at`: an HTTP status of 400 or above, a failure of the
   * exchange or a JSON-RPC error is a failed call; a tool's own error keeps
   * the status. Later calls do nothing.
   */
  end(at: bigint, failure?: Failure): void {
    if (this.hasEnded) return;
    this.hasEnded = true;
    clearTimeout(this.graceTimer);
    this.shared.open.delete(this);
    const attributes: Record<string, unknown> = {
      ...this.event.attributes,
      ...this.late,
      ...this.exchangeAttributes,
    };
    let failed = failure;
    if (failed === undefined && this.status !== undefined && this.status >= 400) {
      failed = {type: String(this.status)};
    }
    if (this.firstReply !== undefined) {
      const reading = readReply(this.method, this.firstReply);
      Object.assign(attributes, reading.attributes);
      if (reading.error !== undefined) {
        failed =
          failed === undefined
            ? reading.error
            : {...failed, message: failed.message ?? reading.error.message};
      }
    }
    if (failed !== undefined) {
      attributes['error.type'] = failed.type;
    }
    const complete: ToolCallEvent = {
      ...this.event,
      endTimeUnixNano: at.toString(),
      attributes: attributes as ToolCallEvent['attributes'],
      ...(this.spanEvents.length > 0 && {events: this.spanEvents}),
      status:
        failed === undefined
          ? {code: 1}
          : {code: 2, ...(failed.message !== undefined && {message: failed.message})},
    };
    this.placed.ended(complete);
    this.shared.options.onCall?.({
      type: 'call_ended',
      traceId: this.placed.traceId,
      event: complete,
    });
  }
}

/** The relay that records the exchange on a capture: chunks as they come, the response at the end. */
export function recording(capture: ToolCapture | undefined): Relay {
  let status = 0;
  let headers: IncomingHttpHeaders = {};
  return {
    head(replyStatus, replyHeaders) {
      status = replyStatus;
      headers = replyHeaders;
    },
    event(event, at) {
      capture?.chunk(event, at);
    },
    end(at, body) {
      capture?.exchange(status, headers, body);
      capture?.end(at);
    },
    fail(failure, at, reached) {
      if (reached) capture?.exchange(status, headers);
      capture?.end(at, failure);
    },
    agentClosed(drop) {
      if (capture === undefined) drop();
      else capture.agentClosed(drop);
    },
  };
}
