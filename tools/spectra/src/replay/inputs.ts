/**
 * What the driver re-sends for each recorded turn: the host's wire input as
 * the record holds it, read back out of its transport-neutral form. The
 * record keeps no transport envelope, so the A2A version and the method come
 * from the live card at send time; what the record can say about the offer,
 * the versions its capabilities are keyed by, becomes the extensions header.
 */
import type {InputMetadata} from '../a2a/metadata.js';
import {
  isEventOfKind,
  recordFormOf,
  type Turn,
  type TurnRecord,
  type WirePart,
} from '../record/turn_record.js';

/** The A2UI extension URI of a protocol version in the record's form. */
export function extensionUriOf(version: string): string {
  return `https://a2ui.org/a2a-extension/a2ui/${recordFormOf(version)}`;
}

/** One recorded turn's input, ready to be written in the live A2A version's form. */
export interface ReplayInput {
  /** The host's parts, in the record's form. */
  parts: WirePart[];
  /** The capabilities, the data model and the other metadata, as recorded. */
  metadata: InputMetadata;
  /**
   * The A2UI extension URIs of the versions the host offered: those the
   * recorded capabilities are keyed by, else the turn's protocol version,
   * else none.
   */
  extensions: string[];
  /** Whether the request carried a task id: the recorded turn before it ended waiting for input. */
  carriesTask: boolean;
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

function replayInput(turn: Turn, number: number, carriesTask: boolean): ReplayInput {
  const wireInput = turn.events.find(event => isEventOfKind(event, 'wire_input'));
  if (wireInput === undefined) {
    throw new ReplayRecordError(
      `Turn ${number} of the record has no wire input, so there is nothing to send for it.`,
    );
  }
  const attributes = wireInput.attributes;
  const capabilities = attributes['a2ui.wire.capabilities'];
  const dataModel = attributes['a2ui.wire.data_model'];
  const metadata = attributes['a2ui.wire.metadata'];
  const turnEvent = turn.events.find(event => isEventOfKind(event, 'turn'));
  const protocolVersion = turnEvent?.attributes['a2ui.turn.protocol_version'];
  const extensions =
    capabilities !== undefined && Object.keys(capabilities).length > 0
      ? Object.keys(capabilities).map(extensionUriOf)
      : protocolVersion !== undefined
        ? [extensionUriOf(protocolVersion)]
        : [];
  return {
    parts: attributes['a2ui.wire.message'].parts,
    metadata: {
      ...(capabilities !== undefined && {capabilities}),
      ...(dataModel !== undefined && {dataModel}),
      ...(metadata !== undefined && {metadata}),
    },
    extensions,
    carriesTask,
  };
}
