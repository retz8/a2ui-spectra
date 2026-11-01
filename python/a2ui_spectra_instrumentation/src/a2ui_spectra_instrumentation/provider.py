"""The tracer provider the wrapper starts when the process has none."""

from __future__ import annotations

import os

from opentelemetry import trace
from opentelemetry.exporter.otlp.proto.http.trace_exporter import OTLPSpanExporter
from opentelemetry.sdk.trace import TracerProvider
from opentelemetry.sdk.trace.export import BatchSpanProcessor

from .log import logger


def _variable(*names: str) -> str | None:
    """The first of the variables the environment sets to a value."""
    for name in names:
        value = os.environ.get(name, "").strip()
        if value:
            return value
    return None


def tracer_provider(given: trace.TracerProvider | None) -> trace.TracerProvider | None:
    """The provider the wrapper's spans go to; None means the global one, set now or later.

    A provider passed in is used. A provider the process has set is kept. With
    none, and an OTLP endpoint in the environment with its protocol unset or
    `http/protobuf`, the wrapper sets an SDK provider on the SDK's default
    resource, exporting over OTLP/HTTP. Otherwise it starts none, and says why.
    """
    if given is not None:
        return given
    if not isinstance(trace.get_tracer_provider(), trace.ProxyTracerProvider):
        return None
    endpoint = _variable(
        "OTEL_EXPORTER_OTLP_TRACES_ENDPOINT", "OTEL_EXPORTER_OTLP_ENDPOINT"
    )
    protocol = _variable(
        "OTEL_EXPORTER_OTLP_TRACES_PROTOCOL", "OTEL_EXPORTER_OTLP_PROTOCOL"
    )
    if endpoint is None:
        logger.info(
            "a2ui-spectra-instrumentation started no tracer provider: the"
            " environment names no OTLP endpoint (OTEL_EXPORTER_OTLP_ENDPOINT);"
            " the spans go to a provider the process sets"
        )
        return None
    if protocol is not None and protocol != "http/protobuf":
        logger.info(
            "a2ui-spectra-instrumentation started no tracer provider: the"
            " environment names the OTLP protocol %s, and the wrapper exports"
            " only http/protobuf; the spans go to a provider the process sets",
            protocol,
        )
        return None
    provider = TracerProvider()
    provider.add_span_processor(BatchSpanProcessor(OTLPSpanExporter()))
    trace.set_tracer_provider(provider)
    return None
