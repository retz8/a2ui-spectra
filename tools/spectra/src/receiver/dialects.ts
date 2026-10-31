/**
 * Each producer's dialect, read off the span, and the record's names its
 * reader translates: ADK's own `gcp.vertex.agent.*` names, OpenInference's
 * `llm.*` and `input.value` names, and the current GenAI conventions. A
 * span's attached log records are read with it. Every reader writes beside
 * the received attributes and never in place of them.
 */
import {asArray, asInteger, asNumber, asString, defined, isRecord} from '../model_proxy/genai.js';
import {geminiReader} from '../model_proxy/readers/gemini.js';
import {openAiChatReader} from '../model_proxy/readers/openai_chat.js';
import {CACHE_CREATION_NAME, isConventionName, isContentName, parsedJson} from './genai.js';
import type {ReceivedLog, ReceivedSpan} from './otlp.js';

export type Dialect = 'adk' | 'openinference' | 'genai';

/** The record's kinds a received span may be. */
export type ReceivedKind = 'model_call' | 'tool_call' | 'framework_span';

/** What a reader makes of a span and its attached logs. */
export interface Reading {
  dialect?: Dialect;
  kind: ReceivedKind;
  /** The translated names, before they are fitted to the record's types and schemas. */
  names: Record<string, unknown>;
}

const ADK_SCOPE = 'gcp.vertex.agent';

/** A span's dialect: ADK by its scope, OpenInference by its span kind, the conventions by their operation. */
export function dialectOf(span: ReceivedSpan): Dialect | undefined {
  if (span.scope.name === ADK_SCOPE) return 'adk';
  if (span.attributes['openinference.span.kind'] !== undefined) return 'openinference';
  if (span.attributes['gen_ai.operation.name'] !== undefined) return 'genai';
  return undefined;
}

const INFERENCE_OPERATIONS = new Set(['chat', 'generate_content', 'text_completion', 'embeddings']);

/** The kind a span is, by its dialect's own operation marker. */
export function kindOf(span: ReceivedSpan, dialect: Dialect | undefined): ReceivedKind {
  switch (dialect) {
    case 'adk':
      if (span.name === 'call_llm' || /^generate_content(?: |$)/.test(span.name)) {
        return 'model_call';
      }
      return /^execute_tool(?: |$)/.test(span.name) ? 'tool_call' : 'framework_span';
    case 'openinference': {
      const kind = span.attributes['openinference.span.kind'];
      if (kind === 'LLM' || kind === 'EMBEDDING') return 'model_call';
      return kind === 'TOOL' ? 'tool_call' : 'framework_span';
    }
    case 'genai': {
      const operation = span.attributes['gen_ai.operation.name'];
      if (typeof operation === 'string' && INFERENCE_OPERATIONS.has(operation)) {
        return 'model_call';
      }
      return operation === 'execute_tool' ? 'tool_call' : 'framework_span';
    }
    default:
      return 'framework_span';
  }
}

/** Reads a span and its attached logs in its dialect. */
export function readSpan(span: ReceivedSpan, logs: readonly ReceivedLog[]): Reading {
  const dialect = dialectOf(span);
  const kind = kindOf(span, dialect);
  let names: Record<string, unknown>;
  switch (dialect) {
    case 'adk':
      names = readAdk(span, kind, logs);
      break;
    case 'openinference':
      names = readOpenInference(span, kind);
      break;
    case 'genai':
      names = readConventions(span.attributes, logs);
      break;
    default:
      names = {};
  }
  return {...(dialect !== undefined && {dialect}), kind, names: withCacheWrite(names, span)};
}

/** The pinned conventions' cache write name, read from the name the Python conventions package writes. */
function withCacheWrite(
  names: Record<string, unknown>,
  span: ReceivedSpan,
): Record<string, unknown> {
  const creation = names[CACHE_CREATION_NAME] ?? span.attributes[CACHE_CREATION_NAME];
  const result = {...names};
  delete result[CACHE_CREATION_NAME];
  if (result['gen_ai.usage.cache_write.input_tokens'] === undefined && creation !== undefined) {
    result['gen_ai.usage.cache_write.input_tokens'] = creation;
  }
  return result;
}

// The pinned conventions, as written.

