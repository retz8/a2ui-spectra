import assert from 'node:assert/strict';
import {describe, it} from 'node:test';

import {readRecording} from '../testing/recordings.ts';
import {followNewest, stepInView} from './follow.ts';
import {problemsOf} from './problems.ts';
import {
  isTurnEvent,
  isWireInput,
  isWireOutput,
  type TurnRecordEvent,
  unixMillis,
} from './record.ts';
import {replay} from './replay.ts';
import {timelineOf} from './steps.ts';

/**
 * A recording's last turn as the turn view sees it: open, with its first
 * `wireEvents` wire events as the live stream sends them, and closed, with
 * the record's events; each with its problems on their steps.
 */
function turnOf(name: string) {
  const {turns} = readRecording(name);
  const {events} = turns[turns.length - 1];
  const start = events.find(isTurnEvent);
  assert.ok(start);
  const startMs = unixMillis(start.startTimeUnixNano);
  const wire = events.filter(event => isWireInput(event) || isWireOutput(event));
  const viewOf = (shown: readonly TurnRecordEvent[]) => {
    const rows = timelineOf(shown, startMs);
    const problems = new Map<string, number>();
    const rejections = replay(turns.slice(0, -1), shown).rejections;
    for (const {stepId} of problemsOf(shown, rows, rejections)) {
      problems.set(stepId, (problems.get(stepId) ?? 0) + 1);
    }
    return {rows, problems};
  };
  return {
    wire: wire.length,
    open: (wireEvents: number) => viewOf(wire.slice(0, wireEvents)),
    closed: viewOf(events),
  };
}

describe('stepInView', () => {
  it('follows the newest step while the turn is open', () => {
    const turn = turnOf('file_upload_summarizer/artifact_stream_and_send');
    for (let shown = 1; shown <= turn.wire; shown++) {
      const {rows, problems} = turn.open(shown);
      assert.deepEqual(
        stepInView(rows, {open: true, picked: undefined, followed: true, problems}),
        {row: rows[rows.length - 1], following: true, selected: false},
      );
    }
  });

  it('keeps a step picked while the turn is open as new steps come, and once it closes', () => {
    const turn = turnOf('file_upload_summarizer/artifact_stream_and_send');
    const early = turn.open(1);
    const picked = early.rows[0].id;
    for (const {rows, problems, open} of [
      {...turn.open(turn.wire), open: true},
      {...turn.closed, open: false},
    ]) {
      const view = stepInView(rows, {open, picked, followed: true, problems});
      assert.equal(view.row?.id, picked);
      assert.equal(view.following, false);
      assert.equal(view.selected, true);
    }
  });

  it('follows the newest step again once the pick is let go of', () => {
    const turn = turnOf('file_upload_summarizer/artifact_stream_and_send');
    const {rows, problems} = turn.open(turn.wire);
    assert.equal(
      stepInView(rows, {open: true, picked: undefined, followed: true, problems}).following,
      true,
    );
  });

  it('lands on the first step with a problem when a followed turn closes', () => {
    const {rows, problems} = turnOf('file_upload_summarizer/artifact_stream_and_send').closed;
    const view = stepInView(rows, {open: false, picked: undefined, followed: true, problems});
    assert.equal(view.row?.row === 'step' ? view.row.messageKey : undefined, '2.4');
    assert.equal(view.selected, true);
  });

  it("lands on a failed turn's outcome, its reason being its problem", () => {
    const {rows, problems} = turnOf('ag2/stream_v1_0_failed').closed;
    const view = stepInView(rows, {open: false, picked: undefined, followed: true, problems});
    assert.equal(view.row?.id, 'outcome');
    assert.equal(view.selected, true);
  });

  it('lands on the final state, with no step selected, when a followed turn closes with no problems', () => {
    const {rows, problems} = turnOf('stub_agent/cancel_a2a_1_0').closed;
    assert.equal(problems.size, 0);
    assert.deepEqual(stepInView(rows, {open: false, picked: undefined, followed: true, problems}), {
      row: rows[rows.length - 1],
      following: false,
      selected: false,
    });
  });

  it('shows the final state of a turn opened once closed, with no step selected', () => {
    const {rows, problems} = turnOf('file_upload_summarizer/artifact_stream_and_send').closed;
    assert.deepEqual(
      stepInView(rows, {open: false, picked: undefined, followed: false, problems}),
      {row: rows[rows.length - 1], following: false, selected: false},
    );
  });
});

describe('followNewest', () => {
  it('selects the newest turn when none is selected', () => {
    assert.equal(followNewest(undefined, 'b', undefined), 'b');
    assert.equal(followNewest('b', 'b', undefined), 'b');
  });

  it('selects a new turn as it opens while the newest before it is selected', () => {
    assert.equal(followNewest('a', 'b', 'a'), 'b');
  });

  it('leaves the selection on an older turn when a new one opens', () => {
    assert.equal(followNewest('b', 'c', 'a'), undefined);
  });

  it('leaves the selection as it is while the newest stays the same', () => {
    assert.equal(followNewest('b', 'b', 'a'), undefined);
    assert.equal(followNewest('b', 'b', 'b'), undefined);
    assert.equal(followNewest(undefined, undefined, 'a'), undefined);
  });
});
