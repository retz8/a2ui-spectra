import assert from 'node:assert/strict';
import {request as httpRequest} from 'node:http';
import {describe, it} from 'node:test';
import {gzipSync} from 'node:zlib';

import {create, toBinary} from '@bufbuild/protobuf';

import {HOST_REFUSED, PAGE_REFUSED} from '../host_check.js';
import {PortTakenError} from '../server.js';
import {jsonBytes, logExport, traceExport} from '../testing/otlp.js';
import {ExportTraceServiceRequestSchema} from './gen/opentelemetry/proto/collector/trace/v1/trace_service_pb.js';
import {startReceiverListener} from './listener.js';
import type {ReceivedLog, ReceivedSpan} from './otlp.js';
import {freePort} from '../testing/free_port.js';

const TRACE = 'a'.repeat(32);
const SPAN = '1'.repeat(16);

async function withListener(
  use: (origin: string, spans: ReceivedSpan[][], logs: ReceivedLog[][]) => Promise<void>,
  allowedHosts?: readonly string[],
): Promise<void> {
  const spans: ReceivedSpan[][] = [];
  const logs: ReceivedLog[][] = [];
  const listener = await startReceiverListener({
    port: await freePort(),
    onSpans: received => spans.push(received),
    onLogs: received => logs.push(received),
    allowedHosts,
  });
  try {
    await use(listener.origin, spans, logs);
  } finally {
    await listener.close();
  }
}

/** Posts `body` to the listener with the headers given, `Host` among them, which `fetch` does not set. */
function post(
  origin: string,
  path: string,
  headers: Record<string, string>,
  body: Uint8Array,
): Promise<{status: number; body: string}> {
  return new Promise((resolve, reject) => {
    const sent = httpRequest(`${origin}${path}`, {method: 'POST', headers}, response => {
      const chunks: Buffer[] = [];
      response.on('data', (chunk: Buffer) => chunks.push(chunk));
      response.on('end', () =>
        resolve({status: response.statusCode ?? 0, body: Buffer.concat(chunks).toString()}),
      );
    });
    sent.on('error', reject);
    sent.end(body);
  });
}

const oneSpan = traceExport([
  {scope: {name: 'test'}, spans: [{traceId: TRACE, spanId: SPAN, name: 's', start: 1n, end: 2n}]},
]);

describe("the receiver's listener", () => {
  it('reads a trace export in OTLP/JSON and in protobuf, gzip included, and answers with an empty export response', async () => {
    await withListener(async (origin, spans) => {
      const json = await fetch(`${origin}/v1/traces`, {
        method: 'POST',
        headers: {'content-type': 'application/json'},
        body: jsonBytes(oneSpan),
      });
      assert.equal(json.status, 200);
      assert.equal(json.headers.get('content-type'), 'application/json');
      assert.equal(await json.text(), '{}');
      const protobuf = await fetch(`${origin}/v1/traces`, {
        method: 'POST',
        headers: {'content-type': 'application/x-protobuf', 'content-encoding': 'gzip'},
        body: gzipSync(
          toBinary(
            ExportTraceServiceRequestSchema,
            create(ExportTraceServiceRequestSchema, {
              resourceSpans: [
                {
                  scopeSpans: [
                    {
                      scope: {name: 'test'},
                      spans: [
                        {
                          traceId: Buffer.from(TRACE, 'hex'),
                          spanId: Buffer.from(SPAN, 'hex'),
                          name: 's',
                          kind: 1,
                          startTimeUnixNano: 1n,
                          endTimeUnixNano: 2n,
                        },
                      ],
                    },
                  ],
                },
              ],
            }),
          ),
        ),
      });
      assert.equal(protobuf.status, 200);
      assert.equal(protobuf.headers.get('content-type'), 'application/x-protobuf');
      assert.equal((await protobuf.arrayBuffer()).byteLength, 0);
      assert.equal(spans.length, 2);
      assert.deepEqual(spans[0], spans[1]);
    });
  });

  it('reads log exports, answers metrics and drops them, and answers what it cannot read', async () => {
    await withListener(async (origin, spans, logs) => {
      const post = (path: string, body: Uint8Array | string, type = 'application/json') =>
        fetch(`${origin}${path}`, {method: 'POST', headers: {'content-type': type}, body});
      const logged = await post(
        '/v1/logs',
        jsonBytes(logExport([{scope: {name: 'test'}, logs: [{time: 5n, body: 'hello'}]}])),
      );
      assert.equal(logged.status, 200);
      assert.equal(logs[0][0].body, 'hello');
      assert.equal((await post('/v1/metrics', '{"resourceMetrics": []}')).status, 200);
      assert.equal((await post('/v1/traces', '{"resourceSpans": 5}')).status, 400);
      assert.equal((await post('/v1/traces', 'x', 'text/plain')).status, 415);
      assert.equal((await post('/v1/other', '{}')).status, 404);
      assert.equal((await fetch(`${origin}/v1/traces`)).status, 405);
      assert.equal(spans.length, 0);
    });
  });

  it('refuses a port that is taken', async () => {
    await withListener(async origin => {
      await assert.rejects(
        startReceiverListener({
          port: Number(new URL(origin).port),
          onSpans: () => {},
          onLogs: () => {},
        }),
        PortTakenError,
      );
    });
  });

  it('refuses a Host that is not a loopback name or one allowed, and hands nothing on', async () => {
    await withListener(
      async (origin, spans, logs) => {
        const logged = jsonBytes(
          logExport([{scope: {name: 'test'}, logs: [{time: 5n, body: 'x'}]}]),
        );
        for (const [path, body] of [
          ['/v1/traces', jsonBytes(oneSpan)],
          ['/v1/logs', logged],
        ] as const) {
          const answer = await post(
            origin,
            path,
            {
              host: `r.attacker.example:${new URL(origin).port}`,
              'content-type': 'application/json',
            },
            body,
          );
          assert.equal(answer.status, 403, path);
          assert.equal(answer.body, HOST_REFUSED, path);
        }
        assert.deepEqual(spans, []);
        assert.deepEqual(logs, []);
        const allowed = await post(
          origin,
          '/v1/traces',
          {host: `spectra.test:${new URL(origin).port}`, 'content-type': 'application/json'},
          jsonBytes(oneSpan),
        );
        assert.equal(allowed.status, 200);
        assert.equal(spans.length, 1);
      },
      ['spectra.test'],
    );
  });

  it('refuses any request from a page, and hands nothing on', async () => {
    await withListener(async (origin, spans) => {
      for (const from of ['https://attacker.example', 'http://localhost:5173', 'null']) {
        const answer = await post(
          origin,
          '/v1/traces',
          {origin: from, 'content-type': 'application/json'},
          jsonBytes(oneSpan),
        );
        assert.equal(answer.status, 403, from);
        assert.equal(answer.body, PAGE_REFUSED, from);
      }
      assert.deepEqual(spans, []);
    });
  });
});
