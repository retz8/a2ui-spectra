import assert from 'node:assert/strict';
import {describe, it} from 'node:test';

import type {ListedFixture} from '../api.ts';
import {modelCall, T0, toolCall, TRACE} from '../testing/model_calls.ts';
import type {Prices} from './cost.ts';
import {
  fixtureGroupsOf,
  fixtureLinePartsOf,
  fixtureRowId,
  hasNothingToServe,
  nameProblemOf,
  numberedName,
  recordedCostOf,
  recordedCostText,
  replayRowsOf,
  savedTimeOf,
  savedTurnsLine,
  searchFixtureGroups,
  slugOf,
} from './fixtures.ts';
import type {Turn, TurnRecordEvent} from './record.ts';

const PRICES: Prices = {
  release: 'v1',
  date: '2026-10-01',
  entries: {},
  overrides: {'claude-sonnet-5-5': {input: 1_000_000, output: 1_000_000}},
};

const OTHER = 'b'.repeat(32);

function turnEvent(traceId = TRACE): TurnRecordEvent {
  return {
    traceId,
    spanId: traceId.slice(0, 16),
    name: 'invoke_agent',
    kind: 3,
    startTimeUnixNano: T0.toString(),
    endTimeUnixNano: T0.toString(),
    attributes: {'a2ui.event.kind': 'turn', 'a2ui.turn.outcome': 'completed'},
  };
}

const CALL = modelCall({spanId: 'a'.repeat(16), start: 0, end: 10, usage: {input: 1, output: 1}});

describe('the slug prefilled at save', () => {
  it("slugs the turn's input in brief by the server's rule", () => {
    assert.equal(slugOf({text: 'Book a table for 2!'}), 'book-a-table-for-2');
    assert.equal(
      slugOf({text: '  Find   the top-10 Chinese restaurants in the US, please. '}),
      'find-the-top-10-chinese-restaurants-in',
    );
    assert.equal(slugOf({text: 'x'.repeat(60)}), 'x'.repeat(40));
    assert.equal(slugOf({action: 'submit_booking'}), 'submit-booking');
  });

  it("falls back to 'turn' when nothing survives", () => {
    assert.equal(slugOf({text: '이탈리아 식당 찾아줘'}), 'turn');
    assert.equal(slugOf({partType: 'blob'}), 'turn');
    assert.equal(slugOf(undefined), 'turn');
  });
});

describe('the name the prompt takes', () => {
  it('says what is wrong with a character outside the set, a leading dot and a clash', () => {
    assert.equal(nameProblemOf('good-name_1.2', []), undefined);
    assert.equal(nameProblemOf('', []), undefined);
    assert.deepEqual(nameProblemOf('a b', []), {
      line: 'A name holds letters, digits, -, _ and . only.',
    });
    assert.deepEqual(nameProblemOf('.hidden', []), {line: 'A name does not start with a dot.'});
    assert.deepEqual(nameProblemOf('a', ['a', 'a-2']), {
      line: 'The folder already holds this name.',
      offer: 'a-3',
    });
  });

  it('numbers from 2, the first free', () => {
    assert.equal(numberedName('a', ['a']), 'a-2');
    assert.equal(numberedName('a', ['a', 'a-2', 'a-3']), 'a-4');
  });

  it('states the turn count the fixture will hold', () => {
    assert.equal(savedTurnsLine(1), '1 turn');
    assert.equal(savedTurnsLine(2), '2 turns, the earlier one embedded');
    assert.equal(savedTurnsLine(3), '3 turns, the earlier two embedded');
    assert.equal(savedTurnsLine(12), '12 turns, the earlier 11 embedded');
  });
});

