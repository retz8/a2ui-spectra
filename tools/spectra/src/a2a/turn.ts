import {randomBytes} from 'node:crypto';

import type {
  Turn,
  TurnEvent,
  TurnOutcome,
  WireInputAttributes,
  WireInputEvent,
  WireOutputEvent,
  WirePart,
} from '../record/turn_record.js';
import {splitInputMetadata} from './metadata.js';
import {wirePart} from './parts.js';
import {
  type A2aMessage,
  isRecord,
  readReply,
  type Reply,
  type TaskState,
  type TurnRequest,
} from './protocol.js';

/** What the adapter hands out as a turn is captured. */
export type TurnNotification =
  | {type: 'turn_opened'; traceId: string; conversationId?: string}
  | {type: 'wire_event'; traceId: string; event: WireInputEvent | WireOutputEvent}
  /** The turn: its turn event, then its wire events in order. No check event. */
  | {type: 'turn_closed'; traceId: string; turn: Turn};

export type TurnListener = (notification: TurnNotification) => void;

export interface TurnCaptureOptions {
  /** The agent's name, from its card. */
  agentName?: string;
  /** The program writing the record. */
  writer: {name: string; version: string};
  listener: TurnListener;
  /** Nanoseconds since the Unix epoch. */
  now?: () => bigint;
  newTraceId?: () => string;
  newSpanId?: () => string;
}

const OUTCOMES: Readonly<Record<TaskState, TurnOutcome>> = {
  completed: 'completed',
  'input-required': 'waiting_for_input',
  'auth-required': 'waiting_for_input',
  canceled: 'cancelled',
  failed: 'failed',
  rejected: 'failed',
  submitted: 'failed',
  working: 'failed',
  unknown: 'failed',
};

/** An A2UI extension URI, which ends in the protocol version it stands for. */
const A2UI_EXTENSION_URI = /^https?:\/\/a2ui\.org\/a2a-extension\/a2ui\/(v\d+(?:\.\d+)*)\/?$/;

/**
 * One turn as the wire proxy sees it: opened by the host's request, given
 * each delivery from the agent in order, and closed when the reply ends. It
 * writes the turn event and the wire events of turn record v0.1, and
 * notifies the listener as it goes.
 */
export class TurnCapture {
  readonly #request: TurnRequest;
  readonly #options: TurnCaptureOptions;
  readonly #now: () => bigint;
  readonly #newSpanId: () => string;
  readonly #traceId: string;
  readonly #spanId: string;
  readonly #start: bigint;
  readonly #wireEvents: Array<WireInputEvent | WireOutputEvent> = [];
  readonly #a2uiVersions: string[] = [];
  readonly #offeredVersions: string[];
  #conversationId: string | undefined;
  #state: TaskState | undefined;
  #sawMessage = false;
  #error: string | undefined;
  #headerVersions: string[] = [];
  #closed = false;

  private constructor(request: TurnRequest, options: TurnCaptureOptions) {
    this.#request = request;
    this.#options = options;
    this.#now = options.now ?? nowUnixNano;
    this.#newSpanId = options.newSpanId ?? (() => randomBytes(8).toString('hex'));
    this.#start = this.#now();
    this.#traceId = (options.newTraceId ?? (() => randomBytes(16).toString('hex')))();
    this.#spanId = this.#newSpanId();
    this.#conversationId = request.message.contextId;

    this.#notify({
      type: 'turn_opened',
      traceId: this.#traceId,
      ...(this.#conversationId !== undefined && {conversationId: this.#conversationId}),
    });

    const parts = this.#parts(request.message.parts);
    const split = splitInputMetadata(request.message.metadata, this.#a2uiVersions[0]);
    this.#offeredVersions = Object.keys(split.capabilities ?? {});
    const attributes: WireInputAttributes = {
      'a2ui.event.kind': 'wire_input',
      'a2ui.wire.message': {role: 'user', parts},
      ...(split.dataModel && {'a2ui.wire.data_model': split.dataModel}),
      ...(split.capabilities && {'a2ui.wire.capabilities': split.capabilities}),
      ...(split.metadata && {'a2ui.wire.metadata': split.metadata}),
    };
    this.#addWireEvent({...this.#pointEvent('wire_input'), attributes});
  }