/** Every name the pinned conventions define, as written, from a set of attributes. */
function conventionNames(attributes: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(attributes).filter(([name]) => isConventionName(name)));
}

/** The last log record of an event name; the operation details come once per call. */
function lastLog(logs: readonly ReceivedLog[], eventName: string): ReceivedLog | undefined {
  return [...logs].reverse().find(log => log.eventName === eventName);
}

const DETAILS_EVENT = 'gen_ai.client.inference.operation.details';

/**
 * The current conventions: every name they define as written, `gen_ai.system`
 * standing for the provider when there is none, and the content from the
 * operation details log record or from the older per-message log records.
 */
function readConventions(
  attributes: Record<string, unknown>,
  logs: readonly ReceivedLog[],
): Record<string, unknown> {
  const names = conventionNames(attributes);
  if (names['gen_ai.provider.name'] === undefined && attributes['gen_ai.system'] !== undefined) {
    names['gen_ai.provider.name'] = attributes['gen_ai.system'];
  }
  if (attributes[CACHE_CREATION_NAME] !== undefined) {
    names[CACHE_CREATION_NAME] = attributes[CACHE_CREATION_NAME];
  }
  for (const [name, value] of Object.entries(names)) {
    if (isContentName(name)) names[name] = parsedJson(value);
  }
  Object.assign(names, messageLogs(logs));
  const details = lastLog(logs, DETAILS_EVENT);
  if (details !== undefined) {
    for (const [name, value] of Object.entries(conventionNames(details.attributes))) {
      names[name] = isContentName(name) ? parsedJson(value) : value;
    }
  }
  return names;
}

// The per-message log records: `gen_ai.{role}.message` and `gen_ai.choice`.

const MESSAGE_EVENT = /^gen_ai\.(system|user|assistant|tool)\.message$/;
const ELIDED = '<elided>';

/** A Gemini content, as the API writes it or as a Python dump does, in snake case with nulls. */
function isGeminiContent(value: unknown): value is Record<string, unknown> {
  return isRecord(value) && Array.isArray(value.parts);
}

/** The parts a log body's `content` holds, from a Gemini content, a list of OpenAI parts, or a text. */
function bodyParts(content: unknown): Array<Record<string, unknown>> {
  if (typeof content === 'string') {
    return content === ELIDED ? [] : [{type: 'text', content}];
  }
  if (isGeminiContent(content)) return geminiParts(content);
  if (Array.isArray(content)) {
    return content.flatMap(part => {
      if (typeof part === 'string') return [{type: 'text', content: part}];
      if (isRecord(part) && typeof part.text === 'string') {
        return [{type: 'text', content: part.text}];
      }
      return isRecord(part) && typeof part.type === 'string' ? [part] : [];
    });
  }
  return [];
}

/** OpenAI's tool calls in a log body, as tool call parts. */
function bodyToolCalls(value: unknown): Array<Record<string, unknown>> {
  return asArray(value).flatMap(call => {
    if (!isRecord(call)) return [];
    const fn = isRecord(call.function) ? call.function : {};
    return [
      defined({
        type: 'tool_call',
        id: asString(call.id),
        name: asString(fn.name) ?? '',
        arguments: parsedJson(fn.arguments),
      }),
    ];
  });
}

/** One per-message log record as a message, or nothing when its content was not captured. */
function messageOfLog(
  role: string,
  body: Record<string, unknown>,
): Record<string, unknown> | undefined {
  const content = body.content;
  if (content === ELIDED) return undefined;
  if (isGeminiContent(content)) {
    const message = geminiMessage(content);
    return message.parts.length > 0 ? message : undefined;
  }
  const parts =
    role === 'tool'
      ? [defined({type: 'tool_call_response', id: asString(body.id), response: content})]
      : [...bodyParts(content), ...bodyToolCalls(body.tool_calls)];
  return parts.length > 0 ? {role: asString(body.role) ?? role, parts} : undefined;
}

/**
 * The content of the older per-message log records, in arrival order: the
 * system message's as the system instructions, the others' as the input
 * messages, and each `gen_ai.choice` as an output message.
 */
