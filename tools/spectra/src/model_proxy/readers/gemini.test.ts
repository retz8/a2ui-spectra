import assert from 'node:assert/strict';
import {describe, it} from 'node:test';

import {geminiReader} from './gemini.js';

const request = {
  contents: [
    {role: 'user', parts: [{text: 'Top 2 Chinese restaurants in New York'}]},
    {
      role: 'model',
      parts: [{functionCall: {name: 'get_restaurants', args: {cuisine: 'Chinese', count: 2}}}],
    },
    {
      role: 'user',
      parts: [{functionResponse: {name: 'get_restaurants', response: {result: ['A', 'B']}}}],
    },
    {role: 'user', parts: [{inlineData: {mimeType: 'image/png', data: 'AAAA'}}]},
  ],
  systemInstruction: {parts: [{text: 'You are a helpful restaurant finding assistant.'}]},
  tools: [
    {
      functionDeclarations: [
        {
          name: 'get_restaurants',
          description: 'Finds restaurants.',
          parameters: {type: 'object', properties: {cuisine: {type: 'string'}}},
        },
      ],
    },
    {googleSearch: {}},
  ],
  generationConfig: {
    temperature: 0.2,
    topP: 0.9,
    topK: 40,
    maxOutputTokens: 2048,
    stopSequences: ['END'],
    candidateCount: 1,
    responseMimeType: 'application/json',
  },
};

function read(pathname: string, body: unknown) {
  return geminiReader.request({pathname, search: new URLSearchParams(), body});
}

