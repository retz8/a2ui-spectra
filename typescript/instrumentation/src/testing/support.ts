/** What the wrapper's tests share: the SDK on a small catalog, a span capture, warnings, and subprocesses. */

import {spawn} from 'node:child_process';
import {createRequire} from 'node:module';
import * as path from 'node:path';
import {fileURLToPath} from 'node:url';

import * as sdk from '@a2ui/agent';
import type {Attributes, TracerProvider} from '@opentelemetry/api';
import {
  BasicTracerProvider,
  InMemorySpanExporter,
  type ReadableSpan,
  SimpleSpanProcessor,
} from '@opentelemetry/sdk-trace-node';

import {ORIGINAL} from '../patching.js';
import {HOOKS} from '../table.js';

export {sdk};

/** The package's directory. */
export const PACKAGE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

/** The `node_modules/@opentelemetry` directory the package resolves. */
export const OPENTELEMETRY = ((): string => {
  const entry = createRequire(import.meta.url).resolve('@opentelemetry/api');
  const scope = `${path.sep}@opentelemetry${path.sep}`;
  return entry.slice(0, entry.lastIndexOf(scope) + scope.length - 1);
})();

export const CATALOG_ID = 'https://example.com/spectra/test_catalog.json';

/** A catalog of two components, a column of children and a text. */
const CATALOG = {
  catalogId: CATALOG_ID,
  components: {
    Text: {
      type: 'object',
      properties: {
        component: {const: 'Text'},
        text: {$ref: 'common_types.json#/$defs/DynamicString'},
      },
      required: ['component', 'text'],
    },
    Column: {
      type: 'object',
      properties: {
        component: {const: 'Column'},
        children: {$ref: 'common_types.json#/$defs/ChildList'},
      },
      required: ['component', 'children'],
    },
  },
};

export type Format = 'direct_json' | 'express';

export async function processorOf(format: Format): Promise<sdk.A2uiRequestProcessor> {
  const catalog = await new sdk.InMemoryCatalogProvider(CATALOG, '1.0').load();
  const factory =
    format === 'direct_json' ? new sdk.DirectJsonFormatFactory() : new sdk.ExpressFormatFactory();
  return new sdk.A2uiRequestProcessor([catalog], undefined, factory);
}

/** A Direct JSON block's messages: a surface and its components. */
export function messagesOf(surfaceId: string, components: object[]): string {
  return JSON.stringify([
    {version: '1.0', createSurface: {surfaceId, catalogId: CATALOG_ID}},
    {version: '1.0', updateComponents: {surfaceId, components}},
  ]);
}

/** A good Direct JSON block, wrapped in its tags. */
export function goodBlock(surfaceId: string): string {
  return `<a2ui-json>${messagesOf(surfaceId, [
    {id: 'root', component: 'Column', children: ['title']},
    {id: 'title', component: 'Text', text: 'Hello'},
  ])}</a2ui-json>`;
}

/** Where a substring sits in a text, as a block range. */
export function rangeOf(text: string, part: string, from = 0): [number, number] {
  const start = text.indexOf(part, from);
  if (start < 0) throw new Error(`Not in the text: ${part.slice(0, 40)}`);
  return [start, start + part.length];
}

/** A provider that keeps every span the wrapper ends. */
export class Capture {
  readonly exporter = new InMemorySpanExporter();
  readonly provider = new BasicTracerProvider({
    spanProcessors: [new SimpleSpanProcessor(this.exporter)],
  });

  spans(): ReadableSpan[] {
    return this.exporter.getFinishedSpans();
  }

  only(): ReadableSpan {
    const spans = this.spans();
    if (spans.length !== 1) throw new Error(`${spans.length} spans, not one`);
    return spans[0];
  }

  reset(): void {
    this.exporter.reset();
  }
}

/** A span's span events by name, with their attributes. */
export function eventsOf(span: ReadableSpan, name: string): Attributes[] {
  return span.events.filter(event => event.name === name).map(event => event.attributes ?? {});
}

/** A tracer provider whose tracer throws when a span starts: a fault inside every hook that ends an event. */
export function faultyProvider(): TracerProvider {
  const fail = () => {
    throw new Error('injected');
  };
  return {
    getTracer: () => ({startSpan: fail, startActiveSpan: fail}) as never,
  };
}

/** The warning lines the process emits while it runs. */
export class Warnings {
  readonly lines: string[] = [];
  private readonly listener = (warning: Error) => this.lines.push(warning.message);

  constructor() {
    process.on('warning', this.listener);
  }

  /** Waits for the warnings emitted so far, which Node emits on the next tick. */
  async settled(): Promise<string[]> {
    await new Promise(resolve => setImmediate(resolve));
    return this.lines;
  }

  stop(): void {
    process.off('warning', this.listener);
  }
}

/** Whether every hooked name is hooked, or none is. */
export function hooked(): boolean[] {
  return HOOKS.map(hook => {
    const cls = (sdk as unknown as Record<string, {prototype: Record<string, unknown>}>)[
      hook.className
    ];
    const method = cls.prototype[hook.method] as Record<symbol, unknown>;
    return method[ORIGINAL] !== undefined;
  });
}

/** Runs Node in a subprocess with an environment; resolves with its exit code and output. */
export function runNode(
  args: string[],
  options: {cwd: string; env: NodeJS.ProcessEnv},
): Promise<{code: number | null; stdout: string; stderr: string}> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, args, {
      cwd: options.cwd,
      env: options.env,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk: Buffer) => (stdout += chunk.toString()));
    child.stderr.on('data', (chunk: Buffer) => (stderr += chunk.toString()));
    child.on('error', reject);
    child.on('exit', code => resolve({code, stdout, stderr}));
  });
}

/** This process's environment without its OpenTelemetry variables, with those given. */
export function childEnv(variables: Record<string, string> = {}): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  for (const [name, value] of Object.entries(process.env)) {
    if (!name.startsWith('OTEL_')) env[name] = value;
  }
  return {...env, ...variables};
}

/** Sets OpenTelemetry's variables in this process for a test, and puts them back after. */
export function otlpVariables(variables: Record<string, string>): () => void {
  const saved = Object.entries(process.env).filter(([name]) => name.startsWith('OTEL_'));
  for (const [name] of saved) delete process.env[name];
  Object.assign(process.env, variables);
  return () => {
    for (const name of Object.keys(process.env)) {
      if (name.startsWith('OTEL_')) delete process.env[name];
    }
    for (const [name, value] of saved) process.env[name] = value;
  };
}
