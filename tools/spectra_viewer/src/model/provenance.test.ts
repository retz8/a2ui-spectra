import assert from 'node:assert/strict';
import {describe, it} from 'node:test';

import type {ListedFixture, ListedTurn} from '../api.ts';
import {a2uiDelivery, at, modelCall, T0, toolCall, TRACE} from '../testing/model_calls.ts';
import {shownCostOf, type Prices} from './cost.ts';
import {
  candidatesFor,
  prefixBreakOf,
  recordedCandidatesFor,
  replayPrefixBreakOf,
} from './prefix.ts';
import {listedProblemCount, turnProblemsOf} from './problems.ts';
import {
  callReplayOf,
  differencesOf,
  numberIn,
  provenanceOf,
  recordedCallsOf,
  replayWhereOf,
  resolveSource,
  rowTagsOf,
  sourceAddressOf,
  storeTraceOf,
  toolMissListOf,
} from './provenance.ts';
import type {OtherEvent, Turn, TurnRecordEvent} from './record.ts';
import {type CallRow} from './call_rows.ts';
import {timelineOf} from './steps.ts';
import {rowFieldsOf} from './summary.ts';
import {insideLineOf} from './turn_calls.ts';

const START = Number(T0 / 1_000_000n);
const RECORDED = 'b'.repeat(32);
const SOURCE = 'a2ui-spectra-fixtures/find-italian-restaurants.json';
const PRICES: Prices = {
  release: 'v1',
  date: '2026-10-01',
  entries: {},
  overrides: {'claude-sonnet-5-5': {input: 1_000_000, output: 1_000_000}},
};

function turnEvent(
  attributes: Record<string, unknown> = {},
  traceId = TRACE,
  outcome: 'completed' | 'failed' = 'completed',
): TurnRecordEvent {
  return {
    traceId,
    spanId: '0'.repeat(16),
    name: 'invoke_agent',
    kind: 3,
    startTimeUnixNano: at(0),
    endTimeUnixNano: at(3000),
    attributes: {'a2ui.event.kind': 'turn', 'a2ui.turn.outcome': outcome, ...attributes},
    status: {code: 1},
  };
}

const PROVENANCE = {
  'a2ui.replay.source': SOURCE,
  'a2ui.replay.turn': RECORDED,
  'a2ui.replay.mode': 'recorded',
};

const PROMPT = 'You are a helpful assistant.\n\nYou MUST use the BOOKING_FORM template.\n\nThanks.';

const request = (spanId: string, start: number, system = PROMPT, attributes = {}) =>
  modelCall({
    spanId,
    start,
    end: start + 10,
    system,
    messages: [{role: 'user', text: 'Book a table for 2'}],
    usage: {input: 1, output: 1},
    attributes,
  });

const miss = (spanId: string, start: number, system: string) => ({
  ...request(spanId, start, system, {'error.type': 'replay_miss'}),
  status: {
    code: 2 as const,
    message:
      "a2ui-spectra's model proxy is replaying, and POST /v1/messages matched nothing in the record.",
  },
});

/** The source record: a recorded turn with its two model calls. */
const recordedTurn: Turn = {
  events: [
    turnEvent({}, RECORDED),
    request('1'.repeat(16), 2000),
    request('2'.repeat(16), 4000, 'A different prompt altogether.'),
  ],
};

const fixtures: ListedFixture[] = [
  {
    name: 'find-italian-restaurants',
    path: SOURCE,
    savedAt: '2026-11-05T14:02:00.000Z',
    turns: [{traceId: RECORDED, startTime: '2026-11-05T14:01:20.000Z'}],
  },
];

const storeTurn: ListedTurn = {
  traceId: RECORDED,
  startTime: '2026-11-05T14:01:20.000Z',
  input: {text: 'Book a table for 2'},
};

