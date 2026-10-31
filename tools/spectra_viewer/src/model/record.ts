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

/** A timed point inside an event: an OTLP span event, such as a response chunk. */
export interface SpanEvent {
  /** Nanoseconds since the Unix epoch, as a decimal string. */
  timeUnixNano: string;
  name: string;
  attributes?: Record<string, unknown>;
}

/** A link to a related event, such as the same call seen by another capture path. */
export interface Link {
  traceId: string;
  spanId: string;
  attributes?: Record<string, unknown>;
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
  events?: SpanEvent[];
  links?: Link[];
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

export type CheckName = 'schema' | 'catalog' | 'structural' | 'binding';

/** A surface a check could not judge, and why. */
export interface SkippedSurface {
  surfaceId: string;
  /** The catalog id the surface named, when it named one. */
  catalogId?: string;
  reason: 'no_definition' | 'not_created';
}

export interface CheckAttributes {
  'a2ui.event.kind': 'check';
  'a2ui.check.name': CheckName;
  'a2ui.check.passed': boolean;
  'a2ui.check.protocol_version': string;
  'a2ui.check.findings': Finding[];
  /** On the catalog, structural and binding checks: empty when nothing was skipped. */
  'a2ui.check.skipped'?: SkippedSurface[];
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

/** A model call event: its GenAI names, its exchange, and its chunks in `events`. */
export type ModelCallEvent = EventFields<{
  'a2ui.event.kind': 'model_call';
  [name: string]: unknown;
}>;

export function isModelCall(event: TurnRecordEvent): event is ModelCallEvent {
  return event.attributes['a2ui.event.kind'] === 'model_call';
}

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

function keyOfEvent(event: {traceId: string; spanId: string}): string {
  return `${event.traceId}:${event.spanId}`;
}

/** Whether an event came from the receiver. */
function isReceivedEvent(event: TurnRecordEvent): boolean {
  return 'a2ui.received.attributes' in event.attributes;
}

/**
 * A turn with the events a `turn_amended` sent: each replaces the event of
 * its span id, or is added. As the receiver assembles a turn, the turn's own
 * events keep their places, the received events follow them in start order,
 * and the check events come last, so no event a finding points at moves.
 */
export function amendedTurn(turn: Turn, events: readonly TurnRecordEvent[]): Turn {
  const byKey = new Map(events.map(event => [keyOfEvent(event), event]));
  const replaced = new Set<string>();
  const kept = turn.events.map(event => {
    const next = byKey.get(keyOfEvent(event));
    if (next === undefined) return event;
    replaced.add(keyOfEvent(event));
    return next;
  });
  const added = events.filter(event => !replaced.has(keyOfEvent(event)));
  const own = [
    ...kept.filter(event => !isReceivedEvent(event) && !isCheck(event)),
    ...added.filter(event => !isReceivedEvent(event) && !isCheck(event)),
  ];
  const received = [...kept.filter(isReceivedEvent), ...added.filter(isReceivedEvent)]
    .map((event, index) => ({event, index, start: BigInt(event.startTimeUnixNano)}))
    .sort((a, b) => (a.start === b.start ? a.index - b.index : a.start < b.start ? -1 : 1))
    .map(({event}) => event);
  const checks = kept.filter(event => !isReceivedEvent(event) && isCheck(event));
  return {events: [...own, ...received, ...checks]};
}
