/**
 * TypeScript types for turn record v0.1, as `specification/turn_record/v0_1/`
 * defines it. The JSON Schema there is normative; these types follow it.
 *
 * Every kind shares the span fields. The attributes are typed in full for the
 * kinds Phase 2 writes (turn, wire input, wire output and check), and the
 * proxies' model and tool calls name theirs; the other kinds keep an open
 * attribute map until the phase that writes them.
 */

/** The record version this module describes. */
export type TurnRecordVersion = 'v0.1';

/** One turn, with the earlier turns of its conversation, oldest first. */
export interface TurnRecord {
  version: TurnRecordVersion;
  /** The recorded turn is the last. */
  turns: [Turn, ...Turn[]];
}

/** A flat list of the turn's events. Exactly one is the turn event. */
export interface Turn {
  events: TurnRecordEvent[];
}

/** The value of `a2ui.event.kind`. */
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

/** 32 lowercase hex characters. */
export type TraceId = string;

/** 16 lowercase hex characters. */
export type SpanId = string;

/** Nanoseconds since the Unix epoch, as a decimal string, as in OTLP JSON. */
export type UnixNano = string;

/** An A2UI protocol version, such as `v0.9` or `v0.9.1`. */
export type ProtocolVersion = string;

/**
 * OTLP's span kind: 0 unspecified, 1 internal, 2 server, 3 client,
 * 4 producer, 5 consumer.
 */
export type SpanKind = 0 | 1 | 2 | 3 | 4 | 5;

/** OTLP's status: 0 unset, 1 ok, 2 error. */
export interface Status {
  code: 0 | 1 | 2;
  message?: string;
}

/** A timed point inside an event: an OTLP span event. */
export interface SpanEvent {
  timeUnixNano: UnixNano;
  name: string;
  attributes?: Record<string, unknown>;
}

/** A link to a related event. */
export interface Link {
  traceId: TraceId;
  spanId: SpanId;
  attributes?: Record<string, unknown>;
}

/** The fields every event shares, shaped as an OTLP span. */
export interface EventFields<Attributes> {
  traceId: TraceId;
  spanId: SpanId;
  parentSpanId?: SpanId;
  name: string;
  kind: SpanKind;
  startTimeUnixNano: UnixNano;
  endTimeUnixNano?: UnixNano;
  attributes: Attributes;
  events?: SpanEvent[];
  links?: Link[];
  status?: Status;
}

// The turn event.

export type TurnOutcome = 'completed' | 'failed' | 'cancelled' | 'waiting_for_input';

export type CapturePath = 'wire' | 'model_proxy' | 'tool_proxy' | 'otel_receiver' | 'wrapper';

export interface TurnAttributes {
  'a2ui.event.kind': 'turn';
  'gen_ai.operation.name': 'invoke_agent';
  /** The agent's name, from its card. */
  'gen_ai.agent.name'?: string;
  /** The conversation the turn belongs to, such as A2A's `contextId`. */
  'gen_ai.conversation.id'?: string;
  'a2ui.turn.outcome': TurnOutcome;
  'a2ui.turn.protocol_version'?: ProtocolVersion;
  'a2ui.turn.capture_paths': CapturePath[];
  /** The program that wrote the record. */
  'a2ui.turn.writer.name': string;
  'a2ui.turn.writer.version': string;
}

/** The root of the turn: a client span with no parent, an end time and a status. */
export interface TurnEvent extends EventFields<TurnAttributes> {
  kind: 3;
  parentSpanId?: never;
  endTimeUnixNano: UnixNano;
  status: Status;
}

// The wire events.

/** GenAI's modalities, open to other values. */
export type Modality = 'image' | 'video' | 'audio' | 'document' | (string & {});

/** One or more A2UI messages, as the transport delivered them. Not validated. */
export interface A2uiPart {
  type: 'a2ui';
  content: unknown;
}

export interface TextPart {
  type: 'text';
  content: string;
}

