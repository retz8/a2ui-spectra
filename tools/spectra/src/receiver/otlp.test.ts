import assert from 'node:assert/strict';
import {describe, it} from 'node:test';

import {create, toBinary} from '@bufbuild/protobuf';

import {jsonBytes, logExport, traceExport} from '../testing/otlp.js';
import {ExportLogsServiceRequestSchema} from './gen/opentelemetry/proto/collector/logs/v1/logs_service_pb.js';
import {ExportTraceServiceRequestSchema} from './gen/opentelemetry/proto/collector/trace/v1/trace_service_pb.js';
import {
  DecodeError,
  decodeLogs,
  decodeTraces,
  plainAttributes,
  receivedLogs,
  receivedSpans,
} from './otlp.js';

const TRACE = '0af7651916cd43dd8448eb211c80319c';
const SPAN = 'b7ad6b7169203331';
const PARENT = '00f067aa0ba902b7';

function bytes(hex: string): Uint8Array {
  return Uint8Array.from(Buffer.from(hex, 'hex'));
}

/** The same trace export as `jsonTraces`, in protobuf. */
function protobufTraces(): Uint8Array {
  return toBinary(
    ExportTraceServiceRequestSchema,
    create(ExportTraceServiceRequestSchema, {
      resourceSpans: [
        {
          scopeSpans: [
            {
              scope: {name: 'gcp.vertex.agent', version: '2.3.0'},
              spans: [
                {
                  traceId: bytes(TRACE),
                  spanId: bytes(SPAN),
                  parentSpanId: bytes(PARENT),
                  name: 'call_llm',
                  kind: 1,
                  startTimeUnixNano: 1_000_000_000_123n,
                  endTimeUnixNano: 2_000_000_000_456n,
                  attributes: [
                    {key: 'text', value: {value: {case: 'stringValue', value: 'hi'}}},
                    {key: 'count', value: {value: {case: 'intValue', value: 7n}}},
                    {key: 'big', value: {value: {case: 'intValue', value: 9007199254740993n}}},
                    {key: 'ratio', value: {value: {case: 'doubleValue', value: 0.5}}},
                    {key: 'flag', value: {value: {case: 'boolValue', value: true}}},
                    {
                      key: 'list',
                      value: {
                        value: {
                          case: 'arrayValue',
                          value: {values: [{value: {case: 'stringValue', value: 'a'}}]},
                        },
                      },
                    },
                    {
                      key: 'map',
                      value: {
                        value: {
                          case: 'kvlistValue',
                          value: {
                            values: [{key: 'k', value: {value: {case: 'intValue', value: 1n}}}],
                          },
                        },
                      },
                    },
                    {key: 'raw', value: {value: {case: 'bytesValue', value: bytes('0102')}}},
                  ],
                  events: [{timeUnixNano: 1_500_000_000_000n, name: 'exception', attributes: []}],
                  links: [{traceId: bytes(TRACE), spanId: bytes(PARENT), attributes: []}],
                  status: {code: 2, message: 'boom'},
                },
              ],
            },
          ],
        },
      ],
    }),
  );
}

function jsonTraces(): unknown {
  return {
    resourceSpans: [
      {
        scopeSpans: [
          {
            scope: {name: 'gcp.vertex.agent', version: '2.3.0'},
            spans: [
              {
                traceId: TRACE.toUpperCase(),
                spanId: SPAN,
                parentSpanId: PARENT,
                name: 'call_llm',
                kind: 1,
                startTimeUnixNano: '1000000000123',
                endTimeUnixNano: 2000000000456,
                attributes: [
                  {key: 'text', value: {stringValue: 'hi'}},
                  {key: 'count', value: {intValue: 7}},
                  {key: 'big', value: {intValue: '9007199254740993'}},
                  {key: 'ratio', value: {doubleValue: 0.5}},
                  {key: 'flag', value: {boolValue: true}},
                  {key: 'list', value: {arrayValue: {values: [{stringValue: 'a'}]}}},
                  {
                    key: 'map',
                    value: {kvlistValue: {values: [{key: 'k', value: {intValue: '1'}}]}},
                  },
                  {key: 'raw', value: {bytesValue: 'AQI='}},
                ],
                events: [{timeUnixNano: '1500000000000', name: 'exception'}],
                links: [{traceId: TRACE, spanId: PARENT}],
                status: {code: 2, message: 'boom'},
              },
            ],
          },
        ],
      },
    ],
  };
}

