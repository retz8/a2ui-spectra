import assert from 'node:assert/strict';
import {createServer} from 'node:net';
import {describe, it} from 'node:test';
import {gzipSync} from 'node:zlib';

import {create, toBinary} from '@bufbuild/protobuf';

import {PortTakenError} from '../server.js';
import {jsonBytes, logExport, traceExport} from '../testing/otlp.js';
import {ExportTraceServiceRequestSchema} from './gen/opentelemetry/proto/collector/trace/v1/trace_service_pb.js';
import {startReceiverListener} from './listener.js';
import type {ReceivedLog, ReceivedSpan} from './otlp.js';

const TRACE = 'a'.repeat(32);
const SPAN = '1'.repeat(16);

function freePort(): Promise<number> {
  return new Promise(resolve => {
    const server = createServer().listen(0, '127.0.0.1', () => {
      const address = server.address();
      server.close(() =>
        resolve(typeof address === 'object' && address !== null ? address.port : 0),
      );
    });
  });
}

async function withListener(
  use: (origin: string, spans: ReceivedSpan[][], logs: ReceivedLog[][]) => Promise<void>,
): Promise<void> {
  const spans: ReceivedSpan[][] = [];
  const logs: ReceivedLog[][] = [];
  const listener = await startReceiverListener({
    port: await freePort(),
    onSpans: received => spans.push(received),
    onLogs: received => logs.push(received),
  });
  try {
    await use(listener.origin, spans, logs);
  } finally {
    await listener.close();
  }
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
});
