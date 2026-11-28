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
import {
  Capture,
  childEnv,
  collector,
  otlpVariables,
  PACKAGE,
  processorOf,
  runNode,
} from './testing/support.js';

const capture = new Capture();
let restore: () => void = () => {};
let lines: string[] = [];
let exitListeners: Function[] = [];
let closeCollector: () => Promise<void> = async () => {};

/** Names a local stand-in as the OTLP endpoint for a test. */
async function endpointNamed(): Promise<void> {
  const {endpoint, close} = await collector();
  closeCollector = close;
  restore = otlpVariables({OTEL_EXPORTER_OTLP_ENDPOINT: endpoint});
}

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
  await closeCollector();
  closeCollector = async () => {};
});

describe('the tracer provider', () => {
  it('with none, and an endpoint named: a NodeTracerProvider, started when the first event ends', async () => {
    await endpointNamed();
    instrument();
    assert.equal(hasGlobalProvider(), false);
    await compileOnce();
    assert.ok(delegate() instanceof NodeTracerProvider);
    assert.equal(process.listeners('beforeExit').length, exitListeners.length);
  });

  it("its own provider's spans are sent before the process ends, and the agent's beforeExit listeners run once", async () => {
    const child = [
      "import {instrument} from './dist/index.js';",
      "import {processorOf} from './dist/testing/support.js';",
      'let calls = 0;',
      "process.on('beforeExit', () => { calls += 1; });",
      "process.on('exit', () => console.log(JSON.stringify({beforeExit: calls})));",
      'instrument();',
      '(await processorOf(\'express\')).parser.compile(\'surface("e")\\nroot = Text("Hi")\');',
    ].join('\n');
    const {endpoint, exports, close} = await collector();
    try {
      const {code, stdout, stderr} = await runNode(['--input-type=module', '-e', child], {
        cwd: PACKAGE,
        env: childEnv({OTEL_EXPORTER_OTLP_ENDPOINT: endpoint}),
      });
      assert.equal(code, 0, stderr);
      assert.deepEqual(JSON.parse(stdout), {beforeExit: 1});
      assert.equal(exports(), 1);
    } finally {
      await close();
    }
  });

  it('a provider the agent registers after instrument(), with an endpoint named, is kept', async () => {
    await endpointNamed();
    instrument();
    assert.ok(trace.setGlobalTracerProvider(capture.provider));
    await compileOnce();
    assert.equal(delegate(), capture.provider);
    assert.equal(capture.spans().length, 1);
  });

  it('with none, and no endpoint named: none started, and one line at info, once', async () => {
    restore = otlpVariables({});
    instrument();
    assert.equal(lines.length, 0);
    await compileOnce();
    await compileOnce();
    assert.equal(hasGlobalProvider(), false);
    assert.equal(lines.length, 1);
    assert.match(
      lines[0],
      /^a2ui-spectra-instrumentation started no tracer provider: the environment names no OTLP endpoint/,
    );
  });

  it('with none, and another protocol named: none started, and the line names it', async () => {
    restore = otlpVariables({
      OTEL_EXPORTER_OTLP_ENDPOINT: 'http://127.0.0.1:9',
      OTEL_EXPORTER_OTLP_PROTOCOL: 'grpc',
    });
    instrument();
    await compileOnce();
    assert.equal(hasGlobalProvider(), false);
    assert.equal(lines.length, 1);
    assert.match(
      lines[0],
      /^a2ui-spectra-instrumentation started no tracer provider: the environment names the OTLP protocol grpc/,
    );
  });

  it('names the wrapper once, at the start, in each line its diag logger writes', async () => {
    const all: string[] = [];
    const record = (...args: unknown[]) => all.push(args.join(' '));
    diag.setLogger(
      {error: record, warn: record, info: record, debug: record, verbose: record},
      DiagLogLevel.ALL,
    );
    restore = otlpVariables({});
    instrument();
    await compileOnce();
    uninstrument();
    trace.setGlobalTracerProvider(capture.provider);
    instrument();
    await compileOnce();
    const wrapper = all.filter(line => line.includes('a2ui-spectra-instrumentation'));
    assert.ok(wrapper.length >= 3, `${wrapper.length} lines from the wrapper`);
    for (const line of wrapper) {
      assert.match(line, /^a2ui-spectra-instrumentation /);
      assert.equal(line.split('a2ui-spectra-instrumentation').length, 2, line);
    }
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
