import assert from 'node:assert/strict';
import {describe, it} from 'node:test';

import {readTestData} from '../testing/recordings.ts';
import {
  failedCallsOf,
  modelReadingOf,
  readingOf,
  sourceLinesOf,
  sourcesOfRow,
} from './call_rows.ts';
import {callCostOf, type Prices} from './cost.ts';
import {problemsOf} from './problems.ts';
import {isTurnEvent, type Turn, unixMillis} from './record.ts';
import {type Step, timelineOf} from './steps.ts';
import {argumentsOf, resultOf} from './tool_calls.ts';
import {insideLineOf} from './turn_calls.ts';

/** A turn of a record of the shared test data: the last unless named. */
function turnOf(file: string, at = -1): Turn {
  const {turns} = readTestData(file);
  return turns[at < 0 ? turns.length + at : at];
}

function startOf(turn: Turn): number {
  return unixMillis(turn.events.find(isTurnEvent)!.startTimeUnixNano);
}

/** The timeline's call rows of a turn. */
function callStepsOf(turn: Turn): Step[] {
  return timelineOf(turn.events, startOf(turn)).filter(
    (row): row is Step => row.row === 'step' && row.call !== undefined,
  );
}

/** What each call row says: its label, its target, and whether it is housekeeping. */
function said(steps: readonly Step[]): string[] {
  return steps.map(
    step => `${step.housekeeping === true ? 'housekeeping ' : ''}${step.label} · ${step.target}`,
  );
}

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

describe("the tool capture suite's records", () => {
  for (const transport of ['streamable_http', 'http_sse']) {
    it(`rows the tools case's calls, full and housekeeping, over ${transport}`, () => {
      const turn = turnOf(`tool_capture/v0_1/tools/${transport}.json`);
      const steps = callStepsOf(turn);
      assert.deepEqual(said(steps), [
        'housekeeping initialize · MCP · 127.0.0.1',
        'housekeeping notifications/initialized · MCP · 127.0.0.1',
        'housekeeping tools/list · MCP · 127.0.0.1',
        'echo · MCP · 127.0.0.1',
        'fail · MCP · 127.0.0.1',
        'missing · MCP · 127.0.0.1',
      ]);
      // tools/call missing answered a JSON-RPC error; tools/call fail is the tool's own isError.
      const problems = problemsOf(turn.events, timelineOf(turn.events, startOf(turn)), []);
      assert.deepEqual(problems, [
        {
          stepId: steps[5].id,
          sentence: 'The tool server answered a JSON-RPC error.',
          code: 'JSON-RPC -32602 · MCP',
          note: 'MCP error -32602: Tool missing not found',
        },
      ]);
      const fail = resultOf(steps[4].call!);
      assert.equal(fail?.error, true);
      assert.equal(resultOf(steps[5].call!)?.code, -32602);
      assert.deepEqual(argumentsOf(steps[3].call!), {text: 'hello'});
      assert.deepEqual(insideLineOf(turn.events, startOf(turn), PRICES), ['3 tool calls']);
    });
  }

  it("rows a DELETE and a server's request as housekeeping, by the event's name or the method", () => {
    assert.deepEqual(
      said(callStepsOf(turnOf('tool_capture/v0_1/session_end/streamable_http.json'))),
      [
        'housekeeping initialize · MCP · 127.0.0.1',
        'housekeeping notifications/initialized · MCP · 127.0.0.1',
        'housekeeping DELETE · MCP · 127.0.0.1',
      ],
    );
    const sse = callStepsOf(turnOf('tool_capture/v0_1/sampling/http_sse.json'));
    assert.deepEqual(said(sse).slice(2), [
      'ask · MCP · 127.0.0.1',
      'housekeeping sampling/createMessage · MCP · 127.0.0.1',
    ]);
    // A server's request: its params from the message it sent, its result from the agent's answer.
    assert.deepEqual(argumentsOf(sse[3].call!), {
      messages: [{role: 'user', content: {type: 'text', text: 'Ready?'}}],
      maxTokens: 16,
    });
    assert.equal((resultOf(sse[3].call!)?.value as {model: string}).model, 'stand-in');
    assert.deepEqual(
      said(callStepsOf(turnOf('tool_capture/v0_1/sampling/streamable_http.json'))).slice(2),
      ['ask · MCP · 127.0.0.1', 'housekeeping response · MCP · 127.0.0.1'],
    );
  });

  it('rows the HTTP tools by method and path, GET /missing a problem among them', () => {
    const turn = turnOf('tool_capture/v0_1/http_routes/http.json');
    const steps = callStepsOf(turn);
    assert.deepEqual(said(steps), [
      'GET /api/json · HTTP · 127.0.0.1',
      'POST /api/json · HTTP · 127.0.0.1',
      'GET /api/events · HTTP · 127.0.0.1',
      'GET /missing · HTTP · 127.0.0.1',
    ]);
    const problems = problemsOf(turn.events, timelineOf(turn.events, startOf(turn)), []);
    assert.deepEqual(problems, [
      {
        stepId: steps[3].id,
        sentence: 'The tool server answered 404 Not Found.',
        code: 'HTTP 404 · HTTP',
      },
    ]);
    assert.deepEqual(insideLineOf(turn.events, startOf(turn), PRICES), ['4 tool calls']);
  });
});

