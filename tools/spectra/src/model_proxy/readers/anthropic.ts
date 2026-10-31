/**
 * Anthropic's Messages API, `POST /v1/messages`, read into the GenAI names.
 */
import {
  asArray,
  asInteger,
  asNumber,
  asString,
  asStringArray,
  blobPart,
  defined,
  type FinishReason,
  type GenAiPart,
  isRecord,
  reasoningPart,
  type StreamError,
  sum,
  textPart,
  toolCallPart,
  toolCallResponsePart,
  uriPart,
} from '../genai.js';
import type {ApiReader, ReadRequest, StreamChunk} from './reader.js';

const STOP_REASONS: Record<string, FinishReason> = {
  end_turn: 'stop',
  stop_sequence: 'stop',
  pause_turn: 'stop',
  max_tokens: 'length',
  tool_use: 'tool_call',
  refusal: 'content_filter',
  model_context_window_exceeded: 'length',
};

function finishReason(value: unknown): FinishReason | undefined {
  return typeof value === 'string' ? (STOP_REASONS[value] ?? 'error') : undefined;
}

/** A message's content: a string, or content blocks. */
function blocks(content: unknown): GenAiPart[] {
  if (typeof content === 'string') return [textPart(content)];
  return asArray(content).flatMap(block => {
    if (!isRecord(block)) return [];
    switch (block.type) {
      case 'text':
        return [textPart(asString(block.text) ?? '')];
      case 'image':
      case 'document': {
        const source = isRecord(block.source) ? block.source : {};
        const mimeType = asString(source.media_type);
        if (source.type === 'base64') return [blobPart(mimeType, asString(source.data) ?? '')];
        if (source.type === 'url') return [uriPart(mimeType, asString(source.url) ?? '')];
        return [{type: asString(block.type) ?? 'unknown', content: block}];
      }
      case 'tool_use':
      case 'server_tool_use':
        return [toolCallPart(asString(block.id), asString(block.name) ?? '', block.input)];
      case 'tool_result':
        return [toolCallResponsePart(asString(block.tool_use_id), block.content)];
      case 'thinking':
        return [reasoningPart(asString(block.thinking) ?? '')];
      case 'redacted_thinking':
        return [{type: 'redacted_thinking', content: block}];
      default:
        return [{type: asString(block.type) ?? 'unknown', content: block}];
    }
  });
}

function tools(value: unknown): GenAiPart[] | undefined {
  const definitions = asArray(value).flatMap(tool => {
    if (!isRecord(tool)) return [];
    if (tool.type === undefined || tool.type === 'custom') {
      return [
        defined({
          type: 'function',
          name: asString(tool.name) ?? '',
          description: asString(tool.description),
          parameters: tool.input_schema,
        }),
      ];
    }
    const type = asString(tool.type) ?? 'unknown';
    return [{type, name: asString(tool.name) ?? type}];
  });
  return definitions.length > 0 ? definitions : undefined;
}

function usage(value: unknown): Record<string, number | undefined> {
  if (!isRecord(value)) return {};
  const input = asInteger(value.input_tokens);
  const cacheRead = asInteger(value.cache_read_input_tokens);
  const cacheWrite = asInteger(value.cache_creation_input_tokens);
  const outputDetails = isRecord(value.output_tokens_details) ? value.output_tokens_details : {};
  return {
    'gen_ai.usage.input_tokens':
      input === undefined ? undefined : sum(input, cacheRead, cacheWrite),
    'gen_ai.usage.output_tokens': asInteger(value.output_tokens),
    'gen_ai.usage.cache_read.input_tokens': cacheRead,
    'gen_ai.usage.cache_write.input_tokens': cacheWrite,
    'gen_ai.usage.reasoning.output_tokens': asInteger(outputDetails.thinking_tokens),
  };
}

function responseAttributes(message: Record<string, unknown>): Record<string, unknown> {
  const finish = finishReason(message.stop_reason);
  const parts = blocks(message.content);
  const output =
    parts.length === 0 && finish === undefined
      ? undefined
      : [defined({role: 'assistant', parts, finish_reason: finish})];
  return defined({
    'gen_ai.response.id': asString(message.id),
    'gen_ai.response.model': asString(message.model),
    'gen_ai.response.finish_reasons': finish === undefined ? undefined : [finish],
    ...usage(message.usage),
    'gen_ai.output.messages': output,
  });
}

