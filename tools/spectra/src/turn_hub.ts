import type {TurnListener} from './a2a/turn.js';
import {inputBriefOf, type InputBrief} from './listing.js';
import type {CallListener, CallNotification} from './model_proxy/proxy.js';
import {
  type CallEvent,
  isEventOfKind,
  type TurnRecordEvent,
  type SpanEvent,
  type Turn,
  type TurnEvent,
  type WireInputEvent,
  type WireOutputEvent,
} from './record/turn_record.js';

/** An open turn, as the listing shows it. */
export interface OpenTurn {
  traceId: string;
  conversationId?: string;
  /** The turn's start, as an ISO 8601 UTC time to the millisecond. */
  startTime: string;
}

/** What the live stream sends. */
export type LiveEvent =
  | ({type: 'turn_opened'} & OpenTurn)
  | {
      type: 'wire_event';
      traceId: string;
      /** The turn's conversation, once a reply or the host's message has named it. */
      conversationId?: string;
      event: WireInputEvent | WireOutputEvent;
    }
  /** A call placed in an open turn: its event so far, with its start, its request and the names read from it. */
  | {type: 'call_started'; traceId: string; event: CallEvent}
  /** One response chunk of a call, as it arrives. */
  | {type: 'call_chunk'; traceId: string; spanId: string; chunk: SpanEvent}
  /** A model call's response names read from its chunks so far. */
  | {type: 'call_progress'; traceId: string; spanId: string; attributes: Record<string, unknown>}
  /** The call's complete event, as the record holds it. */
  | {type: 'call_ended'; traceId: string; event: CallEvent}
  /** The turn's own events with its check event, once its write has finished. */
  | {type: 'turn_closed'; traceId: string; turn: Turn}
  /**
   * The events one export to the receiver added to a turn or changed in it,
   * in the record's shape, open or written: the spans placed, the proxies'
   * calls whose links grew, the turn event when its capture paths changed.
   * A subscriber replaces each by its span id.
   */
  | {type: 'turn_amended'; traceId: string; events: TurnRecordEvent[]};

/** A live event, and for a turn opened, the `messageId` of the host's message. */
export type HubEvent = LiveEvent & {messageId?: string};

export type HubListener = (event: HubEvent) => void;

interface OpenCall {
  started: Extract<HubEvent, {type: 'call_started'}>;
  chunks: Array<Extract<HubEvent, {type: 'call_chunk'}>>;
  /** The latest progress, which reads every chunk before it. */
  progress?: Extract<HubEvent, {type: 'call_progress'}>;
  ended?: Extract<HubEvent, {type: 'call_ended'}>;
}

interface Open {
  opened: Extract<HubEvent, {type: 'turn_opened'}>;
  wireEvents: Array<Extract<HubEvent, {type: 'wire_event'}>>;
  /** The calls placed in the turn so far, by span id, in the order they started. */
  calls: Map<string, OpenCall>;
  /** The events the receiver's exports added or changed so far, by span id, the latest of each. */
  amended: Map<string, TurnRecordEvent>;
}

/**
 * The turns of this run as they happen: each turn is open from the adapter's
 * turn opened until the recorder has checked it and finished writing it, and
 * every event, the proxies' calls included, is passed to the listeners as it
 * comes.
 */
export class TurnHub {
  readonly #open = new Map<string, Open>();
  readonly #listeners = new Set<HubListener>();

