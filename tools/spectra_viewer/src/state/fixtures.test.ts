import assert from 'node:assert/strict';
import {describe, it} from 'node:test';

import type {ListedFixture, MessageBoxState} from '../api.ts';
import {writeFixtureAddress} from '../model/address.ts';
import {at, TRACE} from '../testing/model_calls.ts';
import type {TurnRecord, TurnRecordEvent} from '../model/record.ts';
import {readAddress} from '../model/address.ts';
import {
  fixtureAddressOf,
  fixtureFailed,
  fixtureRead,
  fixturesListed,
  type FixturesState,
  fixtureViewOf,
  NO_FIXTURES,
  replayEnded,
  replayedTurnToFollow,
  replayStarted,
  replayTurn,
  type ReplayTurn,
} from './fixtures.ts';
import {
  composerOf,
  liveStatusOf,
  provenanceOfTurn,
  replayLineOf,
  sourceInView,
} from './selectors.ts';
import type {SpectraState} from './spectra.ts';

const OWN = 'b'.repeat(32);
const SOURCE = 'a2ui-spectra-fixtures/a.json';

const turnEvent = (traceId: string): TurnRecordEvent => ({
  traceId,
  spanId: traceId.slice(0, 16),
  name: 'invoke_agent',
  kind: 3,
  startTimeUnixNano: at(0),
  endTimeUnixNano: at(10),
  attributes: {'a2ui.event.kind': 'turn', 'a2ui.turn.outcome': 'completed'},
});

const recordOf = (...traceIds: string[]): TurnRecord =>
  ({
    version: 'v0.1',
    turns: traceIds.map(traceId => ({events: [turnEvent(traceId)]})),
  }) as TurnRecord;

const listedOf = (name: string, savedAt: string, ...traceIds: string[]): ListedFixture => ({
  name,
  path: `a2ui-spectra-fixtures/${name}.json`,
  savedAt,
  turns: traceIds.map(traceId => ({traceId, startTime: '2026-11-05T14:00:00.000Z'})),
});

const T1 = '2026-11-05T14:00:00.000Z';
const T2 = '2026-11-05T15:00:00.000Z';

function holding(...fixtures: ListedFixture[]): FixturesState {
  const {fixtures: state, read} = fixturesListed(NO_FIXTURES, {folder: 'f', fixtures});
  let held = state;
  for (const {name, savedAt} of read) {
    const listed = fixtures.find(fixture => fixture.name === name);
    held = fixtureRead(held, name, savedAt, recordOf(...listed!.turns!.map(turn => turn.traceId)));
  }
  return held;
}

const stateOf = (changes: Partial<SpectraState> = {}): SpectraState => ({
  connected: true,
  loaded: true,
  turns: [],
  live: new Map(),
  closed: new Map(),
  records: new Map(),
  pending: new Map(),
  box: {conversations: []},
  fixtures: NO_FIXTURES,
  replayTurns: new Map(),
  ...changes,
});

describe('the listing arriving', () => {
  it('asks for each new record, and again when its saved time changes', () => {
    const first = fixturesListed(NO_FIXTURES, {folder: 'f', fixtures: [listedOf('a', T1, TRACE)]});
    assert.deepEqual(first.read, [{name: 'a', savedAt: T1}]);
    const read = fixtureRead(first.fixtures, 'a', T1, recordOf(TRACE));
    assert.deepEqual(
      fixturesListed(read, {folder: 'f', fixtures: [listedOf('a', T1, TRACE)]}).read,
      [],
    );
    assert.deepEqual(
      fixturesListed(read, {folder: 'f', fixtures: [listedOf('a', T2, TRACE)]}).read,
      [{name: 'a', savedAt: T2}],
    );
  });

  it('does not ask for a file that does not read as a record', () => {
    const {read} = fixturesListed(NO_FIXTURES, {
      folder: 'f',
      fixtures: [{name: 'bad', path: 'f/bad.json', savedAt: T1, error: 'Not JSON.'}],
    });
    assert.deepEqual(read, []);
  });
});

