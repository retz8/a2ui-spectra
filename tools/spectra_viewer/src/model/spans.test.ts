import assert from 'node:assert/strict';
import {describe, it} from 'node:test';

import {
  a2uiDelivery,
  byStart,
  linked,
  modelCall,
  receivedSpan,
  T0,
  toolCall,
} from '../testing/model_calls.ts';
import {callRowsOf, modelReadingOf, readingOf, sourcesOfRow} from './call_rows.ts';
import {callCostOf, type Prices} from './cost.ts';
import {lanesOf, shareOf} from './lanes.ts';
import {problemsOf, rowFailureOf} from './problems.ts';
import {type OtherEvent, type TurnRecordEvent} from './record.ts';
import {type Step, timelineOf} from './steps.ts';
import {argumentsOf, toolFailureOf} from './tool_calls.ts';
import {insideLineOf} from './turn_calls.ts';

const START = Number(T0 / 1_000_000n);

const PRICES: Prices = {
  release: 'v1.106.6',
  date: '2026-10-28',
  entries: {
    'gemini/gemini-3.6-flash': {
      litellm_provider: 'gemini',
      input_cost_per_token: 0.5e-6,
      output_cost_per_token: 3e-6,
    },
  },
  overrides: {},
};

function steps(events: TurnRecordEvent[]): Step[] {
  return timelineOf(events, START).filter(
    (row): row is Step => row.row === 'step' && row.call !== undefined,
  );
}

/** ADK's call_llm around generate_content around OpenInference's acompletion, with no exchange. */
function chainOfThree(): TurnRecordEvent[] {
  return [
    receivedSpan({
      spanId: '1'.repeat(16),
      name: 'call_llm',
      start: 100,
      end: 2500,
      names: {
        'gen_ai.request.model': 'gemini/gemini-3.6-flash',
        'gen_ai.usage.input_tokens': 999,
        'gen_ai.usage.output_tokens': 9,
        'gen_ai.system_instructions': [{type: 'text', content: 'Outer prompt.'}],
      },
    }),
    receivedSpan({
      spanId: '2'.repeat(16),
      parentSpanId: '1'.repeat(16),
      name: 'generate_content gemini/gemini-3.6-flash',
      start: 101,
      end: 2499,
      names: {'gen_ai.provider.name': 'gcp.gemini'},
    }),
    receivedSpan({
      spanId: '3'.repeat(16),
      parentSpanId: '2'.repeat(16),
      name: 'acompletion',
      start: 102,
      end: 2498,
      dialect: 'openinference',
      scope: {name: 'openinference.instrumentation.litellm', version: '0.1.52'},
      names: {
        'gen_ai.provider.name': 'gcp.gen_ai',
        'gen_ai.request.model': 'gemini/gemini-3.6-flash',
        'gen_ai.usage.input_tokens': 2000,
        'gen_ai.usage.output_tokens': 100,
        'gen_ai.input.messages': [{role: 'user', parts: [{type: 'text', content: 'Hi'}]}],
      },
    }),
  ];
}

describe('a call read from spans only', () => {
  it('is one row for a chain of one kind, named by its innermost span, filled innermost first', () => {
    const rows = steps(chainOfThree());
    assert.equal(rows.length, 1);
    const [row] = rows;
    assert.equal(row.id, '3'.repeat(16));
    assert.equal(row.label, 'gemini/gemini-3.6-flash');
    assert.equal(row.target, 'Google · OpenInference spans');
    assert.deepEqual(
      row.aliases,
      ['1', '2', '3'].map(x => x.repeat(16)),
    );
    const {event, fromSpans} = modelReadingOf(row.call!);
    assert.equal(fromSpans, true);
    assert.equal(event.attributes['gen_ai.provider.name'], 'gcp.gen_ai');
    // The token counts together from the innermost span that has input tokens.
    assert.equal(event.attributes['gen_ai.usage.input_tokens'], 2000);
    assert.equal(event.attributes['gen_ai.usage.output_tokens'], 100);
    // A name only an outer span carries comes from it.
    assert.deepEqual(event.attributes['gen_ai.system_instructions'], [
      {type: 'text', content: 'Outer prompt.'},
    ]);
    assert.deepEqual(sourcesOfRow(row.call!), ['ADK spans', 'OpenInference spans']);
  });

  it('is priced through gcp.gen_ai as gemini, the gemini/ id meeting its own key', () => {
    const [row] = steps(chainOfThree());
    const cost = callCostOf(modelReadingOf(row.call!).event, PRICES);
    assert.equal(cost.kind, 'priced');
    assert.ok(cost.kind === 'priced' && Math.abs(cost.usd - (2000 * 0.5e-6 + 100 * 3e-6)) < 1e-12);
  });

  it('joins its proxy row once linked, its id the proxy event’s', () => {
    const chain = chainOfThree();
    const proxy = linked(
      modelCall({
        spanId: 'p'.repeat(16),
        start: 110,
        end: 2400,
        provider: 'gcp.gemini',
        model: 'gemini-3.6-flash',
      }),
      ...chain.map(span => span.spanId),
    );
    const rows = steps(byStart(proxy, ...chain));
    assert.equal(rows.length, 1);
    assert.equal(rows[0].id, 'p'.repeat(16));
    assert.equal(rows[0].target, 'Gemini');
    assert.deepEqual(sourcesOfRow(rows[0].call!), [
      'Model proxy',
      'ADK spans',
      'OpenInference spans',
    ]);
    assert.equal(readingOf(rows[0].call!).fromSpans, false);
  });
});

