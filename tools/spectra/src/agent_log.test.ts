import assert from 'node:assert/strict';
import {describe, it} from 'node:test';

import {LINE_LIMIT, LineSplitter, LOG_CAP, LogBuffer} from './agent_log.js';

const bytes = (text: string) => Buffer.from(text, 'utf8');

describe("the split of the agent's output into lines", () => {
  it('ends a line at a newline, dropping a carriage return just before it, and keeps the rest as written', () => {
    const splitter = new LineSplitter();
    assert.deepEqual(splitter.push(bytes('one\ntwo\r\n\x1b[32mgreen\x1b[0m 40%\r80%\n')), [
      'one',
      'two',
      '\x1b[32mgreen\x1b[0m 40%\r80%',
    ]);
  });

  it('holds an unfinished line until its newline, or the end of the stream', () => {
    const splitter = new LineSplitter();
    assert.deepEqual(splitter.push(bytes('Process')), []);
    assert.deepEqual(splitter.push(bytes('ing… done\nlast words')), ['Processing… done']);
    assert.deepEqual(splitter.end(), ['last words']);
    assert.deepEqual(splitter.end(), [], 'Nothing is held after the end.');
  });

  it('joins a character split across two chunks, and a carriage return and its newline', () => {
    const splitter = new LineSplitter();
    const text = bytes('식당\r\n');
    assert.deepEqual(splitter.push(text.subarray(0, 4)), []);
    assert.deepEqual(splitter.push(text.subarray(4, 7)), []);
    assert.deepEqual(splitter.push(text.subarray(7)), ['식당']);
  });

  it("splits a line at 16 KiB, Docker's limit, what follows continuing as the next line", () => {
    assert.equal(LINE_LIMIT, 16 * 1024);
    const splitter = new LineSplitter();
    const lines = splitter.push(bytes(`${'x'.repeat(LINE_LIMIT + 5)}\n`));
    assert.deepEqual(
      lines.map(line => line.length),
      [LINE_LIMIT, 5],
    );
    // A stream that never sends a newline is entered as it reaches the limit.
    assert.deepEqual(
      splitter.push(bytes('y'.repeat(LINE_LIMIT * 2 + 1))).map(line => line.length),
      [LINE_LIMIT, LINE_LIMIT],
    );
    assert.deepEqual(splitter.end(), ['y']);
  });

  it('never splits inside a character', () => {
    const splitter = new LineSplitter();
    // Three bytes each, so the limit falls inside the 5,462nd character.
    const lines = splitter.push(bytes(`${'식'.repeat(6000)}\n`));
    assert.deepEqual(
      lines.map(line => line.length),
      [5461, 539],
    );
    assert.ok(lines.every(line => /^식+$/.test(line)));
  });
});

describe("the buffer of the agent's output", () => {
  const clock = () => {
    let ms = Date.parse('2026-11-10T18:36:26.412Z');
    return () => new Date(ms++);
  };

  it('numbers its entries in order from 1, each with the moment it entered, and gives them with the count of lines and the cap', () => {
    const buffer = new LogBuffer({now: clock()});
    const started = buffer.add([{type: 'started', command: 'uv run .'}]);
    assert.deepEqual(started, {
      entries: [{n: 1, type: 'started', time: '2026-11-10T18:36:26.412Z', command: 'uv run .'}],
      oldest: 1,
    });
    const lines = buffer.add([
      {type: 'line', stream: 'stderr', text: 'INFO: Started server process'},
      {type: 'line', stream: 'stdout', text: 'ready'},
    ]);
    assert.deepEqual(
      lines.entries.map(entry => [entry.n, entry.type, entry.time]),
      [
        [2, 'line', '2026-11-10T18:36:26.413Z'],
        [3, 'line', '2026-11-10T18:36:26.413Z'],
      ],
    );
    const stopped = buffer.add([
      {type: 'stopped', exit: 'exited with code 143', cause: {kind: 'press'}},
    ]);
    assert.deepEqual(buffer.snapshot(), {
      entries: [...started.entries, ...lines.entries, ...stopped.entries],
      lines: 2,
      cap: LOG_CAP,
    });
    assert.equal(LOG_CAP, 1000);
  });

  it('never lets its times go backwards', () => {
    const times = ['2026-11-10T18:36:26.500Z', '2026-11-10T18:36:26.400Z'];
    const buffer = new LogBuffer({now: () => new Date(times.shift() ?? 0)});
    buffer.add([{type: 'line', stream: 'stdout', text: 'a'}]);
    const {entries} = buffer.add([{type: 'line', stream: 'stdout', text: 'b'}]);
    assert.equal(entries[0].time, '2026-11-10T18:36:26.500Z');
  });

  it('counts output lines alone against its cap, a divider leaving when the lines before it have left', () => {
    const buffer = new LogBuffer({cap: 3, now: clock()});
    const line = (text: string) => ({type: 'line' as const, stream: 'stdout' as const, text});
    buffer.add([{type: 'started', command: 'agent'}]);
    buffer.add([line('1'), line('2')]);
    buffer.add([{type: 'stopped', exit: 'exited with code 1'}]);
    buffer.add([{type: 'started', command: 'agent'}]);
    buffer.add([line('3')]);
    // Three lines and three dividers: the cap is not reached by the dividers.
    assert.equal(buffer.snapshot().entries.length, 6);
    assert.equal(buffer.snapshot().lines, 3);

    // The first line leaves, and the started divider before it with it.
    assert.deepEqual(buffer.add([line('4')]).oldest, 3);
    assert.deepEqual(
      buffer.snapshot().entries.map(entry => (entry.type === 'line' ? entry.text : entry.type)),
      ['2', 'stopped', 'started', '3', '4'],
    );
    // The second line leaves, and the two dividers after it have no line before them.
    const event = buffer.add([line('5')]);
    assert.deepEqual(
      buffer.snapshot().entries.map(entry => (entry.type === 'line' ? entry.text : entry.type)),
      ['3', '4', '5'],
    );
    assert.equal(event.oldest, 6);
    assert.equal(buffer.snapshot().lines, 3);
  });
});