describe('a record with nothing to serve', () => {
  const turnOf = (...events: TurnRecordEvent[]): Turn => ({events: [turnEvent(), ...events]});
  const tool = (attributes: Record<string, unknown>, name = 'tools/call', kind = 3) => ({
    ...(toolCall({spanId: 'c'.repeat(16), start: 0, end: 1, attributes}) as TurnRecordEvent),
    name,
    kind,
  });

  it('has neither a model call nor a tool call the pool would answer with', () => {
    assert.equal(hasNothingToServe([turnOf(), turnOf()]), true);
    assert.equal(hasNothingToServe([turnOf(), turnOf(CALL)]), false);
  });

  it("leaves out a model call or tool call read from the agent's spans, as the server's pool does", () => {
    const fromSpans = (kind: 'model_call' | 'tool_call', spanId: string): TurnRecordEvent => ({
      traceId: 'f'.repeat(32),
      spanId,
      name:
        kind === 'model_call'
          ? 'generate_content gemini-3.6-flash'
          : 'execute_tool get_restaurants',
      kind: 1,
      startTimeUnixNano: '0',
      endTimeUnixNano: '1',
      attributes: {'a2ui.event.kind': kind, 'a2ui.received.dialect': 'adk'},
      status: {code: 1},
    });
    const spans = [fromSpans('model_call', 'd'.repeat(16)), fromSpans('tool_call', 'e'.repeat(16))];
    assert.equal(hasNothingToServe([turnOf(...spans)]), true);
    assert.equal(hasNothingToServe([turnOf(CALL, ...spans)]), false);
  });

  it("mirrors the server's pool on the tool calls it leaves out", () => {
    const request = {'mcp.method.name': 'tools/call', 'jsonrpc.request.id': 1};
    assert.equal(hasNothingToServe([turnOf(tool(request))]), false);
    assert.equal(
      hasNothingToServe([turnOf(tool({'mcp.method.name': 'notifications/initialized'}))]),
      false === hasNothingToServe([turnOf(tool(request))]),
    );
    assert.equal(hasNothingToServe([turnOf(tool(request, 'tools/call', 4))]), true);
  });
});

describe('the recorded cost', () => {
  const served = modelCall({
    spanId: 'd'.repeat(16),
    start: 20,
    end: 30,
    usage: {input: 2, output: 1},
    attributes: {'a2ui.replay.served_from': 'e'.repeat(16)},
  });
  const turns: Turn[] = [{events: [turnEvent(), CALL]}, {events: [turnEvent(OTHER), served]}];

  it('adds every turn of the record, a call a replay served among them, for the ceiling', () => {
    assert.equal(recordedCostOf(turns, PRICES), 2 + 3);
    assert.equal(recordedCostOf(turns, undefined), undefined);
  });

  it('reads in brief once the record has been read', () => {
    assert.equal(recordedCostText(undefined, PRICES), undefined);
    assert.equal(recordedCostText(turns, PRICES), '$5.0');
    assert.equal(recordedCostText([{events: [turnEvent()]}], PRICES), 'nothing recorded');
  });
});

