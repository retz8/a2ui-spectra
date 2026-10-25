/**
 * The parts of turn record v0.1 the viewer reads, as
 * `specification/turn_record/v0_1/` defines them. The JSON Schema there is
 * normative; these types follow it.
 */

/** One turn, with the earlier turns of its conversation, oldest first. */
export interface TurnRecord {
  version: 'v0.1';
  /** The recorded turn is the last. */
  turns: Turn[];
}

/** A flat list of the turn's events. Exactly one is the turn event. */
export interface Turn {
  events: TurnRecordEvent[];
}

export type EventKind =
  | 'turn'
  | 'wire_input'
  | 'wire_output'
  | 'model_call'
  | 'tool_call'
  | 'prompt_generation'
  | 'parse'
  | 'check'
  | 'framework_span';

export type TurnOutcome = 'completed' | 'failed' | 'cancelled' | 'waiting_for_input';

/** OTLP's status: 0 unset, 1 ok, 2 error. */
export interface Status {
  code: 0 | 1 | 2;
  message?: string;
}

/** The fields every event shares, shaped as an OTLP span. */
interface EventFields<Attributes> {
  traceId: string;
  spanId: string;
  parentSpanId?: string;
  name: string;
  kind: number;
  /** Nanoseconds since the Unix epoch, as a decimal string. */
  startTimeUnixNano: string;
  endTimeUnixNano?: string;
  attributes: Attributes;
  status?: Status;
}

export interface TurnAttributes {
  'a2ui.event.kind': 'turn';
  'gen_ai.agent.name'?: string;
  'gen_ai.conversation.id'?: string;
  'a2ui.turn.outcome': TurnOutcome;
  'a2ui.turn.protocol_version'?: string;
  [name: string]: unknown;
}

/** One part of a delivery, in GenAI's part shape. An `a2ui` part's content is one message or an array. */
export interface WirePart {
  type: string;
  content?: unknown;
  [field: string]: unknown;
}

export interface WireMessage {
  role: 'user' | 'assistant';
  parts: WirePart[];
}

export interface WireInputAttributes {
  'a2ui.event.kind': 'wire_input';
  'a2ui.wire.message': WireMessage;
  'a2ui.wire.data_model'?: Record<string, unknown>;
  'a2ui.wire.capabilities'?: Record<string, unknown>;
  'a2ui.wire.metadata'?: Record<string, unknown>;
}

export interface WireOutputAttributes {
  'a2ui.event.kind': 'wire_output';
  'a2ui.wire.message': WireMessage;
  'a2ui.wire.metadata'?: Record<string, unknown>;
}

/** One finding, in A2UI's error shape. */
export interface Finding {
  code: string;
  surfaceId?: string;
  /** A JSON Pointer from the turn to the offending value. */
  path?: string;
  message: string;
}

export interface CheckAttributes {
  'a2ui.event.kind': 'check';
  'a2ui.check.name': string;
  'a2ui.check.passed': boolean;
  'a2ui.check.protocol_version': string;
  'a2ui.check.catalog_id'?: string;
  'a2ui.check.findings': Finding[];
}

export type TurnEvent = EventFields<TurnAttributes> & {endTimeUnixNano: string};
export type WireInputEvent = EventFields<WireInputAttributes>;
export type WireOutputEvent = EventFields<WireOutputAttributes>;
export type WireEvent = WireInputEvent | WireOutputEvent;
export type CheckEvent = EventFields<CheckAttributes>;

/** An event of a kind the viewer does not read yet. */
export type OtherEvent = EventFields<{
  'a2ui.event.kind': Exclude<EventKind, 'turn' | 'wire_input' | 'wire_output' | 'check'>;
  [name: string]: unknown;
}>;

export type TurnRecordEvent =
  TurnEvent | WireInputEvent | WireOutputEvent | CheckEvent | OtherEvent;

export function isTurnEvent(event: TurnRecordEvent): event is TurnEvent {
  return event.attributes['a2ui.event.kind'] === 'turn';
}

export function isWireInput(event: TurnRecordEvent): event is WireInputEvent {
  return event.attributes['a2ui.event.kind'] === 'wire_input';
}

export function isWireOutput(event: TurnRecordEvent): event is WireOutputEvent {
  return event.attributes['a2ui.event.kind'] === 'wire_output';
}

export function isCheck(event: TurnRecordEvent): event is CheckEvent {
  return event.attributes['a2ui.event.kind'] === 'check';
}

/** The A2UI messages a part holds: its content, or each element of an array. */
export function messagesOfPart(part: WirePart): unknown[] {
  if (part.type !== 'a2ui') return [];
  return Array.isArray(part.content) ? part.content : [part.content];
}

/** Milliseconds since the Unix epoch, from OTLP's nanoseconds. */
export function unixMillis(unixNano: string): number {
  return Number(BigInt(unixNano) / 1_000_000n);
}

/** Whole milliseconds between two times in nanoseconds, as the listing counts a turn's duration. */
export function millisBetween(startUnixNano: string, endUnixNano: string): number {
  return Number((BigInt(endUnixNano) - BigInt(startUnixNano)) / 1_000_000n);
}