describe('the Fixtures address', () => {
  it('opens the most recently saved fixture on its own turn from the bare address', () => {
    const state = holding(listedOf('old', T1, TRACE), listedOf('new', T2, TRACE, OWN));
    assert.deepEqual(fixtureAddressOf(readAddress('#/fixtures'), state), {
      section: 'fixtures',
      fixture: 'new',
      traceId: OWN,
    });
  });

  it('skips a file that is not a record, and stands with none to open', () => {
    const bad = {name: 'bad', path: 'f/bad.json', savedAt: T2, error: 'Not JSON.'};
    assert.equal(fixtureAddressOf(readAddress('#/fixtures'), holding(bad)), undefined);
    assert.equal(fixtureAddressOf(readAddress('#/fixtures'), holding()), undefined);
    assert.deepEqual(
      fixtureAddressOf(readAddress('#/fixtures'), holding(bad, listedOf('a', T1, OWN))),
      {
        section: 'fixtures',
        fixture: 'a',
        traceId: OWN,
      },
    );
  });

  it('opens a fixture with no turn on its own turn', () => {
    const state = holding(listedOf('a', T1, TRACE, OWN));
    assert.deepEqual(fixtureAddressOf(readAddress('#/fixtures/a'), state), {
      section: 'fixtures',
      fixture: 'a',
      traceId: OWN,
    });
  });

  it('stands on a turn the fixture holds, an earlier one included', () => {
    const state = holding(listedOf('a', T1, TRACE, OWN));
    assert.equal(fixtureAddressOf(readAddress(writeFixtureAddress('a', TRACE)), state), undefined);
  });

  it('waits for the listing, and has nothing to say outside Fixtures', () => {
    assert.equal(fixtureAddressOf(readAddress('#/fixtures'), NO_FIXTURES), undefined);
    assert.equal(fixtureAddressOf(readAddress(`#/turns/${TRACE}`), holding()), undefined);
  });
});

describe('the fixture view', () => {
  const address = readAddress(writeFixtureAddress('a', TRACE, 'outcome'));

  it('says the folder is empty, and waits for the listing', () => {
    assert.deepEqual(fixtureViewOf(readAddress('#/fixtures'), NO_FIXTURES), {status: 'reading'});
    assert.deepEqual(fixtureViewOf(readAddress('#/fixtures'), holding()), {status: 'empty'});
  });

  it('shows the turn named, the earlier turns before it and when it was saved', () => {
    const view = fixtureViewOf(
      readAddress(writeFixtureAddress('a', OWN)),
      holding(listedOf('a', T1, TRACE, OWN)),
    );
    assert.equal(view.status, 'shown');
    if (view.status !== 'shown') return;
    assert.equal(view.earlier.length, 1);
    assert.equal(view.saved.kind, 'saved');
    assert.match(view.saved.text, /^saved \d{4}-\d{2}-\d{2} \d{2}:\d{2}$/);
  });

  describe('changing under it', () => {
    const state = holding(listedOf('a', T1, TRACE, OWN));

    it('keeps what it holds when removed, saying so in the saved time’s place', () => {
      const removed = fixturesListed(state, {folder: 'f', fixtures: []}).fixtures;
      const view = fixtureViewOf(address, removed);
      assert.equal(view.status, 'shown');
      if (view.status !== 'shown') return;
      assert.deepEqual(view.saved, {kind: 'removed', text: 'no longer in the folder'});
      assert.equal(view.turn.events[0].traceId, TRACE);
      assert.equal(fixtureAddressOf(address, removed), undefined);
    });

    it('follows a rewrite: the turn stays by its trace id, the saved time updates', () => {
      const rewritten = fixtureRead(
        fixturesListed(state, {folder: 'f', fixtures: [listedOf('a', T2, TRACE, OWN)]}).fixtures,
        'a',
        T2,
        recordOf(TRACE, OWN),
      );
      assert.equal(fixtureAddressOf(address, rewritten), undefined);
      const view = fixtureViewOf(address, rewritten);
      assert.equal(view.status === 'shown' && view.turn.events[0].traceId, TRACE);
      assert.equal(rewritten.records.get('a')?.savedAt, T2);
    });

    it('goes to the fixture’s own turn when the rewrite no longer holds the turn', () => {
      const rewritten = fixtureRead(
        fixturesListed(state, {folder: 'f', fixtures: [listedOf('a', T2, OWN)]}).fixtures,
        'a',
        T2,
        recordOf(OWN),
      );
      assert.deepEqual(fixtureAddressOf(address, rewritten), {
        section: 'fixtures',
        fixture: 'a',
        traceId: OWN,
      });
    });

    it('keeps the record held until the rewrite’s comes', () => {
      const listed = fixturesListed(state, {folder: 'f', fixtures: [listedOf('a', T2, TRACE)]});
      const view = fixtureViewOf(address, listed.fixtures);
      assert.equal(view.status === 'shown' && view.record.turns.length, 2);
    });

    it('is treated as removed when it no longer reads as a record, the reason in the saved time’s place', () => {
      const bad = {name: 'a', path: 'f/a.json', savedAt: T2, error: 'The file is not JSON.'};
      const changed = fixturesListed(state, {folder: 'f', fixtures: [bad]}).fixtures;
      const view = fixtureViewOf(address, changed);
      assert.equal(view.status, 'shown');
      if (view.status !== 'shown') return;
      assert.deepEqual(view.saved, {kind: 'unreadable', text: 'The file is not JSON.'});
    });

    it('says why, with nothing held, for a file it never read', () => {
      const bad = {name: 'a', path: 'f/a.json', savedAt: T2, error: 'The file is not JSON.'};
      assert.deepEqual(fixtureViewOf(address, holding(bad)), {
        status: 'missing',
        message: 'The file is not JSON.',
      });
      const failed = fixtureFailed(holding(), 'a', 'No fixture is named a.');
      assert.deepEqual(fixtureViewOf(address, failed), {
        status: 'missing',
        message: 'No fixture is named a.',
      });
    });
  });
});

