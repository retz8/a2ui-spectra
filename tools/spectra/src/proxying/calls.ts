/**
 * The notifications the model proxy and the tool proxy hand out as each call
 * is captured, which the turn hub passes on to the viewer.
 */
import type {CallEvent, SpanEvent} from '../record/turn_record.js';

/** What the model proxy and the tool proxy hand out as a call is captured. */
export type CallNotification =
  /** The call's event so far: its start, its request and the names read from it. */
  | {type: 'call_started'; traceId: string; event: CallEvent}
  /** One response chunk, as it arrives. */
  | {type: 'call_chunk'; traceId: string; spanId: string; chunk: SpanEvent}
  /**
   * A model call's response names read from its chunks so far: the output
   * messages, the finish reasons and the usage as far as the stream has
   * given them.
   */
  | {type: 'call_progress'; traceId: string; spanId: string; attributes: Record<string, unknown>}
  /** The complete event, as the record holds it. */
  | {type: 'call_ended'; traceId: string; event: CallEvent};

export type CallListener = (notification: CallNotification) => void;
