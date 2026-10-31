/**
 * Hand-written model call events, in turn record v0.1's shape, for the tests
 * of what the viewer reads from them.
 */
import type {ModelCallEvent, TurnRecordEvent, WireOutputEvent} from '../model/record.ts';

/** The turn's start: 2026-10-30T14:02:31Z. */
export const T0 = 1793368951000n * 1_000_000n;

/** A time `ms` after the turn's start, in nanoseconds, as a decimal string. */
export function at(ms: number): string {
  return (T0 + BigInt(ms) * 1_000_000n).toString();
}

export const TRACE = 'a'.repeat(32);

export interface CallOptions {
  spanId: string;
  start: number;
  end?: number;
  provider?: 'gcp.gemini' | 'anthropic' | 'openai';
  model?: string;
  system?: string;
  tools?: Array<{name: string; description?: string}>;
  /** Each message as its role and its text, or its role and its parts. */
  messages?: Array<{role: string; text?: string; parts?: unknown[]}>;
  usage?: {
    input?: number;
    output?: number;
    reasoning?: number;
    cacheRead?: number;
    cacheWrite?: number;
  };
  /** Attributes added or replacing the ones built. */
  attributes?: Record<string, unknown>;
  status?: {code: 0 | 1 | 2; message?: string};
  chunks?: number[];
  traceId?: string;
}

/** A model call read in full, as the model proxy records it. */
export function modelCall(options: CallOptions): ModelCallEvent {
  const {
    spanId,
    start,
    end,
    provider = 'anthropic',
    model = 'claude-sonnet-5-5',
    system,
    tools,
    messages = [],
    usage,
    attributes = {},
    status,
    chunks,
    traceId = TRACE,
  } = options;
  const usageAttributes = {
    ...(usage?.input !== undefined && {'gen_ai.usage.input_tokens': usage.input}),
    ...(usage?.output !== undefined && {'gen_ai.usage.output_tokens': usage.output}),
    ...(usage?.reasoning !== undefined && {
      'gen_ai.usage.reasoning.output_tokens': usage.reasoning,
    }),
    ...(usage?.cacheRead !== undefined && {
      'gen_ai.usage.cache_read.input_tokens': usage.cacheRead,
    }),
    ...(usage?.cacheWrite !== undefined && {
      'gen_ai.usage.cache_write.input_tokens': usage.cacheWrite,
    }),
  };
  return {
    traceId,
    spanId,
    parentSpanId: '0'.repeat(16),
    name: `chat ${model}`,
    kind: 3,
    startTimeUnixNano: at(start),
    ...(end !== undefined && {endTimeUnixNano: at(end)}),
    attributes: {
      'a2ui.event.kind': 'model_call',
      'gen_ai.operation.name': provider === 'gcp.gemini' ? 'generate_content' : 'chat',
      'gen_ai.provider.name': provider,
      'gen_ai.request.model': model,
      ...(system !== undefined && {
        'gen_ai.system_instructions': [{type: 'text', content: system}],
      }),
      ...(tools !== undefined && {
        'gen_ai.tool.definitions': tools.map(tool => ({type: 'function', ...tool})),
      }),
      'gen_ai.input.messages': messages.map(({role, text, parts}) => ({
        role,
        parts: parts ?? [{type: 'text', content: text ?? ''}],
      })),
      ...usageAttributes,
      'http.request.method': 'POST',
      'url.full': 'https://api.anthropic.com/v1/messages',
      ...(end !== undefined && {'http.response.status_code': 200}),
      ...attributes,
    },
    ...(chunks !== undefined && {
      events: chunks.map(ms => ({
        timeUnixNano: at(ms),
        name: 'a2ui.http.response.chunk',
        attributes: {'a2ui.http.response.chunk.body': {}},
      })),
    }),
    ...(end !== undefined && {status: status ?? {code: 1}}),
  };
}

/** A call recorded raw: the exchange only. */
export function rawCall(spanId: string, start: number, end: number): ModelCallEvent {
  return {
    traceId: TRACE,
    spanId,
    parentSpanId: '0'.repeat(16),
    name: 'POST',
    kind: 3,
    startTimeUnixNano: at(start),
    endTimeUnixNano: at(end),
    attributes: {
      'a2ui.event.kind': 'model_call',
      'http.request.method': 'POST',
      'url.full': 'https://openrouter.ai/api/v1/chat/completions',
      'http.response.status_code': 200,
    },
    status: {code: 1},
  };
}

/** A delivery from the agent carrying one A2UI message. */
export function a2uiDelivery(spanId: string, ms: number): WireOutputEvent {
  return {
    traceId: TRACE,
    spanId,
    parentSpanId: '0'.repeat(16),
    name: 'wire_output',
    kind: 1,
    startTimeUnixNano: at(ms),
    attributes: {
      'a2ui.event.kind': 'wire_output',
      'a2ui.wire.message': {
        role: 'assistant',
        parts: [
          {
            type: 'a2ui',
            content: {version: 'v0.9', createSurface: {surfaceId: 'contact_card', catalogId: 'x'}},
          },
        ],
      },
    },
  };
}

/** Events by start time, as the record joins them. */
export function byStart(...events: TurnRecordEvent[]): TurnRecordEvent[] {
  return [...events].sort((a, b) =>
    BigInt(a.startTimeUnixNano) < BigInt(b.startTimeUnixNano) ? -1 : 1,
  );
}
