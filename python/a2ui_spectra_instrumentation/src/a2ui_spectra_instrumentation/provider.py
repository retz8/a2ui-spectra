"""The tracer provider the wrapper starts when the process has none."""

from __future__ import annotations

import os
import threading

from opentelemetry import trace
from opentelemetry.exporter.otlp.proto.http import trace_exporter
from opentelemetry.sdk import trace as sdk_trace
from opentelemetry.sdk.trace import export as sdk_export

from a2ui_spectra_instrumentation import log


def _variable(*names: str) -> str | None:
    """The first of the variables the environment sets to a value."""
    for name in names:
        value = os.environ.get(name, "").strip()
        if value:
            return value
    return None


class LateStart:
    """Starts the wrapper's provider at most once, the first time it is called.

    The wrapper calls it when its first event ends, not when it is switched
    on: OpenTelemetry takes one global provider a process, so a provider the
    wrapper set at switch-on would refuse the one the agent sets after it.
    """

    def __init__(self) -> None:
        self._lock = threading.Lock()
        self._called = False

    def __call__(self) -> None:
        if self._called:
            return
        with self._lock:
            if self._called:
                return
            self._called = True
            try:
                start_provider_if_needed()
            except Exception as fault:
                log.logger.warning(
                    "a2ui-spectra-instrumentation could not start a tracer"
                    " provider (%s: %s); the spans go to a provider the process"
                    " sets",
                    type(fault).__name__,
                    fault,
                )


def start_provider_if_needed() -> None:
    """Starts a tracer provider when the process has none.

    A provider the process has set is kept. With none, and an OTLP endpoint in
    the environment with its protocol unset or `http/protobuf`, the wrapper
    sets an SDK provider on the SDK's default resource, exporting over
    OTLP/HTTP. Otherwise it starts none, and says why.
    """
    if not isinstance(trace.get_tracer_provider(), trace.ProxyTracerProvider):
        return
    endpoint = _variable(
        "OTEL_EXPORTER_OTLP_TRACES_ENDPOINT", "OTEL_EXPORTER_OTLP_ENDPOINT"
    )
    protocol = _variable(
        "OTEL_EXPORTER_OTLP_TRACES_PROTOCOL", "OTEL_EXPORTER_OTLP_PROTOCOL"
    )
    if endpoint is None:
        log.logger.info(
            "a2ui-spectra-instrumentation started no tracer provider: the"
            " environment names no OTLP endpoint (OTEL_EXPORTER_OTLP_ENDPOINT);"
            " the spans go to a provider the process sets"
        )
        return
    if protocol is not None and protocol != "http/protobuf":
        log.logger.info(
            "a2ui-spectra-instrumentation started no tracer provider: the"
            " environment names the OTLP protocol %s, and the wrapper starts one"
            " only for http/protobuf, the protocol a2ui-spectra run sets; the"
            " spans go to a provider the process sets",
            protocol,
        )
        return
    # The flush on exit: the SDK provider's default, `shutdown_on_exit=True`,
    # registers its shutdown with `atexit`, and shutting the batch span
    # processor down exports the spans it still holds.
    provider = sdk_trace.TracerProvider()
    provider.add_span_processor(
        sdk_export.BatchSpanProcessor(trace_exporter.OTLPSpanExporter())
    )
    trace.set_tracer_provider(provider)
