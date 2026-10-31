/**
 * Google's Gemini API, `POST /{version}/models/{model}:generateContent` and
 * `:streamGenerateContent?alt=sse`, read into the GenAI names.
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
  reasoningPart,
  type StreamError,
  sum,
  textPart,
  toolCallPart,
  toolCallResponsePart,
  uriPart,
} from '../genai.js';
import type {ApiReader, ReadRequest, StreamChunk} from './reader.js';

/** `/{version}/models/{model}:{method}`, or LiteLLM's `/models/{model}:{method}` under its own prefix. */
export const GEMINI_PATH =
  /^(?:\/v1[a-z0-9]*)?\/models\/([^/:]+):(generateContent|streamGenerateContent)$/;

export const FINISH_REASONS: Record<string, FinishReason> = {
  STOP: 'stop',
  MAX_TOKENS: 'length',
  SAFETY: 'content_filter',
  RECITATION: 'content_filter',
  BLOCKLIST: 'content_filter',
  PROHIBITED_CONTENT: 'content_filter',
  SPII: 'content_filter',
  IMAGE_SAFETY: 'content_filter',
  IMAGE_PROHIBITED_CONTENT: 'content_filter',
  IMAGE_RECITATION: 'content_filter',
  LANGUAGE: 'error',
  MALFORMED_FUNCTION_CALL: 'error',
  UNEXPECTED_TOOL_CALL: 'error',
  OTHER: 'error',
};

function finishReason(value: unknown): FinishReason | undefined {
  return typeof value === 'string' ? (FINISH_REASONS[value] ?? 'error') : undefined;
}

/** A content's parts in GenAI's shapes. */
function parts(value: unknown): GenAiPart[] {
  return asArray(value).flatMap(part => {
    if (!isRecord(part)) return [];
    if (typeof part.text === 'string') {
      return [part.thought === true ? reasoningPart(part.text) : textPart(part.text)];
    }
    if (isRecord(part.functionCall)) {
      const call = part.functionCall;
      return [toolCallPart(asString(call.id), asString(call.name) ?? '', call.args)];
    }
    if (isRecord(part.functionResponse)) {
      const response = part.functionResponse;
      return [
        defined({
          ...toolCallResponsePart(asString(response.id), response.response),
          name: asString(response.name),
        }),
      ];
    }
    if (isRecord(part.inlineData)) {
      return [blobPart(asString(part.inlineData.mimeType), asString(part.inlineData.data) ?? '')];
    }
    if (isRecord(part.fileData)) {
      return [uriPart(asString(part.fileData.mimeType), asString(part.fileData.fileUri) ?? '')];
    }
    const [key] = Object.keys(part).filter(
      name => name !== 'thought' && name !== 'thoughtSignature',
    );
    return [{type: key ?? 'unknown', content: part}];
  });
}

function role(value: unknown): string {
  return value === 'model' ? 'assistant' : (asString(value) ?? 'user');
}

function tools(value: unknown): GenAiPart[] | undefined {
  const definitions = asArray(value).flatMap(tool => {
    if (!isRecord(tool)) return [];
    const functions = asArray(tool.functionDeclarations).flatMap(declaration =>
      isRecord(declaration)
        ? [
            defined({
              type: 'function',
              name: asString(declaration.name) ?? '',
              description: asString(declaration.description),
              parameters: declaration.parameters ?? declaration.parametersJsonSchema,
            }),
          ]
        : [],
    );
    const others = Object.keys(tool)
      .filter(key => key !== 'functionDeclarations')
      .map(key => ({type: key, name: key}));
    return [...functions, ...others];
  });
  return definitions.length > 0 ? definitions : undefined;
}

function usage(value: unknown): Record<string, number | undefined> {
  if (!isRecord(value)) return {};
  const thoughts = asInteger(value.thoughtsTokenCount);
  return {
    'gen_ai.usage.input_tokens': sum(
      asInteger(value.promptTokenCount),
      asInteger(value.toolUsePromptTokenCount),
    ),
    'gen_ai.usage.cache_read.input_tokens': asInteger(value.cachedContentTokenCount),
    'gen_ai.usage.output_tokens': sum(asInteger(value.candidatesTokenCount), thoughts),
    'gen_ai.usage.reasoning.output_tokens': thoughts,
  };
}

/** One candidate as an output message. */
function candidateMessage(candidate: Record<string, unknown>): GenAiMessage {
  const content = isRecord(candidate.content) ? candidate.content : {};
  return defined({
    role: role(content.role ?? 'model'),
    parts: parts(content.parts),
    finish_reason: finishReason(candidate.finishReason),
  });
}

