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

/**
 * How a body's fields are spelled. A request is read in both spellings, the
 * camel case and the snake case, as the Gemini API takes either: google-genai
 * sends `parameters_json_schema`, LiteLLM `system_instruction`,
 * `function_declarations`, `function_call` and `function_response`. A
 * response is read in camel case, as the API answers.
 */
type Spelling = 'request' | 'response';

/** A field's snake-case spelling: `systemInstruction` as `system_instruction`. */
function snakeCase(name: string): string {
  return name.replace(/[A-Z]/g, letter => `_${letter.toLowerCase()}`);
}

/** A field by its camel-case name, else, in a request, by its snake-case one. */
function field(record: Record<string, unknown>, name: string, spelling: Spelling): unknown {
  return record[name] ?? (spelling === 'request' ? record[snakeCase(name)] : undefined);
}

/** A field that holds an object, in the spellings `field` reads. */
function recordField(
  record: Record<string, unknown>,
  name: string,
  spelling: Spelling,
): Record<string, unknown> | undefined {
  const value = field(record, name, spelling);
  return isRecord(value) ? value : undefined;
}

/** The fields of a part that are no part of its content. */
const PART_FLAGS = new Set(['thought', 'thoughtSignature', 'thought_signature']);

/** A content's parts in GenAI's shapes. */
function parts(value: unknown, spelling: Spelling): GenAiPart[] {
  return asArray(value).flatMap(part => {
    if (!isRecord(part)) return [];
    if (typeof part.text === 'string') {
      return [part.thought === true ? reasoningPart(part.text) : textPart(part.text)];
    }
    const call = recordField(part, 'functionCall', spelling);
    if (call !== undefined) {
      return [toolCallPart(asString(call.id), asString(call.name) ?? '', call.args)];
    }
    const response = recordField(part, 'functionResponse', spelling);
    if (response !== undefined) {
      return [
        defined({
          ...toolCallResponsePart(asString(response.id), response.response),
          name: asString(response.name),
        }),
      ];
    }
    const inline = recordField(part, 'inlineData', spelling);
    if (inline !== undefined) {
      return [blobPart(asString(field(inline, 'mimeType', spelling)), asString(inline.data) ?? '')];
    }
    const file = recordField(part, 'fileData', spelling);
    if (file !== undefined) {
      return [
        uriPart(
          asString(field(file, 'mimeType', spelling)),
          asString(field(file, 'fileUri', spelling)) ?? '',
        ),
      ];
    }
    const [key] = Object.keys(part).filter(name => !PART_FLAGS.has(name));
    return [{type: key ?? 'unknown', content: part}];
  });
}

function role(value: unknown): string {
  return value === 'model' ? 'assistant' : (asString(value) ?? 'user');
}

/** A tool's key for its function declarations, in both spellings. */
const DECLARATIONS = new Set(['functionDeclarations', 'function_declarations']);

function tools(value: unknown): GenAiPart[] | undefined {
  const definitions = asArray(value).flatMap(tool => {
    if (!isRecord(tool)) return [];
    const functions = asArray(field(tool, 'functionDeclarations', 'request')).flatMap(
      declaration =>
        isRecord(declaration)
          ? [
              defined({
                type: 'function',
                name: asString(declaration.name) ?? '',
                description: asString(declaration.description),
                parameters:
                  declaration.parameters ?? field(declaration, 'parametersJsonSchema', 'request'),
              }),
            ]
          : [],
    );
    const others = Object.keys(tool)
      .filter(key => !DECLARATIONS.has(key))
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
    parts: parts(content.parts, 'response'),
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
    const config = recordField(record, 'generationConfig', 'request') ?? {};
    const setting = (name: string) => field(config, name, 'request');
    const instruction = recordField(record, 'systemInstruction', 'request');
    const system = instruction === undefined ? undefined : parts(instruction.parts, 'request');
    const messages = asArray(record.contents).flatMap(content =>
      isRecord(content) ? [{role: role(content.role), parts: parts(content.parts, 'request')}] : [],
    );
    const mimeType = asString(setting('responseMimeType'));
    return defined({
      'gen_ai.operation.name': 'generate_content',
      'gen_ai.provider.name': 'gcp.gemini',
      'gen_ai.request.model': match?.[1],
      'gen_ai.request.stream': match?.[2] === 'streamGenerateContent',
      'gen_ai.request.temperature': asNumber(setting('temperature')),
      'gen_ai.request.top_p': asNumber(setting('topP')),
      'gen_ai.request.top_k': asInteger(setting('topK')),
      'gen_ai.request.max_tokens': asInteger(setting('maxOutputTokens')),
      'gen_ai.request.stop_sequences': asStringArray(setting('stopSequences')),
      'gen_ai.request.choice.count': asInteger(setting('candidateCount')),
      'gen_ai.request.seed': asInteger(setting('seed')),
      'gen_ai.request.frequency_penalty': asNumber(setting('frequencyPenalty')),
      'gen_ai.request.presence_penalty': asNumber(setting('presencePenalty')),
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
        for (const part of parts(content.parts, 'response')) {
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
