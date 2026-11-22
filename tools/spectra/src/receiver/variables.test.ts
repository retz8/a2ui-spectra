import assert from 'node:assert/strict';
import {describe, it} from 'node:test';

import {receiverExportLines, receiverVariables, replacedLine} from './variables.js';

const ORIGIN = 'http://127.0.0.1:9823';

describe("the receiver's variables", () => {
  it("sets the endpoint, the protocol and both content capture switches, SPAN_ONLY and true, each unless Spectra's environment sets it", () => {
    const variables = receiverVariables({}, ORIGIN);
    // Each with the note attach prints beside it, which the API serves too.
    const note = "for Spectra's OpenTelemetry receiver";
    assert.deepEqual(variables.printed, [
      {name: 'OTEL_EXPORTER_OTLP_ENDPOINT', value: ORIGIN, note},
      {name: 'OTEL_EXPORTER_OTLP_PROTOCOL', value: 'http/protobuf', note},
      {name: 'OTEL_INSTRUMENTATION_GENAI_CAPTURE_CONTENT', value: 'SPAN_ONLY', note},
      {name: 'OTEL_INSTRUMENTATION_GENAI_CAPTURE_MESSAGE_CONTENT', value: 'true', note},
    ]);
    assert.deepEqual(
      receiverExportLines(variables),
      variables.printed.map(({name, value}) => `export ${name}=${value}  # ${note}`),
    );
    assert.deepEqual(variables.environment, {
      OTEL_EXPORTER_OTLP_ENDPOINT: ORIGIN,
      OTEL_EXPORTER_OTLP_PROTOCOL: 'http/protobuf',
      OTEL_INSTRUMENTATION_GENAI_CAPTURE_CONTENT: 'SPAN_ONLY',
      OTEL_INSTRUMENTATION_GENAI_CAPTURE_MESSAGE_CONTENT: 'true',
    });
    assert.equal(replacedLine(variables), undefined);
    const own = receiverVariables(
      {
        OTEL_INSTRUMENTATION_GENAI_CAPTURE_CONTENT: 'SPAN_AND_EVENT',
        OTEL_INSTRUMENTATION_GENAI_CAPTURE_MESSAGE_CONTENT: 'false',
      },
      ORIGIN,
    ).environment;
    assert.equal(own.OTEL_INSTRUMENTATION_GENAI_CAPTURE_CONTENT, 'SPAN_AND_EVENT');
    assert.equal(own.OTEL_INSTRUMENTATION_GENAI_CAPTURE_MESSAGE_CONTENT, 'false');
  });

  it("replaces an endpoint or protocol Spectra's environment sets to another value, a signal's own included, and says so once", () => {
    const variables = receiverVariables(
      {
        OTEL_EXPORTER_OTLP_ENDPOINT: 'https://user:secret@collector.example:4318',
        OTEL_EXPORTER_OTLP_PROTOCOL: 'grpc',
        OTEL_EXPORTER_OTLP_TRACES_ENDPOINT: 'http://collector.example:4318/v1/traces',
        OTEL_EXPORTER_OTLP_LOGS_PROTOCOL: 'http/protobuf',
      },
      ORIGIN,
    );
    assert.equal(variables.environment.OTEL_EXPORTER_OTLP_TRACES_ENDPOINT, `${ORIGIN}/v1/traces`);
    assert.equal(variables.environment.OTEL_EXPORTER_OTLP_LOGS_PROTOCOL, 'http/protobuf');
    assert.equal(variables.environment.OTEL_EXPORTER_OTLP_METRICS_ENDPOINT, undefined);
    assert.equal(
      replacedLine(variables),
      "In the agent's environment, Spectra replaced OTEL_EXPORTER_OTLP_ENDPOINT from https://REMOVED@collector.example:4318/, " +
        'OTEL_EXPORTER_OTLP_PROTOCOL from grpc and OTEL_EXPORTER_OTLP_TRACES_ENDPOINT from http://collector.example:4318/v1/traces, ' +
        "so that its exports reach Spectra's OpenTelemetry receiver. They are not passed on.",
    );
    // Values left over from an earlier attach are the receiver's own.
    assert.equal(
      replacedLine(receiverVariables({OTEL_EXPORTER_OTLP_ENDPOINT: `${ORIGIN}/`}, ORIGIN)),
      undefined,
    );
  });

  it('prints one export line per variable for attach', () => {
    assert.deepEqual(receiverExportLines(receiverVariables({}, ORIGIN)), [
      `export OTEL_EXPORTER_OTLP_ENDPOINT=${ORIGIN}  # for Spectra's OpenTelemetry receiver`,
      "export OTEL_EXPORTER_OTLP_PROTOCOL=http/protobuf  # for Spectra's OpenTelemetry receiver",
      "export OTEL_INSTRUMENTATION_GENAI_CAPTURE_CONTENT=SPAN_ONLY  # for Spectra's OpenTelemetry receiver",
      "export OTEL_INSTRUMENTATION_GENAI_CAPTURE_MESSAGE_CONTENT=true  # for Spectra's OpenTelemetry receiver",
    ]);
  });
});