  /** Opens a turn for a host's request and notifies that it opened. */
  static open(request: TurnRequest, options: TurnCaptureOptions): TurnCapture {
    return new TurnCapture(request, options);
  }

  /**
   * The reply's extensions header, `X-A2A-Extensions` in A2A 0.3 and
   * `A2A-Extensions` in A2A 1.0: the turn's protocol version when its
   * messages name none and the header names one A2UI version.
   */
  replyExtensions(header: string | undefined): void {
    const versions = (header ?? '')
      .split(',')
      .map(uri => uri.trim().match(A2UI_EXTENSION_URI)?.[1])
      .filter(version => version !== undefined);
    this.#headerVersions = [...new Set(versions)];
  }

  /**
   * One delivery from the agent: a send's JSON-RPC response, or one stream
   * event's. Anything that is not a JSON-RPC response is still a delivery,
   * with no parts.
   */
  delivery(response: unknown): void {
    let content: {parts: unknown[]; metadata?: Record<string, unknown>} = {parts: []};
    if (isRecord(response) && response.error !== undefined) {
      const error = response.error;
      this.fail(
        isRecord(error) && typeof error.message === 'string' ? error.message : 'JSON-RPC error',
      );
    } else if (isRecord(response) && 'result' in response) {
      const reply = readReply(response.result, this.#request.version);
      if (reply !== undefined) {
        this.#follow(reply);
        content = agentContent(reply, this.#request.message.messageId);
      }
    }
    this.#addWireEvent({
      ...this.#pointEvent('wire_output'),
      attributes: {
        'a2ui.event.kind': 'wire_output',
        'a2ui.wire.message': {role: 'assistant', parts: this.#parts(content.parts)},
        ...(content.metadata && {'a2ui.wire.metadata': content.metadata}),
      },
    });
  }

  /**
   * The reply failed: a JSON-RPC error, a response that is not 2xx, or a
   * connection that broke. The first failure's message is the turn's.
   */
  fail(message: string): void {
    this.#error ??= message;
  }

  /** Closes the turn and notifies with the turn's events. Later calls do nothing. */
  close(): void {
    if (this.#closed) {
      return;
    }
    this.#closed = true;
    const outcome = this.#outcome();
    const version =
      this.#a2uiVersions[0] ?? only(this.#headerVersions) ?? only(this.#offeredVersions);
    const {agentName, writer} = this.#options;
    const turnEvent: TurnEvent = {
      traceId: this.#traceId,
      spanId: this.#spanId,
      name: agentName === undefined ? 'invoke_agent' : `invoke_agent ${agentName}`,
      kind: 3,
      startTimeUnixNano: this.#start.toString(),
      endTimeUnixNano: this.#now().toString(),
      attributes: {
        'a2ui.event.kind': 'turn',
        'gen_ai.operation.name': 'invoke_agent',
        ...(agentName !== undefined && {'gen_ai.agent.name': agentName}),
        ...(this.#conversationId !== undefined && {
          'gen_ai.conversation.id': this.#conversationId,
        }),
        'a2ui.turn.outcome': outcome,
        ...(version !== undefined && {'a2ui.turn.protocol_version': version}),
        'a2ui.turn.capture_paths': ['wire'],
        'a2ui.turn.writer.name': writer.name,
        'a2ui.turn.writer.version': writer.version,
      },
      status:
        outcome === 'failed'
          ? {code: 2, ...(this.#error !== undefined && {message: this.#error})}
          : {code: 1},
    };
    this.#notify({
      type: 'turn_closed',
      traceId: this.#traceId,
      turn: {events: [turnEvent, ...this.#wireEvents]},
    });
  }

  #outcome(): TurnOutcome {
    if (this.#error !== undefined) {
      return 'failed';
    }
    if (this.#state !== undefined) {
      return OUTCOMES[this.#state];
    }
    return this.#sawMessage ? 'completed' : 'failed';
  }

  #follow(reply: Reply): void {
    const contextId = reply.kind === 'message' ? reply.message.contextId : reply.contextId;
    this.#conversationId ??= contextId;
    if (reply.kind === 'message') {
      this.#sawMessage = true;
    } else if ((reply.kind === 'task' || reply.kind === 'status-update') && reply.state) {
      this.#state = reply.state;
    }
  }

  #parts(parts: unknown[]): WirePart[] {
    const mapped = parts.map(part => wirePart(part, this.#request.version));
    for (const part of mapped) {
      if (part.type === 'a2ui') {
        this.#a2uiVersions.push(...a2uiVersions(part.content));
      }
    }
    return mapped;
  }

  #pointEvent<Name extends 'wire_input' | 'wire_output'>(name: Name) {
    return {
      traceId: this.#traceId,
      spanId: this.#newSpanId(),
      parentSpanId: this.#spanId,
      name,
      kind: 1 as const,
      startTimeUnixNano: this.#now().toString(),
    };
  }

  #addWireEvent(event: WireInputEvent | WireOutputEvent): void {
    this.#wireEvents.push(event);
    this.#notify({type: 'wire_event', traceId: this.#traceId, event});
  }