function messageLogs(logs: readonly ReceivedLog[]): Record<string, unknown> {
  const system: Array<Record<string, unknown>> = [];
  const input: Array<Record<string, unknown>> = [];
  const output: Array<Record<string, unknown>> = [];
  for (const log of logs) {
    const body = isRecord(log.body) ? log.body : undefined;
    if (log.eventName === undefined || body === undefined) continue;
    const role = MESSAGE_EVENT.exec(log.eventName)?.[1];
    if (role === 'system') {
      system.push(...bodyParts(body.content));
    } else if (role !== undefined) {
      const message = messageOfLog(role, body);
      if (message !== undefined) input.push(message);
    } else if (log.eventName === 'gen_ai.choice') {
      const source = isRecord(body.message) ? body.message : body;
      const message = messageOfLog('assistant', source);
      if (message === undefined) continue;
      const reason = asString(body.finish_reason);
      output.push(defined({...message, finish_reason: reason}));
    }
  }
  return defined({
    'gen_ai.system_instructions': system.length > 0 ? system : undefined,
    'gen_ai.input.messages': input.length > 0 ? input : undefined,
    'gen_ai.output.messages': output.length > 0 ? output : undefined,
  });
}

// ADK.

/** A Python dump's key, in snake case, as the Gemini API's camel case. */
function camel(key: string): string {
  return key.replace(/_([a-z0-9])/g, (_, letter: string) => letter.toUpperCase());
}

/** An object with its keys in camel case and its nulls dropped, one level deep. */
function camelKeys(value: unknown): Record<string, unknown> {
  if (!isRecord(value)) return {};
  return Object.fromEntries(
    Object.entries(value)
      .filter(([, item]) => item !== null && item !== undefined)
      .map(([key, item]) => [camel(key), item]),
  );
}

/** Keys whose values are the model's or the tool's own data, kept as they are. */
const OPAQUE = new Set([
  'args',
  'response',
  'parameters',
  'parametersJsonSchema',
  'responseJsonSchema',
]);

/** A Gemini part, from a Python dump or the API, in the API's camel case. */
function apiPart(value: unknown): Record<string, unknown> {
  const part = camelKeys(value);
  for (const [key, item] of Object.entries(part)) {
    if (isRecord(item) && !OPAQUE.has(key)) {
      const nested = camelKeys(item);
      for (const opaque of OPAQUE) {
        const raw = isRecord(item) ? (item[opaque] ?? item[snake(opaque)]) : undefined;
        if (raw !== undefined && raw !== null) nested[opaque] = raw;
      }
      part[key] = nested;
    }
  }
  return part;
}

function snake(key: string): string {
  return key.replace(/[A-Z]/g, letter => `_${letter.toLowerCase()}`);
}

/** A Gemini content in the API's shape. */
function apiContent(value: unknown): Record<string, unknown> {
  const content = camelKeys(value);
  return {...content, parts: asArray(content.parts).map(apiPart)};
}

/** A Gemini content's parts as GenAI parts, read by the model proxy's Gemini reader. */
function geminiParts(content: Record<string, unknown>): Array<Record<string, unknown>> {
  const read = geminiReader.request({
    pathname: '/v1beta/models/m:generateContent',
    search: new URLSearchParams(),
    body: {contents: [apiContent(content)]},
  })['gen_ai.input.messages'];
  const [message] = asArray(read);
  return isRecord(message) ? (asArray(message.parts) as Array<Record<string, unknown>>) : [];
}

/** A Gemini content as a GenAI message, its role read as the model proxy reads it. */
function geminiMessage(content: Record<string, unknown>): {
  role: string;
  parts: Array<Record<string, unknown>>;
} {
  const role = content.role === 'model' ? 'assistant' : (asString(content.role) ?? 'user');
  return {role, parts: geminiParts(content)};
}

/** A system instruction as ADK's config holds it: a text, a content, or a list of either. */
function systemInstruction(value: unknown): Record<string, unknown> | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value === 'string') return {parts: [{text: value}]};
  if (Array.isArray(value)) {
    return {
      parts: value.flatMap(item =>
        typeof item === 'string'
          ? [{text: item}]
          : isGeminiContent(item)
            ? asArray(apiContent(item).parts)
            : [apiPart(item)],
      ),
    };
  }
  return isGeminiContent(value) ? apiContent(value) : undefined;
}

