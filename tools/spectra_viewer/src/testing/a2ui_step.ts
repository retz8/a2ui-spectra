/**
 * Hand-written events of the A2UI step, in turn record v0.1's shape, for
 * the tests of what the viewer works out from them.
 */
import type {
  CatalogRef,
  ComponentRange,
  InferenceFormat,
  ParseEvent,
  PromptGenerationEvent,
} from '../model/record.ts';
import {at, TRACE} from './model_calls.ts';

export const BASIC_V10: CatalogRef = {
  catalogId: 'https://a2ui.org/specification/v1_0/catalogs/basic/catalog.json',
  protocolVersion: 'v1.0',
};

const SCOPE = {name: 'a2ui-spectra-instrumentation', version: '0.1.0'};

export interface ParseError {
  type: string;
  message: string;
  /** The rejected block's range in the input. */
  block?: [number, number];
  ms: number;
}

export interface ParseOptions {
  spanId: string;
  start: number;
  end?: number;
  format?: InferenceFormat;
  input: string;
  messages?: unknown[];
  entryPoint?: 'parse_response' | 'open_stream' | 'compile' | 'tool_call';
  wrapped?: boolean;
  /** Each chunk fed, for a stream, as its time and the offset it brought the input to. */
  chunks?: Array<{ms: number; end: number}>;
  errors?: ParseError[];
  /** The toolset's tool call this parse is. */
  tool?: {name: string; callId?: string; result?: unknown};
  parentSpanId?: string;
  sdk?: 'a2ui-agent-sdk' | '@a2ui/agent';
  /** Ranges the producer states itself. */
  components?: ComponentRange[];
  traceId?: string;
}

/** A parse event as the wrapper writes it, received through the receiver. */
export function parse(options: ParseOptions): ParseEvent {
  const {
    spanId,
    start,
    end = start + 10,
    format = 'direct_json',
    input,
    messages = [],
    entryPoint = 'parse_response',
    wrapped,
    chunks,
    errors = [],
    tool,
    parentSpanId,
    sdk = 'a2ui-agent-sdk',
    components,
    traceId = TRACE,
  } = options;
  const names = {
    'a2ui.event.kind': 'parse' as const,
    'otel.scope.name': SCOPE.name,
    'otel.scope.version': SCOPE.version,
    'a2ui.parse.input': input,
    'a2ui.parse.entry_point': entryPoint,
    ...(wrapped !== undefined && {'a2ui.parse.wrapped': wrapped}),
    ...(chunks !== undefined && {'a2ui.parse.streamed': true}),
    'a2ui.parse.inference_format': format,
    'a2ui.parse.catalogs': [BASIC_V10],
    'a2ui.parse.messages': messages,
    ...(components !== undefined && {'a2ui.parse.components': components}),
    'a2ui.sdk.name': sdk,
    'a2ui.sdk.version': sdk === '@a2ui/agent' ? '0.1.0' : '0.10.0',
    ...(tool !== undefined && {
      'gen_ai.tool.name': tool.name,
      ...(tool.callId !== undefined && {'gen_ai.tool.call.id': tool.callId}),
      ...(tool.result !== undefined && {'gen_ai.tool.call.result': tool.result}),
    }),
    ...(errors.length > 0 && {'error.type': errors[0].type}),
  };
  const events = [
    ...(chunks ?? []).map(chunk => ({
      ms: chunk.ms,
      name: 'a2ui.parse.chunk',
      attributes: {'a2ui.parse.chunk.end': chunk.end},
    })),
    ...errors.map(error => ({
      ms: error.ms,
      name: 'exception',
      attributes: {
        'exception.type': error.type,
        'exception.message': error.message,
        'exception.stacktrace': 'Traceback (most recent call last): …',
        ...(error.block !== undefined && {
          'a2ui.parse.block.start': error.block[0],
          'a2ui.parse.block.end': error.block[1],
        }),
      },
    })),
  ].sort((a, b) => a.ms - b.ms);
  return {
    traceId,
    spanId,
    ...(parentSpanId !== undefined && {parentSpanId}),
    name: 'parse',
    kind: 1,
    startTimeUnixNano: at(start),
    endTimeUnixNano: at(end),
    attributes: {...names, 'a2ui.received.attributes': {...names}},
    ...(events.length > 0 && {
      events: events.map(({ms, name, attributes}) => ({timeUnixNano: at(ms), name, attributes})),
    }),
    status: errors.length > 0 ? {code: 2, message: errors[0].message} : {code: 0},
  } as ParseEvent;
}

export interface GenerationOptions {
  spanId: string;
  start: number;
  end?: number;
  format?: InferenceFormat;
  section?: string;
  catalogs?: CatalogRef[];
  /** A generation that failed, with no section. */
  failure?: {type: string; message: string};
  /** The toolset's generation, which names its tool. */
  tool?: string;
  sdk?: 'a2ui-agent-sdk' | '@a2ui/agent';
  traceId?: string;
}

/** A prompt generation event as the wrapper writes it, received through the receiver. */
export function promptGeneration(options: GenerationOptions): PromptGenerationEvent {
  const {
    spanId,
    start,
    end = start + 2,
    format = 'direct_json',
    section = '## Workflow Description:\n\nThe generated response MUST follow these rules.',
    catalogs = [BASIC_V10],
    failure,
    tool,
    sdk = 'a2ui-agent-sdk',
    traceId = TRACE,
  } = options;
  const names = {
    'a2ui.event.kind': 'prompt_generation' as const,
    'otel.scope.name': SCOPE.name,
    'otel.scope.version': SCOPE.version,
    ...(failure === undefined && {'a2ui.prompt.ui_section': section}),
    'a2ui.prompt.inference_format': format,
    'a2ui.prompt.catalogs': catalogs,
    'a2ui.sdk.name': sdk,
    'a2ui.sdk.version': sdk === '@a2ui/agent' ? '0.1.0' : '0.10.0',
    ...(tool !== undefined && {'gen_ai.tool.name': tool}),
    ...(failure !== undefined && {'error.type': failure.type}),
  };
  return {
    traceId,
    spanId,
    name: 'prompt_generation',
    kind: 1,
    startTimeUnixNano: at(start),
    endTimeUnixNano: at(end),
    attributes: {...names, 'a2ui.received.attributes': {...names}},
    ...(failure !== undefined && {
      events: [
        {
          timeUnixNano: at(end),
          name: 'exception',
          attributes: {
            'exception.type': failure.type,
            'exception.message': failure.message,
            'exception.stacktrace': 'Traceback (most recent call last): …',
          },
        },
      ],
    }),
    status: failure === undefined ? {code: 0} : {code: 2, message: failure.message},
  } as PromptGenerationEvent;
}