describe('a pair left unlinked', () => {
  it('is two rows, Gemini against Gemini · ADK spans', () => {
    const proxy = modelCall({
      spanId: 'p'.repeat(16),
      start: 10,
      end: 500,
      provider: 'gcp.gemini',
      model: 'gemini-3.6-flash',
    });
    const span = receivedSpan({
      spanId: 's'.repeat(16),
      name: 'generate_content gemini-3.6-flash',
      start: 600,
      end: 700,
      names: {'gen_ai.provider.name': 'gcp.gemini', 'gen_ai.request.model': 'gemini-3.6-flash'},
    });
    assert.deepEqual(
      steps(byStart(proxy, span)).map(row => `${row.label} · ${row.target}`),
      ['gemini-3.6-flash · Gemini', 'gemini-3.6-flash · Gemini · ADK spans'],
    );
  });
});

describe('a proxy tool call linked to a received tool span', () => {
  it('is one row, the proxy’s reading filling it, both sources named', () => {
    const span = receivedSpan({
      spanId: 's'.repeat(16),
      kind: 'tool_call',
      name: 'execute_tool list_runs',
      start: 100,
      end: 1500,
      names: {'gen_ai.tool.name': 'list_runs', 'gen_ai.tool.call.arguments': {from: 'span'}},
    });
    const proxy = linked(
      toolCall({
        spanId: 'p'.repeat(16),
        start: 120,
        end: 1400,
        method: 'tools/call',
        tool: 'list_runs',
        arguments: {limit: 5},
        url: 'https://mcp.circleci.com/v1/mcp',
      }),
      span.spanId,
    );
    const rows = steps(byStart(span, proxy));
    assert.equal(rows.length, 1);
    assert.equal(rows[0].id, 'p'.repeat(16));
    assert.equal(`${rows[0].label} · ${rows[0].target}`, 'list_runs · MCP · mcp.circleci.com');
    assert.deepEqual(sourcesOfRow(rows[0].call!), ['Tool proxy', 'ADK spans']);
    assert.deepEqual(argumentsOf(rows[0].call!), {limit: 5});
  });
});

describe('a failed call', () => {
  const tool = (type: string, attributes: Record<string, unknown> = {}) =>
    toolCall({
      spanId: 't'.repeat(16),
      start: 0,
      end: 10,
      method: 'tools/call',
      tool: 'echo',
      status: {code: 2, message: 'Recorded.'},
      attributes: {'error.type': type, ...attributes},
    }) as OtherEvent;

  it('reads by its kind, the code and the source on the second line', () => {
    const forms = ['-32602', '502', 'cancelled', 'aborted', 'ECONNREFUSED'].map(type => {
      const failure = toolFailureOf(tool(type))!;
      return [failure.sentence, failure.code];
    });
    assert.deepEqual(forms, [
      ['The tool server answered a JSON-RPC error.', 'JSON-RPC -32602 · MCP'],
      ['The tool server answered 502 Bad Gateway.', 'HTTP 502 · MCP'],
      ['The agent cancelled the request before it was answered.', 'cancelled · MCP'],
      ['The connection closed before the request was answered.', 'aborted · MCP'],
      ['The tool server could not be reached: ECONNREFUSED.', 'ECONNREFUSED · MCP'],
    ]);
    const http = toolCall({
      spanId: 'h'.repeat(16),
      start: 0,
      end: 10,
      status: {code: 2},
      attributes: {'error.type': '404'},
    }) as OtherEvent;
    assert.deepEqual(toolFailureOf(http), {
      sentence: 'The tool server answered 404 Not Found.',
      code: 'HTTP 404 · HTTP',
    });
    // The tool's own isError is shown in the Result and is not a failure.
    assert.equal(toolFailureOf({...tool('tool_error'), status: {code: 1}}), undefined);
  });

  it('read from spans only says the agent’s span ended in error', () => {
    const span = receivedSpan({
      spanId: 's'.repeat(16),
      name: 'generate_content gemini-3.6-flash',
      start: 0,
      end: 10,
      status: {code: 2, message: '429 RESOURCE_EXHAUSTED'},
    });
    const [row] = callRowsOf([span]);
    assert.deepEqual(rowFailureOf(row), {
      sentence: "The agent's span ended in error.",
      code: 'Span status error · ADK spans',
      note: '429 RESOURCE_EXHAUSTED',
    });
  });

  it('is one problem for a linked pair where both sides failed, the span’s message joining the third line', () => {
    const span = receivedSpan({
      spanId: 's'.repeat(16),
      name: 'generate_content gemini-3.6-flash',
      start: 0,
      end: 300,
      status: {code: 2, message: 'Span saw it fail.'},
    });
    const proxy = linked(
      modelCall({
        spanId: 'p'.repeat(16),
        start: 5,
        end: 250,
        provider: 'gcp.gemini',
        model: 'gemini-3.6-flash',
        status: {code: 2, message: 'Proxy saw it fail.'},
        attributes: {'error.type': '429', 'http.response.status_code': 429},
      }),
      span.spanId,
    );
    const events = byStart(span, proxy);
    const problems = problemsOf(events, timelineOf(events, START), []);
    assert.deepEqual(problems, [
      {
        stepId: 'p'.repeat(16),
        sentence: 'The model API answered 429 Too Many Requests.',
        code: 'HTTP 429 · Gemini API',
        note: 'Proxy saw it fail. · Span saw it fail.',
      },
    ]);
  });
});