const GENERATION_SETTINGS = [
  'temperature',
  'topP',
  'topK',
  'candidateCount',
  'maxOutputTokens',
  'stopSequences',
  'presencePenalty',
  'frequencyPenalty',
  'seed',
  'responseMimeType',
];

/** ADK's `llm_request`, `{model, config, contents}`, as a Gemini API request body. */
function geminiRequestOf(request: Record<string, unknown>): Record<string, unknown> {
  const config = camelKeys(request.config);
  const generationConfig = Object.fromEntries(
    GENERATION_SETTINGS.filter(key => config[key] !== undefined).map(key => [key, config[key]]),
  );
  const tools = asArray(config.tools).map(tool => {
    const camelTool = camelKeys(tool);
    return {
      ...camelTool,
      ...(camelTool.functionDeclarations !== undefined && {
        functionDeclarations: asArray(camelTool.functionDeclarations).map(apiPart),
      }),
    };
  });
  return defined({
    contents: asArray(request.contents).map(apiContent),
    systemInstruction: systemInstruction(config.systemInstruction),
    tools: tools.length > 0 ? tools : undefined,
    generationConfig,
  });
}

/** The request's names the model proxy's Gemini reader reads that are the request's own: not the operation, the provider, the model or the stream. */
const ADK_REQUEST_NAMES = [
  'gen_ai.request.temperature',
  'gen_ai.request.top_p',
  'gen_ai.request.top_k',
  'gen_ai.request.max_tokens',
  'gen_ai.request.stop_sequences',
  'gen_ai.request.choice.count',
  'gen_ai.request.seed',
  'gen_ai.request.frequency_penalty',
  'gen_ai.request.presence_penalty',
  'gen_ai.output.type',
  'gen_ai.system_instructions',
  'gen_ai.input.messages',
  'gen_ai.tool.definitions',
];

/** ADK's `llm_response`, an `LlmResponse` dump, as its output message. */
function adkOutput(response: Record<string, unknown>): Record<string, unknown> {
  const camelResponse = camelKeys(response);
  if (!isGeminiContent(camelResponse.content)) return {};
  const read = geminiReader.response({
    candidates: [
      defined({
        content: apiContent(camelResponse.content),
        finishReason: asString(camelResponse.finishReason),
      }),
    ],
  });
  return defined({'gen_ai.output.messages': read['gen_ai.output.messages']});
}

const GEMINI_SYSTEMS: Readonly<Record<string, string>> = {
  gemini: 'gcp.gemini',
  vertex_ai: 'gcp.vertex_ai',
};

/**
 * ADK, as tested at 2.3.0: `call_llm`'s content from its own request and
 * response attributes; `generate_content {model}`'s from the conventions'
 * names under the opt-in, else from the per-message log records; the tool's
 * arguments and result from its own attributes; the `gen_ai.` names as written.
 */
function readAdk(
  span: ReceivedSpan,
  kind: ReceivedKind,
  logs: readonly ReceivedLog[],
): Record<string, unknown> {
  const attributes = span.attributes;
  const names = conventionNames(attributes);
  if (attributes[CACHE_CREATION_NAME] !== undefined) {
    names[CACHE_CREATION_NAME] = attributes[CACHE_CREATION_NAME];
  }
  const sessionId = asString(attributes['gcp.vertex.agent.session_id']);
  if (names['gen_ai.conversation.id'] === undefined && sessionId !== undefined) {
    names['gen_ai.conversation.id'] = sessionId;
  }
  // `gen_ai.system` on `call_llm` is the literal `gcp.vertex.agent`, which names no provider.
  const system = asString(attributes['gen_ai.system']);
  if (
    names['gen_ai.provider.name'] === undefined &&
    system !== undefined &&
    GEMINI_SYSTEMS[system]
  ) {
    names['gen_ai.provider.name'] = GEMINI_SYSTEMS[system];
  }
  if (kind === 'model_call' && span.name === 'call_llm') {
    const request = parsedJson(attributes['gcp.vertex.agent.llm_request']);
    if (isRecord(request)) {
      const read = geminiReader.request({
        pathname: '/v1beta/models/m:generateContent',
        search: new URLSearchParams(),
        body: geminiRequestOf(request),
      });
      for (const name of ADK_REQUEST_NAMES) {
        if (read[name] !== undefined) names[name] = read[name];
      }
    }
    const response = parsedJson(attributes['gcp.vertex.agent.llm_response']);
    if (isRecord(response)) Object.assign(names, adkOutput(response));
  } else if (kind === 'model_call') {
    for (const [name, value] of Object.entries(names)) {
      if (isContentName(name)) names[name] = parsedJson(value);
    }
    Object.assign(names, messageLogs(logs));
    const details = lastLog(logs, DETAILS_EVENT);
    if (details !== undefined) {
      for (const [name, value] of Object.entries(conventionNames(details.attributes))) {
        names[name] = isContentName(name) ? parsedJson(value) : value;
      }
    }
  } else if (kind === 'tool_call') {
    const args = parsedJson(attributes['gcp.vertex.agent.tool_call_args']);
    if (args !== undefined) names['gen_ai.tool.call.arguments'] = args;
    const result = parsedJson(attributes['gcp.vertex.agent.tool_response']);
    if (result !== undefined) names['gen_ai.tool.call.result'] = result;
  }
  return names;
}