function responseAttributes(
  body: Record<string, unknown>,
  messages: GenAiMessage[],
): Record<string, unknown> {
  const reasons = messages.flatMap(message =>
    message.finish_reason === undefined ? [] : [message.finish_reason],
  );
  return defined({
    'gen_ai.response.id': asString(body.responseId),
    'gen_ai.response.model': asString(body.modelVersion),
    'gen_ai.response.finish_reasons': reasons.length > 0 ? reasons : undefined,
    ...usage(body.usageMetadata),
    'gen_ai.output.messages': messages.length > 0 ? messages : undefined,
  });
}

export const geminiReader: ApiReader = {
  api: 'gemini',

  request({pathname, body}: ReadRequest) {
    const match = GEMINI_PATH.exec(pathname);
    const record = isRecord(body) ? body : {};
    const config = isRecord(record.generationConfig) ? record.generationConfig : {};
    const system = isRecord(record.systemInstruction)
      ? parts(record.systemInstruction.parts)
      : undefined;
    const messages = asArray(record.contents).flatMap(content =>
      isRecord(content) ? [{role: role(content.role), parts: parts(content.parts)}] : [],
    );
    const mimeType = asString(config.responseMimeType);
    return defined({
      'gen_ai.operation.name': 'generate_content',
      'gen_ai.provider.name': 'gcp.gemini',
      'gen_ai.request.model': match?.[1],
      'gen_ai.request.stream': match?.[2] === 'streamGenerateContent',
      'gen_ai.request.temperature': asNumber(config.temperature),
      'gen_ai.request.top_p': asNumber(config.topP),
      'gen_ai.request.top_k': asInteger(config.topK),
      'gen_ai.request.max_tokens': asInteger(config.maxOutputTokens),
      'gen_ai.request.stop_sequences': asStringArray(config.stopSequences),
      'gen_ai.request.choice.count': asInteger(config.candidateCount),
      'gen_ai.request.seed': asInteger(config.seed),
      'gen_ai.request.frequency_penalty': asNumber(config.frequencyPenalty),
      'gen_ai.request.presence_penalty': asNumber(config.presencePenalty),
      'gen_ai.output.type':
        mimeType === undefined
          ? undefined
          : /json/i.test(mimeType)
            ? 'json'
            : /^text\//i.test(mimeType)
              ? 'text'
              : mimeType,
      'gen_ai.system_instructions': system !== undefined && system.length > 0 ? system : undefined,
      'gen_ai.input.messages': messages.length > 0 ? messages : undefined,
      'gen_ai.tool.definitions': tools(record.tools),
    });
  },

  response(body: unknown) {
    if (!isRecord(body)) return {};
    const messages = asArray(body.candidates).flatMap(candidate =>
      isRecord(candidate) ? [candidateMessage(candidate)] : [],
    );
    return responseAttributes(body, messages);
  },

  stream(chunks: StreamChunk[]) {
    const merged: Record<string, unknown> = {};
    const candidates = new Map<
      number,
      {parts: GenAiPart[]; finishReason?: unknown; text?: string}
    >();
    let error: StreamError | undefined;
    for (const {data} of chunks) {
      if (!isRecord(data)) continue;
      if (isRecord(data.error)) {
        error ??= {
          type: asString(data.error.status) ?? String(data.error.code ?? 'error'),
          message: asString(data.error.message),
        };
        continue;
      }
      for (const key of ['responseId', 'modelVersion', 'usageMetadata']) {
        if (data[key] !== undefined) merged[key] = data[key];
      }
      for (const candidate of asArray(data.candidates)) {
        if (!isRecord(candidate)) continue;
        const index = asInteger(candidate.index) ?? 0;
        const slot = candidates.get(index) ?? {parts: []};
        candidates.set(index, slot);
        const content = isRecord(candidate.content) ? candidate.content : {};
        for (const part of parts(content.parts)) {
          const last = slot.parts[slot.parts.length - 1];
          // Text arrives in pieces; the pieces of one text part are one part.
          if (part.type === 'text' && last?.type === 'text') {
            last.content = `${String(last.content)}${String(part.content)}`;
          } else {
            slot.parts.push(part);
          }
        }
        if (candidate.finishReason !== undefined) slot.finishReason = candidate.finishReason;
      }
    }
    const messages = [...candidates.entries()]
      .sort(([a], [b]) => a - b)
      .map(([, slot]) =>
        defined({
          role: 'assistant',
          parts: slot.parts,
          finish_reason: finishReason(slot.finishReason),
        }),
      );
    return {attributes: responseAttributes(merged, messages), ...(error && {error})};
  },

  errorMessage(body: unknown) {
    return isRecord(body) && isRecord(body.error) ? asString(body.error.message) : undefined;
  },
};
