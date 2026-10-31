import assert from 'node:assert/strict';
import {describe, it} from 'node:test';

import {dialectOf, kindOf, readSpan} from './dialects.js';
import {fittedValue, normaliseFinishReason} from './genai.js';
import type {ReceivedLog, ReceivedSpan} from './otlp.js';
import {logEvent, receivedEvent} from './received_event.js';

const TRACE = 'a'.repeat(32);
const ADK = {name: 'gcp.vertex.agent', version: '2.3.0'};

function span(
  name: string,
  attributes: Record<string, unknown>,
  scope: {name: string; version?: string} = {name: 'other'},
): ReceivedSpan {
  return {
    traceId: TRACE,
    spanId: '1'.repeat(16),
    name,
    kind: 1,
    startTimeUnixNano: '100',
    endTimeUnixNano: '200',
    attributes,
    events: [],
    links: [],
    status: {code: 0},
    scope,
  };
}

function log(
  eventName: string,
  body: unknown,
  attributes: Record<string, unknown> = {},
): ReceivedLog {
  return {
    timeUnixNano: '150',
    traceId: TRACE,
    spanId: '1'.repeat(16),
    eventName,
    body,
    attributes,
    scope: ADK,
  };
}

/** The names a span's event carries once fitted, without the received ones. */
function translated(received: ReceivedSpan, logs: ReceivedLog[] = []): Record<string, unknown> {
  const attributes = {...receivedEvent(received, logs, undefined).attributes} as Record<
    string,
    unknown
  >;
  delete attributes['a2ui.received.attributes'];
  return attributes;
}