// OpenInference.

const OPENINFERENCE_PROVIDERS: Readonly<Record<string, string>> = {
  openai: 'openai',
  anthropic: 'anthropic',
  cohere: 'cohere',
  mistralai: 'mistral',
  google: 'gcp.gen_ai',
  azure: 'azure.ai.openai',
  aws: 'aws.bedrock',
  xai: 'x_ai',
  deepseek: 'deepseek',
  groq: 'groq',
  perplexity: 'perplexity',
  moonshot: 'moonshot_ai',
};

/** OpenInference's flattened `{prefix}.{i}.{rest}` attributes, as one object per index. */
function flattened(
  attributes: Record<string, unknown>,
  prefix: string,
): Array<Record<string, unknown>> {
  const items = new Map<number, Record<string, unknown>>();
  const pattern = new RegExp(`^${prefix.replaceAll('.', '\\.')}\\.(\\d+)\\.(.+)$`);
  for (const [name, value] of Object.entries(attributes)) {
    const match = pattern.exec(name);
    if (match === null) continue;
    const index = Number(match[1]);
    const item = items.get(index) ?? {};
    item[match[2]] = value;
    items.set(index, item);
  }
  return [...items.entries()].sort(([a], [b]) => a - b).map(([, item]) => item);
}

/** One flattened message as an OpenAI Chat Completions message. */
function chatMessage(message: Record<string, unknown>): Record<string, unknown> {
  const contents = flattened(message, 'message.contents').flatMap(
    (content): Array<Record<string, unknown>> => {
      const type = asString(content['message_content.type']);
      if (type === 'text')
        return [{type: 'text', text: asString(content['message_content.text']) ?? ''}];
      if (type === 'image') {
        return [
          {
            type: 'image_url',
            image_url: {url: asString(content['message_content.image.image.url']) ?? ''},
          },
        ];
      }
      return [];
    },
  );
  const toolCalls = flattened(message, 'message.tool_calls').map(call =>
    defined({
      id: asString(call['tool_call.id']),
      type: 'function',
      function: {
        name: asString(call['tool_call.function.name']) ?? '',
        arguments: call['tool_call.function.arguments'],
      },
    }),
  );
  return defined({
    role: asString(message['message.role']),
    content: message['message.content'] ?? (contents.length > 0 ? contents : undefined),
    name: asString(message['message.name']),
    tool_call_id: asString(message['message.tool_call_id']),
    tool_calls: toolCalls.length > 0 ? toolCalls : undefined,
  });
}

/** OpenInference's invocation parameters, as the Chat Completions request's settings. */
function invocationSettings(value: unknown): Record<string, unknown> {
  const parameters = parsedJson(value);
  if (!isRecord(parameters)) return {};
  const read = defined({
    temperature: asNumber(parameters.temperature),
    top_p: asNumber(parameters.top_p),
    top_k: asInteger(parameters.top_k),
    max_tokens: asInteger(parameters.max_tokens),
    max_completion_tokens: asInteger(parameters.max_completion_tokens),
    stop: parameters.stop,
    seed: asInteger(parameters.seed),
    n: asInteger(parameters.n),
    frequency_penalty: asNumber(parameters.frequency_penalty),
    presence_penalty: asNumber(parameters.presence_penalty),
    stream: typeof parameters.stream === 'boolean' ? parameters.stream : undefined,
    response_format: parameters.response_format,
  });
  return read;
}