describe('the fixtures list', () => {
  const listed: ListedFixture[] = [
    {
      name: 'book-a-table',
      path: 'a2ui-spectra-fixtures/book-a-table.json',
      savedAt: '2026-11-05T14:02:00.000Z',
      turns: [
        {
          traceId: TRACE,
          startTime: '2026-11-05T14:01:20.000Z',
          outcome: 'waiting_for_input',
          input: {text: 'Top 3 Italian restaurants'},
          findings: 1,
        },
        {
          traceId: OTHER,
          startTime: '2026-11-05T14:01:49.000Z',
          outcome: 'completed',
          input: {text: 'Book a table for 2'},
        },
      ],
    },
    {name: 'notes', path: 'a2ui-spectra-fixtures/notes.json', savedAt: 'x', error: 'Not JSON.'},
  ];

  it('has one group per fixture, titled by its name, its turns in order, its own turn last', () => {
    const [group] = fixtureGroupsOf(listed, () => undefined);
    assert.equal(group.name, 'book-a-table');
    assert.equal(group.problems, 1);
    assert.deepEqual(
      group.turns.map(turn => turn.recorded),
      [TRACE, OTHER],
    );
    assert.equal(group.turns[1].traceId, fixtureRowId('book-a-table', OTHER));
  });

  it('gains its cost once the record has been read', () => {
    assert.equal(fixtureGroupsOf(listed, () => undefined)[0].meta, '2 turns');
    assert.equal(fixtureGroupsOf(listed, () => '$0.031')[0].meta, '2 turns · $0.031');
    assert.equal(
      fixtureGroupsOf(listed, () => 'nothing recorded')[0].meta,
      '2 turns · nothing recorded',
    );
  });

  it('shows why in place of the rows of a file that is not a record', () => {
    const notes = fixtureGroupsOf(listed, () => undefined)[1];
    assert.equal(notes.reason, 'Not JSON.');
    assert.deepEqual(notes.turns, []);
  });

  it('names a row by its fixture too, the same turn being in several', () => {
    assert.notEqual(fixtureRowId('a', TRACE), fixtureRowId('b', TRACE));
  });

  it('searches names, keeping the whole group, and inputs, keeping their rows', () => {
    const groups = fixtureGroupsOf(listed, () => undefined);
    assert.equal(searchFixtureGroups(groups, '').length, 2);
    assert.equal(searchFixtureGroups(groups, 'BOOK-A')[0].turns.length, 2);
    const byInput = searchFixtureGroups(groups, 'italian');
    assert.equal(byInput.length, 1);
    assert.deepEqual(
      byInput[0].turns.map(turn => turn.recorded),
      [TRACE],
    );
    assert.deepEqual(searchFixtureGroups(groups, 'nothing here'), []);
  });
});

describe("the Replay popover's rows", () => {
  const ready = {nothingToServe: false, ceiling: 0.031, turnOpen: false, replaying: false};

  it('labels each mode with its cost, the ceiling the recorded cost', () => {
    const [recorded, live] = replayRowsOf(ready);
    assert.equal(recorded.title, 'Everything recorded');
    assert.equal(recorded.label, 'Free · the model and the tools answer from the record');
    assert.equal(recorded.off, false);
    assert.equal(live.title, 'Tools recorded, model live');
    assert.equal(live.label, 'Up to $0.031 · a request that changed goes to the model');
    assert.equal(live.off, false);
  });

  it('disables everything recorded on a record with nothing to serve, the live cost unknown', () => {
    const [recorded, live] = replayRowsOf({...ready, nothingToServe: true});
    assert.equal(recorded.off, true);
    assert.equal(recorded.label, 'No model or tool calls were recorded');
    assert.equal(live.off, false);
    assert.equal(live.label, 'Cost unknown · nothing recorded');
  });

  it('says the cost is unknown when no price reaches the record', () => {
    const [, live] = replayRowsOf({...ready, ceiling: undefined});
    assert.equal(live.label, 'Cost unknown · a request that changed goes to the model');
  });

  it('disables both while a turn is open, and while a replay runs', () => {
    for (const row of replayRowsOf({...ready, turnOpen: true})) {
      assert.equal(row.off, true);
      assert.equal(row.note, 'A turn is open');
    }
    for (const row of replayRowsOf({...ready, turnOpen: true, replaying: true})) {
      assert.equal(row.off, true);
      assert.equal(row.note, 'A replay is running');
    }
  });
});

describe('the fixture line', () => {
  it('names the turn count, the recorded cost and when it was saved', () => {
    assert.deepEqual(
      fixtureLinePartsOf({
        turns: [{events: [turnEvent(), CALL]}],
        prices: PRICES,
        saved: 'saved 2026-11-05 14:02',
      }),
      ['1 turn', 'recorded $2.0', 'saved 2026-11-05 14:02'],
    );
  });

  it('says nothing was recorded to serve, in the cost’s place', () => {
    assert.deepEqual(
      fixtureLinePartsOf({
        turns: [{events: [turnEvent()]}],
        prices: PRICES,
        saved: 'no longer in the folder',
      }),
      ['1 turn', 'nothing recorded to serve', 'no longer in the folder'],
    );
  });

  it('reads the saved time on the page’s clock', () => {
    const local = new Date(2026, 10, 5, 14, 2).toISOString();
    assert.equal(savedTimeOf(local), '2026-11-05 14:02');
  });
});
