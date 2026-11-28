"""The tracer provider: started only when the process has none.

And only when the environment names an endpoint.
"""

from __future__ import annotations

import logging
from typing import TYPE_CHECKING

import pytest
from opentelemetry import trace
from opentelemetry.sdk.trace import TracerProvider
from opentelemetry.sdk.trace.export.in_memory_span_exporter import InMemorySpanExporter

import a2ui_spectra_instrumentation

# The fixtures' types, for the type check only: mypy names the tests by their
# path from the repository root.
if TYPE_CHECKING:
    from python.a2ui_spectra_instrumentation.tests import conftest

CARD = 'surface("card")\nroot = Text("Hi")'


@pytest.mark.usefixtures("no_global_provider", "no_otlp_variables")
def test_no_provider_and_an_endpoint_starts_one_when_the_first_event_ends(
    monkeypatch: pytest.MonkeyPatch,
    processor: conftest.ProcessorFactory,
) -> None:
    monkeypatch.setenv("OTEL_EXPORTER_OTLP_ENDPOINT", "http://127.0.0.1:9")
    monkeypatch.setenv("OTEL_EXPORTER_OTLP_PROTOCOL", "http/protobuf")
    a2ui_spectra_instrumentation.instrument()

    assert isinstance(trace.get_tracer_provider(), trace.ProxyTracerProvider)
    processor().parser.compile(CARD)
    started = trace.get_tracer_provider()
    assert isinstance(started, TracerProvider)
    assert started.resource.attributes["telemetry.sdk.name"] == "opentelemetry"
    assert set(started.resource.attributes) == set(TracerProvider().resource.attributes)


@pytest.mark.usefixtures("no_global_provider", "no_otlp_variables")
def test_a_provider_already_set_is_kept(
    monkeypatch: pytest.MonkeyPatch,
    provider: TracerProvider,
    exporter: InMemorySpanExporter,
    processor: conftest.ProcessorFactory,
) -> None:
    monkeypatch.setenv("OTEL_EXPORTER_OTLP_ENDPOINT", "http://127.0.0.1:9")
    trace.set_tracer_provider(provider)
    a2ui_spectra_instrumentation.instrument()
    processor().parser.compile(CARD)

    assert trace.get_tracer_provider() is provider
    assert [span.name for span in exporter.get_finished_spans()] == ["parse"]


@pytest.mark.usefixtures("no_global_provider", "no_otlp_variables")
def test_a_provider_the_agent_sets_after_instrument_is_kept(
    monkeypatch: pytest.MonkeyPatch,
    provider: TracerProvider,
    exporter: InMemorySpanExporter,
    processor: conftest.ProcessorFactory,
) -> None:
    monkeypatch.setenv("OTEL_EXPORTER_OTLP_ENDPOINT", "http://127.0.0.1:9")
    a2ui_spectra_instrumentation.instrument()
    trace.set_tracer_provider(provider)
    processor().parser.compile(CARD)

    assert trace.get_tracer_provider() is provider
    assert [span.name for span in exporter.get_finished_spans()] == ["parse"]


@pytest.mark.usefixtures("no_global_provider", "no_otlp_variables")
def test_no_endpoint_starts_none_and_a_provider_set_later_gets_the_spans(
    caplog: pytest.LogCaptureFixture,
    provider: TracerProvider,
    exporter: InMemorySpanExporter,
    processor: conftest.ProcessorFactory,
    support: conftest.Support,
) -> None:
    with caplog.at_level(logging.INFO):
        a2ui_spectra_instrumentation.instrument()
        assert support.lines(caplog) == []
        processor().parser.compile(CARD)
        processor().parser.compile(CARD)

    assert isinstance(trace.get_tracer_provider(), trace.ProxyTracerProvider)
    # The line is written once, when the first event ends.
    [line] = support.lines(caplog)
    assert "names no OTLP endpoint" in line.getMessage()
    trace.set_tracer_provider(provider)
    processor().parser.compile(CARD)
    assert [span.name for span in exporter.get_finished_spans()] == ["parse"]


@pytest.mark.usefixtures("no_global_provider", "no_otlp_variables")
def test_another_protocol_starts_none(
    monkeypatch: pytest.MonkeyPatch,
    caplog: pytest.LogCaptureFixture,
    processor: conftest.ProcessorFactory,
    support: conftest.Support,
) -> None:
    monkeypatch.setenv("OTEL_EXPORTER_OTLP_ENDPOINT", "http://127.0.0.1:9")
    monkeypatch.setenv("OTEL_EXPORTER_OTLP_PROTOCOL", "grpc")
    with caplog.at_level(logging.INFO):
        a2ui_spectra_instrumentation.instrument()
        processor().parser.compile(CARD)

    assert isinstance(trace.get_tracer_provider(), trace.ProxyTracerProvider)
    [line] = support.lines(caplog)
    assert "protocol grpc" in line.getMessage()


@pytest.mark.usefixtures("no_global_provider", "no_otlp_variables")
def test_a_provider_passed_in_is_used_and_the_global_one_left_alone(
    monkeypatch: pytest.MonkeyPatch,
    provider: TracerProvider,
    exporter: InMemorySpanExporter,
    processor: conftest.ProcessorFactory,
) -> None:
    monkeypatch.setenv("OTEL_EXPORTER_OTLP_ENDPOINT", "http://127.0.0.1:9")
    a2ui_spectra_instrumentation.instrument(tracer_provider=provider)
    processor().parser.compile(CARD)

    assert isinstance(trace.get_tracer_provider(), trace.ProxyTracerProvider)
    assert [span.name for span in exporter.get_finished_spans()] == ["parse"]
