import assert from 'node:assert/strict';
import {describe, it} from 'node:test';

import type {Turn, TurnEvent, TurnRecordEvent} from '../record/turn_record.js';
import {assembleTurn, type PlacedSpan} from './assemble.js';
import type {ReceivedSpan} from './otlp.js';

const TURN = 'a'.repeat(32);
const TURN_SPAN = 'f'.repeat(16);
const OTHER = 'b'.repeat(32);
const ADK = {name: 'gcp.vertex.agent', version: '2.3.0'};

function turnEvent(): TurnEvent {
  return {
    traceId: TURN,
    spanId: TURN_SPAN,
    name: 'invoke_agent',
    kind: 3,
    startTimeUnixNano: '0',
    endTimeUnixNano: '1000',
    attributes: {
      'a2ui.event.kind': 'turn',
      'gen_ai.operation.name': 'invoke_agent',
      'a2ui.turn.outcome': 'completed',
      'a2ui.turn.capture_paths': ['wire', 'model_proxy'],
      'a2ui.turn.writer.name': 'test',
      'a2ui.turn.writer.version': '0',
    },
    status: {code: 1},
  };
}

function wire(spanId: string, at: string): TurnRecordEvent {
  return {
    traceId: TURN,
    spanId,
    parentSpanId: TURN_SPAN,
    name: 'wire_output',
    kind: 1,
    startTimeUnixNano: at,
    attributes: {
      'a2ui.event.kind': 'wire_output',
      'a2ui.wire.message': {role: 'assistant', parts: []},
    },
  };
}

function check(): TurnRecordEvent {
  return {
    traceId: TURN,
    spanId: 'c'.repeat(16),
    parentSpanId: TURN_SPAN,
    name: 'check schema',
    kind: 1,
    startTimeUnixNano: '1001',
    attributes: {
      'a2ui.event.kind': 'check',
      'a2ui.check.name': 'schema',
      'a2ui.check.passed': true,
      'a2ui.check.protocol_version': 'v0.9',
      'a2ui.check.findings': [],
    },
  };
}

/** A proxy's exchange: a model call, or a tool call with `tool`, at a start, with a traceparent when given. */
function exchange(
  spanId: string,
  start: number,
  {tool = false, traceparent}: {tool?: boolean; traceparent?: string} = {},
): TurnRecordEvent {
  return {
    traceId: TURN,
    spanId,
    parentSpanId: TURN_SPAN,
    name: tool ? 'tools/call lookup' : 'generate_content m',
    kind: 3,
    startTimeUnixNano: String(start),
    endTimeUnixNano: String(start + 10),
    attributes: {
      'a2ui.event.kind': tool ? 'tool_call' : 'model_call',
      'http.request.method': 'POST',
      ...(traceparent !== undefined && {'http.request.header.traceparent': [traceparent]}),
    },
  } as TurnRecordEvent;
}

function received(
  spanId: string,
  name: string,
  start: number,
  end: number,
  {
    parent,
    traceId = OTHER,
    attributes = {},
    scope = ADK,
  }: {
    parent?: string;
    traceId?: string;
    attributes?: Record<string, unknown>;
    scope?: {name: string; version?: string};
  } = {},
): PlacedSpan {
  const span: ReceivedSpan = {
    traceId,
    spanId,
    ...(parent !== undefined && {parentSpanId: parent}),
    name,
    kind: 1,
    startTimeUnixNano: String(start),
    endTimeUnixNano: String(end),
    attributes,
    events: [],
    links: [],
    status: {code: 0},
    scope,
  };
  return {span, logs: []};
}

function event(turn: Turn, spanId: string): TurnRecordEvent {
  const found = turn.events.find(item => item.spanId === spanId);
  assert.ok(found, `no event ${spanId}`);
  return found;
}

function linked(turn: Turn, spanId: string): string[] {
  return (event(turn, spanId).links ?? []).map(link => link.spanId);
}

const S = (n: number) => String(n).padStart(16, '0');

