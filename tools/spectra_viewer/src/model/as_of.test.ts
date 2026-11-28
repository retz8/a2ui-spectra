import assert from 'node:assert/strict';
import {describe, it} from 'node:test';

import {readTestData} from '../testing/recordings.ts';
import {asOfLabel, positionOf, resultMomentOf} from './as_of.ts';
import type {TurnRecordEvent} from './record.ts';
import {type TimelineRow, timelineOf} from './steps.ts';
import {summaryOf} from './summary.ts';

const [turn] = readTestData('turn_record/v0_1/full_record_retried_parse.json').turns;
const {events} = turn;
const summary = summaryOf(turn);
assert.ok(summary, 'The record has no turn event.');
const startMs = summary.startTime;
const rows = timelineOf(events, startMs);

function rowOf(id: string): TimelineRow {
  const row = rows.find(each => each.id === id);
  assert.ok(row, `No row ${id}.`);
  return row;
}

const FIRST_CALL = 'd2b5e8a17c4f9603';
const FAILED_PARSE = 'e9f3a6c15b8d2704';
const RETRY = 'f1c7d4b28e5a3906';
const READ_PARSE = 'a5e1b8d36f2c4807';
const DELIVERY = 'delivery-2d8c5f0a7b3e1649';
const MESSAGE = 'message-2d8c5f0a7b3e1649.1.0';

describe('positionOf', () => {
  it('stands after a step at its position, after a delivery at its whole event, and nowhere for the outcome', () => {
    assert.deepEqual(positionOf(rowOf(MESSAGE)), {eventIndex: 7, partIndex: 1, index: 0});
    assert.deepEqual(positionOf(rowOf(DELIVERY)), {eventIndex: 7});
    assert.equal(positionOf(rowOf('outcome')), undefined);
    assert.equal(positionOf(undefined), undefined);
  });
});

describe('resultMomentOf', () => {
  it('is a call’s end, and a parse’s last traced message', () => {
    assert.equal(resultMomentOf(rowOf(FIRST_CALL), events, startMs), 2000);
    assert.equal(resultMomentOf(rowOf(RETRY), events, startMs), 5000);
    assert.equal(resultMomentOf(rowOf(READ_PARSE), events, startMs), 5100);
  });

  it('is none for a parse no message is traced to, a delivery, another step or no row', () => {
    assert.equal(resultMomentOf(rowOf(FAILED_PARSE), events, startMs), undefined);
    assert.equal(resultMomentOf(rowOf(DELIVERY), events, startMs), undefined);
    assert.equal(resultMomentOf(rowOf(MESSAGE), events, startMs), undefined);
    assert.equal(resultMomentOf(undefined, events, startMs), undefined);
  });

  it('is the present, Infinity, for a call still in flight', () => {
    const open = events.map(event =>
      event.spanId === FIRST_CALL
        ? ({...event, endTimeUnixNano: undefined} as TurnRecordEvent)
        : event,
    );
    const row = timelineOf(open, startMs).find(each => each.id === FIRST_CALL);
    assert.equal(resultMomentOf(row, open, startMs), Infinity);
    assert.equal(asOfLabel(row, open, startMs), 'Live · the call is in flight');
  });
});

describe('asOfLabel', () => {
  it('says the moment each kind of row shows', () => {
    assert.deepEqual(
      rows.map(row => asOfLabel(row, events, startMs)),
      [
        'After the step at +4 ms',
        'At the end of the call, +2.0 s',
        'Right after the parse at +2.0 s',
        'At the end of the call, +5.0 s',
        'After the parse’s last message, +5.1 s',
        'After the delivery at +5.1 s',
        'After the step at +5.1 s',
        'After the step at +5.1 s',
        'After the step at +5.2 s',
      ],
    );
  });

  it('takes a step’s moment from its position’s event when it has no offset of its own', () => {
    const {offsetMs: _, ...bare} = rowOf(MESSAGE) as TimelineRow & {offsetMs?: number};
    assert.equal(asOfLabel(bare as TimelineRow, events, startMs), 'After the step at +5.1 s');
    const {position: __, ...nowhere} = bare as TimelineRow & {position?: unknown};
    assert.equal(asOfLabel(nowhere as TimelineRow, events, startMs), '');
  });

  it('is empty for no row', () => {
    assert.equal(asOfLabel(undefined, events, startMs), '');
  });
});