describe('the dialects', () => {
  it("reads the dialect off the span: ADK's scope, OpenInference's kind, the conventions' operation", () => {
    assert.equal(dialectOf(span('x', {}, ADK)), 'adk');
    assert.equal(dialectOf(span('x', {'openinference.span.kind': 'LLM'})), 'openinference');
    assert.equal(dialectOf(span('x', {'gen_ai.operation.name': 'chat'})), 'genai');
    assert.equal(dialectOf(span('x', {'http.method': 'POST'})), undefined);
  });

  it("reads the kind off each dialect's operation marker", () => {
    const cases: Array<[ReceivedSpan, string]> = [
      [span('call_llm', {}, ADK), 'model_call'],
      [span('generate_content gemini-3.6-flash', {}, ADK), 'model_call'],
      [span('execute_tool get_restaurants', {}, ADK), 'tool_call'],
      [span('execute_tool (merged)', {}, ADK), 'tool_call'],
      [span('invoke_agent restaurant_agent', {}, ADK), 'framework_span'],
      [span('invocation', {}, ADK), 'framework_span'],
      [span('acompletion', {'openinference.span.kind': 'LLM'}), 'model_call'],
      [span('CreateEmbeddings', {'openinference.span.kind': 'EMBEDDING'}), 'model_call'],
      [span('lookup', {'openinference.span.kind': 'TOOL'}), 'tool_call'],
      [span('agent', {'openinference.span.kind': 'AGENT'}), 'framework_span'],
      [span('chain', {'openinference.span.kind': 'CHAIN'}), 'framework_span'],
      ...['chat', 'generate_content', 'text_completion', 'embeddings'].map(
        (operation): [ReceivedSpan, string] => [
          span('litellm.chat', {'gen_ai.operation.name': operation}),
          'model_call',
        ],
      ),
      [span('tool', {'gen_ai.operation.name': 'execute_tool'}), 'tool_call'],
      [span('agent', {'gen_ai.operation.name': 'invoke_agent'}), 'framework_span'],
      [span('POST /', {}), 'framework_span'],
    ];
    for (const [received, kind] of cases) {
      assert.equal(kindOf(received, dialectOf(received)), kind, received.name);
    }
  });

  it("reads ADK's call_llm from its request and response, and no provider from gen_ai.system", () => {
    const request = {
      model: 'gemini-3.6-flash',
      config: {
        system_instruction: 'Be helpful.',
        temperature: 0.2,
        max_output_tokens: 512,
        tools: [
          {
            function_declarations: [
              {
                name: 'get_restaurants',
                description: 'Lists restaurants.',
                parameters_json_schema: {
                  type: 'object',
                  properties: {cuisine_name: {type: 'string'}},
                },
              },
            ],
          },
        ],
      },
      contents: [
        {role: 'user', parts: [{text: 'Top 2 Chinese restaurants'}]},
        {
          role: 'model',
          parts: [
            {function_call: {id: 'c1', name: 'get_restaurants', args: {cuisine_name: 'Chinese'}}},
          ],
        },
        {
          role: 'user',
          parts: [{function_response: {id: 'c1', name: 'get_restaurants', response: {result: []}}}],
        },
      ],
    };
    const response = {
      model_version: 'gemini-3.6-flash',
      content: {role: 'model', parts: [{text: 'Here they are.', thought_signature: 'sig'}]},
      finish_reason: 'STOP',
    };
    const names = translated(
      span(
        'call_llm',
        {
          'gen_ai.system': 'gcp.vertex.agent',
          'gen_ai.request.model': 'gemini-3.6-flash',
          'gcp.vertex.agent.session_id': 'session-1',
          'gcp.vertex.agent.llm_request': JSON.stringify(request),
          'gcp.vertex.agent.llm_response': JSON.stringify(response),
          'gen_ai.usage.input_tokens': 100,
          'gen_ai.usage.output_tokens': 20,
          'gen_ai.usage.cache_creation.input_tokens': 7,
          'gen_ai.response.finish_reasons': ['stop'],
        },
        ADK,
      ),
    );
    assert.deepEqual(names, {
      'a2ui.event.kind': 'model_call',
      'otel.scope.name': 'gcp.vertex.agent',
      'otel.scope.version': '2.3.0',
      'a2ui.received.dialect': 'adk',
      'gen_ai.request.model': 'gemini-3.6-flash',
      'gen_ai.usage.input_tokens': 100,
      'gen_ai.usage.output_tokens': 20,
      'gen_ai.response.finish_reasons': ['stop'],
      'gen_ai.conversation.id': 'session-1',
      'gen_ai.request.temperature': 0.2,
      'gen_ai.request.max_tokens': 512,
      'gen_ai.system_instructions': [{type: 'text', content: 'Be helpful.'}],
      'gen_ai.input.messages': [
        {role: 'user', parts: [{type: 'text', content: 'Top 2 Chinese restaurants'}]},
        {
          role: 'assistant',
          parts: [
            {
              type: 'tool_call',
              id: 'c1',
              name: 'get_restaurants',
              arguments: {cuisine_name: 'Chinese'},
            },
          ],
        },
        {
          role: 'user',
          parts: [
            {type: 'tool_call_response', id: 'c1', response: {result: []}, name: 'get_restaurants'},
          ],
        },
      ],
      'gen_ai.tool.definitions': [
        {
          type: 'function',
          name: 'get_restaurants',
          description: 'Lists restaurants.',
          parameters: {type: 'object', properties: {cuisine_name: {type: 'string'}}},
        },
      ],
      'gen_ai.output.messages': [
        {
          role: 'assistant',
          parts: [{type: 'text', content: 'Here they are.'}],
          finish_reason: 'stop',
        },
      ],
      'gen_ai.usage.cache_write.input_tokens': 7,
    });
  });

  it("reads ADK's generate_content from its per-message log records, its provider from gen_ai.system", () => {
    const content = (role: string, text: string) => ({
      role,
      parts: [{text, function_call: null, inline_data: null, thought: null}],
    });
    const names = translated(
      span(
        'generate_content gemini-3.6-flash',
        {
          'gen_ai.system': 'gemini',
          'gen_ai.operation.name': 'generate_content',
          'gen_ai.request.model': 'gemini-3.6-flash',
          'gen_ai.response.finish_reasons': ['max_tokens'],
        },
        ADK,
      ),
      [
        log('gen_ai.system.message', {content: 'Be helpful.'}),
        log('gen_ai.user.message', {content: content('user', 'Hello')}),
        log('gen_ai.user.message', {content: content('model', 'Hi')}),
        log('gen_ai.user.message', {content: '<elided>'}),
        log('gen_ai.choice', {
          content: content('model', 'Bye'),
          index: 0,
          finish_reason: 'MAX_TOKENS',
        }),
      ],
    );
    assert.equal(names['gen_ai.provider.name'], 'gcp.gemini');
    assert.deepEqual(names['gen_ai.response.finish_reasons'], ['length']);
    assert.deepEqual(names['gen_ai.system_instructions'], [{type: 'text', content: 'Be helpful.'}]);
    assert.deepEqual(names['gen_ai.input.messages'], [
      {role: 'user', parts: [{type: 'text', content: 'Hello'}]},
      {role: 'assistant', parts: [{type: 'text', content: 'Hi'}]},
    ]);
    assert.deepEqual(names['gen_ai.output.messages'], [
      {role: 'assistant', parts: [{type: 'text', content: 'Bye'}], finish_reason: 'length'},
    ]);
  });

  it("reads ADK's generate_content under the opt-in from its operation details log record", () => {
    const names = translated(
      span(
        'generate_content gemini-3.6-flash',
        {
          'gen_ai.operation.name': 'generate_content',
          'gen_ai.tool.definitions': JSON.stringify([
            {type: 'function', name: 'f', description: 'd'},
          ]),
        },
        ADK,
      ),
      [
        log('gen_ai.client.inference.operation.details', undefined, {
          'gen_ai.input.messages': [{role: 'user', parts: [{type: 'text', content: 'Hello'}]}],
          'gen_ai.output.messages': [
            {role: 'assistant', parts: [{type: 'text', content: 'Hi'}], finish_reason: 'safety'},
          ],
          'gen_ai.tool.definitions': [
            {type: 'function', name: 'f', description: 'd', parameters: {type: 'object'}},
          ],
        }),
      ],
    );
    assert.deepEqual(names['gen_ai.input.messages'], [
      {role: 'user', parts: [{type: 'text', content: 'Hello'}]},
    ]);
    assert.deepEqual(names['gen_ai.output.messages'], [
      {role: 'assistant', parts: [{type: 'text', content: 'Hi'}], finish_reason: 'content_filter'},
    ]);
    assert.deepEqual(names['gen_ai.tool.definitions'], [
      {type: 'function', name: 'f', description: 'd', parameters: {type: 'object'}},
    ]);
  });

  it("reads ADK's execute_tool's arguments and result, a result that is not an object left out", () => {
    const tool = (result: unknown) =>
      translated(
        span(
          'execute_tool get_restaurants',
          {
            'gen_ai.operation.name': 'execute_tool',
            'gen_ai.tool.name': 'get_restaurants',
            'gen_ai.tool.call.id': 'c1',
            'gcp.vertex.agent.tool_call_args': '{"cuisine": "Chinese"}',
            'gcp.vertex.agent.tool_response': JSON.stringify(result),
          },
          ADK,
        ),
      );
    const names = tool({result: '[]'});
    assert.equal(names['a2ui.event.kind'], 'tool_call');
    assert.equal(names['gen_ai.tool.name'], 'get_restaurants');
    assert.deepEqual(names['gen_ai.tool.call.arguments'], {cuisine: 'Chinese'});
    assert.deepEqual(names['gen_ai.tool.call.result'], {result: '[]'});
    assert.equal(tool(['a list'])['gen_ai.tool.call.result'], undefined);
  });

  it("reads OpenInference's LLM span from its flattened messages, tools, parameters and counts", () => {
    const names = translated(
      span('acompletion', {
        'openinference.span.kind': 'LLM',
        'llm.model_name': 'gemini/gemini-3.6-flash',
        'llm.provider': 'google',
        'llm.invocation_parameters': JSON.stringify({
          temperature: 0.1,
          stream: true,
          max_tokens: 64,
        }),
        'llm.input_messages.0.message.role': 'system',
        'llm.input_messages.0.message.content': 'Be helpful.',
        'llm.input_messages.1.message.role': 'user',
        'llm.input_messages.1.message.content': 'Who is Alex?',
        'llm.input_messages.2.message.role': 'assistant',
        'llm.input_messages.2.message.tool_calls.0.tool_call.id': 'c1',
        'llm.input_messages.2.message.tool_calls.0.tool_call.function.name': 'lookup',
        'llm.input_messages.2.message.tool_calls.0.tool_call.function.arguments': '{"name":"Alex"}',
        'llm.input_messages.3.message.role': 'tool',
        'llm.input_messages.3.message.tool_call_id': 'c1',
        'llm.input_messages.3.message.content': '{"title":"Engineer"}',
        'llm.output_messages.0.message.role': 'assistant',
        'llm.output_messages.0.message.content': 'Alex is an engineer.',
        'llm.finish_reason': 'stop',
        'llm.tools.0.tool.json_schema': JSON.stringify({
          type: 'function',
          function: {name: 'lookup', description: 'Looks up', parameters: {type: 'object'}},
        }),
        'llm.token_count.prompt': 50,
        'llm.token_count.completion': 8,
        'llm.token_count.prompt_details.cache_read': 30,
        'llm.token_count.completion_details.reasoning': 2,
        'llm.token_count.total': 58,
      }),
    );
    assert.deepEqual(names, {
      'a2ui.event.kind': 'model_call',
      'otel.scope.name': 'other',
      'a2ui.received.dialect': 'openinference',
      'gen_ai.operation.name': 'chat',
      'gen_ai.request.model': 'gemini/gemini-3.6-flash',
      'gen_ai.provider.name': 'gcp.gen_ai',
      'gen_ai.usage.input_tokens': 50,
      'gen_ai.usage.output_tokens': 8,
      'gen_ai.usage.cache_read.input_tokens': 30,
      'gen_ai.usage.reasoning.output_tokens': 2,
      'gen_ai.request.temperature': 0.1,
      'gen_ai.request.max_tokens': 64,
      'gen_ai.request.stream': true,
      'gen_ai.system_instructions': [{type: 'text', content: 'Be helpful.'}],
      'gen_ai.input.messages': [
        {role: 'user', parts: [{type: 'text', content: 'Who is Alex?'}]},
        {
          role: 'assistant',
          parts: [{type: 'tool_call', id: 'c1', name: 'lookup', arguments: {name: 'Alex'}}],
        },
        {
          role: 'tool',
          parts: [{type: 'tool_call_response', id: 'c1', response: '{"title":"Engineer"}'}],
        },
      ],
      'gen_ai.tool.definitions': [
        {type: 'function', name: 'lookup', description: 'Looks up', parameters: {type: 'object'}},
      ],
      'gen_ai.output.messages': [
        {
          role: 'assistant',
          parts: [{type: 'text', content: 'Alex is an engineer.'}],
          finish_reason: 'stop',
        },
      ],
      'gen_ai.response.finish_reasons': ['stop'],
    });
    const tool = translated(
      span('lookup', {
        'openinference.span.kind': 'TOOL',
        'tool.name': 'lookup',
        'input.value': '{"name": "Alex"}',
        'output.value': '{"title": "Engineer"}',
      }),
    );
    assert.equal(tool['gen_ai.tool.name'], 'lookup');
    assert.deepEqual(tool['gen_ai.tool.call.arguments'], {name: 'Alex'});
    assert.deepEqual(tool['gen_ai.tool.call.result'], {title: 'Engineer'});
  });

  it("reads the current conventions as written, content parsed, the producer's own names left in the received attributes", () => {
    const received = span('litellm.chat', {
      'gen_ai.operation.name': 'chat',
      'gen_ai.system': 'gemini',
      'gen_ai.request.model': 'gemini/gemini-3.6-flash',
      'gen_ai.input.messages': JSON.stringify([
        {role: 'user', parts: [{type: 'text', content: 'Hi'}]},
      ]),
      'gen_ai.output.messages': JSON.stringify([
        {role: 'assistant', parts: [{type: 'text', content: 'Hello'}], finish_reason: 'tool_calls'},
      ]),
      'gen_ai.response.finish_reasons': ['tool_calls'],
      'gen_ai.usage.cache_creation.input_tokens': 4,
      'gen_ai.request.max_tokens': 'many',
      'llm.is_streaming': true,
      'llm.usage.total_tokens': 12,
    });
    const event = receivedEvent(received, [], undefined);
    assert.deepEqual(event.attributes, {
      'a2ui.event.kind': 'model_call',
      'otel.scope.name': 'other',
      'a2ui.received.dialect': 'genai',
      'gen_ai.operation.name': 'chat',
      'gen_ai.request.model': 'gemini/gemini-3.6-flash',
      'gen_ai.input.messages': [{role: 'user', parts: [{type: 'text', content: 'Hi'}]}],
      'gen_ai.output.messages': [
        {role: 'assistant', parts: [{type: 'text', content: 'Hello'}], finish_reason: 'tool_call'},
      ],
      'gen_ai.response.finish_reasons': ['tool_call'],
      'gen_ai.provider.name': 'gemini',
      'gen_ai.usage.cache_write.input_tokens': 4,
      'a2ui.received.attributes': received.attributes,
    });
  });

  it('leaves out a content attribute that does not fit its copied schema', () => {
    assert.equal(fittedValue('gen_ai.input.messages', [{parts: 'not a list'}]), undefined);
    assert.equal(fittedValue('gen_ai.input.messages', '{not json'), undefined);
    assert.deepEqual(fittedValue('gen_ai.input.messages', '[]'), []);
    assert.equal(fittedValue('gen_ai.usage.input_tokens', 1.5), undefined);
    assert.equal(fittedValue('gen_ai.agent.description', 42), 42);
  });

  it('normalises finish reasons as the model proxy readers do', () => {
    assert.equal(normaliseFinishReason('STOP', 'gcp.gemini'), 'stop');
    assert.equal(normaliseFinishReason('max_tokens'), 'length');
    assert.equal(normaliseFinishReason('end_turn'), 'stop');
    assert.equal(normaliseFinishReason('tool_use', 'anthropic'), 'tool_call');
    assert.equal(normaliseFinishReason('tool_calls'), 'tool_call');
    assert.equal(normaliseFinishReason('recitation'), 'content_filter');
    assert.equal(normaliseFinishReason('something_new'), 'error');
    assert.equal(normaliseFinishReason('compaction'), 'compaction');
  });

  it('keeps a log record as a span event: its time, its event name else its severity, its body and severity', () => {
    assert.deepEqual(
      logEvent({
        timeUnixNano: '9',
        eventName: 'gen_ai.choice',
        severityNumber: 9,
        severityText: 'INFO',
        body: {index: 0},
        attributes: {'gen_ai.system': 'gemini'},
        scope: ADK,
      }),
      {
        timeUnixNano: '9',
        name: 'gen_ai.choice',
        attributes: {
          'gen_ai.system': 'gemini',
          'a2ui.received.log.body': {index: 0},
          'a2ui.received.log.severity_number': 9,
          'a2ui.received.log.severity_text': 'INFO',
        },
      },
    );
    assert.equal(
      logEvent({timeUnixNano: '9', severityText: 'WARNING', attributes: {}, scope: ADK}).name,
      'WARNING',
    );
    const event = receivedEvent(
      {...span('s', {}), events: [{timeUnixNano: '160', name: 'exception'}]},
      [log('gen_ai.choice', {index: 0})],
      undefined,
    );
    assert.deepEqual(
      event.events?.map(({name}) => name),
      ['gen_ai.choice', 'exception'],
    );
  });

  it('reads a span of no dialect as a framework span with nothing translated', () => {
    assert.deepEqual(readSpan(span('POST /', {'http.method': 'POST'}), []), {
      kind: 'framework_span',
      names: {},
    });
  });
});
