/**
 * The wrapper capture suite's TypeScript driver.
 *
 * Runs one job of `conformance/wrapper_capture/` on upstream's agent SDK,
 * `@a2ui/agent` 0.1.0, with `a2ui-spectra-instrumentation` switched on by its
 * one-line form, which starts the tracer provider from the
 * `OTEL_EXPORTER_OTLP_*` variables the harness sets. From `conformance/`, after
 * this package's build:
 *
 *     node wrapper_driver/typescript/dist/driver.js <job>
 *
 * The SDK's `A2uiError` passes and the driver exits 0, the provider's shutdown
 * on `beforeExit` flushing the export. Any other failure exits non-zero with
 * its message on stderr. It prints nothing and carries no trace context.
 */

import {readFileSync} from 'node:fs';
import * as path from 'node:path';
import {fileURLToPath} from 'node:url';

import {
  A2uiError,
  A2uiRequestProcessor,
  DirectJsonFormatFactory,
  ExpressFormatFactory,
  FileSystemCatalogProvider,
  RendererState,
} from '@a2ui/agent';
import {instrument} from 'a2ui-spectra-instrumentation';

instrument();

/** This package's directory, and `conformance/`, which a job's catalog paths are relative to. */
const PACKAGE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CONFORMANCE = path.resolve(PACKAGE, '../..');

const FACTORIES = {
  direct_json: DirectJsonFormatFactory,
  express: ExpressFormatFactory,
} as const;

/**
 * The basic catalog of each protocol version: this package's copies of the
 * pin's files, v0.9's serving v0.9.1 too, as the Python SDK has it built in.
 */
const BASIC: Readonly<Record<string, string>> = {
  'v0.9': 'catalogs/basic_v0_9.json',
  'v0.9.1': 'catalogs/basic_v0_9.json',
  'v1.0': 'catalogs/basic_v1_0.json',
};

interface Job {
  inferenceFormat: string;
  entryPoint: string;
  catalogs: Array<{catalogId: string; protocolVersion: string; path?: string}>;
  text?: string;
  chunks?: string;
  wrapped?: boolean;
  afterRejectedBlock?: 'end' | 'continue';
  rendererState?: boolean;
}

type Catalog = Awaited<ReturnType<FileSystemCatalogProvider['load']>>;

async function catalogsOf(job: Job): Promise<Catalog[]> {
  const catalogs: Catalog[] = [];
  for (const catalog of job.catalogs) {
    if (catalog.path !== undefined) {
      catalogs.push(
        await new FileSystemCatalogProvider(
          path.join(CONFORMANCE, catalog.path),
          catalog.protocolVersion,
        ).load(),
      );
      continue;
    }
    const file = BASIC[catalog.protocolVersion];
    if (file === undefined) {
      throw new Error(`No basic catalog of ${catalog.protocolVersion}`);
    }
    catalogs.push(
      await new FileSystemCatalogProvider(
        path.join(PACKAGE, file),
        catalog.protocolVersion,
        catalog.catalogId,
      ).load(),
    );
  }
  return catalogs;
}

async function processorOf(job: Job): Promise<A2uiRequestProcessor> {
  const factory = FACTORIES[job.inferenceFormat as keyof typeof FACTORIES];
  if (factory === undefined) {
    throw new Error(`Unknown inference format: ${job.inferenceFormat}`);
  }
  const catalogs = await catalogsOf(job);
  const state = job.rendererState === true ? new RendererState(catalogs) : undefined;
  return new A2uiRequestProcessor(catalogs, undefined, new factory(), {state});
}

/** Feeds each chunk in order, cut at its end in UTF-16 code units, stopping at the first that throws, and closes unless one threw. */
function openStream(processor: A2uiRequestProcessor, job: Job, text: string, ends: number[]): void {
  const stream = processor.openStream({
    wrapped: job.wrapped ?? true,
    afterRejectedBlock: job.afterRejectedBlock ?? 'end',
  });
  let start = 0;
  for (const end of ends) {
    try {
      stream.feed(text.slice(start, end));
    } catch (error) {
      if (error instanceof A2uiError) return;
      throw error;
    }
    start = end;
  }
  stream.close();
}

async function run(jobPath: string): Promise<void> {
  const job = JSON.parse(readFileSync(jobPath, 'utf8')) as Job;
  const jobDir = path.dirname(jobPath);
  const processor = await processorOf(job);
  if (job.entryPoint === 'generate') {
    void processor.promptSnippet;
    return;
  }
  if (job.text === undefined) throw new Error(`The ${job.entryPoint} job names no text`);
  const text = readFileSync(path.join(jobDir, job.text), 'utf8');
  switch (job.entryPoint) {
    case 'parse_response':
      processor.parseResponse(text, {wrapped: job.wrapped ?? true});
      return;
    case 'open_stream': {
      if (job.chunks === undefined) throw new Error('The open_stream job names no chunks');
      const ends = JSON.parse(readFileSync(path.join(jobDir, job.chunks), 'utf8')) as number[];
      openStream(processor, job, text, ends);
      return;
    }
    case 'compile':
      processor.parser.compile(text);
      return;
    default:
      throw new Error(`Unknown entry point: ${job.entryPoint}`);
  }
}

if (process.argv.length !== 3) {
  process.stderr.write('usage: driver.js <job>\n');
  process.exitCode = 2;
} else {
  try {
    await run(process.argv[2]);
  } catch (error) {
    if (!(error instanceof A2uiError)) {
      process.stderr.write(
        `${error instanceof Error ? `${error.name}: ${error.message}` : String(error)}\n`,
      );
      process.exitCode = 1;
    }
  }
}