export interface BlobPart {
  type: 'blob';
  mime_type?: string | null;
  modality: Modality;
  /** The data, base64-encoded. */
  content: string;
}

export interface FilePart {
  type: 'file';
  mime_type?: string | null;
  modality: Modality;
  file_id: string;
}

export interface UriPart {
  type: 'uri';
  mime_type?: string | null;
  modality: Modality;
  uri: string;
}

/** GenAI's open part, for any other part type. */
export interface GenericPart {
  type: string;
  [field: string]: unknown;
}

export type WirePart = A2uiPart | TextPart | BlobPart | FilePart | UriPart | GenericPart;

/** One delivery, in GenAI's message and part shape. */
export interface WireMessage<Role extends 'user' | 'assistant'> {
  role: Role;
  parts: WirePart[];
  name?: string | null;
}

export interface WireInputAttributes {
  'a2ui.event.kind': 'wire_input';
  /** What the host sent. */
  'a2ui.wire.message': WireMessage<'user'>;
  /** The A2UI data model the host sent, as A2UI defines it. */
  'a2ui.wire.data_model'?: Record<string, unknown>;
  /** The A2UI capabilities the host sent, as A2UI defines them. */
  'a2ui.wire.capabilities'?: Record<string, unknown>;
  /** Any other metadata the delivery carried. */
  'a2ui.wire.metadata'?: Record<string, unknown>;
}

export interface WireOutputAttributes {
  'a2ui.event.kind': 'wire_output';
  /** One piece the agent sent back. */
  'a2ui.wire.message': WireMessage<'assistant'>;
  'a2ui.wire.metadata'?: Record<string, unknown>;
}

/** A point-in-time event under the turn event. */
interface PointUnderTurn<Attributes> extends EventFields<Attributes> {
  parentSpanId: SpanId;
  endTimeUnixNano?: never;
}

export type WireInputEvent = PointUnderTurn<WireInputAttributes>;
export type WireOutputEvent = PointUnderTurn<WireOutputAttributes>;

// The check event.

export type CheckName = 'schema' | 'catalog' | 'structural' | 'binding';

/** One finding, in A2UI's error shape. */
export interface Finding {
  code: string;
  surfaceId?: string;
  /** A JSON path to the offending value. */
  path?: string;
  message: string;
}

/** Why a check could not judge a surface. */
export type SkipReason = 'no_definition' | 'not_created';

/** A surface a check could not judge. */
export interface SkippedSurface {
  surfaceId: string;
  /** The catalog id the surface named, when it named one. */
  catalogId?: string;
  reason: SkipReason;
}

export interface CheckAttributes {
  'a2ui.event.kind': 'check';
  'a2ui.check.name': CheckName;
  'a2ui.check.passed': boolean;
  'a2ui.check.protocol_version': ProtocolVersion;
  /** Empty when the check passed. */
  'a2ui.check.findings': Finding[];
  /**
   * The surfaces the check could not judge: on the catalog, structural and
   * binding checks, empty when none was skipped; never on the schema check.
   */
  'a2ui.check.skipped'?: SkippedSurface[];
}

export type CheckEvent = PointUnderTurn<CheckAttributes>;

// The model call event.

