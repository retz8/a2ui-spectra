/**
 * What every dialect's reader shares: the names the pinned GenAI conventions
 * define, the record's types for the names it types, the content attributes
 * validated against the copied GenAI schemas, and finish reasons normalised
 * as the model proxy's readers normalise them. A value that does not fit is
 * left out of the GenAI attribute; it stays in `a2ui.received.attributes`.
 */
import {Ajv2020, type AnySchemaObject, type ValidateFunction} from 'ajv/dist/2020.js';
import draft07 from 'ajv/dist/refs/json-schema-draft-07.json' with {type: 'json'};

import {type FinishReason, isRecord} from '../model_proxy/genai.js';
import {STOP_REASONS as ANTHROPIC_REASONS} from '../model_proxy/readers/anthropic.js';
import {FINISH_REASONS as GEMINI_REASONS} from '../model_proxy/readers/gemini.js';
import {FINISH_REASONS as OPENAI_REASONS} from '../model_proxy/readers/openai_chat.js';
import inputMessages from './genai_schemas/gen-ai-input-messages.json' with {type: 'json'};
import outputMessages from './genai_schemas/gen-ai-output-messages.json' with {type: 'json'};
import systemInstructions from './genai_schemas/gen-ai-system-instructions.json' with {type: 'json'};
import toolDefinitions from './genai_schemas/gen-ai-tool-definitions.json' with {type: 'json'};

/**
 * The attribute names the pinned conventions define, from `model/*\/registry.yaml`
 * of `open-telemetry/semantic-conventions-genai` at 8538971bd11dba723fdd33c804b5a32121827ff7,
 * and the core conventions' `error.type`. The genai dialect copies these as written.
 */
export const CONVENTION_NAMES: ReadonlySet<string> = new Set([
  'gen_ai.provider.name',
  'gen_ai.request.model',
  'gen_ai.request.max_tokens',
  'gen_ai.request.choice.count',
  'gen_ai.request.temperature',
  'gen_ai.request.top_p',
  'gen_ai.request.top_k',
  'gen_ai.request.stop_sequences',
  'gen_ai.request.frequency_penalty',
  'gen_ai.request.presence_penalty',
  'gen_ai.request.encoding_formats',
  'gen_ai.request.seed',
  'gen_ai.request.stream',
  'gen_ai.request.reasoning.level',
  'gen_ai.request.previous_response.id',
  'gen_ai.request.stream_cursor',
  'gen_ai.response.id',
  'gen_ai.response.model',
  'gen_ai.response.finish_reasons',
  'gen_ai.response.status',
  'gen_ai.response.time_to_first_chunk',
  'gen_ai.usage.input_tokens',
  'gen_ai.usage.cache_read.input_tokens',
  'gen_ai.usage.cache_write.input_tokens',
  'gen_ai.usage.text.input_tokens',
  'gen_ai.usage.image.input_tokens',
  'gen_ai.usage.audio.input_tokens',
  'gen_ai.usage.output_tokens',
  'gen_ai.usage.reasoning.output_tokens',
  'gen_ai.usage.text.output_tokens',
  'gen_ai.usage.image.output_tokens',
  'gen_ai.usage.audio.output_tokens',
  'gen_ai.usage.text.cache_read.input_tokens',
  'gen_ai.usage.image.cache_read.input_tokens',
  'gen_ai.usage.audio.cache_read.input_tokens',
  'gen_ai.token.modality',
  'gen_ai.conversation.id',
  'gen_ai.conversation.compacted',
  'gen_ai.agent.id',
  'gen_ai.agent.name',
  'gen_ai.agent.description',
  'gen_ai.agent.version',
  'gen_ai.main_agent.id',
  'gen_ai.main_agent.name',
  'gen_ai.main_agent.description',
  'gen_ai.tool.name',
  'gen_ai.tool.call.id',
  'gen_ai.tool.description',
  'gen_ai.tool.type',
  'gen_ai.tool.call.arguments',
  'gen_ai.tool.call.result',
  'gen_ai.tool.definitions',
  'gen_ai.data_source.id',
  'gen_ai.operation.name',
  'gen_ai.output.type',
  'gen_ai.embeddings.dimension.count',
  'gen_ai.retrieval.documents',
  'gen_ai.retrieval.query.text',
  'gen_ai.retrieval.top_k',
  'gen_ai.memory.store.id',
  'gen_ai.memory.record.id',
  'gen_ai.memory.record.count',
  'gen_ai.memory.query.text',
  'gen_ai.memory.records',
  'gen_ai.system_instructions',
  'gen_ai.input.messages',
  'gen_ai.output.messages',
  'gen_ai.evaluation.name',
  'gen_ai.evaluation.score.value',
  'gen_ai.evaluation.score.label',
  'gen_ai.evaluation.explanation',
  'gen_ai.prompt.name',
  'gen_ai.prompt.version',
  'gen_ai.workflow.name',
  'gen_ai.skill.name',
  'gen_ai.skill.description',
  'gen_ai.skill.source.uri',
  'gen_ai.skill.resource.name',
  'mcp.method.name',
  'mcp.session.id',
  'mcp.resource.uri',
  'mcp.protocol.version',
  'openai.request.service_tier',
  'openai.api.type',
  'openai.response.service_tier',
  'openai.response.system_fingerprint',
  'error.type',
]);

