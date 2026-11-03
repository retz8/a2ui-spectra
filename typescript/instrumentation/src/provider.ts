/** The tracer provider the wrapper starts when the process has none. */

import {ProxyTracerProvider, trace} from '@opentelemetry/api';
import {OTLPTraceExporter} from '@opentelemetry/exporter-trace-otlp-http';
import {BatchSpanProcessor, NodeTracerProvider} from '@opentelemetry/sdk-trace-node';

import {logger, messageOf} from './log.js';
import {SCOPE_NAME} from './package.js';

/** The first of the variables the environment sets to a value. */
function variable(...names: string[]): string | undefined {
  for (const name of names) {
    const value = process.env[name]?.trim();
    if (value) return value;
  }
  return undefined;
}

/** Whether the process has a tracer provider: the API's global proxy has one registered. */
function hasProvider(): boolean {
  const global = trace.getTracerProvider();
  return (
    !(global instanceof ProxyTracerProvider) || global.getDelegateTracer(SCOPE_NAME) !== undefined
  );
}

/**
 * Starts a provider when the process has none and the environment names an
 * OTLP endpoint, with its protocol unset or `http/protobuf`: a
 * `NodeTracerProvider` on the SDK's default resource, with a batch span
 * processor on the OTLP/HTTP exporter, which reads the endpoint itself. It is
 * shut down on `beforeExit`, once, which flushes a natural exit. Otherwise it
 * starts none, and says why at info.
 */
export function startProvider(): void {
  if (hasProvider()) {
    logger.debug('a2ui-spectra-instrumentation keeps the tracer provider the process has');
    return;
  }
  const endpoint = variable('OTEL_EXPORTER_OTLP_TRACES_ENDPOINT', 'OTEL_EXPORTER_OTLP_ENDPOINT');
  const protocol = variable('OTEL_EXPORTER_OTLP_TRACES_PROTOCOL', 'OTEL_EXPORTER_OTLP_PROTOCOL');
  if (endpoint === undefined) {
    logger.info(
      'a2ui-spectra-instrumentation started no tracer provider: the environment names no OTLP ' +
        'endpoint (OTEL_EXPORTER_OTLP_ENDPOINT); the spans go to a provider the process sets',
    );
    return;
  }
  if (protocol !== undefined && protocol !== 'http/protobuf') {
    logger.info(
      `a2ui-spectra-instrumentation started no tracer provider: the environment names the OTLP ` +
        `protocol ${protocol}, and the wrapper starts one only for http/protobuf, the protocol ` +
        'a2ui-spectra run sets; the spans go to a provider the process sets',
    );
    return;
  }
  const provider = new NodeTracerProvider({
    spanProcessors: [new BatchSpanProcessor(new OTLPTraceExporter())],
  });
  provider.register();
  process.once('beforeExit', () => {
    provider.shutdown().catch((error: unknown) => {
      logger.info(
        `a2ui-spectra-instrumentation could not flush its tracer provider: ${messageOf(error)}`,
      );
    });
  });
}