describe('a replayed turn’s provenance', () => {
  it('is read from its turn event, with the verdict once judged', () => {
    assert.equal(provenanceOf([turnEvent()]), undefined);
    assert.deepEqual(provenanceOf([turnEvent(PROVENANCE)]), {
      source: SOURCE,
      recordedTurn: RECORDED,
      mode: 'recorded',
      reasons: [],
    });
    const failed = provenanceOf([
      turnEvent({
        ...PROVENANCE,
        'a2ui.replay.mode': 'model_live',
        'a2ui.replay.verdict': 'failed',
        'a2ui.replay.reasons': [{code: 'REPLAY_MISS', message: 'A miss.'}],
      }),
    ]);
    assert.equal(failed?.mode, 'model_live');
    assert.equal(failed?.verdict, 'failed');
    assert.equal(failed?.reasons.length, 1);
  });

  it('reads the third line’s turn and mode, the total only when it is known', () => {
    assert.equal(
      replayWhereOf('recorded', {turn: 3, turns: 3}),
      'turn 3 of 3 · everything recorded',
    );
    assert.equal(
      replayWhereOf('model_live', {turn: 2, turns: 3}),
      'turn 2 of 3 · tools recorded, model live',
    );
    assert.equal(replayWhereOf('recorded', {turn: 2}), 'turn 2 · everything recorded');
    assert.deepEqual(numberIn([{traceId: 'a'}, {traceId: 'b'}], 'b'), {turn: 2, turns: 2});
    assert.equal(numberIn([{traceId: 'a'}], 'b'), undefined);
    assert.equal(numberIn(undefined, 'b'), undefined);
  });
});

describe('where a provenance link points', () => {
  it('resolves a listed fixture at the recorded path first', () => {
    const source = resolveSource(SOURCE, RECORDED, {fixtures, turns: [storeTurn]});
    assert.deepEqual(source, {
      kind: 'fixture',
      name: 'find-italian-restaurants',
      path: SOURCE,
      file: 'find-italian-restaurants.json',
    });
    assert.deepEqual(sourceAddressOf(source, RECORDED, 'x'), {
      section: 'fixtures',
      fixture: 'find-italian-restaurants',
      traceId: RECORDED,
      stepId: 'x',
    });
  });

  it('then a store turn carrying the recorded trace id, named by its input in brief', () => {
    const source = resolveSource(SOURCE, RECORDED, {fixtures: [], turns: [storeTurn]});
    assert.deepEqual(source, {kind: 'turn', traceId: RECORDED, label: 'Book a table for 2'});
    assert.deepEqual(sourceAddressOf(source, RECORDED, 'x'), {traceId: RECORDED, stepId: 'x'});
  });

  it('then gone: the base name as plain text, going nowhere', () => {
    const source = resolveSource(SOURCE, RECORDED, {fixtures: [], turns: []});
    assert.deepEqual(source, {kind: 'gone', file: 'find-italian-restaurants.json'});
    assert.equal(sourceAddressOf(source, RECORDED), undefined);
  });

  it('reads a store file’s own turn from its name', () => {
    assert.equal(
      storeTraceOf(`.a2ui-spectra/turns/ctx/2026-10-24T15-30-12.123Z_${TRACE}.json`),
      TRACE,
    );
    assert.equal(storeTraceOf(SOURCE), undefined);
  });
});