/** Whether a name is one the pinned conventions define, `gen_ai.prompt.variable.<key>` included. */
export function isConventionName(name: string): boolean {
  return CONVENTION_NAMES.has(name) || name.startsWith('gen_ai.prompt.variable.');
}

/**
 * The name the Python conventions package, OpenLLMetry and LiteLLM write for
 * the pinned conventions' `gen_ai.usage.cache_write.input_tokens`.
 */
export const CACHE_CREATION_NAME = 'gen_ai.usage.cache_creation.input_tokens';

type Kind = 'string' | 'integer' | 'number' | 'boolean' | 'strings' | 'object';

/** The names the record types, on `model_call` and `tool_call`, with their types. */
const TYPED: Readonly<Record<string, Kind>> = {
  'gen_ai.operation.name': 'string',
  'gen_ai.provider.name': 'string',
  'gen_ai.request.model': 'string',
  'gen_ai.response.id': 'string',
  'gen_ai.response.model': 'string',
  'gen_ai.output.type': 'string',
  'gen_ai.conversation.id': 'string',
  'gen_ai.tool.name': 'string',
  'gen_ai.tool.call.id': 'string',
  'gen_ai.tool.type': 'string',
  'gen_ai.tool.description': 'string',
  'gen_ai.prompt.name': 'string',
  'gen_ai.agent.name': 'string',
  'mcp.method.name': 'string',
  'mcp.session.id': 'string',
  'mcp.protocol.version': 'string',
  'mcp.resource.uri': 'string',
  'error.type': 'string',
  'gen_ai.request.max_tokens': 'integer',
  'gen_ai.request.top_k': 'integer',
  'gen_ai.request.seed': 'integer',
  'gen_ai.request.choice.count': 'integer',
  'gen_ai.usage.input_tokens': 'integer',
  'gen_ai.usage.output_tokens': 'integer',
  'gen_ai.usage.cache_read.input_tokens': 'integer',
  'gen_ai.usage.cache_write.input_tokens': 'integer',
  'gen_ai.usage.reasoning.output_tokens': 'integer',
  'gen_ai.request.temperature': 'number',
  'gen_ai.request.top_p': 'number',
  'gen_ai.request.frequency_penalty': 'number',
  'gen_ai.request.presence_penalty': 'number',
  'gen_ai.response.time_to_first_chunk': 'number',
  'gen_ai.request.stream': 'boolean',
  'gen_ai.request.stop_sequences': 'strings',
  'gen_ai.response.finish_reasons': 'strings',
  'gen_ai.tool.call.arguments': 'object',
  'gen_ai.tool.call.result': 'object',
};

/** The content attributes, each validated against its copied schema. */
const CONTENT_SCHEMAS: Readonly<Record<string, AnySchemaObject>> = {
  'gen_ai.system_instructions': systemInstructions,
  'gen_ai.input.messages': inputMessages,
  'gen_ai.output.messages': outputMessages,
  'gen_ai.tool.definitions': toolDefinitions,
};

let validators: Map<string, ValidateFunction> | undefined;

/**
 * Compiled once, as the turn record's harness reads the copied schemas: as
 * draft 2020-12, with the draft-07 meta-schema the tool definitions
 * reference loaded and formats, such as the blob part's `binary`, unchecked.
 */
function validatorFor(name: string): ValidateFunction | undefined {
  if (validators === undefined) {
    const ajv = new Ajv2020({strict: false, validateFormats: false});
    ajv.addMetaSchema(draft07 as AnySchemaObject);
    validators = new Map(
      Object.entries(CONTENT_SCHEMAS).map(([key, schema]) => [key, ajv.compile(schema)]),
    );
  }
  return validators.get(name);
}

/** Whether a name is one of the content attributes the copied schemas define. */
export function isContentName(name: string): boolean {
  return name in CONTENT_SCHEMAS;
}

