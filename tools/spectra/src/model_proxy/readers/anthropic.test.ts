import assert from 'node:assert/strict';
import {describe, it} from 'node:test';

import {anthropicReader} from './anthropic.js';

function read(body: unknown) {
  return anthropicReader.request({pathname: '/v1/messages', search: new URLSearchParams(), body});
}

describe('the Anthropic Messages reader', () => {
  it('reads the request: the system prompt, the messages with their blocks, the tools and the settings', () => {
    const attributes = read({
      model: 'claude-sonnet-4-5',
      max_tokens: 1024,
      system: [{type: 'text', text: 'Be brief.', cache_control: {type: 'ephemeral'}}],
      messages: [
        {role: 'user', content: 'Weather in Paris?'},
        {
          role: 'assistant',
          content: [
            {type: 'thinking', thinking: 'Need the weather.', signature: 'sig'},
            {type: 'tool_use', id: 'toolu_1', name: 'get_weather', input: {city: 'Paris'}},
          ],
        },
        {
          role: 'user',
          content: [
            {type: 'tool_result', tool_use_id: 'toolu_1', content: 'rainy'},
            {type: 'image', source: {type: 'base64', media_type: 'image/png', data: 'AAAA'}},
          ],
        },
      ],
      tools: [
        {name: 'get_weather', description: 'The weather.', input_schema: {type: 'object'}},
        {type: 'web_search_20250305', name: 'web_search'},
      ],
      temperature: 0.7,
      top_p: 0.9,
      top_k: 5,
      stop_sequences: ['END'],
      stream: true,
    });
    assert.deepEqual(attributes, {
      'gen_ai.operation.name': 'chat',
      'gen_ai.provider.name': 'anthropic',
      'gen_ai.request.model': 'claude-sonnet-4-5',
      'gen_ai.request.stream': true,
      'gen_ai.request.max_tokens': 1024,
      'gen_ai.request.temperature': 0.7,
      'gen_ai.request.top_p': 0.9,
      'gen_ai.request.top_k': 5,
      'gen_ai.request.stop_sequences': ['END'],
      'gen_ai.system_instructions': [{type: 'text', content: 'Be brief.'}],
      'gen_ai.input.messages': [
        {role: 'user', parts: [{type: 'text', content: 'Weather in Paris?'}]},
        {
          role: 'assistant',
          parts: [
            {type: 'reasoning', content: 'Need the weather.'},
            {type: 'tool_call', id: 'toolu_1', name: 'get_weather', arguments: {city: 'Paris'}},
          ],
        },
        {
          role: 'user',
          parts: [
            {type: 'tool_call_response', id: 'toolu_1', response: 'rainy'},
            {type: 'blob', mime_type: 'image/png', modality: 'image', content: 'AAAA'},
          ],
        },
      ],
      'gen_ai.tool.definitions': [
        {
          type: 'function',
          name: 'get_weather',
          description: 'The weather.',
          parameters: {type: 'object'},
        },
        {type: 'web_search_20250305', name: 'web_search'},
      ],
    });
    assert.deepEqual(read({model: 'm', system: 'Plain.'})['gen_ai.system_instructions'], [
      {type: 'text', content: 'Plain.'},
    ]);
  });

  it('reads a response: the stop reason normalised, the input tokens summed with the cache figures, and the content', () => {
    const attributes = anthropicReader.response({
      id: 'msg_1',
      type: 'message',
      role: 'assistant',
      model: 'claude-sonnet-4-5-20250929',
      content: [
        {type: 'text', text: 'Checking.'},
        {type: 'tool_use', id: 'toolu_1', name: 'get_weather', input: {city: 'Paris'}},
      ],
      stop_reason: 'tool_use',
      stop_sequence: null,
      usage: {
        input_tokens: 10,
        cache_creation_input_tokens: 1200,
        cache_read_input_tokens: 300,
        output_tokens: 25,
        service_tier: 'standard',
      },
    });
    assert.deepEqual(attributes, {
      'gen_ai.response.id': 'msg_1',
      'gen_ai.response.model': 'claude-sonnet-4-5-20250929',
      'gen_ai.response.finish_reasons': ['tool_call'],
      'gen_ai.usage.input_tokens': 1510,
      'gen_ai.usage.output_tokens': 25,
      'gen_ai.usage.cache_read.input_tokens': 300,
      'gen_ai.usage.cache_write.input_tokens': 1200,
      'gen_ai.output.messages': [
        {
          role: 'assistant',
          parts: [
            {type: 'text', content: 'Checking.'},
            {type: 'tool_call', id: 'toolu_1', name: 'get_weather', arguments: {city: 'Paris'}},
          ],
          finish_reason: 'tool_call',
        },
      ],
    });
    const plain = anthropicReader.response({
      id: 'm',
      model: 'c',
      content: [{type: 'text', text: 'x'}],
      stop_reason: 'end_turn',
      usage: {input_tokens: 3, output_tokens: 1},
    });
    assert.equal(plain['gen_ai.usage.input_tokens'], 3);
    assert.equal('gen_ai.usage.cache_read.input_tokens' in plain, false);
    assert.deepEqual(plain['gen_ai.response.finish_reasons'], ['stop']);
  });

  it('assembles a stream: the blocks from their deltas, the tool input from its JSON pieces, the usage from start and delta', () => {
    const {attributes, error} = anthropicReader.stream([
      {
        event: 'message_start',
        data: {
          type: 'message_start',
          message: {
            id: 'msg_2',
            type: 'message',
            role: 'assistant',
            model: 'claude-sonnet-4-5',
            content: [],
            stop_reason: null,
            usage: {
              input_tokens: 20,
              cache_creation_input_tokens: 0,
              cache_read_input_tokens: 500,
              output_tokens: 1,
            },
          },
        },
      },
      {
        event: 'content_block_start',
        data: {type: 'content_block_start', index: 0, content_block: {type: 'text', text: ''}},
      },
      {event: 'ping', data: {type: 'ping'}},
      {
        event: 'content_block_delta',
        data: {type: 'content_block_delta', index: 0, delta: {type: 'text_delta', text: 'Chec'}},
      },
      {
        event: 'content_block_delta',
        data: {type: 'content_block_delta', index: 0, delta: {type: 'text_delta', text: 'king.'}},
      },
      {event: 'content_block_stop', data: {type: 'content_block_stop', index: 0}},
      {
        event: 'content_block_start',
        data: {
          type: 'content_block_start',
          index: 1,
          content_block: {type: 'tool_use', id: 'toolu_2', name: 'get_weather', input: {}},
        },
      },
      {
        event: 'content_block_delta',
        data: {
          type: 'content_block_delta',
          index: 1,
          delta: {type: 'input_json_delta', partial_json: '{"city":'},
        },
      },
      {
        event: 'content_block_delta',
        data: {
          type: 'content_block_delta',
          index: 1,
          delta: {type: 'input_json_delta', partial_json: ' "Paris"}'},
        },
      },
      {event: 'content_block_stop', data: {type: 'content_block_stop', index: 1}},
      {
        event: 'message_delta',
        data: {
          type: 'message_delta',
          delta: {stop_reason: 'tool_use', stop_sequence: null},
          usage: {output_tokens: 30},
        },
      },
      {event: 'message_stop', data: {type: 'message_stop'}},
    ]);
    assert.equal(error, undefined);
    assert.deepEqual(attributes, {
      'gen_ai.response.id': 'msg_2',
      'gen_ai.response.model': 'claude-sonnet-4-5',
      'gen_ai.response.finish_reasons': ['tool_call'],
      'gen_ai.usage.input_tokens': 520,
      'gen_ai.usage.output_tokens': 30,
      'gen_ai.usage.cache_read.input_tokens': 500,
      'gen_ai.usage.cache_write.input_tokens': 0,
      'gen_ai.output.messages': [
        {
          role: 'assistant',
          parts: [
            {type: 'text', content: 'Checking.'},
            {type: 'tool_call', id: 'toolu_2', name: 'get_weather', arguments: {city: 'Paris'}},
          ],
          finish_reason: 'tool_call',
        },
      ],
    });
  });

  it('reads an error event inside a stream, keeping what came before', () => {
    const {attributes, error} = anthropicReader.stream([
      {
        event: 'message_start',
        data: {
          type: 'message_start',
          message: {
            id: 'msg_3',
            model: 'c',
            content: [],
            usage: {input_tokens: 5, output_tokens: 1},
          },
        },
      },
      {
        event: 'error',
        data: {type: 'error', error: {type: 'overloaded_error', message: 'Overloaded'}},
      },
    ]);
    assert.deepEqual(error, {type: 'overloaded_error', message: 'Overloaded'});
    assert.equal(attributes['gen_ai.response.id'], 'msg_3');
  });

  it("reads the provider's error message", () => {
    assert.equal(
      anthropicReader.errorMessage({
        type: 'error',
        error: {type: 'not_found_error', message: 'model: x'},
      }),
      'model: x',
    );
  });
});