describe("the receiver capture suite's records", () => {
  it('rows a linked pair as one row, and get_restaurants read from spans only as in the agent', () => {
    const turn = turnOf('receiver_capture/v0_1/adk_time_window/expected.json', 0);
    const steps = callStepsOf(turn);
    assert.deepEqual(said(steps), [
      'gemini-3.6-flash · Gemini',
      'get_restaurants · in the agent',
      'gemini-3.6-flash · Gemini',
      'gemini-3.6-flash · Gemini',
    ]);
    const model = steps[0].call!;
    assert.deepEqual(
      model.spans.map(span => span.name),
      ['call_llm', 'generate_content gemini-3.6-flash'],
    );
    assert.deepEqual(sourcesOfRow(model), ['Model proxy', 'ADK spans']);
    assert.deepEqual(sourceLinesOf(model), ['ADK spans · gcp.vertex.agent 2.3.0']);
    const tool = steps[1].call!;
    assert.equal(tool.proxy, undefined);
    assert.deepEqual(sourcesOfRow(tool), ['ADK spans']);
    assert.deepEqual(argumentsOf(tool), {count: 2, cuisine: 'Chinese', location: 'New York'});
    assert.ok(resultOf(tool)?.value !== undefined);
    assert.equal(readingOf(tool).fromSpans, true);
    const line = insideLineOf(turn.events, startOf(turn), PRICES)!;
    assert.ok(line.includes('3 model calls'));
    assert.ok(line.includes('1 tool call'));
  });

  for (const [name, source, scope] of [
    ['openinference', 'OpenInference spans', 'openinference.instrumentation.litellm 0.1.52'],
    ['openllmetry', 'GenAI spans', 'opentelemetry.instrumentation.litellm 0.62.4'],
  ]) {
    it(`rows the chain of three as one row with two source lines, under ${name}`, () => {
      const steps = callStepsOf(turnOf(`receiver_capture/v0_1/${name}/expected.json`));
      const models = steps.filter(step => step.call!.kind === 'model');
      assert.equal(models.length, 3);
      for (const step of models) {
        assert.equal(step.call!.spans.length, 3);
        assert.equal(step.target, 'Gemini');
        assert.deepEqual(sourcesOfRow(step.call!), ['Model proxy', 'ADK spans', source]);
        assert.deepEqual(sourceLinesOf(step.call!), [
          'ADK spans · gcp.vertex.agent 2.3.0',
          `${source} · ${scope}`,
        ]);
      }
      assert.deepEqual(said(steps.filter(step => step.call!.kind === 'tool')), [
        'get_contact_info · in the agent',
      ]);
    });
  }

  it('rows one span linked to two exchanges as two rows, the failed exchange one problem', () => {
    const turn = turnOf('receiver_capture/v0_1/several_exchanges/expected.json', 0);
    const steps = callStepsOf(turn).filter(step => step.call!.kind === 'model');
    assert.equal(steps.length, 4);
    const [failed, retried] = steps;
    assert.deepEqual(
      failed.call!.spans.map(span => span.spanId),
      retried.call!.spans.map(span => span.spanId),
    );
    const problems = problemsOf(turn.events, timelineOf(turn.events, startOf(turn)), []);
    assert.deepEqual(
      problems.map(problem => [problem.stepId, problem.sentence]),
      [[failed.id, 'The model API answered 503 Service Unavailable.']],
    );
  });

  it('reads a chain whose spans name no provider with none and no price', () => {
    // Under attach with the model variables unset: the proxy's calls are not in the turn.
    const turn = turnOf('receiver_capture/v0_1/adk_operation_details/expected.json');
    const spansOnly: Turn = {
      events: turn.events.filter(
        event =>
          !(
            event.attributes['a2ui.event.kind'] === 'model_call' &&
            !('a2ui.received.attributes' in event.attributes)
          ),
      ),
    };
    const steps = callStepsOf(spansOnly);
    assert.deepEqual(said(steps), ['gemini-3.6-flash · ADK spans']);
    const reading = modelReadingOf(steps[0].call!).event;
    assert.equal(reading.attributes['gen_ai.provider.name'], undefined);
    assert.deepEqual(callCostOf(reading, PRICES), {kind: 'unpriced', model: 'gemini-3.6-flash'});
  });
});

describe("the listing's failedCalls, as the server counts them on the same records", () => {
  const count = (file: string, at = -1) => failedCallsOf(turnOf(file, at).events);
  it('counts each failed row once, model and tool', () => {
    assert.equal(count('tool_capture/v0_1/tools/streamable_http.json'), 1);
    assert.equal(count('tool_capture/v0_1/tools/http_sse.json'), 1);
    assert.equal(count('tool_capture/v0_1/http_routes/http.json'), 1);
    assert.equal(count('tool_capture/v0_1/sampling/http_sse.json'), 0);
    assert.equal(count('receiver_capture/v0_1/several_exchanges/expected.json', 0), 1);
    assert.equal(count('receiver_capture/v0_1/openinference/expected.json'), 0);
  });
});
