import assert from 'node:assert/strict';
import {describe, it} from 'node:test';

import {SseParser} from './sse.js';

function parseAll(...chunks: string[]) {
  const parser = new SseParser();
  return chunks.flatMap(chunk => parser.push(chunk));
}

describe('SseParser', () => {
  it('dispatches an event at each blank line, with its fields', () => {
    assert.deepEqual(parseAll('data: {"a":1}\n\nevent: message\nid: 7\ndata: two\n\n'), [
      {data: '{"a":1}'},
      {event: 'message', id: '7', data: 'two'},
    ]);
  });

  it('joins data lines with a newline and strips one leading space only', () => {
    assert.deepEqual(parseAll('data:  a\ndata:b\ndata\n\n'), [{data: ' a\nb\n'}]);
  });

  it('reads CRLF and CR line endings', () => {
    assert.deepEqual(parseAll('data: one\r\n\r\ndata: two\r\rdata: three\n\n'), [
      {data: 'one'},
      {data: 'two'},
      {data: 'three'},
    ]);
  });

  it('reads events split across chunks, a CRLF included', () => {
    assert.deepEqual(parseAll('da', 'ta: {"jsonrpc"', ':"2.0"}\r', '\n\r', '\ndata: x\n', '\n'), [
      {data: '{"jsonrpc":"2.0"}'},
      {data: 'x'},
    ]);
  });

  it('skips comments and events without data, and drops an unfinished event', () => {
    assert.deepEqual(parseAll(': ping\n\nevent: empty\n\ndata: last'), []);
  });
});
