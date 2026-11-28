/**
 * What the driver re-sends for each recorded turn: the host's wire input as
 * the record holds it, read back out of its transport-neutral form. The
 * record keeps no transport envelope, so the transport's host writes each
 * input in its own form at send time, from what the record can say: the
 * parts, the metadata, the protocol versions the host offered and whether
 * the turn before it ended waiting for input.
 */
import {
  isEventOfKind,
  recordFormOf,
  type Turn,
  type TurnRecord,
  type WirePart,
} from '../record/turn_record.js';

/** One recorded turn's input, for a transport's host to write in its own form. */
export interface ReplayInput {
  /** The host's parts, in the record's form. */
  parts: WirePart[];
  /** The capabilities, the data model and the other metadata, as recorded. */
  metadata: {
    capabilities?: Record<string, unknown>;
    dataModel?: Record<string, unknown>;
    metadata?: Record<string, unknown>;
  };
  /**
   * The protocol versions the host offered, in the record's form, such as
   * `v0.9.1`: those the recorded capabilities are keyed by, else the turn's
   * protocol version, else none.
   */
  offeredVersions: string[];
  /** Whether the recorded turn before this one ended waiting for input. */
  afterWaitingTurn: boolean;
}

/** A record the driver cannot replay. */
export class ReplayRecordError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ReplayRecordError';
  }
}

/** Each recorded turn's input, in turn order. */
export function replayInputs(record: TurnRecord): ReplayInput[] {
  let previousWaiting = false;
  return record.turns.map((turn, index) => {
    const input = replayInput(turn, index + 1, previousWaiting);
    const turnEvent = turn.events.find(event => isEventOfKind(event, 'turn'));
    previousWaiting = turnEvent?.attributes['a2ui.turn.outcome'] === 'waiting_for_input';
    return input;
  });
}

function replayInput(turn: Turn, number: number, afterWaitingTurn: boolean): ReplayInput {
  const wireInputs = turn.events.filter(event => isEventOfKind(event, 'wire_input'));
  const wireInput = wireInputs[0];
  if (wireInput === undefined) {
    throw new ReplayRecordError(
      `Turn ${number} of the record has no wire input, so there is nothing to send for it.`,
    );
  }
  // A turn record may hold several; no transport Spectra sends over gives a second one a meaning.
  if (wireInputs.length > 1) {
    throw new ReplayRecordError(
      `Turn ${number} of the record holds ${wireInputs.length} wire inputs, and a replay sends one input a turn.`,
    );
  }
  const attributes = wireInput.attributes;
  const message: {parts?: unknown} | undefined = attributes['a2ui.wire.message'];
  if (!Array.isArray(message?.parts)) {
    throw new ReplayRecordError(
      `Turn ${number} of the record's wire input holds no message with parts, so there is nothing to send for it.`,
    );
  }
  const capabilities = attributes['a2ui.wire.capabilities'];
  const dataModel = attributes['a2ui.wire.data_model'];
  const metadata = attributes['a2ui.wire.metadata'];
  const turnEvent = turn.events.find(event => isEventOfKind(event, 'turn'));
  const protocolVersion = turnEvent?.attributes['a2ui.turn.protocol_version'];
  const offeredVersions =
    capabilities !== undefined && Object.keys(capabilities).length > 0
      ? Object.keys(capabilities).map(recordFormOf)
      : protocolVersion !== undefined
        ? [recordFormOf(protocolVersion)]
        : [];
  return {
    parts: attributes['a2ui.wire.message'].parts,
    metadata: {
      ...(capabilities !== undefined && {capabilities}),
      ...(dataModel !== undefined && {dataModel}),
      ...(metadata !== undefined && {metadata}),
    },
    offeredVersions,
    afterWaitingTurn,
  };
}
