import assert from 'node:assert/strict';
import {describe, it} from 'node:test';

import type {LogEntry} from '../api.ts';
import {STATUS_LABELS} from '../components/format.ts';
import {
  dividerTextOf,
  drawerRowsOf,
  lineCountOf,
  logTimeOf,
  type MarkedTurn,
  shownText,
  tailSinceStartOf,
} from './logs.ts';

const DAY = '2026-11-12T09:30:';
const time = (seconds: number, ms = 0) =>
  `${DAY}${String(seconds).padStart(2, '0')}.${String(ms).padStart(3, '0')}Z`;

const line = (n: number, at: string, text: string, stream: 'stdout' | 'stderr' = 'stderr') =>
  ({n, time: at, type: 'line', stream, text}) satisfies LogEntry;
const started = (n: number, at: string): LogEntry => ({
  n,
  time: at,
  type: 'started',
  command: 'uv run .',
});

const turn = (traceId: string, startTime: string, more: Partial<MarkedTurn> = {}): MarkedTurn => ({
  traceId,
  startTime,
  outcome: 'completed',
  durationMs: 1000,
  input: {text: `Input of ${traceId}`},
  ...more,
});

describe("a line's text as shown", () => {
  it('strips ANSI codes, the buffer keeping them', () => {
    assert.equal(shownText('\u001b[32mINFO\u001b[0m:     Started'), 'INFO:     Started');
    assert.equal(shownText('\u001b]0;title\u0007plain'), 'plain');
  });

  it('is what follows its last carriage return, what a terminal would leave', () => {
    assert.equal(shownText('10%\r50%\r100%'), '100%');
    assert.equal(shownText('no return'), 'no return');
    assert.equal(shownText('\u001b[2K\rdone'), 'done');
  });

  it('does not count the carriage returns a line ends in, nothing being written over it', () => {
    assert.equal(shownText('abc\r'), 'abc');
    assert.equal(shownText('10%\r100%\r\r'), '100%');
    assert.equal(shownText('\r'), '');
    // A code after the last carriage return leaves it the line's end.
    assert.equal(shownText('abc\r\u001b[0m'), 'abc');
  });
});

describe("a divider's text", () => {
  it('names the command at a start', () => {
    assert.equal(dividerTextOf(started(1, time(0)) as never), 'Started · uv run .');
  });

  it('names the cause and the exit line at a stop, and the exit line alone with no cause', () => {
    const stop = {n: 2, time: time(1), type: 'stopped' as const, exit: 'exited with code 143'};
    assert.equal(
      dividerTextOf({...stop, cause: {kind: 'save', file: 'prompt_builder.py'}}),
      'Stopped · prompt_builder.py changed · exited with code 143',
    );
    assert.equal(
      dividerTextOf({...stop, cause: {kind: 'press'}}),
      'Stopped · Restart pressed · exited with code 143',
    );
    assert.equal(
      dividerTextOf({...stop, exit: 'exited with code 1'}),
      'Stopped · exited with code 1',
    );
  });
});