describe('the stream’s replay events', () => {
  const state = {
    box: {conversations: []} as MessageBoxState,
    replayTurns: new Map<string, ReplayTurn>(),
  };
  const started = replayStarted(state, {source: SOURCE, mode: 'recorded', turns: 2});
  const opened = replayTurn(started, {traceId: TRACE, recordedTurn: OWN, turn: 1, turns: 2});

  it('replay_started puts the replay on the box’s state, before its first turn', () => {
    assert.deepEqual(started.box.replay, {source: SOURCE, mode: 'recorded', turn: 0, turns: 2});
  });

  it('replay_turn moves it on, and keeps what the turn stands for', () => {
    assert.equal(opened.box.replay?.turn, 1);
    assert.deepEqual(opened.replayTurns.get(TRACE), {
      recordedTurn: OWN,
      source: SOURCE,
      mode: 'recorded',
      turn: 1,
      turns: 2,
    });
  });

  it('replay_turn with no replay known changes nothing, until the box is read', () => {
    assert.equal(replayTurn(state, {traceId: TRACE, recordedTurn: OWN, turn: 1, turns: 2}), state);
  });

  it('replay_ended ends the status and the refusal, and nothing more', () => {
    const ended = replayEnded(opened);
    assert.equal(ended.box.replay, undefined);
    assert.equal(ended.replayTurns.size, 1);
    assert.deepEqual(ended.box.conversations, []);
  });
});

describe('following a replay started from the page', () => {
  const entry = (turn: number): ReplayTurn => ({
    recordedTurn: OWN,
    source: SOURCE,
    mode: 'recorded',
    turn,
    turns: 2,
  });

  it('goes to the newest of its turns heard so far', () => {
    assert.equal(replayedTurnToFollow(new Map(), 'a'), undefined);
    assert.equal(replayedTurnToFollow(new Map([['a', entry(1)]]), 'a'), 'a');
    assert.equal(
      replayedTurnToFollow(
        new Map([
          ['a', entry(1)],
          ['b', entry(2)],
        ]),
        'a',
      ),
      'b',
    );
  });

  it('leaves out an earlier replay’s turns and the next replay’s', () => {
    const turns = new Map([
      ['old', entry(1)],
      ['a', entry(1)],
      ['b', entry(2)],
      ['next', entry(1)],
    ]);
    assert.equal(replayedTurnToFollow(turns, 'a'), 'b');
    assert.equal(replayedTurnToFollow(turns, 'gone'), undefined);
  });
});

