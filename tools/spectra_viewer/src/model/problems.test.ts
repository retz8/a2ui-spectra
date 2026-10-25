import assert from 'node:assert/strict';
import {describe, it} from 'node:test';

import {readRecording} from '../testing/recordings.ts';
import {listedProblemCount, onlyProblems, problemsOf} from './problems.ts';
import {isTurnEvent, type Turn, type TurnRecordEvent, unixMillis} from './record.ts';
import {replay} from './replay.ts';
import {timelineOf} from './steps.ts';

/** A recording's last turn's problems, each step named by its message's key, or by its id when it has none. */
function problemsOfRecording(name: string, extra: TurnRecordEvent[] = []) {
  const {turns} = readRecording(name);
  const turn: Turn = {events: [...turns[turns.length - 1].events, ...extra]};
  const start = turn.events.find(isTurnEvent);
  assert.ok(start);
  const rows = timelineOf(turn.events, unixMillis(start.startTimeUnixNano));
  const keys = new Map(rows.map(row => [row.id, row.row === 'step' ? row.messageKey : undefined]));
  return problemsOf(turn.events, rows, replay(turns.slice(0, -1), turn.events).rejections).map(
    ({stepId, ...problem}) => ({step: keys.get(stepId) ?? stepId, ...problem}),
  );
}

/** The schema check's finding on the flawed booking's turn, as the tool's schema check writes it. */
const FLAWED_BOOKING_FINDING = {
  code: 'VALIDATION_FAILED',
  message: "must have required property 'surfaceId'",
  path: '/events/2/attributes/a2ui.wire.message/parts/5/content/updateDataModel',
};

function check(
  findings: Array<{code: string; message: string; path?: string}>,
  version = 'v1.0',
): TurnRecordEvent {
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
      'a2ui.check.protocol_version': version,
      'a2ui.check.findings': findings,
    },
  };
}

describe('problemsOf', () => {
  it('puts a rejection on the step of the message the processor rejected', () => {
    assert.deepEqual(problemsOfRecording('file_upload_summarizer/artifact_stream_and_send'), [
      {
        step: '2.4',
        sentence: 'Surface file_upload_surface_b88930f6 already exists.',
        code: 'INTEGRITY_ERROR · A2UI web core',
        surfaceId: 'file_upload_surface_b88930f6',
      },
    ]);
  });

  it("puts a failed turn's reason on the outcome, saying the agent gave it", () => {
    assert.deepEqual(problemsOfRecording('ag2/stream_v1_0_failed'), [
      {
        step: 'outcome',
        sentence: 'The scripted model failed.',
        code: 'The reason the agent gave · outcome failed',
      },
    ]);
  });

  it('says only that a failed turn failed when its agent gave no reason', () => {
    const outcome = problemsOfRecording('node_restaurant_finder/send_task_history_and_failed').find(
      problem => problem.step === 'outcome',
    );
    assert.deepEqual(outcome, {
      step: 'outcome',
      sentence: 'The turn failed.',
      code: 'outcome failed',
    });
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
      problems.map(({step, code, inner}) => ({step, code, inner})),
      [
        {
          step: '4.1.2',
          code: 'VALIDATION_FAILED · schema check, A2UI v1.0',
          inner: '/callFunction',
        },
        {
          step: 'outcome',
          code: 'SCHEMA_VERSIONS_MIXED · schema check, A2UI v1.0',
          inner: undefined,
        },
        {step: '4.1.2', code: 'VALIDATION_ERROR · A2UI web core', inner: undefined},
      ],
    );
  });
});

describe("the flawed booking's problems", () => {
  it('marks where the schema check and web core say each message went wrong, its own branch of the union only', () => {
    assert.deepEqual(
      problemsOfRecording('stub_agent/flawed_booking_a2a_1_0', [
        check([FLAWED_BOOKING_FINDING], 'v0.9'),
      ]),
      [
        {
          step: '2.5',
          sentence: "must have required property 'surfaceId'",
          code: 'VALIDATION_FAILED · schema check, A2UI v0.9',
          inner: '/updateDataModel',
        },
        {
          step: '2.2',
          sentence:
            "Validation failed for component 'Button' (submit): root: Unrecognized key(s) in object: 'colour'",
          code: 'VALIDATION_ERROR · A2UI web core',
          surfaceId: 'booking',
          inner: '/updateComponents/components/3/colour',
        },
        {
          step: '2.4',
          sentence: 'Surface not found for message: confirmation',
          code: 'INTEGRITY_ERROR · A2UI web core',
          surfaceId: 'confirmation',
        },
        {
          step: '2.5',
          sentence:
            'Invalid v0.9 message: updateDataModel.surfaceId: Expected string, received undefined',
          code: 'VALIDATION_ERROR · A2UI web core',
          inner: '/updateDataModel/surfaceId',
        },
      ],
    );
  });
});

describe('onlyProblems', () => {
  it('keeps the steps with problems, under the row of the delivery they came in', () => {
    const {turns} = readRecording('stub_agent/flawed_booking_a2a_1_0');
    const events = [...turns[0].events, check([FLAWED_BOOKING_FINDING], 'v0.9')];
    const start = events.find(isTurnEvent);
    assert.ok(start);
    const rows = timelineOf(events, unixMillis(start.startTimeUnixNano));
    const problems = new Map<string, number>();
    for (const {stepId} of problemsOf(events, rows, replay([], events).rejections)) {
      problems.set(stepId, (problems.get(stepId) ?? 0) + 1);
    }
    const kept = onlyProblems(rows, problems);
    assert.deepEqual(
      kept.map(row => (row.row === 'delivery' ? 'delivery' : (row.messageKey ?? row.id))),
      ['delivery', '2.2', '2.4', '2.5'],
    );
    assert.equal(kept.filter(row => row.row === 'step').length, 3);
    assert.equal(rows.filter(row => row.row === 'step').length, 8);
  });

  it("keeps a failed turn's outcome, its reason being its problem", () => {
    const {turns} = readRecording('ag2/stream_v1_0_failed');
    const {events} = turns[0];
    const start = events.find(isTurnEvent);
    assert.ok(start);
    const rows = timelineOf(events, unixMillis(start.startTimeUnixNano));
    assert.deepEqual(
      onlyProblems(rows, new Map([['outcome', 1]])).map(row => row.id),
      ['outcome'],
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
