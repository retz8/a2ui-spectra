import assert from 'node:assert/strict';
import {describe, it} from 'node:test';

import {readRecording} from '../testing/recordings.ts';
import {listedProblemCount, problemsOf} from './problems.ts';
import {isTurnEvent, type Turn, type TurnRecordEvent, unixMillis} from './record.ts';
import {replay} from './replay.ts';
import {timelineOf} from './steps.ts';

function problemsOfRecording(name: string, extra: TurnRecordEvent[] = []) {
  const {turns} = readRecording(name);
  const turn: Turn = {events: [...turns[turns.length - 1].events, ...extra]};
  const start = turn.events.find(isTurnEvent);
  assert.ok(start);
  const rows = timelineOf(turn.events, unixMillis(start.startTimeUnixNano));
  return problemsOf(turn.events, rows, replay(turns.slice(0, -1), turn.events).rejections);
}

function check(findings: Array<{code: string; message: string; path?: string}>): TurnRecordEvent {
  return {
    traceId: '0'.repeat(32),
    spanId: '9'.repeat(16),
    name: 'check schema',
    kind: 1,
    startTimeUnixNano: '1792800000000000000',
    attributes: {
      'a2ui.event.kind': 'check',
      'a2ui.check.name': 'schema',
      'a2ui.check.passed': false,
      'a2ui.check.protocol_version': 'v1.0',
      'a2ui.check.findings': findings,
    },
  };
}

describe('problemsOf', () => {
  it('puts a rejection on the step of the message the processor rejected', () => {
    assert.deepEqual(problemsOfRecording('file_upload_summarizer/artifact_stream_and_send'), [
      {
        stepId: 'message-2.4',
        sentence: 'Surface file_upload_surface_b88930f6 already exists.',
        code: 'INTEGRITY_ERROR · A2UI web core',
        surfaceId: 'file_upload_surface_b88930f6',
      },
    ]);
  });

  it("puts a failed turn's reason on the outcome", () => {
    assert.deepEqual(problemsOfRecording('ag2/stream_v1_0_failed'), [
      {stepId: 'outcome', sentence: 'The scripted model failed.', code: 'outcome failed'},
    ]);
  });

  it('puts a finding on the message its path names, with the path inside it, and one that names none on the outcome', () => {
    const problems = problemsOfRecording('ag2/stream_v1_0_function_call', [
      check([
        {
          code: 'VALIDATION_FAILED',
          message: 'Bad call.',
          path: '/events/4/attributes/a2ui.wire.message/parts/1/content/2/callFunction',
        },
        {code: 'SCHEMA_VERSIONS_MIXED', message: 'Mixed.'},
      ]),
    ]);
    assert.deepEqual(
      problems.map(({stepId, code, inner}) => ({stepId, code, inner})),
      [
        {
          stepId: 'message-4.1.2',
          code: 'VALIDATION_FAILED · schema check, A2UI v1.0',
          inner: '/callFunction',
        },
        {
          stepId: 'outcome',
          code: 'SCHEMA_VERSIONS_MIXED · schema check, A2UI v1.0',
          inner: undefined,
        },
        {stepId: 'message-4.1.2', code: 'VALIDATION_ERROR · A2UI web core', inner: undefined},
      ],
    );
  });
});

describe('listedProblemCount', () => {
  it('adds the findings, the rejections and a failed outcome', () => {
    assert.equal(
      listedProblemCount({outcome: 'failed', schemaCheck: {findings: 2}, rejections: 1}),
      4,
    );
    assert.equal(listedProblemCount({outcome: 'completed'}), 0);
  });
});
