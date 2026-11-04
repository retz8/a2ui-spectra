import assert from 'node:assert/strict';
import {describe, it} from 'node:test';

import {parse, promptGeneration} from '../testing/a2ui_step.ts';
import {at, byStart} from '../testing/model_calls.ts';
import {lanesOf} from './lanes.ts';
import {unixMillis} from './record.ts';
import {timelineOf} from './steps.ts';

describe("the A2UI step's lanes", () => {
  it('draws a parse and a failed prompt generation as bars from their start to their end', () => {
    const events = byStart(
      promptGeneration({spanId: 'g', start: 10, end: 14, failure: {type: 'E', message: 'm'}}),
      parse({spanId: 'p', start: 100, end: 160, input: 'x'}),
    );
    const start = unixMillis(at(0));
    const rows = timelineOf(events, start);
    const {byRow} = lanesOf(rows, start, start + 200);
    assert.deepEqual(byRow.get('g'), {
      kind: 'bar',
      start: 10,
      end: 14,
      inFlight: false,
      waitsForToken: false,
    });
    assert.deepEqual(byRow.get('p'), {
      kind: 'bar',
      start: 100,
      end: 160,
      inFlight: false,
      waitsForToken: false,
    });
  });

  it('draws one that states no end as a dot at its start', () => {
    const generation = promptGeneration({
      spanId: 'g',
      start: 50,
      failure: {type: 'E', message: 'm'},
    });
    delete generation.endTimeUnixNano;
    const start = unixMillis(at(0));
    const {byRow} = lanesOf(timelineOf([generation], start), start, start + 1500);
    assert.deepEqual(byRow.get('g'), {kind: 'dot', at: 50});
  });
});