describe('the OTLP decoding', () => {
  it('brings protobuf and OTLP/JSON to the same shape, ids as lowercase hex and times as strings', () => {
    const fromProtobuf = receivedSpans(decodeTraces(protobufTraces(), 'protobuf'));
    const fromJson = receivedSpans(decodeTraces(jsonBytes(jsonTraces()), 'json'));
    assert.deepEqual(fromProtobuf, fromJson);
    assert.deepEqual(fromJson, [
      {
        traceId: TRACE,
        spanId: SPAN,
        parentSpanId: PARENT,
        name: 'call_llm',
        kind: 1,
        startTimeUnixNano: '1000000000123',
        endTimeUnixNano: '2000000000456',
        attributes: {
          text: 'hi',
          count: 7,
          big: '9007199254740993',
          ratio: 0.5,
          flag: true,
          list: ['a'],
          map: {k: 1},
          raw: 'AQI=',
        },
        events: [{timeUnixNano: '1500000000000', name: 'exception'}],
        links: [{traceId: TRACE, spanId: PARENT}],
        status: {code: 2, message: 'boom'},
        scope: {name: 'gcp.vertex.agent', version: '2.3.0'},
      },
    ]);
  });

  it('reads log records with their span context, time, event name, severity and body', () => {
    const protobuf = toBinary(
      ExportLogsServiceRequestSchema,
      create(ExportLogsServiceRequestSchema, {
        resourceLogs: [
          {
            scopeLogs: [
              {
                scope: {name: 'gcp.vertex.agent'},
                logRecords: [
                  {
                    timeUnixNano: 0n,
                    observedTimeUnixNano: 5n,
                    severityNumber: 9,
                    severityText: 'INFO',
                    eventName: 'gen_ai.choice',
                    body: {
                      value: {
                        case: 'kvlistValue',
                        value: {
                          values: [{key: 'index', value: {value: {case: 'intValue', value: 0n}}}],
                        },
                      },
                    },
                    traceId: bytes(TRACE),
                    spanId: bytes(SPAN),
                  },
                  {timeUnixNano: 6n, traceId: new Uint8Array(16), spanId: new Uint8Array(8)},
                ],
              },
            ],
          },
        ],
      }),
    );
    const logs = receivedLogs(decodeLogs(protobuf, 'protobuf'));
    assert.deepEqual(logs, [
      {
        timeUnixNano: '5',
        traceId: TRACE,
        spanId: SPAN,
        eventName: 'gen_ai.choice',
        severityNumber: 9,
        severityText: 'INFO',
        body: {index: 0},
        attributes: {},
        scope: {name: 'gcp.vertex.agent'},
      },
      {timeUnixNano: '6', attributes: {}, scope: {name: 'gcp.vertex.agent'}},
    ]);
    const json = receivedLogs(
      decodeLogs(
        jsonBytes(
          logExport([
            {
              scope: {name: 'x'},
              logs: [
                {
                  time: 7n,
                  attributes: {'event.name': 'gen_ai.user.message'},
                  traceId: TRACE,
                  spanId: SPAN,
                },
              ],
            },
          ]),
        ),
        'json',
      ),
    );
    assert.equal(json[0].eventName, 'gen_ai.user.message');
    assert.equal(json[0].spanId, SPAN);
  });

  it('keeps the later of two attributes with one key', () => {
    assert.deepEqual(
      plainAttributes([
        {key: 'a', value: {stringValue: 'first'}},
        {key: 'a', value: {stringValue: 'second'}},
        {key: 'b'},
      ]),
      {a: 'second', b: null},
    );
  });

  it('refuses a body that is not its signal export', () => {
    assert.throws(() => decodeTraces(jsonBytes('not an object'), 'json'), DecodeError);
    assert.throws(() => decodeTraces(Buffer.from('{'), 'json'), DecodeError);
    assert.throws(() => decodeTraces(Buffer.from([0x0a, 0xff]), 'protobuf'), DecodeError);
    const shortId = traceExport([
      {scope: {name: 'x'}, spans: [{traceId: 'abc', spanId: SPAN, name: 's', start: 1n, end: 2n}]},
    ]);
    assert.throws(() => decodeTraces(jsonBytes(shortId), 'json'), /16 bytes of hex/);
    assert.throws(
      () =>
        decodeTraces(
          jsonBytes({resourceSpans: [{scopeSpans: [{spans: [{traceId: TRACE}]}]}]}),
          'json',
        ),
      /no trace id or span id/,
    );
    assert.deepEqual(decodeTraces(jsonBytes({}), 'json'), {resourceSpans: []});
  });
});