/**
 * OpenInference, as tested with its LiteLLM instrumentation at 0.1.52: an
 * LLM span's names read from its model, provider, token counts, invocation
 * parameters, flattened messages and tools, the messages read through the
 * model proxy's Chat Completions reader; a TOOL span's name, input and output.
 */
function readOpenInference(span: ReceivedSpan, kind: ReceivedKind): Record<string, unknown> {
  const attributes = span.attributes;
  if (kind === 'tool_call') {
    return defined({
      'gen_ai.tool.name': attributes['tool.name'],
      'gen_ai.tool.call.arguments': parsedJson(attributes['input.value']),
      'gen_ai.tool.call.result': parsedJson(attributes['output.value']),
    });
  }
  if (kind !== 'model_call') return {};
  const embedding = attributes['openinference.span.kind'] === 'EMBEDDING';
  const provider = asString(attributes['llm.provider']);
  const settings = invocationSettings(attributes['llm.invocation_parameters']);
  const tools = flattened(attributes, 'llm.tools').flatMap(tool => {
    const schema = parsedJson(tool['tool.json_schema']);
    return isRecord(schema) ? [schema] : [];
  });
  const request = openAiChatReader.request({
    pathname: '/v1/chat/completions',
    search: new URLSearchParams(),
    body: {
      ...settings,
      messages: flattened(attributes, 'llm.input_messages').map(chatMessage),
      ...(tools.length > 0 && {tools}),
    },
  });
  const outputs = flattened(attributes, 'llm.output_messages');
  const finishReason = asString(attributes['llm.finish_reason']);
  const response =
    outputs.length === 0
      ? {}
      : openAiChatReader.response({
          choices: outputs.map((message, index) =>
            defined({
              index,
              message: chatMessage(message),
              finish_reason: index === 0 ? finishReason : undefined,
            }),
          ),
        });
  return defined({
    'gen_ai.operation.name': embedding ? 'embeddings' : 'chat',
    'gen_ai.request.model':
      attributes['llm.model_name'] ?? (embedding ? attributes['embedding.model_name'] : undefined),
    'gen_ai.provider.name':
      provider === undefined ? undefined : (OPENINFERENCE_PROVIDERS[provider] ?? provider),
    'gen_ai.usage.input_tokens': attributes['llm.token_count.prompt'],
    'gen_ai.usage.output_tokens': attributes['llm.token_count.completion'],
    'gen_ai.usage.cache_read.input_tokens': attributes['llm.token_count.prompt_details.cache_read'],
    'gen_ai.usage.cache_write.input_tokens':
      attributes['llm.token_count.prompt_details.cache_write'],
    'gen_ai.usage.reasoning.output_tokens':
      attributes['llm.token_count.completion_details.reasoning'],
    'gen_ai.request.temperature': request['gen_ai.request.temperature'],
    'gen_ai.request.top_p': request['gen_ai.request.top_p'],
    'gen_ai.request.top_k': settings.top_k,
    'gen_ai.request.max_tokens': request['gen_ai.request.max_tokens'],
    'gen_ai.request.stop_sequences': request['gen_ai.request.stop_sequences'],
    'gen_ai.request.seed': request['gen_ai.request.seed'],
    'gen_ai.request.choice.count': request['gen_ai.request.choice.count'],
    'gen_ai.request.frequency_penalty': request['gen_ai.request.frequency_penalty'],
    'gen_ai.request.presence_penalty': request['gen_ai.request.presence_penalty'],
    'gen_ai.request.stream': settings.stream,
    'gen_ai.output.type': request['gen_ai.output.type'],
    'gen_ai.system_instructions': request['gen_ai.system_instructions'],
    'gen_ai.input.messages': request['gen_ai.input.messages'],
    'gen_ai.tool.definitions': request['gen_ai.tool.definitions'],
    'gen_ai.output.messages': response['gen_ai.output.messages'],
    'gen_ai.response.finish_reasons': response['gen_ai.response.finish_reasons'],
  });
}
