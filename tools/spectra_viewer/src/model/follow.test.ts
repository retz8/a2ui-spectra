import assert from 'node:assert/strict';
import {describe, it} from 'node:test';

import {readRecording} from '../testing/recordings.ts';
import {followNewest, keptPick, nextProblem, pickForKey, stepInView} from './follow.ts';
import {onlyProblems, problemsOf} from './problems.ts';
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
      assert.deepEqual(stepInView(rows, {open: true, picked: undefined, problems}), {
        row: rows[rows.length - 1],
        following: true,
        selected: false,
      });
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
      const view = stepInView(rows, {open, picked, problems});
      assert.equal(view.row?.id, picked);
      assert.equal(view.following, false);
      assert.equal(view.selected, true);
    }
  });

  it('follows the newest step again once the pick is let go of', () => {
    const turn = turnOf('file_upload_summarizer/artifact_stream_and_send');
    const {rows, problems} = turn.open(turn.wire);
    assert.equal(stepInView(rows, {open: true, picked: undefined, problems}).following, true);
  });

  it('lands on the first step with a problem when the turn closes', () => {
    const {rows, problems} = turnOf('file_upload_summarizer/artifact_stream_and_send').closed;
    const view = stepInView(rows, {open: false, picked: undefined, problems});
    assert.equal(view.row?.row === 'step' ? view.row.messageKey : undefined, '2.4');
    assert.equal(view.selected, true);
  });

  it("lands on a failed turn's outcome, its reason being its problem", () => {
    const {rows, problems} = turnOf('ag2/stream_v1_0_failed').closed;
    const view = stepInView(rows, {open: false, picked: undefined, problems});
    assert.equal(view.row?.id, 'outcome');
    assert.equal(view.selected, true);
  });

  it('lands on the final state, with no step selected, when the turn closes with no problems', () => {
    const {rows, problems} = turnOf('stub_agent/cancel_a2a_1_0').closed;
    assert.equal(problems.size, 0);
    assert.deepEqual(stepInView(rows, {open: false, picked: undefined, problems}), {
      row: rows[rows.length - 1],
      following: false,
      selected: false,
    });
  });

  it("opens the flawed booking's turn on its first problem, the booking form's updateComponents", () => {
    const {rows, problems} = turnOf('stub_agent/flawed_booking_a2a_1_0').closed;
    const view = stepInView(rows, {open: false, picked: undefined, problems});
    assert.equal(view.row?.row === 'step' ? view.row.messageKey : undefined, '2.2');
    assert.equal(view.selected, true);
  });

  it('lands on the first problem when the filter hides the step picked', () => {
    const {rows, problems} = turnOf('stub_agent/flawed_booking_a2a_1_0').closed;
    const kept = onlyProblems(rows, problems);
    const input = rows[0].id;
    assert.equal(keptPick(input, kept), undefined);
    const view = stepInView(kept, {open: false, picked: keptPick(input, kept), problems});
    assert.equal(view.row?.row === 'step' ? view.row.messageKey : undefined, '2.2');
    assert.equal(view.selected, true);
  });

  it('keeps a pick the filter keeps, a delivery kept above its steps with problems included', () => {
    const {rows, problems} = turnOf('stub_agent/flawed_booking_a2a_1_0').closed;
    const kept = onlyProblems(rows, problems);
    const delivery = rows.find(row => row.row === 'delivery');
    const last = kept[kept.length - 1].id;
    assert.ok(delivery);
    assert.equal(keptPick(delivery.id, kept), delivery.id);
    assert.equal(keptPick(last, kept), last);
    assert.equal(keptPick(undefined, kept), undefined);
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

describe('pickForKey', () => {
  const {rows} = turnOf('stub_agent/flawed_booking_a2a_1_0').closed;
  const ids = rows.map(row => row.id);
  const last = ids[ids.length - 1];

  it('picks the row above or below the row in view, and stays at either end', () => {
    assert.deepEqual(pickForKey(rows, ids[2], 'ArrowDown', {open: false, following: false}), {
      pick: ids[3],
    });
    assert.deepEqual(pickForKey(rows, ids[2], 'ArrowUp', {open: false, following: false}), {
      pick: ids[1],
    });
    assert.deepEqual(pickForKey(rows, ids[0], 'ArrowUp', {open: false, following: false}), {
      pick: ids[0],
    });
    assert.deepEqual(pickForKey(rows, last, 'ArrowDown', {open: false, following: false}), {
      pick: last,
    });
  });

  it('picks a delivery’s row like a step’s', () => {
    const delivery = rows.findIndex(row => row.row === 'delivery');
    assert.ok(delivery > 0);
    assert.deepEqual(
      pickForKey(rows, ids[delivery - 1], 'ArrowDown', {open: false, following: false}),
      {
        pick: ids[delivery],
      },
    );
  });

  it('picks the first row with Home and the last with End', () => {
    assert.deepEqual(pickForKey(rows, ids[3], 'Home', {open: false, following: false}), {
      pick: ids[0],
    });
    assert.deepEqual(pickForKey(rows, ids[3], 'End', {open: false, following: false}), {
      pick: last,
    });
  });

  it('lets go of the pick with End on an open turn, to follow the newest step again', () => {
    assert.deepEqual(pickForKey(rows, ids[3], 'End', {open: true, following: false}), {
      pick: undefined,
    });
  });

  it('moves nowhere with Down while the newest step is followed, and stops following with Up', () => {
    assert.equal(pickForKey(rows, last, 'ArrowDown', {open: true, following: true}), undefined);
    assert.deepEqual(pickForKey(rows, last, 'ArrowUp', {open: true, following: true}), {
      pick: ids[ids.length - 2],
    });
  });

  it('moves nowhere in an empty timeline', () => {
    assert.equal(pickForKey([], undefined, 'ArrowDown', {open: true, following: false}), undefined);
  });
});

describe('nextProblem', () => {
  const {rows, problems} = turnOf('stub_agent/flawed_booking_a2a_1_0').closed;
  const marked = rows.filter(row => (problems.get(row.id) ?? 0) > 0).map(row => row.id);
  const first = rows[0].id;

  it('goes through the steps with problems in timeline order, wrapping around at the end', () => {
    assert.equal(marked.length, 3);
    assert.equal(nextProblem(rows, problems, first, {backwards: false}), marked[0]);
    assert.equal(nextProblem(rows, problems, marked[0], {backwards: false}), marked[1]);
    assert.equal(nextProblem(rows, problems, marked[1], {backwards: false}), marked[2]);
    assert.equal(nextProblem(rows, problems, marked[2], {backwards: false}), marked[0]);
  });

  it('goes backwards with Shift, wrapping around at the start', () => {
    assert.equal(nextProblem(rows, problems, marked[2], {backwards: true}), marked[1]);
    assert.equal(nextProblem(rows, problems, marked[0], {backwards: true}), marked[2]);
    assert.equal(nextProblem(rows, problems, first, {backwards: true}), marked[2]);
  });

  it('starts from the first problem when no row is in view', () => {
    assert.equal(nextProblem(rows, problems, undefined, {backwards: false}), marked[0]);
    assert.equal(nextProblem(rows, problems, undefined, {backwards: true}), marked[2]);
  });

  it('stays on the only problem, and finds none in a turn without problems', () => {
    const only = new Map([[marked[1], 1]]);
    assert.equal(nextProblem(rows, only, marked[1], {backwards: false}), marked[1]);
    assert.equal(nextProblem(rows, only, marked[1], {backwards: true}), marked[1]);
    assert.equal(nextProblem(rows, new Map(), first, {backwards: false}), undefined);
  });
});
