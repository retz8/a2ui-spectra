/**
 * Which server-sent events of a stream carry output, for the time to the
 * first chunk as the pinned GenAI conventions define it: "a decoded provider
 * stream event carrying new, non-empty output: text, refusals, reasoning
 * (including opaque payloads), audio, images, or tool-call names or
 * arguments". An empty start event, and an event carrying only usage, roles,
 * ids, signatures, keep-alives, progress or status, or an end marker, is not
 * a chunk.
 */
import {isRecord} from '../genai.js';
import type {StreamChunk} from './reader.js';

function hasText(value: unknown): boolean {
  return typeof value === 'string' && value !== '';
}

/** Gemini: a candidate's part with text, thought text included, a function call, inline data, or code. */
export function geminiCarriesOutput({data}: StreamChunk): boolean {
  if (!isRecord(data) || !Array.isArray(data.candidates)) return false;
  return data.candidates.some(candidate => {
    const content = isRecord(candidate) && isRecord(candidate.content) ? candidate.content : {};
    const parts = Array.isArray(content.parts) ? content.parts : [];
    return parts.some(
      part =>
        isRecord(part) &&
        (hasText(part.text) ||
          isRecord(part.functionCall) ||
          isRecord(part.inlineData) ||
          isRecord(part.fileData) ||
          isRecord(part.executableCode) ||
          isRecord(part.codeExecutionResult)),
    );
  });
}

/** Chat Completions: a choice's delta with content, a refusal, audio, or a tool call's name or arguments. */
export function openAiChatCarriesOutput({data}: StreamChunk): boolean {
  if (!isRecord(data) || !Array.isArray(data.choices)) return false;
  return data.choices.some(choice => {
    const delta = isRecord(choice) && isRecord(choice.delta) ? choice.delta : {};
    const audio = isRecord(delta.audio) ? delta.audio : {};
    const calls = Array.isArray(delta.tool_calls) ? delta.tool_calls : [];
    return (
      hasText(delta.content) ||
      hasText(delta.refusal) ||
      hasText(audio.data) ||
      hasText(audio.transcript) ||
      calls.some(call => {
        const fn = isRecord(call) && isRecord(call.function) ? call.function : {};
        return hasText(fn.name) || hasText(fn.arguments);
      })
    );
  });
}

/** The Responses API's event types whose `delta` is output when it is not empty. */
const RESPONSES_DELTAS: ReadonlySet<string> = new Set([
  'response.output_text.delta',
  'response.refusal.delta',
  'response.reasoning_text.delta',
  'response.reasoning_summary_text.delta',
  'response.function_call_arguments.delta',
  'response.custom_tool_call_input.delta',
  'response.mcp_call_arguments.delta',
  'response.code_interpreter_call_code.delta',
  'response.audio.delta',
  'response.audio.transcript.delta',
]);

/**
 * The Responses API: a delta of text, a refusal, reasoning, audio or a tool
 * call's arguments; a partial image; an output item added that names a tool
 * call or carries an opaque reasoning payload.
 */
export function openAiResponsesCarriesOutput({data}: StreamChunk): boolean {
  if (!isRecord(data) || typeof data.type !== 'string') return false;
  if (RESPONSES_DELTAS.has(data.type)) return hasText(data.delta);
  if (data.type === 'response.image_generation_call.partial_image') {
    return hasText(data.partial_image_b64);
  }
  if (data.type === 'response.output_item.added') {
    const item = isRecord(data.item) ? data.item : {};
    return hasText(item.name) || hasText(item.encrypted_content);
  }
  return false;
}

/**
 * Anthropic's Messages: a content block delta of text, thinking or a tool
 * call's input; a content block started that names a tool call, already
 * holds text or thinking, or is redacted thinking.
 */
export function anthropicCarriesOutput({data}: StreamChunk): boolean {
  if (!isRecord(data)) return false;
  if (data.type === 'content_block_delta') {
    const delta = isRecord(data.delta) ? data.delta : {};
    switch (delta.type) {
      case 'text_delta':
        return hasText(delta.text);
      case 'thinking_delta':
        return hasText(delta.thinking);
      case 'input_json_delta':
        return hasText(delta.partial_json);
      default:
        return false;
    }
  }
  if (data.type === 'content_block_start') {
    const block = isRecord(data.content_block) ? data.content_block : {};
    switch (block.type) {
      case 'tool_use':
      case 'server_tool_use':
        return hasText(block.name);
      case 'text':
        return hasText(block.text);
      case 'thinking':
        return hasText(block.thinking);
      case 'redacted_thinking':
        return hasText(block.data);
      default:
        return false;
    }
  }
  return false;
}
