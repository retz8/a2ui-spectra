/** Switching the wrapper on and off, by each route. */

import assert from 'node:assert/strict';
import {createServer, type IncomingMessage} from 'node:http';
import type {AddressInfo} from 'node:net';
import {afterEach, describe, it} from 'node:test';

import {registerInstrumentations} from '@opentelemetry/instrumentation';

import {A2uiInstrumentation, instrument, uninstrument} from './index.js';
import {ORIGINAL} from './patching.js';
import {HOOKS} from './table.js';
import {
  Capture,
  childEnv,
  hooked,
  PACKAGE,
  processorOf,
  runNode,
  sdk,
  Warnings,
} from './testing/support.js';

afterEach(() => uninstrument());

/** Each hooked name's own property on its prototype, or none when it is inherited. */
function descriptors(): Array<PropertyDescriptor | undefined> {
  return HOOKS.map(hook =>
    Object.getOwnPropertyDescriptor(
      (sdk as unknown as Record<string, {prototype: object}>)[hook.className].prototype,
      hook.method,
    ),
  );
}

describe('switching the wrapper on and off', () => {
  it('uninstrument() puts every original back, an inherited one by deleting the hook', () => {
    const before = descriptors();
    instrument({tracerProvider: new Capture().provider});
    assert.ok(hooked().every(on => on));
    uninstrument();
    assert.deepEqual(descriptors(), before);
    assert.ok(hooked().every(on => !on));
    assert.ok(!Object.hasOwn(sdk.ExpressPromptGenerator.prototype, 'generate'));
  });

  it('a second instrument() is one warning and does nothing', async () => {
    const warnings = new Warnings();
    try {
      instrument({tracerProvider: new Capture().provider});
      instrument({tracerProvider: new Capture().provider});
      const lines = await warnings.settled();
      assert.equal(lines.length, 1);
      assert.match(lines[0], /already switched on; instrument\(\) does nothing/);
    } finally {
      warnings.stop();
    }
    const compile = sdk.DirectJsonParser.prototype.compile as unknown as Record<symbol, unknown>;
    const original = compile[ORIGINAL] as Record<symbol, unknown>;
    assert.equal(original[ORIGINAL], undefined);
  });

  it("new A2uiInstrumentation() under an adopter's own provider, through registerInstrumentations", async () => {
    const capture = new Capture();
    const instrumentation = new A2uiInstrumentation();
    const unregister = registerInstrumentations({
      instrumentations: [instrumentation],
      tracerProvider: capture.provider,
    });
    try {
      assert.ok(instrumentation.isEnabled());
      const processor = await processorOf('express');
      processor.parser.compile('surface("e")\nroot = Text("Hi")');
      assert.equal(capture.only().name, 'parse');
    } finally {
      unregister();
    }
    assert.ok(hooked().every(on => !on));
  });

  it('node --import a2ui-spectra-instrumentation/register: hooked before the agent runs, on a provider it started', async () => {
    const child = [
      "import {trace} from '@opentelemetry/api';",
      "import {DirectJsonParser} from '@a2ui/agent';",
      "const original = DirectJsonParser.prototype.compile[Symbol.for('a2ui-spectra-instrumentation.original')];",
      'console.log(JSON.stringify({',
      "  hooked: typeof original === 'function',",
      '  provider: trace.getTracerProvider().getDelegate().constructor.name,',
      '}));',
    ].join('\n');
    const {code, stdout, stderr} = await runNode(
      ['--import', 'a2ui-spectra-instrumentation/register', '--input-type=module', '-e', child],
      {
        cwd: PACKAGE,
        env: childEnv({
          OTEL_EXPORTER_OTLP_ENDPOINT: 'http://127.0.0.1:9',
          OTEL_EXPORTER_OTLP_PROTOCOL: 'http/protobuf',
        }),
      },
    );
    assert.equal(code, 0, stderr);
    assert.deepEqual(JSON.parse(stdout), {hooked: true, provider: 'NodeTracerProvider'});
  });

  it('one line, then a natural exit: the spans reach the endpoint through beforeExit', async () => {
    const bodies: unknown[] = [];
    const server = createServer((request: IncomingMessage, response) => {
      let body = '';
      request.on('data', (chunk: Buffer) => (body += chunk.toString()));
      request.on('end', () => {
        if (request.url === '/v1/traces') bodies.push(JSON.parse(body));
        response.writeHead(200, {'content-type': 'application/json'}).end('{}');
      });
    });
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
    const {port} = server.address() as AddressInfo;
    const child = [
      "import {instrument} from 'a2ui-spectra-instrumentation';",
      "import * as sdk from '@a2ui/agent';",
      'instrument();',
      'const catalog = await new sdk.InMemoryCatalogProvider(',
      "  {catalogId: 'https://example.com/c.json', components: {Text: {type: 'object', properties: {component: {const: 'Text'}, text: {type: 'string'}}, required: ['component', 'text']}}},",
      "  '1.0',",
      ').load();',
      'const processor = new sdk.A2uiRequestProcessor([catalog], undefined, new sdk.ExpressFormatFactory());',
      'processor.parser.compile(\'surface("e")\\nroot = Text("Hi")\');',
    ].join('\n');
    try {
      const {code, stderr} = await runNode(['--input-type=module', '-e', child], {
        cwd: PACKAGE,
        env: childEnv({
          OTEL_EXPORTER_OTLP_ENDPOINT: `http://127.0.0.1:${port}`,
          OTEL_EXPORTER_OTLP_PROTOCOL: 'http/protobuf',
        }),
      });
      assert.equal(code, 0, stderr);
    } finally {
      await new Promise(resolve => server.close(resolve));
    }
    const spans = (
      bodies as Array<{
        resourceSpans: Array<{
          scopeSpans: Array<{scope: {name: string}; spans: Array<{name: string}>}>;
        }>;
      }>
    ).flatMap(body =>
      body.resourceSpans.flatMap(resource =>
        resource.scopeSpans.flatMap(scope =>
          scope.spans.map(span => [scope.scope.name, span.name]),
        ),
      ),
    );
    assert.deepEqual(spans, [['a2ui-spectra-instrumentation', 'parse']]);
  });
});
