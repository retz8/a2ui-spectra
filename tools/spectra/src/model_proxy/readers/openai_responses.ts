/**
 * OpenAI's Responses API, `POST /v1/responses`, read into the GenAI names.
 */
import {
  asArray,
  asInteger,
  asNumber,
  asString,
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
import {dataOrUri, openAiUsage, outputTypeOf} from './openai_chat.js';
import type {ApiReader, ReadRequest, StreamChunk} from './reader.js';

/** A message item's content: a string, or the typed content parts of the Responses API. */
function contentParts(content: unknown): GenAiPart[] {
  if (typeof content === 'string') return [textPart(content)];
  return asArray(content).flatMap(part => {
    if (!isRecord(part)) return [];
    switch (part.type) {
      case 'input_text':
      case 'output_text':
        return [textPart(asString(part.text) ?? '')];
      case 'input_image': {
        const url = asString(part.image_url);
        return url === undefined
          ? [{type: 'input_image', content: part}]
          : [dataOrUri(url, 'image')];
      }
      case 'refusal':
        return [{type: 'refusal', content: part.refusal}];
      default:
        return [{type: asString(part.type) ?? 'unknown', content: part}];
    }
  });
}

/** The text of a reasoning item's summary. */
function summaryText(item: Record<string, unknown>): string {
  return asArray(item.summary)
    .flatMap(entry => (isRecord(entry) ? [asString(entry.text) ?? ''] : []))
    .join('\n');
}

/** An input item, or an output item, as a message of its own. */
function itemMessage(item: Record<string, unknown>): GenAiMessage | undefined {
  const type = asString(item.type) ?? (item.role !== undefined ? 'message' : undefined);
  switch (type) {
    case 'message':
      return {role: asString(item.role) ?? 'user', parts: contentParts(item.content)};
    case 'function_call':
      return {
        role: 'assistant',
        parts: [
          toolCallPart(
            asString(item.call_id) ?? asString(item.id),
            asString(item.name) ?? '',
            parsedArguments(item.arguments),
          ),
        ],
      };
    case 'function_call_output':
      return {role: 'tool', parts: [toolCallResponsePart(asString(item.call_id), item.output)]};
    case 'reasoning':
      return {role: 'assistant', parts: [reasoningPart(summaryText(item))]};
    case undefined:
      return undefined;
    default:
      return {role: 'assistant', parts: [{type, content: item}]};
  }
}

function tools(value: unknown): GenAiPart[] | undefined {
  const definitions = asArray(value).flatMap(tool => {
    if (!isRecord(tool)) return [];
    if (tool.type === 'function') {
      return [
        defined({
          type: 'function',
          name: asString(tool.name) ?? '',
          description: asString(tool.description),
          parameters: tool.parameters,
        }),
      ];
    }
    const type = asString(tool.type) ?? 'unknown';
    return [{type, name: asString(tool.name) ?? type}];
  });
  return definitions.length > 0 ? definitions : undefined;
}

/** The output items of a response as one assistant message, and the response's finish reason. */
function outputMessage(response: Record<string, unknown>): GenAiMessage | undefined {
  const parts: GenAiPart[] = [];
  let toolCall = false;
  for (const item of asArray(response.output)) {
    if (!isRecord(item)) continue;
    switch (item.type) {
      case 'message':
        parts.push(...contentParts(item.content));
        break;
      case 'function_call':
        toolCall = true;
        parts.push(
          toolCallPart(
            asString(item.call_id) ?? asString(item.id),
            asString(item.name) ?? '',
            parsedArguments(item.arguments),
          ),
        );
        break;
      case 'reasoning':
        parts.push(reasoningPart(summaryText(item)));
        break;
      default:
        parts.push({type: asString(item.type) ?? 'unknown', content: item});
    }
  }
  const finish = finishReason(response, toolCall);
  if (parts.length === 0 && finish === undefined) return undefined;
  return defined({role: 'assistant', parts, finish_reason: finish});
}

function finishReason(
  response: Record<string, unknown>,
  toolCall: boolean,
): FinishReason | undefined {
  switch (response.status) {
    case 'completed':
      return toolCall ? 'tool_call' : 'stop';
    case 'incomplete': {
      const reason = isRecord(response.incomplete_details)
        ? asString(response.incomplete_details.reason)
        : undefined;
      return reason === 'content_filter' ? 'content_filter' : 'length';
    }
    case 'failed':
    case 'cancelled':
      return 'error';
    default:
      return undefined;
  }
}

function responseAttributes(response: Record<string, unknown>): Record<string, unknown> {
  const message = outputMessage(response);
  return defined({
    'gen_ai.response.id': asString(response.id),
    'gen_ai.response.model': asString(response.model),
    'gen_ai.response.finish_reasons':
      message?.finish_reason === undefined ? undefined : [message.finish_reason],
    ...openAiUsage(response.usage, {
      input: 'input_tokens',
      output: 'output_tokens',
      inputDetails: 'input_tokens_details',
      outputDetails: 'output_tokens_details',
    }),
    'gen_ai.output.messages': message === undefined ? undefined : [message],
  });
}

export const openAiResponsesReader: ApiReader = {
  api: 'openai_responses',

  request({body}: ReadRequest) {
    const record = isRecord(body) ? body : {};
    const system: GenAiPart[] = [];
    const instructions = asString(record.instructions);
    if (instructions !== undefined) system.push(textPart(instructions));
    const messages: GenAiMessage[] = [];
    if (typeof record.input === 'string') {
      messages.push({role: 'user', parts: [textPart(record.input)]});
    }
    for (const item of asArray(record.input)) {
      if (!isRecord(item)) continue;
      const message = itemMessage(item);
      if (message === undefined) continue;
      if (message.role === 'system' || message.role === 'developer') {
        system.push(...message.parts);
      } else {
        messages.push(message);
      }
    }
    const text = isRecord(record.text) ? record.text : {};
    return defined({
      'gen_ai.operation.name': 'chat',
      'gen_ai.provider.name': 'openai',
      'openai.api.type': 'responses',
      'gen_ai.request.model': asString(record.model),
      'gen_ai.request.stream': record.stream === true,
      'gen_ai.request.temperature': asNumber(record.temperature),
      'gen_ai.request.top_p': asNumber(record.top_p),
      'gen_ai.request.max_tokens': asInteger(record.max_output_tokens),
      'gen_ai.output.type': outputTypeOf(text.format),
      'gen_ai.system_instructions': system.length > 0 ? system : undefined,
      'gen_ai.input.messages': messages.length > 0 ? messages : undefined,
      'gen_ai.tool.definitions': tools(record.tools),
    });
  },

  response(body: unknown) {
    return isRecord(body) ? responseAttributes(body) : {};
  },

  stream(chunks: StreamChunk[]) {
    let last: Record<string, unknown> | undefined;
    const items: unknown[] = [];
    let error: StreamError | undefined;
    for (const {data} of chunks) {
      if (!isRecord(data)) continue;
      const type = asString(data.type);
      if (type === 'error') {
        error ??= {type: asString(data.code) ?? 'error', message: asString(data.message)};
        continue;
      }
      if (isRecord(data.response)) {
        last = data.response;
        if (type === 'response.failed') {
          const failure = isRecord(data.response.error) ? data.response.error : {};
          error ??= {type: asString(failure.code) ?? 'error', message: asString(failure.message)};
        }
      }
      if (type === 'response.output_item.done') items.push(data.item);
    }
    if (last === undefined) {
      return {attributes: {}, ...(error && {error})};
    }
    // A stream that did not reach its end has the items done so far, and the response as created.
    const response =
      Array.isArray(last.output) && last.output.length > 0 ? last : {...last, output: items};
    return {attributes: responseAttributes(response), ...(error && {error})};
  },

  errorMessage(body: unknown) {
    return isRecord(body) && isRecord(body.error) ? asString(body.error.message) : undefined;
  },
};
