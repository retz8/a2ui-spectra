/**
 * OpenAI's Chat Completions API, `POST /v1/chat/completions`, read into the
 * GenAI names.
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
  type GenAiMessage,
  type GenAiPart,
  isRecord,
  parsedArguments,
  reasoningPart,
  type StreamError,
  textPart,
  toolCallPart,
  toolCallResponsePart,
} from '../genai.js';
import type {ApiReader, ReadRequest, StreamChunk} from './reader.js';

export const FINISH_REASONS: Record<string, FinishReason> = {
  stop: 'stop',
  length: 'length',
  content_filter: 'content_filter',
  tool_calls: 'tool_call',
  function_call: 'tool_call',
};

export function openAiFinishReason(value: unknown): FinishReason | undefined {
  return typeof value === 'string' ? (FINISH_REASONS[value] ?? 'error') : undefined;
}

/** Chat Completions' `response_format`, or Responses' `text.format`, as an output type. */
export function outputTypeOf(format: unknown): string | undefined {
  const type = isRecord(format) ? asString(format.type) : asString(format);
  if (type === undefined) return undefined;
  return type === 'json_object' || type === 'json_schema' ? 'json' : type;
}

/** The usage object of either OpenAI API as the GenAI counts. */
export function openAiUsage(
  value: unknown,
  names: {input: string; output: string; inputDetails: string; outputDetails: string},
): Record<string, number | undefined> {
  if (!isRecord(value)) return {};
  const detailsOf = (name: string): Record<string, unknown> => {
    const details = value[name];
    return isRecord(details) ? details : {};
  };
  const inputDetails = detailsOf(names.inputDetails);
  const outputDetails = detailsOf(names.outputDetails);
  return {
    'gen_ai.usage.input_tokens': asInteger(value[names.input]),
    'gen_ai.usage.output_tokens': asInteger(value[names.output]),
    'gen_ai.usage.cache_read.input_tokens': asInteger(inputDetails.cached_tokens),
    'gen_ai.usage.reasoning.output_tokens': asInteger(outputDetails.reasoning_tokens),
  };
}

/** A message's `content`: a string, or an array of typed parts. */
function contentParts(content: unknown): GenAiPart[] {
  if (typeof content === 'string') return [textPart(content)];
  return asArray(content).flatMap(part => {
    if (!isRecord(part)) return [];
    switch (part.type) {
      case 'text':
        return [textPart(asString(part.text) ?? '')];
      case 'image_url': {
        const url = isRecord(part.image_url)
          ? asString(part.image_url.url)
          : asString(part.image_url);
        return [dataOrUri(url ?? '', 'image')];
      }
      case 'input_audio': {
        const audio = isRecord(part.input_audio) ? part.input_audio : {};
        const format = asString(audio.format);
        return [
          blobPart(format === undefined ? 'audio' : `audio/${format}`, asString(audio.data) ?? ''),
        ];
      }
      case 'refusal':
        return [{type: 'refusal', content: part.refusal}];
      default:
        return [{type: asString(part.type) ?? 'unknown', content: part}];
    }
  });
}

/** An image given as a data URL is a blob; any other URL is a URI. */
export function dataOrUri(url: string, modality: string): GenAiPart {
  const data = /^data:([^;,]+)?(;base64)?,(.*)$/s.exec(url);
  if (data !== null) {
    return defined({type: 'blob', mime_type: data[1], modality, content: data[3]});
  }
  return defined({type: 'uri', modality, uri: url});
}

function toolCalls(value: unknown): GenAiPart[] {
  return asArray(value).flatMap(call => {
    if (!isRecord(call)) return [];
    const fn = isRecord(call.function) ? call.function : {};
    return [
      toolCallPart(asString(call.id), asString(fn.name) ?? '', parsedArguments(fn.arguments)),
    ];
  });
}

function tools(value: unknown): GenAiPart[] | undefined {
  const definitions = asArray(value).flatMap(tool => {
    if (!isRecord(tool)) return [];
    if (tool.type === 'function' && isRecord(tool.function)) {
      const fn = tool.function;
      return [
        defined({
          type: 'function',
          name: asString(fn.name) ?? '',
          description: asString(fn.description),
          parameters: fn.parameters,
        }),
      ];
    }
    const type = asString(tool.type) ?? 'unknown';
    return [{type, name: type}];
  });
  return definitions.length > 0 ? definitions : undefined;
}

/** The assistant's message in a choice, or the whole of a streamed choice once assembled. */
function assistantMessage(message: Record<string, unknown>, finishReason: unknown): GenAiMessage {
  const parts: GenAiPart[] = [];
  const reasoning = asString(message.reasoning) ?? asString(message.reasoning_content);
  if (reasoning !== undefined && reasoning !== '') parts.push(reasoningPart(reasoning));
  if (typeof message.content === 'string' && message.content !== '') {
    parts.push(textPart(message.content));
  } else if (Array.isArray(message.content)) {
    parts.push(...contentParts(message.content));
  }
  if (typeof message.refusal === 'string') parts.push({type: 'refusal', content: message.refusal});
  parts.push(...toolCalls(message.tool_calls));
  return defined({role: 'assistant', parts, finish_reason: openAiFinishReason(finishReason)});
}

function responseAttributes(
  body: Record<string, unknown>,
  messages: GenAiMessage[],
): Record<string, unknown> {
  const reasons = messages.flatMap(message =>
    message.finish_reason === undefined ? [] : [message.finish_reason],
  );
  return defined({
    'gen_ai.response.id': asString(body.id),
    'gen_ai.response.model': asString(body.model),
    'gen_ai.response.finish_reasons': reasons.length > 0 ? reasons : undefined,
    ...openAiUsage(body.usage, {
      input: 'prompt_tokens',
      output: 'completion_tokens',
      inputDetails: 'prompt_tokens_details',
      outputDetails: 'completion_tokens_details',
    }),
    'gen_ai.output.messages': messages.length > 0 ? messages : undefined,
  });
}