  #notify(notification: TurnNotification): void {
    this.#options.listener(notification);
  }
}

/**
 * The parts the agent authored for this turn that one reply carries, and the
 * metadata of what carries them. User-role messages are left out. A task's
 * history counts only after the turn's request message, and its status
 * message only when the history does not already hold it.
 */
function agentContent(
  reply: Reply,
  requestMessageId: string | undefined,
): {parts: unknown[]; metadata?: Record<string, unknown>} {
  switch (reply.kind) {
    case 'message':
      return fromMessages([reply.message], reply.message.metadata);
    case 'status-update':
      return reply.message ? fromMessages([reply.message], reply.message.metadata) : {parts: []};
    case 'artifact-update':
      return withMetadata(reply.artifact.parts, reply.artifact.metadata);
    case 'task': {
      const index =
        requestMessageId === undefined
          ? -1
          : reply.history.findIndex(message => message.messageId === requestMessageId);
      const messages = reply.history.slice(index + 1);
      const status = reply.statusMessage;
      if (status !== undefined && !messages.some(message => sameMessage(message, status))) {
        messages.push(status);
      }
      const {parts} = fromMessages(messages, undefined);
      return withMetadata(
        [...parts, ...reply.artifacts.flatMap(artifact => artifact.parts)],
        reply.metadata,
      );
    }
  }
}

function fromMessages(
  messages: A2aMessage[],
  metadata: Record<string, unknown> | undefined,
): {parts: unknown[]; metadata?: Record<string, unknown>} {
  const agentMessages = messages.filter(message => message.role !== 'user');
  return withMetadata(
    agentMessages.flatMap(message => message.parts),
    agentMessages.length > 0 ? metadata : undefined,
  );
}

function withMetadata(parts: unknown[], metadata: Record<string, unknown> | undefined) {
  return metadata === undefined ? {parts} : {parts, metadata};
}

function sameMessage(a: A2aMessage, b: A2aMessage): boolean {
  if (a.messageId !== undefined && b.messageId !== undefined) {
    return a.messageId === b.messageId;
  }
  return JSON.stringify(a) === JSON.stringify(b);
}

/** The `version` of each A2UI message in a part's content, one message or an array. */
function a2uiVersions(content: unknown): string[] {
  const messages = Array.isArray(content) ? content : [content];
  return messages.flatMap(message =>
    isRecord(message) && typeof message.version === 'string' ? [message.version] : [],
  );
}

function only(values: string[]): string | undefined {
  return values.length === 1 ? values[0] : undefined;
}

function nowUnixNano(): bigint {
  return BigInt(Math.round((performance.timeOrigin + performance.now()) * 1000)) * 1000n;
}