describe("the drawer's rows", () => {
  it('draws the buffer as it stands, the first started divider included', () => {
    const rows = drawerRowsOf(
      [started(1, time(0)), line(2, time(1), 'up'), line(3, time(2), 'GET /', 'stdout')],
      [],
    );
    assert.deepEqual(rows, [
      {kind: 'divider', key: 'entry:1', text: 'Started · uv run .'},
      {kind: 'line', key: 'entry:2', time: time(1), stream: 'err', text: 'up'},
      {kind: 'line', key: 'entry:3', time: time(2), stream: 'out', text: 'GET /'},
    ]);
  });

  it('draws nothing of the turns while the buffer is empty', () => {
    assert.deepEqual(drawerRowsOf([], [turn('a', time(1))]), []);
  });

  it('marks where each listed turn opened and closed, by time', () => {
    const rows = drawerRowsOf(
      [started(1, time(0)), line(2, time(5), 'working'), line(3, time(9), 'idle')],
      // Listed newest first.
      [turn('b', time(7), {durationMs: 1000}), turn('a', time(2), {durationMs: 4000})],
    );
    assert.deepEqual(
      rows.map(row => row.key),
      ['entry:1', 'opened:a', 'entry:2', 'closed:a', 'opened:b', 'closed:b', 'entry:3'],
    );
  });

  it('gives an open turn its opened marker alone', () => {
    const rows = drawerRowsOf(
      [started(1, time(0))],
      [{traceId: 'a', startTime: time(2), open: true, durationMs: 500}],
    );
    assert.deepEqual(
      rows.map(row => row.key),
      ['entry:1', 'opened:a'],
    );
  });

  it('draws a marker only when its moment is not earlier than the oldest entry held', () => {
    const entries = [line(40, time(10), 'still held')];
    // A turn of an earlier run gets none; one whose opening has left the buffer keeps its closed marker.
    const rows = drawerRowsOf(entries, [
      turn('kept', time(8), {durationMs: 5000}),
      turn('earlier', '2026-11-11T09:00:00.000Z', {durationMs: 1000}),
    ]);
    assert.deepEqual(
      rows.map(row => row.key),
      ['entry:40', 'closed:kept'],
    );
    // A moment equal to the oldest entry's is drawn.
    assert.deepEqual(
      drawerRowsOf(entries, [turn('edge', time(10), {durationMs: 0})]).map(row => row.key),
      ['opened:edge', 'entry:40', 'closed:edge'],
    );
  });

  it('puts an opened marker before the entries of its millisecond, and a closed one after them', () => {
    const rows = drawerRowsOf(
      [line(1, time(0), 'first'), line(2, time(3, 250), 'a'), line(3, time(3, 250), 'b')],
      [turn('later', time(3, 250), {durationMs: 2000}), turn('ends', time(1), {durationMs: 2250})],
    );
    assert.deepEqual(
      rows.map(row => row.key),
      [
        'entry:1',
        'opened:ends',
        'opened:later',
        'entry:2',
        'entry:3',
        'closed:ends',
        'closed:later',
      ],
    );
  });

  it('names an opened turn as the turn list does, and a closed one by its outcome and duration', () => {
    const rows = drawerRowsOf(
      [started(1, time(0))],
      [
        turn('none', time(3), {input: undefined, outcome: 'failed', durationMs: 44}),
        turn('action', time(2), {input: {action: 'submit_booking'}, outcome: 'waiting_for_input'}),
        turn('text', time(1), {input: {text: 'Book a table'}, durationMs: 9900}),
      ],
    );
    const opened = rows.flatMap(row => (row.kind === 'opened' ? [[row.traceId, row.name]] : []));
    assert.deepEqual(opened, [
      ['text', 'Book a table'],
      ['action', 'Action “submit_booking”'],
      ['none', 'A turn'],
    ]);
    const closed = rows.flatMap(row =>
      row.kind === 'closed' ? [[row.outcome, row.durationMs]] : [],
    );
    // By the moment each closed: the first turn's 9.9 s outlast the other two.
    assert.deepEqual(closed, [
      ['waiting for input', 1000],
      ['failed', 44],
      ['completed', 9900],
    ]);
  });

  it("words a closed turn's outcome as the header does, lower-case", () => {
    for (const outcome of ['completed', 'waiting_for_input', 'failed', 'cancelled'] as const) {
      const [, , closed] = drawerRowsOf([started(1, time(0))], [turn('a', time(1), {outcome})]);
      assert.equal(
        closed.kind === 'closed' && closed.outcome,
        STATUS_LABELS[outcome].toLowerCase(),
      );
    }
  });

  it('shows a line as a terminal would leave it', () => {
    const [row] = drawerRowsOf([line(1, time(0), '\u001b[1m10%\r100%\u001b[0m')], []);
    assert.equal(row.kind === 'line' && row.text, '100%');
  });
});

describe("the first screen's lines", () => {
  const stopped = (n: number, at: string): LogEntry => ({
    n,
    time: at,
    type: 'stopped',
    exit: 'exited with code 1',
  });

  it('are the output lines written since the latest start, dividers not counted', () => {
    const entries = [
      started(1, time(0)),
      line(2, time(1), 'first run'),
      stopped(3, time(2)),
      started(4, time(3)),
      line(5, time(4), 'Traceback'),
      line(6, time(4), 'SyntaxError\r', 'stdout'),
      stopped(7, time(5)),
    ];
    assert.deepEqual(tailSinceStartOf(entries), [
      {key: 'entry:5', time: time(4), stream: 'err', text: 'Traceback'},
      {key: 'entry:6', time: time(4), stream: 'out', text: 'SyntaxError'},
    ]);
  });

  it('are the last twelve of them', () => {
    const entries = [
      started(1, time(0)),
      ...Array.from({length: 20}, (_, index) => line(index + 2, time(1), `line ${index + 1}`)),
    ];
    const tail = tailSinceStartOf(entries);
    assert.equal(tail.length, 12);
    assert.equal(tail[0].text, 'line 9');
    assert.equal(tail[11].text, 'line 20');
  });

  it('are none when the command wrote nothing, as when it could not start', () => {
    assert.deepEqual(
      tailSinceStartOf([
        started(1, time(0)),
        line(2, time(1), 'old'),
        started(3, time(2)),
        stopped(4, time(2)),
      ]),
      [],
    );
    assert.deepEqual(tailSinceStartOf([]), []);
  });
});

describe("the drawer's header", () => {
  it('counts the lines held and names the cap', () => {
    assert.equal(lineCountOf(412, 1000), '412 lines · 1,000 kept');
    assert.equal(lineCountOf(1, 1000), '1 line · 1,000 kept');
    assert.equal(lineCountOf(0, 1000), '0 lines · 1,000 kept');
  });

  it("reads a line's time to the millisecond, in the page's time zone", () => {
    const local = new Date(2026, 10, 12, 18, 36, 26, 412);
    assert.equal(logTimeOf(local.toISOString()), '18:36:26.412');
    assert.equal(logTimeOf(new Date(2026, 10, 12, 7, 5, 3, 9).toISOString()), '07:05:03.009');
  });
});
