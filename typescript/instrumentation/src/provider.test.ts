/** The tracer provider the wrapper starts when the process has none, and the ones it keeps. */

import assert from 'node:assert/strict';
import {afterEach, beforeEach, describe, it} from 'node:test';

import {
  context,
  diag,
  DiagLogLevel,
  propagation,
  type ProxyTracerProvider,
  trace,
} from '@opentelemetry/api';
import {NodeTracerProvider} from '@opentelemetry/sdk-trace-node';

import {instrument, uninstrument} from './index.js';
import {Capture, otlpVariables, processorOf} from './testing/support.js';

const capture = new Capture();
let restore: () => void = () => {};
let lines: string[] = [];
let exitListeners: Function[] = [];

function delegate(): unknown {
  return (trace.getTracerProvider() as ProxyTracerProvider).getDelegate();
}

function hasGlobalProvider(): boolean {
  return (trace.getTracerProvider() as ProxyTracerProvider).getDelegateTracer('test') !== undefined;
}

async function compileOnce(): Promise<void> {
  const processor = await processorOf('express');
  processor.parser.compile('surface("e")\nroot = Text("Hi")');
}

beforeEach(() => {
  capture.reset();
  lines = [];
  // A component logger passes its namespace first.
  const record = (...args: unknown[]) => lines.push(args.join(' '));
  diag.setLogger(
    {error: record, warn: record, info: record, debug: () => {}, verbose: () => {}},
    DiagLogLevel.INFO,
  );
  exitListeners = process.listeners('beforeExit');
});

afterEach(async () => {
  uninstrument();
  const started = delegate();
  if (started instanceof NodeTracerProvider) await started.shutdown();
  for (const listener of process.listeners('beforeExit')) {
    if (!exitListeners.includes(listener)) process.off('beforeExit', listener);
  }
  trace.disable();
  context.disable();
  propagation.disable();
  diag.disable();
  restore();
});

describe('the tracer provider', () => {
  it('with none, and an endpoint named: a NodeTracerProvider, shut down on beforeExit', () => {
    restore = otlpVariables({OTEL_EXPORTER_OTLP_ENDPOINT: 'http://127.0.0.1:9'});
    instrument();
    assert.ok(delegate() instanceof NodeTracerProvider);
    assert.equal(process.listeners('beforeExit').length, exitListeners.length + 1);
  });

  it('with none, and no endpoint named: none started, and one line at info', () => {
    restore = otlpVariables({});
    instrument();
    assert.equal(hasGlobalProvider(), false);
    assert.equal(lines.length, 1);
    assert.match(lines[0], /started no tracer provider: the environment names no OTLP endpoint/);
  });

  it('with none, and another protocol named: none started, and the line names it', () => {
    restore = otlpVariables({
      OTEL_EXPORTER_OTLP_ENDPOINT: 'http://127.0.0.1:9',
      OTEL_EXPORTER_OTLP_PROTOCOL: 'grpc',
    });
    instrument();
    assert.equal(hasGlobalProvider(), false);
    assert.equal(lines.length, 1);
    assert.match(lines[0], /names the OTLP protocol grpc/);
  });

  it("a provider passed in takes the spans, and the process's is left as it is", async () => {
    restore = otlpVariables({OTEL_EXPORTER_OTLP_ENDPOINT: 'http://127.0.0.1:9'});
    instrument({tracerProvider: capture.provider});
    assert.equal(hasGlobalProvider(), false);
    await compileOnce();
    assert.equal(capture.spans().length, 1);
  });

  it('a provider the process has is kept, and takes the spans', async () => {
    restore = otlpVariables({OTEL_EXPORTER_OTLP_ENDPOINT: 'http://127.0.0.1:9'});
    trace.setGlobalTracerProvider(capture.provider);
    instrument();
    assert.equal(delegate(), capture.provider);
    await compileOnce();
    assert.equal(capture.spans().length, 1);
  });

  it('a provider the process sets later takes the spans', async () => {
    restore = otlpVariables({});
    instrument();
    trace.setGlobalTracerProvider(capture.provider);
    await compileOnce();
    assert.equal(capture.spans().length, 1);
  });
});