export const anthropicReader: ApiReader = {
  api: 'anthropic_messages',

  request({body}: ReadRequest) {
    const record = isRecord(body) ? body : {};
    const system = record.system === undefined ? undefined : blocks(record.system);
    const messages = asArray(record.messages).flatMap(message =>
      isRecord(message)
        ? [{role: asString(message.role) ?? 'user', parts: blocks(message.content)}]
        : [],
    );
    return defined({
      'gen_ai.operation.name': 'chat',
      'gen_ai.provider.name': 'anthropic',
      'gen_ai.request.model': asString(record.model),
      'gen_ai.request.stream': record.stream === true,
      'gen_ai.request.max_tokens': asInteger(record.max_tokens),
      'gen_ai.request.temperature': asNumber(record.temperature),
      'gen_ai.request.top_p': asNumber(record.top_p),
      'gen_ai.request.top_k': asInteger(record.top_k),
      'gen_ai.request.stop_sequences': asStringArray(record.stop_sequences),
      'gen_ai.system_instructions': system !== undefined && system.length > 0 ? system : undefined,
      'gen_ai.input.messages': messages.length > 0 ? messages : undefined,
      'gen_ai.tool.definitions': tools(record.tools),
    });
  },

  response(body: unknown) {
    return isRecord(body) ? responseAttributes(body) : {};
  },

  stream(chunks: StreamChunk[]) {
    const message: Record<string, unknown> = {};
    const usageSoFar: Record<string, unknown> = {};
    const content = new Map<number, Record<string, unknown> & {partialJson?: string}>();
    let error: StreamError | undefined;
    for (const {data} of chunks) {
      if (!isRecord(data)) continue;
      switch (data.type) {
        case 'error': {
          const failure = isRecord(data.error) ? data.error : {};
          error ??= {type: asString(failure.type) ?? 'error', message: asString(failure.message)};
          break;
        }
        case 'message_start':
          if (isRecord(data.message)) {
            Object.assign(message, data.message);
            if (isRecord(data.message.usage)) Object.assign(usageSoFar, data.message.usage);
          }
          break;
        case 'content_block_start':
          if (isRecord(data.content_block)) {
            content.set(asInteger(data.index) ?? content.size, {...data.content_block});
          }
          break;
        case 'content_block_delta': {
          const block = content.get(asInteger(data.index) ?? 0);
          const delta = isRecord(data.delta) ? data.delta : {};
          if (block === undefined) break;
          if (delta.type === 'text_delta') {
            block.text = `${asString(block.text) ?? ''}${asString(delta.text) ?? ''}`;
          } else if (delta.type === 'thinking_delta') {
            block.thinking = `${asString(block.thinking) ?? ''}${asString(delta.thinking) ?? ''}`;
          } else if (delta.type === 'input_json_delta') {
            block.partialJson = `${block.partialJson ?? ''}${asString(delta.partial_json) ?? ''}`;
          } else if (delta.type === 'signature_delta') {
            block.signature = `${asString(block.signature) ?? ''}${asString(delta.signature) ?? ''}`;
          }
          break;
        }
        case 'message_delta':
          if (isRecord(data.delta)) {
            for (const [key, value] of Object.entries(data.delta)) {
              if (value !== null && value !== undefined) message[key] = value;
            }
          }
          if (isRecord(data.usage)) {
            for (const [key, value] of Object.entries(data.usage)) {
              if (value !== null && value !== undefined) usageSoFar[key] = value;
            }
          }
          break;
        default:
          break;
      }
    }
    const assembled = [...content.entries()]
      .sort(([a], [b]) => a - b)
      .map(([, block]) => {
        const {partialJson, ...rest} = block;
        if (partialJson !== undefined) {
          try {
            rest.input = JSON.parse(partialJson) as unknown;
          } catch {
            rest.input = partialJson;
          }
        }
        return rest;
      });
    return {
      attributes: responseAttributes({...message, content: assembled, usage: usageSoFar}),
      ...(error && {error}),
    };
  },

  errorMessage(body: unknown) {
    return isRecord(body) && isRecord(body.error) ? asString(body.error.message) : undefined;
  },
};