describe('a failed verdict’s reasons as problems', () => {
  const reasons = (path: string | undefined) => [
    {
      code: 'REPLAY_MISS',
      message: 'A model call matched nothing in the record: POST /v1/messages.',
    },
    {code: 'OUTCOME_DIFFERS', message: 'The turn ended failed; the record ended completed.'},
    {
      code: 'A2UI_DIFFERS',
      message: 'The A2UI differs from the record: message 1 of 1 is not the recorded one.',
      ...(path !== undefined && {path}),
    },
  ];
  const message = {version: 'v1.0', createSurface: {surfaceId: 's', catalogId: 'c'}};
  const recordedMessage = {version: 'v1.0', createSurface: {surfaceId: 'recorded', catalogId: 'c'}};
  const missed = miss('3'.repeat(16), 100, 'An edited prompt.');
  const delivery = a2uiDelivery('4'.repeat(16), 200, [message]);
  const events: TurnRecordEvent[] = [
    missed,
    delivery,
    turnEvent({
      ...PROVENANCE,
      'a2ui.replay.verdict': 'failed',
      'a2ui.replay.reasons': reasons('/events/1/attributes/a2ui.wire.message/parts/0/content/0'),
    }),
  ];
  const recorded: Turn = {
    events: [turnEvent({}, RECORDED), a2uiDelivery('5'.repeat(16), 200, [recordedMessage])],
  };
  const timeline = timelineOf(events, START);

  it('keeps a miss as the failed call’s problem, on its row, and counts it once', () => {
    const {problems} = turnProblemsOf(events, timeline, [], recorded);
    const onCall = problems.filter(problem => problem.stepId === missed.spanId);
    assert.deepEqual(onCall, [
      {
        stepId: missed.spanId,
        sentence: 'This request matched nothing in the record.',
        code: 'replay_miss · Anthropic',
      },
    ]);
    assert.equal(problems.filter(problem => problem.sentence.includes('POST /v1')).length, 0);
  });

  it('puts a different outcome and different A2UI on the outcome, each a sentence over its code', () => {
    const {problems} = turnProblemsOf(events, timeline, [], recorded);
    const onOutcome = problems.filter(problem => problem.stepId === 'outcome');
    assert.deepEqual(
      onOutcome.map(({sentence, code}) => [sentence, code]),
      [
        ['The turn ended failed; the record ended completed.', 'Outcome differs · replay'],
        [
          'The A2UI differs from the record: message 1 of 1 is not the recorded one.',
          'A2UI differs · replay',
        ],
      ],
    );
  });

  it('links the A2UI sentence’s message to its step, the recorded message under it', () => {
    const {problems} = turnProblemsOf(events, timeline, [], recorded);
    const a2ui = problems.find(problem => problem.code === 'A2UI differs · replay');
    const step = timeline.find(row => row.row === 'step' && row.kind === 'message');
    assert.ok(step);
    assert.deepEqual(a2ui?.link, {
      before: 'The A2UI differs from the record: ',
      text: 'message 1 of 1',
      after: ' is not the recorded one.',
      stepId: step.id,
    });
    assert.deepEqual(a2ui?.recorded, {meta: 'message 1 of 1', value: recordedMessage});
  });

  it('leaves the recorded message out when the source is gone', () => {
    const {problems} = turnProblemsOf(events, timeline, []);
    const a2ui = problems.find(problem => problem.code === 'A2UI differs · replay');
    assert.equal(a2ui?.recorded, undefined);
    assert.notEqual(a2ui?.link, undefined);
  });

  it('counts the differences on the list row, a miss by its failed call', () => {
    assert.equal(differencesOf(events), 2);
    const fields = rowFieldsOf({events});
    assert.equal(fields.replayDifferences, 2);
    assert.equal(fields.failedCalls, 1);
    assert.equal(listedProblemCount(fields), 3);
  });
});

describe('a served call', () => {
  const served = (spanId: string, start: number, from: string) =>
    request(spanId, start, PROMPT, {'a2ui.replay.served_from': from});
  const servedTool = {
    ...(toolCall({spanId: '7'.repeat(16), start: 40, end: 50, attributes: {}}) as OtherEvent),
  };
  servedTool.attributes = {...servedTool.attributes, 'a2ui.replay.served_from': '8'.repeat(16)};

  it('carries the Record tag, beside a retry’s', () => {
    const events: TurnRecordEvent[] = [
      served('5'.repeat(16), 10, '1'.repeat(16)),
      served('6'.repeat(16), 20, '1'.repeat(16)),
      request('9'.repeat(16), 30),
      turnEvent(PROVENANCE),
    ];
    const tags = rowTagsOf(timelineOf(events, START), new Map([['6'.repeat(16), {attempt: 1}]]));
    assert.equal(tags.get('5'.repeat(16)), 'Record');
    assert.equal(tags.get('6'.repeat(16)), 'Retry 1 · Record');
    assert.equal(tags.get('9'.repeat(16)), undefined);
  });

  it('reads free in its detail, with no price to name', () => {
    assert.deepEqual(shownCostOf(served('5'.repeat(16), 10, '1'.repeat(16)), PRICES), {
      value: 'Free · served from the record',
    });
    assert.deepEqual(shownCostOf(request('5'.repeat(16), 10), PRICES), {
      value: '$2.0',
      note: 'Price from the config',
    });
  });

  it('counts apart on the header’s second line: free with no live call', () => {
    const events = [
      served('5'.repeat(16), 10, '1'.repeat(16)),
      served('6'.repeat(16), 20, '1'.repeat(16)),
    ];
    assert.deepEqual(insideLineOf(events, START, PRICES)?.slice(-2), [
      '2 calls from the record',
      'Free',
    ]);
  });

  it('counts the live calls alone beside them, with their tokens and cost', () => {
    const events = [served('5'.repeat(16), 10, '1'.repeat(16)), request('6'.repeat(16), 20)];
    const line = insideLineOf(events, START, PRICES);
    assert.ok(line?.includes('1 model call'));
    assert.ok(line?.includes('1 call from the record'));
    assert.ok(line?.includes('1 in'));
    assert.ok(line?.includes('Est. $2.0'));
    assert.ok(!line?.includes('Free'));
  });

  it('says where it was served from, linked to the recorded call', () => {
    const proxy = served('5'.repeat(16), 10, '1'.repeat(16));
    const row: CallRow = {kind: 'model', id: proxy.spanId, proxy, spans: []};
    const provenance = provenanceOf([turnEvent(PROVENANCE)]);
    const source = resolveSource(SOURCE, RECORDED, {fixtures, turns: []});
    const replay = callReplayOf(row, provenance, source, [recordedTurn]);
    assert.equal(replay?.kind, 'served');
    if (replay?.kind !== 'served') return;
    assert.equal(replay.name, 'find-italian-restaurants.json');
    assert.equal(replay.recorded?.offsetMs, 2000);
    assert.equal(replay.recorded?.traceId, RECORDED);
    assert.equal(replay.recorded?.call.spanId, '1'.repeat(16));
  });

  it('stays unlinked when the source is gone, or no longer holds the call', () => {
    const proxy = served('5'.repeat(16), 10, '1'.repeat(16));
    const row: CallRow = {kind: 'model', id: proxy.spanId, proxy, spans: []};
    const provenance = provenanceOf([turnEvent(PROVENANCE)]);
    const gone = resolveSource(SOURCE, RECORDED, {fixtures: [], turns: []});
    assert.deepEqual(callReplayOf(row, provenance, gone, undefined), {
      kind: 'served',
      name: 'find-italian-restaurants.json',
    });
  });
});