/** The names the model proxy writes on a call read in full; a call recorded raw carries the exchange only. */
export interface ModelCallAttributes {
  'a2ui.event.kind': 'model_call';
  'gen_ai.operation.name'?: string;
  'gen_ai.provider.name'?: string;
  'gen_ai.request.model'?: string;
  'gen_ai.request.max_tokens'?: number;
  'gen_ai.request.temperature'?: number;
  'gen_ai.request.top_p'?: number;
  'gen_ai.request.top_k'?: number;
  'gen_ai.request.frequency_penalty'?: number;
  'gen_ai.request.presence_penalty'?: number;
  'gen_ai.request.stop_sequences'?: string[];
  'gen_ai.request.seed'?: number;
  'gen_ai.request.choice.count'?: number;
  'gen_ai.request.stream'?: boolean;
  'gen_ai.output.type'?: string;
  'gen_ai.response.id'?: string;
  'gen_ai.response.model'?: string;
  'gen_ai.response.finish_reasons'?: string[];
  'gen_ai.response.time_to_first_chunk'?: number;
  'gen_ai.usage.input_tokens'?: number;
  'gen_ai.usage.output_tokens'?: number;
  'gen_ai.usage.cache_read.input_tokens'?: number;
  'gen_ai.usage.cache_write.input_tokens'?: number;
  'gen_ai.usage.reasoning.output_tokens'?: number;
  'gen_ai.system_instructions'?: unknown[];
  'gen_ai.input.messages'?: unknown[];
  'gen_ai.output.messages'?: unknown[];
  'gen_ai.tool.definitions'?: unknown[];
  'http.request.method'?: string;
  'url.full'?: string;
  'http.response.status_code'?: number;
  'server.address'?: string;
  'server.port'?: number;
  'a2ui.http.request.body'?: unknown;
  'a2ui.http.response.body'?: unknown;
  'error.type'?: string;
  [name: string]: unknown;
}

/** A proxy's model call: a client span under the turn event, lasting from the request to the end of the response. */
export interface ModelCallEvent extends EventFields<ModelCallAttributes> {
  kind: 3;
  parentSpanId: SpanId;
}

// The tool call.

export interface ToolCallAttributes {
  'a2ui.event.kind': 'tool_call';
  'gen_ai.operation.name'?: string;
  'gen_ai.tool.name'?: string;
  'gen_ai.tool.call.arguments'?: Record<string, unknown>;
  'gen_ai.tool.call.result'?: Record<string, unknown>;
  'gen_ai.prompt.name'?: string;
  'mcp.method.name'?: string;
  'mcp.session.id'?: string;
  'mcp.protocol.version'?: string;
  'mcp.resource.uri'?: string;
  'jsonrpc.request.id'?: string;
  'rpc.response.status_code'?: string;
  'http.request.method'?: string;
  'url.full'?: string;
  'http.response.status_code'?: number;
  'server.address'?: string;
  'server.port'?: number;
  'a2ui.http.request.body'?: unknown;
  'a2ui.http.response.body'?: unknown;
  'error.type'?: string;
  [name: string]: unknown;
}

/**
 * A tool call. The tool proxy's is a client span under the turn event, or a
 * producer span for an operation the server initiated, lasting from the
 * request to the response.
 */
export type ToolCallEvent = EventFields<ToolCallAttributes>;

/** A call one of the proxies captured. */
export type CallEvent = ModelCallEvent | ToolCallEvent;

// The kinds whose attributes later phases type.

type OtherKind = Exclude<
  EventKind,
  'turn' | 'wire_input' | 'wire_output' | 'check' | 'model_call' | 'tool_call'
>;

/** An event of a kind Phase 2 does not write, with open attributes. */
export type OtherEvent = {
  [Kind in OtherKind]: EventFields<{
    'a2ui.event.kind': Kind;
    [name: string]: unknown;
  }>;
}[OtherKind];

export type TurnRecordEvent =
  | TurnEvent
  | WireInputEvent
  | WireOutputEvent
  | CheckEvent
  | ModelCallEvent
  | ToolCallEvent
  | OtherEvent;

/** The event type for one kind. */
export type EventOfKind<Kind extends EventKind> = Extract<
  TurnRecordEvent,
  {attributes: {'a2ui.event.kind': Kind}}
>;

/** Narrows an event to its kind. */
export function isEventOfKind<Kind extends EventKind>(
  event: TurnRecordEvent,
  kind: Kind,
): event is EventOfKind<Kind> {
  return event.attributes['a2ui.event.kind'] === kind;
}

/** Whether a wire part is an A2UI part. */
export function isA2uiPart(part: WirePart): part is A2uiPart {
  return part.type === 'a2ui';
}