describe('the header’s second line with tool calls and spans', () => {
  it('counts the full tool rows and a span-only call’s tokens in its totals', () => {
    const housekeeping = toolCall({spanId: 'h'.repeat(16), start: 5, end: 8, method: 'initialize'});
    const read = toolCall({
      spanId: 'r'.repeat(16),
      start: 10,
      end: 30,
      method: 'resources/read',
      attributes: {'mcp.resource.uri': 'ui://floor-plan-server/map'},
    });
    const proxied = modelCall({
      spanId: 'p'.repeat(16),
      start: 40,
      end: 900,
      provider: 'gcp.gemini',
      model: 'gemini/gemini-3.6-flash',
      usage: {input: 1000, output: 100},
      chunks: [600],
    });
    const events = byStart(housekeeping, read, proxied, ...chainOfThree().map(shifted(1000)));
    assert.deepEqual(insideLineOf(events, START, PRICES), [
      'First token 600 ms',
      '2 model calls',
      '1 tool call',
      '3.0k in',
      '200 out',
      'Est. $0.0021',
      'LiteLLM prices 2026-10-28',
    ]);
  });

  it('times the first token to a span-only first call’s end', () => {
    const line = insideLineOf(chainOfThree(), START, PRICES)!;
    assert.equal(line[0], 'First token 2.5 s');
  });
});

describe('the time lane', () => {
  it('draws calls as bars and steps as dots from the turn’s start to the latest end', () => {
    const call = modelCall({
      spanId: 'p'.repeat(16),
      start: 100,
      end: 1100,
      provider: 'gcp.gemini',
      model: 'gemini-3.6-flash',
      chunks: [600, 700],
    });
    const tool = toolCall({
      spanId: 't'.repeat(16),
      start: 1200,
      end: 1300,
      method: 'tools/call',
      tool: 'x',
    });
    const delivery = a2uiDelivery('d'.repeat(16), 1400);
    // A span placed after the agent's last reply, at 1,000 ms past the turn's end.
    const late = receivedSpan({
      spanId: 's'.repeat(16),
      kind: 'tool_call',
      name: 'execute_tool late',
      start: 1500,
      end: 2000,
    });
    const rows = timelineOf(byStart(call, tool, delivery, late), START);
    const lanes = lanesOf(rows, START, START + 1000);
    assert.equal(lanes.total, 2000);
    assert.deepEqual(lanes.byRow.get('p'.repeat(16)), {
      kind: 'bar',
      start: 100,
      end: 1100,
      firstToken: 600,
      inFlight: false,
      waitsForToken: false,
    });
    assert.deepEqual(lanes.byRow.get('t'.repeat(16)), {
      kind: 'bar',
      start: 1200,
      end: 1300,
      inFlight: false,
      waitsForToken: false,
    });
    assert.deepEqual(lanes.byRow.get(`message-${'d'.repeat(16)}.0`), {kind: 'dot', at: 1400});
    assert.equal(shareOf(1500, lanes.total), 75);
  });

  it('grows an in-flight call’s bar to the present, the lighter tone alone before its first token', () => {
    const call = modelCall({spanId: 'p'.repeat(16), start: 100, provider: 'gcp.gemini'});
    const rows = timelineOf([call], START);
    const lanes = lanesOf(rows, START, START + 800);
    assert.deepEqual(lanes.byRow.get('p'.repeat(16)), {
      kind: 'bar',
      start: 100,
      end: 800,
      inFlight: true,
      waitsForToken: true,
    });
    assert.equal(lanes.total, 800);
  });
});

/** A span moved later by `ms`. */
function shifted(ms: number): (event: TurnRecordEvent) => TurnRecordEvent {
  const by = BigInt(ms) * 1_000_000n;
  return event => ({
    ...event,
    startTimeUnixNano: (BigInt(event.startTimeUnixNano) + by).toString(),
    ...(event.endTimeUnixNano !== undefined && {
      endTimeUnixNano: (BigInt(event.endTimeUnixNano) + by).toString(),
    }),
  });
}