describe('the live status', () => {
  const replay = {source: SOURCE, mode: 'recorded' as const, turn: 2, turns: 3};
  const fixtures = holding(listedOf('a', T1, TRACE, OWN));

  it('reads capturing, and not connected', () => {
    assert.deepEqual(liveStatusOf(stateOf()), {form: 'capturing'});
    assert.deepEqual(liveStatusOf(stateOf({connected: false})), {form: 'down'});
    assert.deepEqual(liveStatusOf(stateOf({connected: undefined})), {form: 'connecting'});
  });

  it('names the replay and its turn of the total', () => {
    const status = liveStatusOf(
      stateOf({
        fixtures,
        box: {conversations: [], replay},
        replayTurns: new Map([
          [TRACE, {recordedTurn: OWN, source: SOURCE, mode: 'recorded', turn: 2, turns: 3}],
        ]),
      }),
    );
    assert.equal(status.form, 'replaying');
    if (status.form !== 'replaying') return;
    assert.equal(status.turn, 'turn 2 of 3');
    assert.equal(status.recordedTurn, OWN);
    assert.deepEqual(status.source, {kind: 'fixture', name: 'a', path: SOURCE, file: 'a.json'});
  });

  it('has no turn before the first opens, and says not connected over a replay', () => {
    const status = liveStatusOf(stateOf({box: {conversations: [], replay: {...replay, turn: 0}}}));
    assert.equal(status.form === 'replaying' && status.turn, undefined);
    assert.deepEqual(liveStatusOf(stateOf({connected: false, box: {conversations: [], replay}})), {
      form: 'down',
    });
  });

  it('names a store source by its input in brief before its first turn opens', () => {
    const file = `.a2ui-spectra/turns/c/2026-10-24T15-30-12.123Z_${TRACE}.json`;
    const status = liveStatusOf(
      stateOf({
        turns: [{traceId: TRACE, startTime: T1, input: {text: 'The turn'}}],
        box: {conversations: [], replay: {...replay, source: file, turn: 0}},
      }),
    );
    assert.equal(status.form === 'replaying' && status.source.kind, 'turn');
  });

  it('refuses the composer while a replay runs, and only then', () => {
    assert.equal(composerOf(stateOf({box: {conversations: [], replay}}), {}).replaying, true);
    assert.equal(composerOf(stateOf(), {}).replaying, undefined);
  });
});

describe('a replayed turn’s third line', () => {
  const fixtures = holding(listedOf('a', T1, TRACE, OWN));
  const provenance = {source: SOURCE, recordedTurn: OWN, mode: 'recorded' as const, reasons: []};

  it('counts from the source, passed or failed', () => {
    const state = stateOf({fixtures});
    const line = replayLineOf(
      state,
      'x',
      {...provenance, verdict: 'passed'},
      sourceInView(state, provenance),
      9,
    );
    assert.equal(line.where, 'turn 2 of 2 · everything recorded');
    assert.equal(line.verdict, 'passed');
  });

  it('counts from the stream while open, with no verdict', () => {
    const state = stateOf({
      replayTurns: new Map([
        ['x', {recordedTurn: OWN, source: SOURCE, mode: 'recorded', turn: 1, turns: 4}],
      ]),
    });
    const from = provenanceOfTurn(state, 'x', []);
    assert.ok(from);
    const line = replayLineOf(state, 'x', from, sourceInView(state, from), 9);
    assert.equal(line.where, 'turn 1 of 4 · everything recorded');
    assert.equal(line.verdict, undefined);
  });

  it('takes a host’s turn opening mid-replay for no replayed turn, once the replay’s has been heard', () => {
    const live = new Map([['host', {} as never]]);
    const replay = {source: SOURCE, mode: 'recorded' as const, turn: 1, turns: 2};
    const heard = stateOf({
      live,
      box: {conversations: [], replay},
      replayTurns: new Map([
        ['x', {recordedTurn: OWN, source: SOURCE, mode: 'recorded', turn: 1, turns: 2}],
      ]),
    });
    assert.equal(provenanceOfTurn(heard, 'host', []), undefined);
    const opened = stateOf({live, box: {conversations: [], replay}});
    assert.equal(provenanceOfTurn(opened, 'host', [])?.source, SOURCE);
  });

  it('says its own place with no total when the source is gone', () => {
    const state = stateOf();
    const line = replayLineOf(state, 'x', provenance, sourceInView(state, provenance), 2);
    assert.deepEqual(line.source, {kind: 'gone', file: 'a.json'});
    assert.equal(line.where, 'turn 2 · everything recorded');
  });

  it('asks for a store source’s record through the turn route, its own turn when listed', () => {
    const file = `.a2ui-spectra/turns/c/2026-10-24T15-30-12.123Z_${TRACE}.json`;
    const row = (traceId: string, text: string) => ({
      traceId,
      startTime: T1,
      input: {text},
    });
    const state = stateOf({turns: [row(TRACE, 'The last'), row(OWN, 'The first')]});
    const source = sourceInView(state, {source: file, recordedTurn: OWN});
    assert.deepEqual(source.resolved, {kind: 'turn', traceId: OWN, label: 'The first'});
    assert.equal(source.needs, TRACE);
    const read = stateOf({
      turns: state.turns,
      records: new Map([[TRACE, {record: recordOf(OWN, TRACE)}]]),
    });
    const withRecord = sourceInView(read, {source: file, recordedTurn: OWN});
    assert.equal(withRecord.turns?.length, 2);
    assert.equal(withRecord.needs, undefined);
    assert.equal(
      replayLineOf(read, 'x', {...provenance, source: file}, withRecord, 9).where,
      'turn 1 of 2 · everything recorded',
    );
  });
});
