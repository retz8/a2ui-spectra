/**
 * The notifications a transport adapter hands out as each turn is captured,
 * which the call placer, the recorder and the turn hub take, whatever the
 * transport.
 */
import type {Turn, WireInputEvent, WireOutputEvent} from './record/turn_record.js';

/** What a transport adapter hands out as a turn is captured. */
export type TurnNotification =
  | {
      type: 'turn_opened';
      traceId: string;
      /** The turn event's span id, the parent of the calls placed in the turn. */
      spanId: string;
      conversationId?: string;
      /** The turn's start, in nanoseconds since the Unix epoch. */
      startTimeUnixNano: string;
      /** The id the host gave its message, when it gave one, whatever the transport. */
      messageId?: string;
    }
  | {
      type: 'wire_event';
      traceId: string;
      /** The turn's conversation, once a reply or the host's message has named it. */
      conversationId?: string;
      event: WireInputEvent | WireOutputEvent;
    }
  /** The turn: its turn event, then its wire events in order. No check event. */
  | {type: 'turn_closed'; traceId: string; turn: Turn};

export type TurnListener = (notification: TurnNotification) => void;