  /** Takes the adapter's turn notifications. */
  readonly onTurn: TurnListener = notification => {
    if (notification.type === 'turn_opened') {
      const opened: Open['opened'] = {
        type: 'turn_opened',
        traceId: notification.traceId,
        ...(notification.conversationId !== undefined && {
          conversationId: notification.conversationId,
        }),
        startTime: isoTime(notification.startTimeUnixNano),
        ...(notification.messageId !== undefined && {messageId: notification.messageId}),
      };
      this.#open.set(notification.traceId, {
        opened,
        wireEvents: [],
        calls: new Map(),
        amended: new Map(),
      });
      this.#emit(opened);
    } else if (notification.type === 'wire_event') {
      const event: Open['wireEvents'][number] = {
        type: 'wire_event',
        traceId: notification.traceId,
        ...(notification.conversationId !== undefined && {
          conversationId: notification.conversationId,
        }),
        event: notification.event,
      };
      const open = this.#open.get(notification.traceId);
      if (open !== undefined) {
        // A conversation a reply names after the turn opened is the open turn's from then on.
        if (open.opened.conversationId === undefined && notification.conversationId !== undefined) {
          open.opened = {...open.opened, conversationId: notification.conversationId};
        }
        open.wireEvents.push(event);
      }
      this.#emit(event);
    }
  };

  /** Takes the proxies' call notifications. */
  readonly onCall: CallListener = (notification: CallNotification) => {
    const open = this.#open.get(notification.traceId);
    if (open !== undefined) {
      if (notification.type === 'call_started') {
        open.calls.set(notification.event.spanId, {started: notification, chunks: []});
      } else if (notification.type === 'call_chunk') {
        open.calls.get(notification.spanId)?.chunks.push(notification);
      } else if (notification.type === 'call_progress') {
        const call = open.calls.get(notification.spanId);
        if (call !== undefined) call.progress = notification;
      } else {
        const call = open.calls.get(notification.event.spanId);
        if (call !== undefined) call.ended = notification;
      }
    }
    this.#emit(notification);
  };

  /** Takes the events one export to the receiver added to a turn or changed in it. */
  readonly onAmended = (traceId: string, events: TurnRecordEvent[]): void => {
    if (events.length === 0) return;
    const open = this.#open.get(traceId);
    if (open !== undefined) {
      for (const event of events) open.amended.set(event.spanId, event);
    }
    this.#emit({type: 'turn_amended', traceId, events});
  };

  /** Takes each turn the recorder has checked and finished writing, and closes it. */
  readonly onRecorded = (turn: Turn): void => {
    const turnEvent = turn.events.find((event): event is TurnEvent => isEventOfKind(event, 'turn'));
    if (turnEvent === undefined) {
      return;
    }
    this.#open.delete(turnEvent.traceId);
    this.#emit({type: 'turn_closed', traceId: turnEvent.traceId, turn});
  };

  /** The turns open now, in the order they opened, each with its input in brief once its input has come. */
  openTurns(): Array<OpenTurn & {input?: InputBrief}> {
    return [...this.#open.values()].map(({opened, wireEvents}) => {
      const wireInput = wireEvents.find(({event}) => isEventOfKind(event, 'wire_input'))?.event;
      const input =
        wireInput !== undefined && isEventOfKind(wireInput, 'wire_input')
          ? inputBriefOf(wireInput)
          : undefined;
      return {
        traceId: opened.traceId,
        ...(opened.conversationId !== undefined && {conversationId: opened.conversationId}),
        startTime: opened.startTime,
        ...(input !== undefined && {input}),
      };
    });
  }

  isOpen(traceId: string): boolean {
    return this.#open.has(traceId);
  }

  /**
   * Passes every event from now on to the listener. With `catchUp`, the
   * listener first receives each open turn's turn opened, its wire events so
   * far, its calls with their chunks so far and, for a call in flight, its
   * latest progress, and one turn amended with the
   * events the receiver placed or changed in it so far. Returns the call that
   * stops it.
   */
  subscribe(listener: HubListener, {catchUp = false}: {catchUp?: boolean} = {}): () => void {
    if (catchUp) {
      for (const {opened, wireEvents, calls, amended} of this.#open.values()) {
        listener(opened);
        for (const event of wireEvents) listener(event);
        for (const call of calls.values()) {
          listener(call.started);
          for (const chunk of call.chunks) listener(chunk);
          if (call.ended !== undefined) listener(call.ended);
          else if (call.progress !== undefined) listener(call.progress);
        }
        if (amended.size > 0) {
          listener({type: 'turn_amended', traceId: opened.traceId, events: [...amended.values()]});
        }
      }
    }
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  #emit(event: HubEvent): void {
    for (const listener of [...this.#listeners]) {
      listener(event);
    }
  }
}

function isoTime(unixNano: string): string {
  return new Date(Number(BigInt(unixNano) / 1_000_000n)).toISOString();
}