describe('the Gemini reader', () => {
  it('reads the request: the model from the path, the settings, the system prompt, the messages and the tools', () => {
    const attributes = read('/v1beta/models/gemini-2.5-flash:streamGenerateContent', request);
    assert.deepEqual(attributes, {
      'gen_ai.operation.name': 'generate_content',
      'gen_ai.provider.name': 'gcp.gemini',
      'gen_ai.request.model': 'gemini-2.5-flash',
      'gen_ai.request.stream': true,
      'gen_ai.request.temperature': 0.2,
      'gen_ai.request.top_p': 0.9,
      'gen_ai.request.top_k': 40,
      'gen_ai.request.max_tokens': 2048,
      'gen_ai.request.stop_sequences': ['END'],
      'gen_ai.request.choice.count': 1,
      'gen_ai.output.type': 'json',
      'gen_ai.system_instructions': [
        {type: 'text', content: 'You are a helpful restaurant finding assistant.'},
      ],
      'gen_ai.input.messages': [
        {role: 'user', parts: [{type: 'text', content: 'Top 2 Chinese restaurants in New York'}]},
        {
          role: 'assistant',
          parts: [
            {type: 'tool_call', name: 'get_restaurants', arguments: {cuisine: 'Chinese', count: 2}},
          ],
        },
        {
          role: 'user',
          parts: [
            {type: 'tool_call_response', response: {result: ['A', 'B']}, name: 'get_restaurants'},
          ],
        },
        {
          role: 'user',
          parts: [{type: 'blob', mime_type: 'image/png', modality: 'image', content: 'AAAA'}],
        },
      ],
      'gen_ai.tool.definitions': [
        {
          type: 'function',
          name: 'get_restaurants',
          description: 'Finds restaurants.',
          parameters: {type: 'object', properties: {cuisine: {type: 'string'}}},
        },
        {type: 'googleSearch', name: 'googleSearch'},
      ],
    });
    assert.equal(
      read('/models/gemini-2.5-flash:generateContent', {})['gen_ai.request.model'],
      'gemini-2.5-flash',
    );
    assert.equal(
      read('/models/gemini-2.5-flash:generateContent', {})['gen_ai.request.stream'],
      false,
    );
  });

  it('reads a request in the snake case LiteLLM sends as it reads the camel case', () => {
    const snake = {
      contents: [
        {role: 'user', parts: [{text: 'Top 2 Chinese restaurants in New York'}]},
        {
          role: 'model',
          parts: [
            {
              function_call: {name: 'get_restaurants', args: {cuisine: 'Chinese', count: 2}},
              thought_signature: 'c2ln',
            },
          ],
        },
        {
          role: 'user',
          parts: [{function_response: {name: 'get_restaurants', response: {result: ['A', 'B']}}}],
        },
        {role: 'user', parts: [{inline_data: {mime_type: 'image/png', data: 'AAAA'}}]},
      ],
      system_instruction: {parts: [{text: 'You are a helpful restaurant finding assistant.'}]},
      tools: [
        {
          function_declarations: [
            {
              name: 'get_restaurants',
              description: 'Finds restaurants.',
              parameters: {type: 'object', properties: {cuisine: {type: 'string'}}},
            },
          ],
        },
        {googleSearch: {}},
      ],
      generation_config: {
        temperature: 0.2,
        top_p: 0.9,
        top_k: 40,
        max_output_tokens: 2048,
        stop_sequences: ['END'],
        candidate_count: 1,
        response_mime_type: 'application/json',
      },
    };
    const path = '/v1beta/models/gemini-2.5-flash:streamGenerateContent';
    assert.deepEqual(read(path, snake), read(path, request));
  });

  it("reads a function declaration's parameters from parameters_json_schema, as google-genai sends it, and from parametersJsonSchema", () => {
    const schema = {type: 'object', properties: {cuisine: {type: 'string'}}};
    for (const key of ['parameters_json_schema', 'parametersJsonSchema']) {
      const attributes = read('/v1beta/models/gemini-2.5-flash:generateContent', {
        tools: [{functionDeclarations: [{name: 'get_restaurants', [key]: schema}]}],
      });
      assert.deepEqual(attributes['gen_ai.tool.definitions'], [
        {type: 'function', name: 'get_restaurants', parameters: schema},
      ]);
    }
  });

  it('reads a response in camel case only', () => {
    const attributes = geminiReader.response({
      candidates: [{content: {role: 'model', parts: [{function_call: {name: 'f', args: {}}}]}}],
    });
    assert.deepEqual(attributes['gen_ai.output.messages'], [
      {
        role: 'assistant',
        parts: [{type: 'function_call', content: {function_call: {name: 'f', args: {}}}}],
      },
    ]);
  });

  it('reads a response: the ids, the finish reason normalised, the tokens as the reference scenario sums them, and the message', () => {
    const attributes = geminiReader.response({
      candidates: [
        {
          content: {
            role: 'model',
            parts: [{text: 'Thinking…', thought: true}, {text: 'Here you go.'}],
          },
          finishReason: 'MAX_TOKENS',
          index: 0,
        },
      ],
      usageMetadata: {
        promptTokenCount: 100,
        toolUsePromptTokenCount: 20,
        cachedContentTokenCount: 60,
        candidatesTokenCount: 30,
        thoughtsTokenCount: 10,
        totalTokenCount: 160,
      },
      modelVersion: 'gemini-2.5-flash-001',
      responseId: 'resp-1',
    });
    assert.deepEqual(attributes, {
      'gen_ai.response.id': 'resp-1',
      'gen_ai.response.model': 'gemini-2.5-flash-001',
      'gen_ai.response.finish_reasons': ['length'],
      'gen_ai.usage.input_tokens': 120,
      'gen_ai.usage.cache_read.input_tokens': 60,
      'gen_ai.usage.output_tokens': 40,
      'gen_ai.usage.reasoning.output_tokens': 10,
      'gen_ai.output.messages': [
        {
          role: 'assistant',
          parts: [
            {type: 'reasoning', content: 'Thinking…'},
            {type: 'text', content: 'Here you go.'},
          ],
          finish_reason: 'length',
        },
      ],
    });
  });

  it('leaves out a count the provider does not report', () => {
    const attributes = geminiReader.response({
      candidates: [{content: {role: 'model', parts: [{text: 'Hi'}]}, finishReason: 'STOP'}],
      usageMetadata: {promptTokenCount: 5, candidatesTokenCount: 1, totalTokenCount: 6},
    });
    assert.equal(attributes['gen_ai.usage.input_tokens'], 5);
    assert.equal(attributes['gen_ai.usage.output_tokens'], 1);
    assert.equal('gen_ai.usage.cache_read.input_tokens' in attributes, false);
    assert.equal('gen_ai.usage.reasoning.output_tokens' in attributes, false);
    assert.deepEqual(attributes['gen_ai.response.finish_reasons'], ['stop']);
  });

  it('assembles a stream: the text in pieces as one part, the function call, the last usage', () => {
    const {attributes, error} = geminiReader.stream([
      {
        data: {
          candidates: [{content: {role: 'model', parts: [{text: 'Let me '}]}, index: 0}],
          usageMetadata: {promptTokenCount: 10, totalTokenCount: 10},
          responseId: 'r',
          modelVersion: 'm',
        },
      },
      {data: {candidates: [{content: {role: 'model', parts: [{text: 'look.'}]}, index: 0}]}},
      {
        data: {
          candidates: [
            {
              content: {
                role: 'model',
                parts: [{functionCall: {name: 'get_restaurants', args: {}}}],
              },
              finishReason: 'STOP',
              index: 0,
            },
          ],
          usageMetadata: {promptTokenCount: 10, candidatesTokenCount: 7, totalTokenCount: 17},
        },
      },
    ]);
    assert.equal(error, undefined);
    assert.deepEqual(attributes, {
      'gen_ai.response.id': 'r',
      'gen_ai.response.model': 'm',
      'gen_ai.response.finish_reasons': ['stop'],
      'gen_ai.usage.input_tokens': 10,
      'gen_ai.usage.output_tokens': 7,
      'gen_ai.output.messages': [
        {
          role: 'assistant',
          parts: [
            {type: 'text', content: 'Let me look.'},
            {type: 'tool_call', name: 'get_restaurants', arguments: {}},
          ],
          finish_reason: 'stop',
        },
      ],
    });
  });

  it('reads an error inside a stream, with the chunks before it', () => {
    const {attributes, error} = geminiReader.stream([
      {data: {candidates: [{content: {role: 'model', parts: [{text: 'Hi'}]}, index: 0}]}},
      {data: {error: {code: 429, message: 'Quota exceeded.', status: 'RESOURCE_EXHAUSTED'}}},
    ]);
    assert.deepEqual(error, {type: 'RESOURCE_EXHAUSTED', message: 'Quota exceeded.'});
    assert.deepEqual(attributes['gen_ai.output.messages'], [
      {role: 'assistant', parts: [{type: 'text', content: 'Hi'}]},
    ]);
  });

  it("reads the provider's error message", () => {
    assert.equal(
      geminiReader.errorMessage({
        error: {code: 404, message: 'models/x is not found', status: 'NOT_FOUND'},
      }),
      'models/x is not found',
    );
    assert.equal(geminiReader.errorMessage('nope'), undefined);
  });
});