export const openAiChatReader: ApiReader = {
  api: 'openai_chat_completions',

  request({body}: ReadRequest) {
    const record = isRecord(body) ? body : {};
    const system: GenAiPart[] = [];
    const messages: GenAiMessage[] = [];
    for (const message of asArray(record.messages)) {
      if (!isRecord(message)) continue;
      const role = asString(message.role) ?? 'user';
      if (role === 'system' || role === 'developer') {
        system.push(...contentParts(message.content));
      } else if (role === 'assistant') {
        // An assistant message that only called tools has no content, or an empty one.
        const content =
          message.content === null || message.content === undefined || message.content === ''
            ? []
            : contentParts(message.content);
        messages.push({role, parts: [...content, ...toolCalls(message.tool_calls)]});
      } else if (role === 'tool' || role === 'function') {
        messages.push({
          role: 'tool',
          parts: [toolCallResponsePart(asString(message.tool_call_id), message.content)],
        });
      } else {
        messages.push(
          defined({role, parts: contentParts(message.content), name: asString(message.name)}),
        );
      }
    }
    return defined({
      'gen_ai.operation.name': 'chat',
      'gen_ai.provider.name': 'openai',
      'openai.api.type': 'chat_completions',
      'gen_ai.request.model': asString(record.model),
      'gen_ai.request.stream': record.stream === true,
      'gen_ai.request.temperature': asNumber(record.temperature),
      'gen_ai.request.top_p': asNumber(record.top_p),
      'gen_ai.request.max_tokens':
        asInteger(record.max_completion_tokens) ?? asInteger(record.max_tokens),
      'gen_ai.request.stop_sequences': asStringArray(record.stop),
      'gen_ai.request.choice.count': asInteger(record.n),
      'gen_ai.request.seed': asInteger(record.seed),
      'gen_ai.request.frequency_penalty': asNumber(record.frequency_penalty),
      'gen_ai.request.presence_penalty': asNumber(record.presence_penalty),
      'gen_ai.output.type': outputTypeOf(record.response_format),
      'gen_ai.system_instructions': system.length > 0 ? system : undefined,
      'gen_ai.input.messages': messages.length > 0 ? messages : undefined,
      'gen_ai.tool.definitions': tools(record.tools),
    });
  },

  response(body: unknown) {
    if (!isRecord(body)) return {};
    const messages = asArray(body.choices).flatMap(choice =>
      isRecord(choice) && isRecord(choice.message)
        ? [assistantMessage(choice.message, choice.finish_reason)]
        : [],
    );
    return responseAttributes(body, messages);
  },

  stream(chunks: StreamChunk[]) {
    const merged: Record<string, unknown> = {};
    interface Choice {
      content: string;
      reasoning: string;
      refusal: string;
      toolCalls: Map<number, {id?: string; name: string; arguments: string}>;
      finishReason?: unknown;
    }
    const choices = new Map<number, Choice>();
    let error: StreamError | undefined;
    for (const {data} of chunks) {
      if (!isRecord(data)) continue;
      if (isRecord(data.error)) {
        error ??= {
          type: asString(data.error.type) ?? asString(data.error.code) ?? 'error',
          message: asString(data.error.message),
        };
        continue;
      }
      for (const key of ['id', 'model', 'usage']) {
        if (data[key] !== undefined && data[key] !== null) merged[key] = data[key];
      }
      for (const choice of asArray(data.choices)) {
        if (!isRecord(choice)) continue;
        const index = asInteger(choice.index) ?? 0;
        const slot: Choice = choices.get(index) ?? {
          content: '',
          reasoning: '',
          refusal: '',
          toolCalls: new Map(),
        };
        choices.set(index, slot);
        const delta = isRecord(choice.delta) ? choice.delta : {};
        if (typeof delta.content === 'string') slot.content += delta.content;
        const reasoning = asString(delta.reasoning) ?? asString(delta.reasoning_content);
        if (reasoning !== undefined) slot.reasoning += reasoning;
        if (typeof delta.refusal === 'string') slot.refusal += delta.refusal;
        for (const call of asArray(delta.tool_calls)) {
          if (!isRecord(call)) continue;
          const callIndex = asInteger(call.index) ?? 0;
          const fn = isRecord(call.function) ? call.function : {};
          const entry = slot.toolCalls.get(callIndex) ?? {name: '', arguments: ''};
          slot.toolCalls.set(callIndex, entry);
          if (typeof call.id === 'string') entry.id = call.id;
          if (typeof fn.name === 'string') entry.name += fn.name;
          if (typeof fn.arguments === 'string') entry.arguments += fn.arguments;
        }
        if (choice.finish_reason !== undefined && choice.finish_reason !== null) {
          slot.finishReason = choice.finish_reason;
        }
      }
    }
    const messages = [...choices.entries()]
      .sort(([a], [b]) => a - b)
      .map(([, slot]) =>
        assistantMessage(
          {
            ...(slot.reasoning !== '' && {reasoning: slot.reasoning}),
            content: slot.content,
            ...(slot.refusal !== '' && {refusal: slot.refusal}),
            tool_calls: [...slot.toolCalls.entries()]
              .sort(([a], [b]) => a - b)
              .map(([, call]) => ({
                id: call.id,
                function: {name: call.name, arguments: call.arguments},
              })),
          },
          slot.finishReason,
        ),
      );
    return {attributes: responseAttributes(merged, messages), ...(error && {error})};
  },

  errorMessage(body: unknown) {
    return isRecord(body) && isRecord(body.error) ? asString(body.error.message) : undefined;
  },
};
