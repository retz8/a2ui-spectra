/**
 * Turns for the checks' tests: a turn event, the host's wire input with its
 * capabilities, then one wire output per delivery, each A2UI message its own
 * part. The pointer to a message is `/events/<2 + delivery>/attributes/
 * a2ui.wire.message/parts/<message>/content`.
 */
import {CatalogRegistry} from '../catalog/registry.js';
import type {Turn, TurnEvent, TurnRecordEvent, WirePart} from '../record/turn_record.js';

export const TRACE_ID = '0af7651916cd43dd8448eb211c80319c';
export const TURN_SPAN = 'b7ad6b7169203331';

/** The v0.9 basic catalog's id, and its v0.9.1 URL. */
export const BASIC_V0_9 = CatalogRegistry.builtIn().known[0].id;
export const BASIC_V0_9_1 = CatalogRegistry.builtIn().known[0].aliases[0];
/** The v1.0 basic catalog's id. */
export const BASIC_V1_0 = CatalogRegistry.builtIn().known[1].id;

export interface TurnSpec {
  /** The A2UI messages the agent sent, as one delivery; or several deliveries. */
  messages?: unknown[];
  deliveries?: unknown[][];
  /** The capabilities the host sent with its message. */
  capabilities?: Record<string, unknown>;
  /** The turn event's protocol version. */
  version?: string;
  conversationId?: string;
  traceId?: string;
}

/** The JSON Pointer from the turn object to one A2UI message a test turn carries. */
export function pointer(message: number, delivery = 0): string {
  return `/events/${2 + delivery}/attributes/a2ui.wire.message/parts/${message}/content`;
}

export function testTurn(spec: TurnSpec): Turn {
  const traceId = spec.traceId ?? TRACE_ID;
  const deliveries = spec.deliveries ?? [spec.messages ?? []];
  const turnEvent: TurnEvent = {
    traceId,
    spanId: TURN_SPAN,
    name: 'invoke_agent',
    kind: 3,
    startTimeUnixNano: '1792576860000000000',
    endTimeUnixNano: '1792576861000000000',
    attributes: {
      'a2ui.event.kind': 'turn',
      'gen_ai.operation.name': 'invoke_agent',
      ...(spec.conversationId !== undefined && {'gen_ai.conversation.id': spec.conversationId}),
      'a2ui.turn.outcome': 'completed',
      ...(spec.version !== undefined && {'a2ui.turn.protocol_version': spec.version}),
      'a2ui.turn.capture_paths': ['wire'],
      'a2ui.turn.writer.name': 'a2ui-spectra',
      'a2ui.turn.writer.version': '0.0.1',
    },
    status: {code: 1},
  };
  const input: TurnRecordEvent = {
    traceId,
    spanId: '0000000000000001',
    parentSpanId: TURN_SPAN,
    name: 'wire_input',
    kind: 1,
    startTimeUnixNano: '1792576860100000000',
    attributes: {
      'a2ui.event.kind': 'wire_input',
      'a2ui.wire.message': {role: 'user', parts: [{type: 'text', content: 'Hi'}]},
      ...(spec.capabilities !== undefined && {'a2ui.wire.capabilities': spec.capabilities}),
    },
  };
  const outputs: TurnRecordEvent[] = deliveries.map((messages, index) => ({
    traceId,
    spanId: `00000000000000${String(index + 2).padStart(2, '0')}`,
    parentSpanId: TURN_SPAN,
    name: 'wire_output',
    kind: 1,
    startTimeUnixNano: `179257686020000000${index}`,
    attributes: {
      'a2ui.event.kind': 'wire_output',
      'a2ui.wire.message': {
        role: 'assistant',
        parts: messages.map((content): WirePart => ({type: 'a2ui', content})),
      },
    },
  }));
  return {events: [turnEvent, input, ...outputs]};
}

/** A v0.9 `createSurface`, on the basic catalog unless another id is given. */
export function createSurface(surfaceId: string, catalogId = BASIC_V0_9, extra = {}): unknown {
  return {version: 'v0.9', createSurface: {surfaceId, catalogId, ...extra}};
}

export function updateComponents(surfaceId: string, components: unknown[]): unknown {
  return {version: 'v0.9', updateComponents: {surfaceId, components}};
}

export function updateDataModel(surfaceId: string, value: unknown, path = '/'): unknown {
  return {version: 'v0.9', updateDataModel: {surfaceId, path, value}};
}

export function deleteSurface(surfaceId: string): unknown {
  return {version: 'v0.9', deleteSurface: {surfaceId}};
}

/** The same messages in v1.0's shape. */
export const v1 = {
  createSurface: (surfaceId: string, catalogId = BASIC_V1_0, extra = {}): unknown => ({
    version: 'v1.0',
    createSurface: {surfaceId, catalogId, ...extra},
  }),
  updateComponents: (surfaceId: string, components: unknown[]): unknown => ({
    version: 'v1.0',
    updateComponents: {surfaceId, components},
  }),
  updateDataModel: (surfaceId: string, value: unknown, path = '/'): unknown => ({
    version: 'v1.0',
    updateDataModel: {surfaceId, path, value},
  }),
};
