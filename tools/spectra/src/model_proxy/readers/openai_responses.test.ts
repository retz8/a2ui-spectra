import assert from 'node:assert/strict';
import {describe, it} from 'node:test';

import {openAiResponsesReader} from './openai_responses.js';

function read(body: unknown) {
  return openAiResponsesReader.request({
    pathname: '/v1/responses',
    search: new URLSearchParams(),
    body,
  });
}

const completed = {
  id: 'resp_1',
  object: 'response',
  model: 'gpt-4.1-mini-2025-04-14',
  status: 'completed',
  error: null,
  incomplete_details: null,
  output: [
    {type: 'reasoning', id: 'rs_1', summary: [{type: 'summary_text', text: 'Need the weather.'}]},
    {
      type: 'function_call',
      id: 'fc_1',
      call_id: 'call_1',
      name: 'get_weather',
      arguments: '{"city":"Paris"}',
      status: 'completed',
    },
    {
      type: 'message',
      id: 'msg_1',
      role: 'assistant',
      status: 'completed',
      content: [{type: 'output_text', text: 'Checking.', annotations: []}],
    },
  ],
  usage: {
    input_tokens: 40,
    input_tokens_details: {cached_tokens: 32},
    output_tokens: 15,
    output_tokens_details: {reasoning_tokens: 5},
    total_tokens: 55,
  },
};

const completedAttributes = {
  'gen_ai.response.id': 'resp_1',
  'gen_ai.response.model': 'gpt-4.1-mini-2025-04-14',
  'gen_ai.response.finish_reasons': ['tool_call'],
  'gen_ai.usage.input_tokens': 40,
  'gen_ai.usage.output_tokens': 15,
  'gen_ai.usage.cache_read.input_tokens': 32,
  'gen_ai.usage.reasoning.output_tokens': 5,
  'gen_ai.output.messages': [
    {
      role: 'assistant',
      parts: [
        {type: 'reasoning', content: 'Need the weather.'},
        {type: 'tool_call', id: 'call_1', name: 'get_weather', arguments: {city: 'Paris'}},
        {type: 'text', content: 'Checking.'},
      ],
      finish_reason: 'tool_call',
    },
  ],
};

describe('the OpenAI Responses reader', () => {
  it('reads the request: the instructions and developer items as the system prompt, the input items as messages, the tools and the settings', () => {
    const attributes = read({
      model: 'gpt-4.1-mini',
      instructions: 'Be brief.',
      input: [
        {role: 'developer', content: 'Answer in JSON.'},
        {type: 'message', role: 'user', content: [{type: 'input_text', text: 'Weather in Paris?'}]},
        {
          type: 'function_call',
          call_id: 'call_1',
          name: 'get_weather',
          arguments: '{"city":"Paris"}',
        },
        {type: 'function_call_output', call_id: 'call_1', output: 'rainy'},
      ],
      tools: [
        {
          type: 'function',
          name: 'get_weather',
          description: 'The weather.',
          parameters: {type: 'object'},
          strict: true,
        },
        {type: 'web_search'},
      ],
      temperature: 0.3,
      top_p: 0.8,
      max_output_tokens: 500,
      text: {format: {type: 'json_object'}},
      stream: false,
    });
    assert.deepEqual(attributes, {
      'gen_ai.operation.name': 'chat',
      'gen_ai.provider.name': 'openai',
      'openai.api.type': 'responses',
      'gen_ai.request.model': 'gpt-4.1-mini',
      'gen_ai.request.stream': false,
      'gen_ai.request.temperature': 0.3,
      'gen_ai.request.top_p': 0.8,
      'gen_ai.request.max_tokens': 500,
      'gen_ai.output.type': 'json',
      'gen_ai.system_instructions': [
        {type: 'text', content: 'Be brief.'},
        {type: 'text', content: 'Answer in JSON.'},
      ],
      'gen_ai.input.messages': [
        {role: 'user', parts: [{type: 'text', content: 'Weather in Paris?'}]},
        {
          role: 'assistant',
          parts: [
            {type: 'tool_call', id: 'call_1', name: 'get_weather', arguments: {city: 'Paris'}},
          ],
        },
        {role: 'tool', parts: [{type: 'tool_call_response', id: 'call_1', response: 'rainy'}]},
      ],
      'gen_ai.tool.definitions': [
        {
          type: 'function',
          name: 'get_weather',
          description: 'The weather.',
          parameters: {type: 'object'},
        },
        {type: 'web_search', name: 'web_search'},
      ],
    });
    assert.deepEqual(read({model: 'm', input: 'Hi'})['gen_ai.input.messages'], [
      {role: 'user', parts: [{type: 'text', content: 'Hi'}]},
    ]);
  });

  it('reads a response: the output items as one message, the finish reason from the status, the usage', () => {
    assert.deepEqual(openAiResponsesReader.response(completed), completedAttributes);
    const incomplete = openAiResponsesReader.response({
      ...completed,
      status: 'incomplete',
      incomplete_details: {reason: 'max_output_tokens'},
      output: [
        {
          type: 'message',
          id: 'm',
          role: 'assistant',
          content: [{type: 'output_text', text: 'Partial'}],
        },
      ],
    });
    assert.deepEqual(incomplete['gen_ai.response.finish_reasons'], ['length']);
  });

  it('assembles a stream from its final event, and reads a failure', () => {
    const {attributes, error} = openAiResponsesReader.stream([
      {
        event: 'response.created',
        data: {
          type: 'response.created',
          response: {...completed, status: 'in_progress', output: [], usage: null},
        },
      },
      {
        event: 'response.output_text.delta',
        data: {type: 'response.output_text.delta', delta: 'Check'},
      },
      {event: 'response.completed', data: {type: 'response.completed', response: completed}},
    ]);
    assert.equal(error, undefined);
    assert.deepEqual(attributes, completedAttributes);

    const failed = openAiResponsesReader.stream([
      {
        event: 'response.created',
        data: {
          type: 'response.created',
          response: {...completed, status: 'in_progress', output: [], usage: null},
        },
      },
      {
        event: 'response.failed',
        data: {
          type: 'response.failed',
          response: {
            ...completed,
            status: 'failed',
            output: [],
            usage: null,
            error: {code: 'server_error', message: 'The model failed.'},
          },
        },
      },
    ]);
    assert.deepEqual(failed.error, {type: 'server_error', message: 'The model failed.'});
    assert.deepEqual(failed.attributes['gen_ai.response.finish_reasons'], ['error']);
  });

  it('assembles a stream that broke off from the items done so far', () => {
    const {attributes} = openAiResponsesReader.stream([
      {
        event: 'response.created',
        data: {
          type: 'response.created',
          response: {id: 'resp_2', model: 'm', status: 'in_progress', output: []},
        },
      },
      {
        event: 'response.output_item.done',
        data: {
          type: 'response.output_item.done',
          item: {type: 'message', role: 'assistant', content: [{type: 'output_text', text: 'Hi'}]},
        },
      },
    ]);
    assert.deepEqual(attributes, {
      'gen_ai.response.id': 'resp_2',
      'gen_ai.response.model': 'm',
      'gen_ai.output.messages': [{role: 'assistant', parts: [{type: 'text', content: 'Hi'}]}],
    });
  });

  it("reads the provider's error message", () => {
    assert.equal(
      openAiResponsesReader.errorMessage({
        error: {message: 'Invalid', type: 'invalid_request_error'},
      }),
      'Invalid',
    );
  });
});
