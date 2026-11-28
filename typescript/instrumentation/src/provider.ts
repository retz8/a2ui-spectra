/** The tracer provider the wrapper starts when the process has none. */

import {ProxyTracerProvider, trace} from '@opentelemetry/api';
import {OTLPTraceExporter} from '@opentelemetry/exporter-trace-otlp-http';
import {
  BatchSpanProcessor,
  NodeTracerProvider,
  type SpanProcessor,
} from '@opentelemetry/sdk-trace-node';

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
 * Sends the spans soon after they end: when a span ends it asks for a flush on
 * the next turn of the event loop, one flush at a time, so the spans that end
 * together go in one export.
 *
 * The pending flush is what keeps the process up until its last spans are
 * sent. A flush on `beforeExit` would do that too, but work started in a
 * `beforeExit` listener makes Node emit the event again, and the agent's own
 * `beforeExit` listeners would run twice.
 */
class FlushAfterEnd implements SpanProcessor {
  private flushing = false;
  private endedSince = false;

  constructor(private readonly flush: () => Promise<void>) {}

  onStart(): void {}

  onEnd(): void {
    if (this.flushing) {
      this.endedSince = true;
      return;
    }
    this.flushing = true;
    setImmediate(() => {
      this.flush()
        .catch((error: unknown) => {
          logger.info(`could not flush its tracer provider: ${messageOf(error)}`);
        })
        .finally(() => {
          this.flushing = false;
          if (!this.endedSince) return;
          this.endedSince = false;
          this.onEnd();
        });
    });
  }

  forceFlush(): Promise<void> {
    return Promise.resolve();
  }

  shutdown(): Promise<void> {
    return Promise.resolve();
  }
}

/**
 * Starts a provider when the process has none and the environment names an
 * OTLP endpoint, with its protocol unset or `http/protobuf`: a
 * `NodeTracerProvider` on the SDK's default resource, with a batch span
 * processor on the OTLP/HTTP exporter, which reads the endpoint itself, flushed
 * soon after each span ends. Otherwise it starts none, and says why at info.
 */
export function startProvider(): void {
  if (hasProvider()) {
    logger.debug('keeps the tracer provider the process has');
    return;
  }
  const endpoint = variable('OTEL_EXPORTER_OTLP_TRACES_ENDPOINT', 'OTEL_EXPORTER_OTLP_ENDPOINT');
  const protocol = variable('OTEL_EXPORTER_OTLP_TRACES_PROTOCOL', 'OTEL_EXPORTER_OTLP_PROTOCOL');
  if (endpoint === undefined) {
    logger.info(
      'started no tracer provider: the environment names no OTLP ' +
        'endpoint (OTEL_EXPORTER_OTLP_ENDPOINT); the spans go to a provider the process sets',
    );
    return;
  }
  if (protocol !== undefined && protocol !== 'http/protobuf') {
    logger.info(
      `started no tracer provider: the environment names the OTLP ` +
        `protocol ${protocol}, and the wrapper starts one only for http/protobuf, the protocol ` +
        'a2ui-spectra run sets; the spans go to a provider the process sets',
    );
    return;
  }
  const batch = new BatchSpanProcessor(new OTLPTraceExporter());
  // The batch takes a span before the flush for it is asked for.
  const provider = new NodeTracerProvider({
    spanProcessors: [batch, new FlushAfterEnd(() => batch.forceFlush())],
  });
  provider.register();
}
