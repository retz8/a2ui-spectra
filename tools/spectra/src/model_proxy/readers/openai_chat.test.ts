import assert from 'node:assert/strict';
import {describe, it} from 'node:test';

import {openAiChatReader} from './openai_chat.js';

function read(body: unknown) {
  return openAiChatReader.request({
    pathname: '/v1/chat/completions',
    search: new URLSearchParams(),
    body,
  });
}

describe('the OpenAI Chat Completions reader', () => {
  it('reads the request: the system and developer messages apart, the tool call and its result, the tools and the settings', () => {
    const attributes = read({
      model: 'gpt-4.1-mini',
      messages: [
        {role: 'system', content: 'Be brief.'},
        {role: 'developer', content: [{type: 'text', text: 'Answer in JSON.'}]},
        {role: 'user', content: 'Weather in Paris?', name: 'jo'},
        {
          role: 'assistant',
          content: null,
          tool_calls: [
            {
              id: 'call_1',
              type: 'function',
              function: {name: 'get_weather', arguments: '{"city":"Paris"}'},
            },
          ],
        },
        {role: 'tool', tool_call_id: 'call_1', content: 'rainy, 57°F'},
        {
          role: 'user',
          content: [
            {type: 'text', text: 'And this?'},
            {type: 'image_url', image_url: {url: 'data:image/png;base64,AAAA'}},
            {type: 'image_url', image_url: {url: 'https://img.example/a.jpg'}},
          ],
        },
      ],
      tools: [
        {
          type: 'function',
          function: {
            name: 'get_weather',
            description: 'The weather.',
            parameters: {type: 'object'},
          },
        },
      ],
      temperature: 0.5,
      top_p: 1,
      n: 2,
      max_completion_tokens: 300,
      stop: 'END',
      seed: 7,
      frequency_penalty: 0.1,
      presence_penalty: 0.2,
      response_format: {type: 'json_schema', json_schema: {}},
      stream: true,
      stream_options: {include_usage: true},
    });
    assert.deepEqual(attributes, {
      'gen_ai.operation.name': 'chat',
      'gen_ai.provider.name': 'openai',
      'openai.api.type': 'chat_completions',
      'gen_ai.request.model': 'gpt-4.1-mini',
      'gen_ai.request.stream': true,
      'gen_ai.request.temperature': 0.5,
      'gen_ai.request.top_p': 1,
      'gen_ai.request.max_tokens': 300,
      'gen_ai.request.stop_sequences': ['END'],
      'gen_ai.request.choice.count': 2,
      'gen_ai.request.seed': 7,
      'gen_ai.request.frequency_penalty': 0.1,
      'gen_ai.request.presence_penalty': 0.2,
      'gen_ai.output.type': 'json',
      'gen_ai.system_instructions': [
        {type: 'text', content: 'Be brief.'},
        {type: 'text', content: 'Answer in JSON.'},
      ],
      'gen_ai.input.messages': [
        {role: 'user', parts: [{type: 'text', content: 'Weather in Paris?'}], name: 'jo'},
        {
          role: 'assistant',
          parts: [
            {type: 'tool_call', id: 'call_1', name: 'get_weather', arguments: {city: 'Paris'}},
          ],
        },
        {
          role: 'tool',
          parts: [{type: 'tool_call_response', id: 'call_1', response: 'rainy, 57°F'}],
        },
        {
          role: 'user',
          parts: [
            {type: 'text', content: 'And this?'},
            {type: 'blob', mime_type: 'image/png', modality: 'image', content: 'AAAA'},
            {type: 'uri', modality: 'image', uri: 'https://img.example/a.jpg'},
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
      ],
    });
    assert.equal(read({model: 'm', max_tokens: 10})['gen_ai.request.max_tokens'], 10);
  });

  it('reads a response: the ids, the finish reasons normalised, the usage with its cached and reasoning tokens, and the messages', () => {
    const attributes = openAiChatReader.response({
      id: 'chatcmpl-1',
      object: 'chat.completion',
      model: 'gpt-4.1-mini-2025-04-14',
      choices: [
        {
          index: 0,
          message: {
            role: 'assistant',
            content: null,
            tool_calls: [
              {
                id: 'call_1',
                type: 'function',
                function: {name: 'get_weather', arguments: '{"city":"Paris"}'},
              },
            ],
          },
          finish_reason: 'tool_calls',
        },
        {
          index: 1,
          message: {role: 'assistant', content: 'Rainy.', refusal: null},
          finish_reason: 'stop',
        },
      ],
      usage: {
        prompt_tokens: 50,
        completion_tokens: 12,
        total_tokens: 62,
        prompt_tokens_details: {cached_tokens: 40, audio_tokens: 0},
        completion_tokens_details: {reasoning_tokens: 4, audio_tokens: 0},
      },
    });
    assert.deepEqual(attributes, {
      'gen_ai.response.id': 'chatcmpl-1',
      'gen_ai.response.model': 'gpt-4.1-mini-2025-04-14',
      'gen_ai.response.finish_reasons': ['tool_call', 'stop'],
      'gen_ai.usage.input_tokens': 50,
      'gen_ai.usage.output_tokens': 12,
      'gen_ai.usage.cache_read.input_tokens': 40,
      'gen_ai.usage.reasoning.output_tokens': 4,
      'gen_ai.output.messages': [
        {
          role: 'assistant',
          parts: [
            {type: 'tool_call', id: 'call_1', name: 'get_weather', arguments: {city: 'Paris'}},
          ],
          finish_reason: 'tool_call',
        },
        {role: 'assistant', parts: [{type: 'text', content: 'Rainy.'}], finish_reason: 'stop'},
      ],
    });
    const bare = openAiChatReader.response({
      id: 'c',
      model: 'm',
      choices: [{index: 0, message: {role: 'assistant', content: 'x'}, finish_reason: 'length'}],
      usage: {prompt_tokens: 1, completion_tokens: 1, total_tokens: 2},
    });
    assert.equal('gen_ai.usage.cache_read.input_tokens' in bare, false);
    assert.deepEqual(bare['gen_ai.response.finish_reasons'], ['length']);
  });

  it('assembles a stream: the content deltas, the tool call arguments in pieces, the finish reason and the usage', () => {
    const chunk = (
      delta: unknown,
      finish: string | null = null,
      extra: Record<string, unknown> = {},
    ) => ({
      data: {
        id: 'chatcmpl-2',
        object: 'chat.completion.chunk',
        model: 'gpt-4.1-mini',
        choices: [{index: 0, delta, finish_reason: finish}],
        ...extra,
      },
    });
    const {attributes, error} = openAiChatReader.stream([
      chunk({role: 'assistant', content: ''}),
      chunk({content: 'Let me '}),
      chunk({content: 'check.'}),
      chunk({
        tool_calls: [
          {
            index: 0,
            id: 'call_9',
            type: 'function',
            function: {name: 'get_weather', arguments: ''},
          },
        ],
      }),
      chunk({tool_calls: [{index: 0, function: {arguments: '{"city":'}}]}),
      chunk({tool_calls: [{index: 0, function: {arguments: '"Paris"}'}}]}),
      chunk({}, 'tool_calls'),
      {
        data: {
          id: 'chatcmpl-2',
          object: 'chat.completion.chunk',
          model: 'gpt-4.1-mini',
          choices: [],
          usage: {prompt_tokens: 9, completion_tokens: 8, total_tokens: 17},
        },
      },
      {data: '[DONE]'},
    ]);
    assert.equal(error, undefined);
    assert.deepEqual(attributes, {
      'gen_ai.response.id': 'chatcmpl-2',
      'gen_ai.response.model': 'gpt-4.1-mini',
      'gen_ai.response.finish_reasons': ['tool_call'],
      'gen_ai.usage.input_tokens': 9,
      'gen_ai.usage.output_tokens': 8,
      'gen_ai.output.messages': [
        {
          role: 'assistant',
          parts: [
            {type: 'text', content: 'Let me check.'},
            {type: 'tool_call', id: 'call_9', name: 'get_weather', arguments: {city: 'Paris'}},
          ],
          finish_reason: 'tool_call',
        },
      ],
    });
  });

  it('reads an error inside a stream', () => {
    const {error} = openAiChatReader.stream([
      {data: {error: {message: 'The server had an error.', type: 'server_error', code: null}}},
    ]);
    assert.deepEqual(error, {type: 'server_error', message: 'The server had an error.'});
  });

  it("reads the provider's error message", () => {
    assert.equal(
      openAiChatReader.errorMessage({
        error: {
          message: 'The model `x` does not exist',
          type: 'invalid_request_error',
          code: 'model_not_found',
        },
      }),
      'The model `x` does not exist',
    );
  });
});
