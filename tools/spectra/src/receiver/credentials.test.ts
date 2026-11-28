import assert from 'node:assert/strict';
import {describe, it} from 'node:test';

import {
  attributesWithoutCredentials,
  logWithoutCredentials,
  spanWithoutCredentials,
} from './credentials.js';
import type {ReceivedLog, ReceivedSpan} from './otlp.js';

describe("credentials removed from what the receiver takes, by the proxies' rules", () => {
  it("removes a URL's credentials wherever an attribute's value is a URL", () => {
    assert.deepEqual(
      attributesWithoutCredentials({
        'url.full': 'https://generativelanguage.googleapis.com/v1beta/models?key=abc&alt=sse',
        'http.url': 'https://user:pass@api.example/v1?access_token=t',
        'server.address': 'api.example',
        note: 'see https://api.example/?key=abc',
        list: ['https://api.example/?api_key=abc', 'plain'],
        count: 3,
      }),
      {
        'url.full': 'https://generativelanguage.googleapis.com/v1beta/models?key=REMOVED&alt=sse',
        'http.url': 'https://REMOVED@api.example/v1?access_token=REMOVED',
        'server.address': 'api.example',
        note: 'see https://api.example/?key=abc',
        list: ['https://api.example/?api_key=REMOVED', 'plain'],
        count: 3,
      },
    );
  });

  it('removes the credentials of a query and of a request target, which name no host', () => {
    assert.deepEqual(
      attributesWithoutCredentials({
        'url.query': 'key=abc&alt=sse',
        'http.target': '/v1beta/models?key=abc',
        'url.path': '/v1beta/models',
      }),
      {
        'url.query': 'key=REMOVED&alt=sse',
        'http.target': '/v1beta/models?key=REMOVED',
        'url.path': '/v1beta/models',
      },
    );
  });

  it("removes a header's value by its name, a request's by the name pattern and a response's set-cookie", () => {
    assert.deepEqual(
      attributesWithoutCredentials({
        'http.request.header.authorization': ['Bearer abc'],
        'http.request.header.x-goog-api-key': 'abc',
        'http.request.header.X-Custom-Token': ['abc', 'def'],
        'http.request.header.content-type': ['application/json'],
        'http.response.header.set-cookie': ['session=abc'],
        'http.response.header.x-request-token': ['kept'],
      }),
      {
        'http.request.header.authorization': ['REMOVED'],
        'http.request.header.x-goog-api-key': 'REMOVED',
        'http.request.header.X-Custom-Token': ['REMOVED', 'REMOVED'],
        'http.request.header.content-type': ['application/json'],
        'http.response.header.set-cookie': ['REMOVED'],
        'http.response.header.x-request-token': ['kept'],
      },
    );
  });

  it("removes them from a span's attributes and its events', and from a log record's", () => {
    const span = {
      attributes: {'url.full': 'https://api.example/?key=abc'},
      events: [
        {
          timeUnixNano: '1',
          name: 'request',
          attributes: {'http.url': 'https://api.example/?key=abc'},
        },
        {timeUnixNano: '2', name: 'bare'},
      ],
    } as unknown as ReceivedSpan;
    const cleaned = spanWithoutCredentials(span);
    assert.equal(cleaned.attributes['url.full'], 'https://api.example/?key=REMOVED');
    assert.deepEqual(cleaned.events, [
      {
        timeUnixNano: '1',
        name: 'request',
        attributes: {'http.url': 'https://api.example/?key=REMOVED'},
      },
      {timeUnixNano: '2', name: 'bare'},
    ]);
    const log = {
      attributes: {'http.request.header.authorization': ['Bearer abc']},
      body: {text: 'kept as sent'},
    } as unknown as ReceivedLog;
    assert.deepEqual(logWithoutCredentials(log), {
      attributes: {'http.request.header.authorization': ['REMOVED']},
      body: {text: 'kept as sent'},
    });
  });
});
