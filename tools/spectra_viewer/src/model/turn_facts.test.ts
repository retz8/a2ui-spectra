import assert from 'node:assert/strict';
import {describe, it} from 'node:test';

import {readTestData} from '../testing/recordings.ts';
import {retriesOf} from './a2ui_step.ts';
import {catalogsOf} from './catalogs.ts';
import {legacyByStep, legacyEntriesOf, legacyKeysByPath} from './legacy_form.ts';
import {rowTagsOf} from './provenance.ts';
import {replay} from './replay.ts';
import {timelineOf} from './steps.ts';
import {summaryOf} from './summary.ts';
import {turnFactsOf, turnSurfacesOf} from './turn_facts.ts';

const record = readTestData('turn_record/v0_1/full_record_retried_parse.json');
const [turn] = record.turns;
const summary = summaryOf(turn);
assert.ok(summary, 'The record has no turn event.');

describe('turnFactsOf', () => {
  it('works out a closed turn’s facts as the model functions give them', () => {
    const facts = turnFactsOf({turn, earlier: []});
    const timeline = timelineOf(turn.events, summary.startTime);
    const retries = retriesOf(turn.events);
    const legacyEntries = legacyEntriesOf(turn.events);
    assert.equal(facts.open, false);
    assert.equal(facts.turn, turn);
    assert.equal(facts.events, turn.events);
    assert.deepEqual(facts.summary, summary);
    assert.equal(facts.startMs, summary.startTime);
    assert.equal(facts.endMs, summary.startTime + summary.durationMs);
    assert.deepEqual(facts.earlier, []);
    assert.deepEqual(facts.timeline, timeline);
    assert.deepEqual(facts.retries, retries);
    assert.equal(facts.retries.size, 1);
    assert.deepEqual(facts.tags, rowTagsOf(timeline, retries));
    assert.equal(facts.hasStep, true);
    assert.equal(facts.newerStep, undefined);
    assert.deepEqual(facts.legacyEntries, legacyEntries);
    assert.deepEqual(facts.legacySteps, legacyByStep(turn.events, timeline, legacyEntries));
    assert.deepEqual([...facts.legacyStepIds], [...facts.legacySteps.keys()]);
    assert.deepEqual(facts.legacyKeys, legacyKeysByPath(legacyEntries));
    assert.equal(facts.surfaceEvents, turn.events);
  });

  it('works out an open turn’s from its events so far and its start, its lanes running to the present', () => {
    const startTime = new Date(summary.startTime).toISOString();
    const facts = turnFactsOf({events: turn.events, startTime, earlier: undefined});
    assert.equal(facts.open, true);
    assert.equal(facts.turn, undefined);
    assert.equal(facts.summary, undefined);
    assert.equal(facts.startMs, summary.startTime);
    assert.equal(facts.endMs, undefined);
    assert.equal(facts.earlier, undefined);
    assert.deepEqual(facts.timeline, timelineOf(turn.events, summary.startTime));
  });

  it('reads no step from a turn with neither a parse nor a prompt generation', () => {
    const bare = turn.events.filter(
      event =>
        !['parse', 'prompt_generation'].includes(String(event.attributes['a2ui.event.kind'])),
    );
    assert.equal(
      turnFactsOf({events: bare, startTime: '2026-11-28T00:00:00Z', earlier: []}).hasStep,
      false,
    );
  });
});

describe('turnSurfacesOf', () => {
  const catalogs = catalogsOf(undefined);

  it('replays the whole turn after the earlier turns', () => {
    assert.deepEqual(
      turnSurfacesOf([], turn.events, catalogs),
      replay([], turn.events, undefined, catalogs),
    );
  });

  it('has none while the earlier turns are being read', () => {
    assert.equal(turnSurfacesOf(undefined, turn.events, catalogs), undefined);
  });
});