describe('a turn with its received spans', () => {
  it("keeps the turn's own events where they are, the received ones after them and the checks last", () => {
    const turn: Turn = {events: [turnEvent(), wire(S(90), '5'), exchange(S(91), 20), check()]};
    const assembled = assembleTurn(turn, [
      received(S(2), 'call_llm', 15, 40),
      received(S(1), 'invocation', 10, 50),
    ]);
    assert.deepEqual(
      assembled.events.map(item => item.spanId),
      [TURN_SPAN, S(90), S(91), S(1), S(2), 'c'.repeat(16)],
    );
    assert.deepEqual(
      (event(assembled, TURN_SPAN) as TurnEvent).attributes['a2ui.turn.capture_paths'],
      ['wire', 'model_proxy', 'otel_receiver'],
    );
    assert.equal(assembleTurn(turn, []), turn);
  });

  it("puts the root of a tree carrying the turn's trace id under the turn event, and keeps every other parent", () => {
    const assembled = assembleTurn({events: [turnEvent()]}, [
      received(S(1), 'POST /', 10, 90, {traceId: TURN, parent: 'e'.repeat(16)}),
      received(S(2), 'invocation', 11, 80, {traceId: TURN, parent: S(1)}),
      received(S(3), 'orphan', 12, 70, {traceId: TURN, parent: S(99)}),
      received(S(4), 'own trace', 13, 60, {parent: S(98)}),
      received(S(5), 'own root', 14, 50),
    ]);
    assert.equal(event(assembled, S(1)).parentSpanId, TURN_SPAN);
    assert.equal(event(assembled, S(2)).parentSpanId, S(1));
    assert.equal(event(assembled, S(3)).parentSpanId, TURN_SPAN);
    assert.equal(event(assembled, S(4)).parentSpanId, S(98));
    assert.equal(event(assembled, S(5)).parentSpanId, undefined);
  });

  it('links an exchange by its traceparent to the chain of model call spans above the span it names', () => {
    const tree = [
      received(S(1), 'invoke_agent a', 0, 100, {traceId: TURN}),
      received(S(2), 'call_llm', 10, 90, {traceId: TURN, parent: S(1)}),
      received(S(3), 'generate_content m', 11, 89, {traceId: TURN, parent: S(2)}),
      // OpenInference's LiteLLM span, not current around the request, beside the HTTP span.
      received(S(4), 'acompletion', 12, 88, {
        traceId: TURN,
        parent: S(3),
        scope: {name: 'openinference.instrumentation.litellm'},
        attributes: {'openinference.span.kind': 'LLM'},
      }),
      received(S(5), 'POST', 20, 80, {traceId: TURN, parent: S(3), scope: {name: 'http'}}),
    ];
    const assembled = assembleTurn(
      {events: [turnEvent(), exchange(S(91), 21, {traceparent: `00-${TURN}-${S(5)}-01`})]},
      tree,
    );
    assert.deepEqual(linked(assembled, S(91)), [S(2), S(3), S(4)]);
    for (const spanId of [S(2), S(3), S(4)]) assert.deepEqual(linked(assembled, spanId), [S(91)]);
    assert.deepEqual(linked(assembled, S(1)), []);
    assert.deepEqual(linked(assembled, S(5)), []);
  });

  it('links an exchange without trace context to the model call spans holding its start when they are one chain', () => {
    const chain = [
      received(S(2), 'call_llm', 10, 90),
      received(S(3), 'generate_content m', 11, 89, {parent: S(2)}),
    ];
    const one = assembleTurn(
      {events: [turnEvent(), exchange(S(91), 20), exchange(S(92), 95)]},
      chain,
    );
    assert.deepEqual(linked(one, S(91)), [S(2), S(3)]);
    assert.deepEqual(linked(one, S(92)), []);
    // A traceparent naming no received span, such as the turn event, is no trace context to follow.
    const named = assembleTurn(
      {events: [turnEvent(), exchange(S(91), 20, {traceparent: `00-${TURN}-${TURN_SPAN}-01`})]},
      chain,
    );
    assert.deepEqual(linked(named, S(91)), [S(2), S(3)]);
    const apart = assembleTurn({events: [turnEvent(), exchange(S(91), 20)]}, [
      received(S(2), 'call_llm', 10, 90),
      received(S(3), 'call_llm', 15, 30),
    ]);
    assert.deepEqual(linked(apart, S(91)), []);
  });

  it('links one span back to every exchange its range holds, as when the SDK retried inside it', () => {
    const assembled = assembleTurn(
      {events: [turnEvent(), exchange(S(91), 20), exchange(S(92), 40)]},
      [received(S(2), 'call_llm', 10, 90)],
    );
    assert.deepEqual(linked(assembled, S(2)), [S(91), S(92)]);
  });

  it("pairs the tool proxy's exchanges with tool call spans and the model proxy's with model call spans", () => {
    const assembled = assembleTurn(
      {events: [turnEvent(), exchange(S(91), 20, {tool: true}), exchange(S(92), 60)]},
      [received(S(2), 'execute_tool lookup', 10, 50), received(S(3), 'call_llm', 55, 90)],
    );
    assert.deepEqual(linked(assembled, S(91)), [S(2)]);
    assert.deepEqual(linked(assembled, S(92)), [S(3)]);
  });

  it("rebuilds the receiver's links each time, keeping a span's own links and any other", () => {
    const own: PlacedSpan = received(S(2), 'call_llm', 10, 90);
    own.span.links = [{traceId: OTHER, spanId: S(7), attributes: {why: 'own'}}];
    const first = assembleTurn({events: [turnEvent(), exchange(S(91), 20)]}, [own]);
    const again = assembleTurn(first, [own]);
    assert.deepEqual(again, first);
    assert.deepEqual(event(again, S(2)).links, [
      {traceId: OTHER, spanId: S(7), attributes: {why: 'own'}},
      {traceId: TURN, spanId: S(91)},
    ]);
  });
});