/** A value parsed when it arrives as a JSON string, as content attributes may on spans. */
export function parsedJson(value: unknown): unknown {
  if (typeof value !== 'string') return value;
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return value;
  }
}

function fitsKind(value: unknown, kind: Kind): boolean {
  switch (kind) {
    case 'string':
      return typeof value === 'string';
    case 'integer':
      return typeof value === 'number' && Number.isInteger(value);
    case 'number':
      return typeof value === 'number' && Number.isFinite(value);
    case 'boolean':
      return typeof value === 'boolean';
    case 'strings':
      return Array.isArray(value) && value.every(item => typeof item === 'string');
    case 'object':
      return isRecord(value);
  }
}

/**
 * The value a translated name carries in the record: a content attribute
 * parsed from a JSON string and kept when it fits its schema, a typed name
 * kept when it has the record's type, any other name as it is. Nothing for a
 * value that does not fit.
 */
export function fittedValue(name: string, value: unknown): unknown {
  if (value === undefined || value === null) return undefined;
  if (isContentName(name)) {
    const parsed = parsedJson(value);
    return validatorFor(name)?.(parsed) === true ? parsed : undefined;
  }
  const kind = TYPED[name];
  if (kind === 'object') {
    const parsed = parsedJson(value);
    return fitsKind(parsed, kind) ? parsed : undefined;
  }
  if (kind !== undefined) {
    return fitsKind(value, kind) ? value : undefined;
  }
  return value;
}

// Finish reasons.

const NORMALISED = new Set<string>([
  'stop',
  'length',
  'content_filter',
  'tool_call',
  'compaction',
  'error',
]);

/** The readers' maps, by the provider whose values they read; the order to try them in otherwise. */
function mapsFor(provider: string | undefined): Array<Record<string, FinishReason>> {
  const gemini = Object.fromEntries(
    Object.entries(GEMINI_REASONS).map(([key, value]) => [key.toLowerCase(), value]),
  );
  if (provider === 'gcp.gemini' || provider === 'gcp.vertex_ai' || provider === 'gcp.gen_ai') {
    return [gemini];
  }
  if (provider === 'openai' || provider?.startsWith('azure.') === true) return [OPENAI_REASONS];
  if (provider === 'anthropic') return [ANTHROPIC_REASONS];
  return [OPENAI_REASONS, ANTHROPIC_REASONS, gemini];
}

/**
 * A finish reason as the model proxy's readers normalise it: a value the
 * copied output-messages schema allows stays; a provider's own value is read
 * through that provider's reader's map, or through each reader's in turn
 * when the provider is unknown, Gemini's compared in lowercase; any other
 * value is `error`, as the readers have it.
 */
export function normaliseFinishReason(value: string, provider?: string): FinishReason {
  if (NORMALISED.has(value)) return value as FinishReason;
  for (const map of mapsFor(provider)) {
    const reason = map[value] ?? map[value.toLowerCase()];
    if (reason !== undefined) return reason;
  }
  return 'error';
}

/** The translated names with every finish reason normalised, in the response's list and in the output messages. */
export function withFinishReasonsNormalised(
  attributes: Record<string, unknown>,
): Record<string, unknown> {
  const provider =
    typeof attributes['gen_ai.provider.name'] === 'string'
      ? attributes['gen_ai.provider.name']
      : undefined;
  const result = {...attributes};
  // An empty reason, which ADK writes for a response with none, is no reason.
  const reasons = result['gen_ai.response.finish_reasons'];
  if (Array.isArray(reasons)) {
    const read = reasons
      .filter(reason => reason !== '')
      .map(reason =>
        typeof reason === 'string' ? normaliseFinishReason(reason, provider) : reason,
      );
    if (read.length > 0) {
      result['gen_ai.response.finish_reasons'] = read;
    } else {
      delete result['gen_ai.response.finish_reasons'];
    }
  } else if (typeof reasons === 'string') {
    if (reasons === '') {
      delete result['gen_ai.response.finish_reasons'];
    } else {
      result['gen_ai.response.finish_reasons'] = [normaliseFinishReason(reasons, provider)];
    }
  }
  const messages = parsedJson(result['gen_ai.output.messages']);
  if (Array.isArray(messages)) {
    result['gen_ai.output.messages'] = messages.map(message => {
      if (!isRecord(message) || typeof message.finish_reason !== 'string') return message;
      if (message.finish_reason === '') {
        const rest = {...message};
        delete rest.finish_reason;
        return rest;
      }
      return {...message, finish_reason: normaliseFinishReason(message.finish_reason, provider)};
    });
  }
  return result;
}