describe('a miss', () => {
  const edited = PROMPT.replace('BOOKING_FORM', 'BOOKING_FORM_WITH_DIETARY');
  const call = miss('3'.repeat(16), 100, edited);
  const recordedCalls = recordedCallsOf([recordedTurn]);

  it('sets a model miss against the nearest recorded call, by the longest shared prefix', () => {
    const found = replayPrefixBreakOf(call, {
      mode: 'recorded',
      conversation: [],
      recorded: recordedCandidatesFor(call, recordedCalls, 'find-italian-restaurants.json'),
    });
    assert.equal(found?.form, 'breaks');
    if (found?.form !== 'breaks') return;
    assert.equal(found.part, 'system');
    assert.equal(found.earlier.call.spanId, '1'.repeat(16));
    assert.deepEqual(found.earlier.recorded, {
      offsetMs: 2000,
      name: 'find-italian-restaurants.json',
    });
    assert.equal(found.marker.earlierLabel, 'Recorded call');
    assert.equal(found.marker.current[1], '_WITH_DIETARY');
    assert.equal(found.marker.earlier[1], '');
  });

  it('has nothing to compare with on a model the record never called, or a source gone', () => {
    const other = {
      ...call,
      attributes: {...call.attributes, 'gen_ai.request.model': 'gemini-3.6-flash'},
    };
    const found = replayPrefixBreakOf(other, {
      mode: 'recorded',
      conversation: [],
      recorded: recordedCandidatesFor(other, recordedCalls, 'x.json'),
    });
    assert.deepEqual(found, {form: 'first', model: 'gemini-3.6-flash'});
    assert.deepEqual(
      replayPrefixBreakOf(other, {mode: 'recorded', conversation: [], recorded: []}),
      {form: 'first', model: 'gemini-3.6-flash'},
    );
  });

  it('names no first token on the header’s second line, none having come from a model', () => {
    assert.equal(insideLineOf([call], START, PRICES)?.[0], '1 model call');
    const answered = request('6'.repeat(16), 500);
    const line = insideLineOf([call, answered], START, PRICES);
    assert.equal(line?.[0], 'First token 510 ms');
  });

  it('lists a tool miss’s recorded requests of the same method and tool name', () => {
    const tool = (spanId: string, name: string, args: unknown, start = 10) =>
      ({
        ...(toolCall({spanId, start, end: start + 1, attributes: {}}) as OtherEvent),
        attributes: {
          'a2ui.event.kind': 'tool_call',
          'mcp.method.name': 'tools/call',
          'gen_ai.tool.name': name,
          'gen_ai.tool.call.arguments': args,
          'jsonrpc.request.id': 1,
        },
      }) as OtherEvent;
    const source: Turn[] = [
      {
        events: [
          turnEvent({}, RECORDED),
          tool('a'.repeat(16), 'get_contact_info', {name: 'Casey'}, 1200),
        ],
      },
      {
        events: [
          turnEvent({}, 'c'.repeat(32)),
          tool('b'.repeat(16), 'get_contact_info', {name: 'Alex'}, 1400),
          tool('c'.repeat(16), 'other_tool', {}),
        ],
      },
    ];
    const list = toolMissListOf(
      tool('d'.repeat(16), 'get_contact_info', {name: 'Alex', department: 'Eng'}),
      source,
    );
    assert.equal(list.of, 'tools/call get_contact_info');
    assert.deepEqual(
      list.rows.map(row => [row.args, row.recorded.offsetMs, row.recorded.turn]),
      [
        ['{"name":"Casey"}', 1200, 1],
        ['{"name":"Alex"}', 1400, 2],
      ],
    );
  });

  it('has an empty list on a tool the record never called, or a source gone', () => {
    const lonely = toolCall({
      spanId: 'd'.repeat(16),
      start: 10,
      end: 11,
      attributes: {},
    }) as OtherEvent;
    assert.deepEqual(toolMissListOf(lonely, [recordedTurn]).rows, []);
    assert.deepEqual(toolMissListOf(lonely, undefined).rows, []);
  });

  it('matches an HTTP tool by method and path', () => {
    const http = (spanId: string, url: string) =>
      ({
        ...(toolCall({spanId, start: 10, end: 11, attributes: {}}) as OtherEvent),
        attributes: {
          'a2ui.event.kind': 'tool_call',
          'http.request.method': 'GET',
          'url.full': url,
        },
      }) as OtherEvent;
    const source: Turn[] = [
      {
        events: [
          turnEvent({}, RECORDED),
          http('a'.repeat(16), 'https://t.test/a?x=1'),
          http('b'.repeat(16), 'https://t.test/b'),
        ],
      },
    ];
    const list = toolMissListOf(http('c'.repeat(16), 'https://t.test/a?x=2'), source);
    assert.equal(list.of, 'GET /a');
    assert.equal(list.rows.length, 1);
  });
});

