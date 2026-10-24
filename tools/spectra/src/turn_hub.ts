import type {TurnListener} from './a2a/turn.js';
import {
  isEventOfKind,
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
  | {type: 'wire_event'; traceId: string; event: WireInputEvent | WireOutputEvent}
  /** The turn's own events with its check event, once its write has finished. */
  | {type: 'turn_closed'; traceId: string; turn: Turn};

/** A live event, and for a turn opened, the `messageId` of the host's message. */
export type HubEvent = LiveEvent & {messageId?: string};

export type HubListener = (event: HubEvent) => void;

interface Open {
  opened: Extract<HubEvent, {type: 'turn_opened'}>;
  wireEvents: Array<Extract<HubEvent, {type: 'wire_event'}>>;
}

/**
 * The turns of this run as they happen: each turn is open from the adapter's
 * turn opened until the recorder has checked it and finished writing it, and
 * every event is passed to the listeners as it comes.
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
      this.#open.set(notification.traceId, {opened, wireEvents: []});
      this.#emit(opened);
    } else if (notification.type === 'wire_event') {
      const event: Open['wireEvents'][number] = {
        type: 'wire_event',
        traceId: notification.traceId,
        event: notification.event,
      };
      this.#open.get(notification.traceId)?.wireEvents.push(event);
      this.#emit(event);
    }
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

  /** The turns open now, in the order they opened. */
  openTurns(): OpenTurn[] {
    return [...this.#open.values()].map(({opened}) => ({
      traceId: opened.traceId,
      ...(opened.conversationId !== undefined && {conversationId: opened.conversationId}),
      startTime: opened.startTime,
    }));
  }

  isOpen(traceId: string): boolean {
    return this.#open.has(traceId);
  }

  /**
   * Passes every event from now on to the listener. With `catchUp`, the
   * listener first receives each open turn's turn opened and its wire events
   * so far. Returns the call that stops it.
   */
  subscribe(listener: HubListener, {catchUp = false}: {catchUp?: boolean} = {}): () => void {
    if (catchUp) {
      for (const {opened, wireEvents} of this.#open.values()) {
        listener(opened);
        for (const event of wireEvents) listener(event);
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
