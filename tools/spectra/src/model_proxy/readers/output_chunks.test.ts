import assert from 'node:assert/strict';
import {describe, it} from 'node:test';

import {
  anthropicCarriesOutput,
  geminiCarriesOutput,
  openAiChatCarriesOutput,
  openAiResponsesCarriesOutput,
} from './output_chunks.js';

describe('the chunks that carry output', () => {
  it("Gemini's: a part with text, thought text, a function call or inline data; not usage or a signature alone", () => {
    const of = (parts: unknown[], extra: Record<string, unknown> = {}) =>
      geminiCarriesOutput({data: {candidates: [{content: {role: 'model', parts}}], ...extra}});
    assert.equal(of([{text: 'Hi'}]), true);
    assert.equal(of([{text: 'Planning.', thought: true}]), true);
    assert.equal(of([{functionCall: {name: 'search', args: {}}}]), true);
    assert.equal(of([{inlineData: {mimeType: 'image/png', data: 'AA=='}}]), true);
    assert.equal(of([{text: ''}]), false);
    assert.equal(of([{thoughtSignature: 'c2ln'}]), false);
    assert.equal(geminiCarriesOutput({data: {usageMetadata: {totalTokenCount: 9}}}), false);
    assert.equal(geminiCarriesOutput({data: 'not JSON'}), false);
  });

  it("Chat Completions': content, a refusal, audio or a tool call's name or arguments; not the role, usage or the end", () => {
    const of = (delta: unknown) => openAiChatCarriesOutput({data: {choices: [{index: 0, delta}]}});
    assert.equal(of({content: 'Hi'}), true);
    assert.equal(of({refusal: 'No.'}), true);
    assert.equal(of({audio: {transcript: 'Hi'}}), true);
    assert.equal(of({tool_calls: [{index: 0, function: {name: 'search'}}]}), true);
    assert.equal(of({tool_calls: [{index: 0, function: {arguments: '{"q'}}]}), true);
    assert.equal(of({role: 'assistant', content: ''}), false);
    assert.equal(of({tool_calls: [{index: 0, id: 'call_1', function: {arguments: ''}}]}), false);
    assert.equal(openAiChatCarriesOutput({data: {choices: [], usage: {total_tokens: 9}}}), false);
    assert.equal(openAiChatCarriesOutput({data: '[DONE]'}), false);
  });

  it("the Responses API's: a delta of output, a partial image, a tool call named or opaque reasoning; not status or the end", () => {
    const of = (data: unknown) => openAiResponsesCarriesOutput({data});
    assert.equal(of({type: 'response.output_text.delta', delta: 'Hi'}), true);
    assert.equal(of({type: 'response.reasoning_summary_text.delta', delta: 'Plan'}), true);
    assert.equal(of({type: 'response.function_call_arguments.delta', delta: '{"q'}), true);
    assert.equal(
      of({type: 'response.image_generation_call.partial_image', partial_image_b64: 'AA=='}),
      true,
    );
    assert.equal(
      of({
        type: 'response.output_item.added',
        item: {type: 'function_call', name: 'search', arguments: ''},
      }),
      true,
    );
    assert.equal(
      of({
        type: 'response.output_item.added',
        item: {type: 'reasoning', encrypted_content: 'gAAA'},
      }),
      true,
    );
    assert.equal(of({type: 'response.output_text.delta', delta: ''}), false);
    assert.equal(of({type: 'response.created', response: {id: 'resp_1'}}), false);
    assert.equal(of({type: 'response.in_progress'}), false);
    assert.equal(
      of({type: 'response.output_item.added', item: {type: 'message', content: []}}),
      false,
    );
    assert.equal(
      of({type: 'response.content_part.added', part: {type: 'output_text', text: ''}}),
      false,
    );
    assert.equal(of({type: 'response.completed'}), false);
  });

  it("Anthropic's: a delta of text, thinking or tool input, a tool call started, redacted thinking; not a start, a signature, a ping or the end", () => {
    const of = (data: unknown) => anthropicCarriesOutput({data});
    assert.equal(of({type: 'content_block_delta', delta: {type: 'text_delta', text: 'Hi'}}), true);
    assert.equal(
      of({type: 'content_block_delta', delta: {type: 'thinking_delta', thinking: 'Hm'}}),
      true,
    );
    assert.equal(
      of({type: 'content_block_delta', delta: {type: 'input_json_delta', partial_json: '{'}}),
      true,
    );
    assert.equal(
      of({type: 'content_block_start', content_block: {type: 'tool_use', name: 'search'}}),
      true,
    );
    assert.equal(
      of({type: 'content_block_start', content_block: {type: 'redacted_thinking', data: 'EmwK'}}),
      true,
    );
    assert.equal(of({type: 'message_start', message: {content: []}}), false);
    assert.equal(of({type: 'content_block_start', content_block: {type: 'text', text: ''}}), false);
    assert.equal(
      of({type: 'content_block_delta', delta: {type: 'signature_delta', signature: 'c2ln'}}),
      false,
    );
    assert.equal(
      of({type: 'content_block_delta', delta: {type: 'input_json_delta', partial_json: ''}}),
      false,
    );
    assert.equal(of({type: 'ping'}), false);
    assert.equal(
      of({type: 'message_delta', delta: {stop_reason: 'end_turn'}, usage: {output_tokens: 3}}),
      false,
    );
    assert.equal(of({type: 'message_stop'}), false);
  });
});
