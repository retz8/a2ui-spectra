import assert from 'node:assert/strict';
import {describe, it} from 'node:test';

import {readRecording} from '../testing/recordings.ts';
import {type CheckEvent, type Finding, isTurnEvent, type Turn, unixMillis} from './record.ts';
import {openFieldsOf, rowFieldsOf, schemaCheckOf, summaryOf} from './summary.ts';

/** A turn with a schema check event added. */
function withCheck(turn: Turn, passed: boolean, findings: Finding[] = []): Turn {
  const check: CheckEvent = {
    traceId: '0'.repeat(32),
    spanId: '3'.repeat(16),
    parentSpanId: '1'.repeat(16),
    name: 'check schema',
    kind: 1,
    startTimeUnixNano: '1792800000009000000',
    attributes: {
      'a2ui.event.kind': 'check',
      'a2ui.check.name': 'schema',
      'a2ui.check.passed': passed,
      'a2ui.check.protocol_version': 'v0.9',
      'a2ui.check.findings': findings,
    },
  };
  return {events: [...turn.events, check]};
}

describe('summaryOf', () => {
  it("reads a failed turn's reason, version, agent, times and conversation", () => {
    const [turn] = readRecording('ag2/stream_v1_0_failed').turns;
    const turnEvent = turn.events.find(isTurnEvent)!;
    assert.deepEqual(summaryOf(turn), {
      traceId: turnEvent.traceId,
      conversationId: turnEvent.attributes['gen_ai.conversation.id'],
      agentName: 'ag2_a2ui_agent',
      outcome: 'failed',
      statusReason: 'The scripted model failed.',
      startTime: 1792800000000,
      durationMs: 6,
      protocolVersion: 'v1.0',
      schemaCheck: {state: 'none'},
    });
  });

  it('gives no reason for a failed turn whose status has none', () => {
    const turn = readRecording('node_restaurant_finder/send_task_history_and_failed').turns[1];
    assert.equal(summaryOf(turn)?.outcome, 'failed');
    assert.equal(summaryOf(turn)?.statusReason, undefined);
  });
});

describe('openFieldsOf', () => {
  /** A closed turn's wire events, as an open turn has them, and its start. */
  function sofar(turn: Turn) {
    const startMs = unixMillis(turn.events.find(isTurnEvent)!.startTimeUnixNano);
    return {events: turn.events.filter(event => !isTurnEvent(event)), startMs};
  }

  it("runs an open turn's duration to its newest event and reads its first message's version", () => {
    const {events, startMs} = sofar(readRecording('ag2/stream_v1_0_function_call').turns[0]);
    const newest = Math.max(...events.map(event => unixMillis(event.startTimeUnixNano)));
    assert.deepEqual(openFieldsOf(events, startMs), {
      durationMs: newest - startMs,
      protocolVersion: 'v1.0',
    });
  });

  it('names no version before an A2UI message has come', () => {
    const {events, startMs} = sofar(readRecording('stub_agent/cancel_a2a_1_0').turns[0]);
    assert.equal(openFieldsOf(events, startMs).protocolVersion, undefined);
    assert.deepEqual(openFieldsOf([], startMs), {durationMs: 0});
  });
});

describe('schemaCheckOf', () => {
  const withA2ui = readRecording('strathweb_booking_wizard/send_then_stream').turns[0];
  const withoutA2ui = readRecording('stub_agent/cancel_a2a_1_0').turns[0];
  const finding: Finding = {code: 'VALIDATION_FAILED', message: 'Bad.'};

  it('is none for a turn with no schema check event', () => {
    assert.deepEqual(schemaCheckOf(withA2ui), {state: 'none'});
  });

  it('is passed for a passing check of A2UI messages', () => {
    assert.deepEqual(schemaCheckOf(withCheck(withA2ui, true)), {state: 'passed'});
  });

  it('is no A2UI for a passing check of a turn with no A2UI from the agent', () => {
    assert.deepEqual(schemaCheckOf(withCheck(withoutA2ui, true)), {state: 'no_a2ui'});
  });

  it('counts the findings of a failing check', () => {
    assert.deepEqual(schemaCheckOf(withCheck(withA2ui, false, [finding, finding])), {
      state: 'findings',
      count: 2,
    });
  });
});

describe('rowFieldsOf', () => {
  it("gives a closed turn's outcome, agent, duration, input in brief and findings, as the listing does", () => {
    const [turn] = readRecording('strathweb_booking_wizard/send_then_stream').turns;
    assert.deepEqual(
      rowFieldsOf(withCheck(turn, false, [{code: 'VALIDATION_FAILED', message: 'Bad.'}])),
      {
        outcome: 'completed',
        agentName: 'table-booking',
        durationMs: 3,
        input: {text: 'Book a table'},
        findings: 1,
      },
    );
  });

  it('leaves out what a turn does not have', () => {
    const turn = readRecording('strathweb_booking_wizard/send_then_stream').turns[1];
    assert.deepEqual(rowFieldsOf(turn), {
      outcome: 'completed',
      agentName: 'table-booking',
      durationMs: 4,
      input: {action: 'next'},
    });
  });
});
