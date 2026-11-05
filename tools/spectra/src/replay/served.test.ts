import assert from 'node:assert/strict';
import {describe, it} from 'node:test';

import type {ModelCallEvent} from '../record/turn_record.js';
import {
  brokeOff,
  missLine,
  recordedAnswer,
  ServedMessage,
  servedHeaders,
  sseText,
  unreachedLine,
} from './served.js';

function call(
  attributes: Record<string, unknown>,
  extra: Partial<ModelCallEvent> = {},
): ModelCallEvent {
  return {
    traceId: 'a'.repeat(32),
    spanId: 'b'.repeat(16),
    parentSpanId: 'c'.repeat(16),
    name: 'chat',
    kind: 3,
    startTimeUnixNano: '1',
    endTimeUnixNano: '2',
    attributes: {'a2ui.event.kind': 'model_call', ...attributes},
    status: {code: 1},
    ...extra,
  };
}

function chunk(body: unknown, fields: {event?: string; id?: string} = {}) {
  return {
    timeUnixNano: '1',
    name: 'a2ui.http.response.chunk',
    attributes: {
      'a2ui.http.response.chunk.body': body,
      ...(fields.event !== undefined && {'a2ui.http.response.chunk.event': fields.event}),
      ...(fields.id !== undefined && {'a2ui.http.response.chunk.id': fields.id}),
    },
  };
}

async function read(message: ServedMessage): Promise<{text: string; aborted: boolean}> {
  let text = '';
  let aborted = false;
  message.on('aborted', () => (aborted = true));
  message.setEncoding('utf8');
  await new Promise<void>(resolve => {
    message.on('data', (piece: string) => (text += piece));
    message.once('end', resolve);
    message.once('close', resolve);
  });
  return {text, aborted};
}

describe('a served reply', () => {
  it('carries the recorded response headers less a removed one, content-encoding and content-length', () => {
    assert.deepEqual(
      servedHeaders({
        'http.response.header.content-type': ['application/json'],
        'http.response.header.content-encoding': ['gzip'],
        'http.response.header.content-length': ['120'],
        'http.response.header.set-cookie': ['REMOVED'],
        'http.response.header.x-request-id': ['req_1'],
        'http.response.header.vary': ['accept', 'origin'],
        'http.request.header.accept': ['*/*'],
      }),
      {'content-type': 'application/json', 'x-request-id': 'req_1', vary: 'accept, origin'},
    );
  });

  it('serialises a JSON body from its recorded value, content-length recomputed', () => {
    const answer = recordedAnswer(
      call({
        'http.response.status_code': 429,
        'http.response.header.content-type': ['application/json'],
        'http.response.header.content-length': ['9999'],
        'a2ui.http.response.body': {error: {message: 'Slow down — please.'}},
      }),
      {broke: false},
    );
    assert.equal(answer.type, 'reply');
    if (answer.type !== 'reply') return;
    const body = JSON.stringify({error: {message: 'Slow down — please.'}});
    assert.deepEqual(answer.reply, {
      status: 429,
      headers: {
        'content-type': 'application/json',
        'content-length': String(Buffer.byteLength(body)),
      },
      body,
    });
  });

  it('writes a text body as its text, and a body left out of the record as none', () => {
    const text = recordedAnswer(
      call({
        'http.response.status_code': 404,
        'http.response.header.content-type': ['text/plain'],
        'a2ui.http.response.body': 'Not here.',
      }),
      {broke: false},
    );
    assert.equal(text.type === 'reply' && text.reply.body, 'Not here.');
    const binary = recordedAnswer(
      call({
        'http.response.status_code': 200,
        'http.response.header.content-type': ['application/octet-stream'],
      }),
      {broke: false},
    );
    assert.equal(binary.type === 'reply' && binary.reply.headers['content-length'], '0');
  });

  it('serves a stream as one server-sent event per chunk, its event and id fields as recorded', () => {
    const answer = recordedAnswer(
      call(
        {
          'http.response.status_code': 200,
          'http.response.header.content-type': ['text/event-stream'],
        },
        {events: [chunk({a: 1}, {event: 'message_start', id: '7'}), chunk('[DONE]')]},
      ),
      {broke: false},
    );
    assert.ok(answer.type === 'reply');
    assert.deepEqual(answer.reply.events, [
      {event: 'message_start', id: '7', data: '{"a":1}'},
      {data: '[DONE]'},
    ]);
    assert.equal(answer.reply.headers['content-length'], undefined);
  });

  it('writes a data line per line of an event', () => {
    assert.equal(
      sseText({event: 'tick', data: 'one\ntwo'}),
      'event: tick\ndata: one\ndata: two\n\n',
    );
  });

  it('answers a call with no response recorded as unreached, with its recorded failure', () => {
    const answer = recordedAnswer(
      call(
        {'error.type': 'ECONNREFUSED'},
        {status: {code: 2, message: 'connect ECONNREFUSED 127.0.0.1:1'}},
      ),
      {broke: false},
    );
    assert.deepEqual(answer, {
      type: 'unreached',
      failure: {type: 'ECONNREFUSED', message: 'connect ECONNREFUSED 127.0.0.1:1'},
    });
    assert.equal(
      unreachedLine('model proxy', 'api.anthropic.com', answer.failure),
      "a2ui-spectra's model proxy could not reach api.anthropic.com: connect ECONNREFUSED 127.0.0.1:1",
    );
    assert.equal(
      unreachedLine('model proxy', 'x', {type: 'replay_miss', message: 'The line.'}),
      'The line.',
      'a recorded miss is served with its own line',
    );
  });

  it('names a break apart from a failure the response states', () => {
    const failed = (type: string, attributes: Record<string, unknown> = {}) =>
      call(
        {'http.response.status_code': 200, 'error.type': type, ...attributes},
        {status: {code: 2}},
      );
    assert.ok(brokeOff(failed('ECONNRESET')));
    assert.ok(!brokeOff(failed('aborted')));
    assert.ok(!brokeOff(failed('cancelled')));
    assert.ok(!brokeOff(failed('overloaded_error'), 'overloaded_error'), 'the stream states it');
    assert.ok(!brokeOff(failed('-32602', {'rpc.response.status_code': '-32602'})));
    assert.ok(!brokeOff(failed('404', {'http.response.status_code': 404})));
    assert.ok(!brokeOff(call({'http.response.status_code': 200})), 'a call that did not fail');
  });

  it('gives its pieces as read, then ends whole, or breaks off once what it gave was read', async () => {
    const whole = new ServedMessage({status: 200, headers: {}, events: [{data: 'a'}, {data: 'b'}]});
    assert.deepEqual(await read(whole), {text: 'data: a\n\ndata: b\n\n', aborted: false});
    assert.ok(whole.complete);
    const broken = new ServedMessage({
      status: 200,
      headers: {},
      events: [{data: 'a'}],
      broken: true,
    });
    assert.deepEqual(await read(broken), {text: 'data: a\n\n', aborted: true});
    assert.ok(!broken.complete);
  });

  it("names the method and the target's path with credentials removed in the miss line", () => {
    assert.equal(
      missLine(
        'model proxy',
        'POST',
        new URL(
          'https://generativelanguage.googleapis.com/v1beta/models/m:generateContent?key=secret',
        ),
      ),
      "a2ui-spectra's model proxy is replaying, and POST /v1beta/models/m:generateContent?key=REMOVED matched nothing in the record.",
    );
  });
});
