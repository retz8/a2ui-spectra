import assert from 'node:assert/strict';
import {describe, it} from 'node:test';

import {byStart, modelCall, rawCall, receivedSpan, T0} from '../testing/model_calls.ts';
import {readTestData} from '../testing/recordings.ts';
import type {Turn} from './record.ts';
import {
  callTitleOf,
  factsOf,
  HEAD_MOST,
  headHeightOf,
  offsetOf,
  TITLE_ROW,
  usageOf,
} from './step_head.ts';
import {type TimelineRow, timelineOf} from './steps.ts';
import {summaryOf} from './summary.ts';

/** A record's last turn, its start and its timeline. */
function lastTurnOf(file: string): {turn: Turn; startMs: number; rows: TimelineRow[]} {
  const {turns} = readTestData(`turn_record/v0_1/${file}`);
  const turn = turns[turns.length - 1];
  assert.ok(turn, `${file} has no turn.`);
  const startMs = summaryOf(turn)?.startTime;
  assert.ok(startMs !== undefined, `${file} has no turn event.`);
  return {turn, startMs, rows: timelineOf(turn.events, startMs)};
}

/** Each row's id, facts line, usage line, head height and offset, and a call's title. */
function headsOf({turn, startMs, rows}: ReturnType<typeof lastTurnOf>) {
  return rows.map(row => {
    const call = row.row === 'step' ? row.call : undefined;
    return [
      row.id,
      factsOf(row, turn.events, startMs),
      usageOf(row, undefined),
      headHeightOf(row, turn.events, startMs, undefined),
      offsetOf(row, turn.events, startMs),
      call === undefined || row.row !== 'step' ? undefined : callTitleOf(call, row.target, startMs),
    ];
  });
}

const gemini = (times: string) => ({target: 'Gemini API · Model proxy', times});
const mcp = (times: string) => ({target: 'MCP · 127.0.0.1:8000 · Tool proxy', times});

describe('the step detail’s head', () => {
  it('on the retried-parse record: two model calls read in full, two parses, a delivery and its steps', () => {
    const calls = ['+20 ms · 2.0 s · first token 880 ms', '+2.0 s · 3.0 s · first token 850 ms'];
    assert.deepEqual(headsOf(lastTurnOf('full_record_retried_parse.json')), [
      ['input-b7e2d9c4a1f06358', '+4 ms', undefined, 63, 4, undefined],
      [
        'd2b5e8a17c4f9603',
        calls[0],
        '11.2k in · 331 out · 0% from cache',
        81,
        20,
        gemini(calls[0]),
      ],
      ['e9f3a6c15b8d2704', '+2.0 s · 18 ms', undefined, 63, 2012, undefined],
      [
        'f1c7d4b28e5a3906',
        calls[1],
        '11.6k in · 844 out · 0% from cache',
        81,
        2050,
        gemini(calls[1]),
      ],
      ['a5e1b8d36f2c4807', '+5.0 s · 20 ms', undefined, 63, 5010, undefined],
      ['delivery-2d8c5f0a7b3e1649', '+5.1 s', undefined, 63, 5100, undefined],
      ['part-2d8c5f0a7b3e1649.0', '+5.1 s', undefined, 63, 5100, undefined],
      ['message-2d8c5f0a7b3e1649.1.0', '+5.1 s', undefined, 63, 5100, undefined],
      ['outcome', '+5.2 s', undefined, 63, 5200, undefined],
    ]);
  });

  it('on the custom-components record: three tool calls through the tool proxy, named by their target', () => {
    const heads = headsOf(lastTurnOf('full_record_custom_components.json'));
    assert.deepEqual(heads.slice(1, 4), [
      ['98413f1d3e21e763', '+10 ms · 21 ms', undefined, 63, 10, mcp('+10 ms · 21 ms')],
      ['15aa6846d4d3bcf4', '+32 ms · 4 ms', undefined, 63, 32, mcp('+32 ms · 4 ms')],
      ['6bed4e8c2acd6f46', '+37 ms · 21 ms', undefined, 63, 37, mcp('+37 ms · 21 ms')],
    ]);
  });

  it('on the restaurant finder record: a model call with its received spans, named after the proxy', () => {
    const [, call] = headsOf(lastTurnOf('full_record_restaurant_finder.json'));
    assert.deepEqual(call, [
      '0e10d0ca2cafad42',
      '+25 ms · 2.0 s · first token 875 ms',
      '4.3k in · 518 out · 0% from cache',
      81,
      25,
      {
        target: 'Gemini API · Model proxy · Received spans',
        times: '+25 ms · 2.0 s · first token 875 ms',
      },
    ]);
  });

  it('names a call recorded raw by its method, path and status, one read from spans by its API, and one in flight by its start', () => {
    const startMs = Number(T0 / 1_000_000n);
    const events = byStart(
      rawCall('1111111111111111', 0, 40),
      receivedSpan({
        spanId: '2222222222222222',
        name: 'call_llm',
        start: 50,
        end: 900,
        names: {
          'gen_ai.provider.name': 'gcp.gemini',
          'gen_ai.request.model': 'gemini-3.6-flash',
          'gen_ai.usage.input_tokens': 120,
          'gen_ai.usage.output_tokens': 30,
        },
      }),
      modelCall({spanId: '3333333333333333', start: 1000, provider: 'gcp.gemini'}),
    );
    const heads = timelineOf(events, startMs).map(row => {
      const call = row.row === 'step' ? row.call : undefined;
      return [
        factsOf(row, events, startMs),
        usageOf(row, undefined),
        headHeightOf(row, events, startMs, undefined),
        call === undefined || row.row !== 'step'
          ? undefined
          : callTitleOf(call, row.target, startMs),
      ];
    });
    assert.deepEqual(heads, [
      [
        '+0 ms · 40 ms',
        undefined,
        63,
        {target: 'POST /api/v1/chat/completions · 200 · Model proxy', times: '+0 ms · 40 ms'},
      ],
      [
        '+50 ms · 850 ms',
        '120 in · 30 out · 0% from cache · tokens from ADK spans',
        81,
        {target: 'Gemini API · ADK spans', times: '+50 ms · 850 ms'},
      ],
      ['+1.0 s', undefined, 63, gemini('+1.0 s')],
    ]);
  });

  it('keeps the title row alone for a row with no offset and no position, and the tallest head for a model call', () => {
    const {turn, startMs, rows} = lastTurnOf('full_record_retried_parse.json');
    const {offsetMs: _, ...bare} = rows[rows.length - 1] as TimelineRow & {offsetMs?: number};
    assert.equal(offsetOf(bare as TimelineRow, turn.events, startMs), undefined);
    assert.equal(factsOf(bare as TimelineRow, turn.events, startMs), undefined);
    assert.equal(headHeightOf(bare as TimelineRow, turn.events, startMs, undefined), TITLE_ROW);
    assert.equal(HEAD_MOST, 81);
  });
});