describe('a live call of a live-mode replay', () => {
  const edited = PROMPT.replace('BOOKING_FORM', 'BOOKING_FORM_WITH_DIETARY');
  const provenance = provenanceOf([turnEvent({...PROVENANCE, 'a2ui.replay.mode': 'model_live'})]);
  const call = request('3'.repeat(16), 100, edited);
  const row: CallRow = {kind: 'model', id: call.spanId, proxy: call, spans: []};
  const source = resolveSource(SOURCE, RECORDED, {fixtures, turns: []});

  it('says it went to the model, its row bare', () => {
    assert.deepEqual(callReplayOf(row, provenance, source, [recordedTurn]), {kind: 'live'});
    const tags = rowTagsOf(timelineOf([call, turnEvent(PROVENANCE)], START), new Map());
    assert.equal(tags.size, 0);
  });

  it('is not said of an everything-recorded turn, or a turn that is no replay', () => {
    const recorded = provenanceOf([turnEvent(PROVENANCE)]);
    assert.equal(callReplayOf(row, recorded, source, [recordedTurn]), undefined);
    assert.equal(callReplayOf(row, undefined, undefined, undefined), undefined);
  });

  it('widens its candidates to the record, so a first call reads against the recorded one', () => {
    const recorded = recordedCandidatesFor(call, recordedCallsOf([recordedTurn]), 'x.json');
    const conversation = candidatesFor(call, [{traceId: TRACE, calls: [call]}]);
    assert.deepEqual(prefixBreakOf(call, conversation), {
      form: 'first',
      model: 'claude-sonnet-5-5',
    });
    const found = replayPrefixBreakOf(call, {mode: 'model_live', conversation, recorded});
    assert.equal(found?.form, 'breaks');
    if (found?.form === 'breaks') assert.equal(found.earlier.recorded?.name, 'x.json');
  });

  it('leaves a served call’s candidates to the conversation', () => {
    const served = request('3'.repeat(16), 100, edited, {'a2ui.replay.served_from': 'x'});
    const recorded = recordedCandidatesFor(served, recordedCallsOf([recordedTurn]), 'x.json');
    assert.deepEqual(
      replayPrefixBreakOf(served, {mode: 'model_live', conversation: [], recorded}),
      {form: 'first', model: 'claude-sonnet-5-5'},
    );
  });
});
