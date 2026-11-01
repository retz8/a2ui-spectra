"""Fixtures for the wrapper's tests.

The wrapper is switched on with an SDK tracer provider handed in through
`tracer_provider=`, its spans going to an in-memory exporter. The texts are
short and written inline.
"""

from __future__ import annotations

import json
import logging
from collections.abc import Callable, Iterator
from typing import Any

import pytest
import wrapt
from a2ui.core.basic_catalog import BasicCatalog
from a2ui.inference_formats import DirectJsonFormatFactory, ExpressFormatFactory
from a2ui.processor import A2uiRequestProcessor
from a2ui.utils import RendererState
from opentelemetry import trace
from opentelemetry.sdk.trace import ReadableSpan, TracerProvider
from opentelemetry.sdk.trace.export import SimpleSpanProcessor
from opentelemetry.sdk.trace.export.in_memory_span_exporter import InMemorySpanExporter
from opentelemetry.util._once import Once

import a2ui_spectra_instrumentation
from a2ui_spectra_instrumentation import A2uiInstrumentor

LOGGER = "a2ui_spectra_instrumentation"
OTLP_VARIABLES = (
    "OTEL_EXPORTER_OTLP_ENDPOINT",
    "OTEL_EXPORTER_OTLP_TRACES_ENDPOINT",
    "OTEL_EXPORTER_OTLP_PROTOCOL",
    "OTEL_EXPORTER_OTLP_TRACES_PROTOCOL",
)


class Recorded:
    """The spans the wrapper exported, and readers for what they carry."""

    def __init__(self, exporter: InMemorySpanExporter) -> None:
        self.exporter = exporter

    def all(self) -> list[ReadableSpan]:
        return list(self.exporter.get_finished_spans())

    def one(self) -> ReadableSpan:
        spans = self.all()
        assert len(spans) == 1, [span.name for span in spans]
        return spans[0]

    def clear(self) -> None:
        self.exporter.clear()

    @staticmethod
    def attributes(span: ReadableSpan) -> dict[str, Any]:
        return dict(span.attributes or {})

    @staticmethod
    def parsed(span: ReadableSpan, name: str) -> Any:
        value = (span.attributes or {})[name]
        assert isinstance(value, str)
        return json.loads(value)

    @staticmethod
    def exceptions(span: ReadableSpan) -> list[dict[str, Any]]:
        return [
            dict(event.attributes or {})
            for event in span.events
            if event.name == "exception"
        ]


class Support:
    """Helpers for the tests, without spans."""

    @staticmethod
    def hooked(owner: object, name: str) -> bool:
        """Whether a class's or a module's own attribute is a hook."""
        return isinstance(
            vars(owner).get(name), getattr(wrapt, "BaseObjectProxy", wrapt.ObjectProxy)
        )

    @staticmethod
    def lines(caplog: pytest.LogCaptureFixture) -> list[logging.LogRecord]:
        """The records the wrapper's logger wrote."""
        return [record for record in caplog.records if record.name == LOGGER]

    @staticmethod
    def utf16(text: str) -> int:
        return len(text.encode("utf-16-le")) // 2

    @staticmethod
    def block_range(text: str, block: str, start: int = 0) -> tuple[int, int]:
        """Where a block's text sits in the input, in UTF-16 code units."""
        found = text.index(block, start)
        return Support.utf16(text[:found]), Support.utf16(text[: found + len(block)])


@pytest.fixture
def support() -> type[Support]:
    return Support


@pytest.fixture(autouse=True)
def switched_off() -> Iterator[None]:
    """Every test starts and ends with the wrapper switched off."""
    yield
    if A2uiInstrumentor().is_instrumented_by_opentelemetry:
        a2ui_spectra_instrumentation.uninstrument()


@pytest.fixture
def exporter() -> InMemorySpanExporter:
    return InMemorySpanExporter()


@pytest.fixture
def provider(exporter: InMemorySpanExporter) -> TracerProvider:
    provider = TracerProvider()
    provider.add_span_processor(SimpleSpanProcessor(exporter))
    return provider


@pytest.fixture
def spans(provider: TracerProvider, exporter: InMemorySpanExporter) -> Recorded:
    """The wrapper switched on, its spans going to the in-memory exporter."""
    a2ui_spectra_instrumentation.instrument(tracer_provider=provider)
    return Recorded(exporter)


@pytest.fixture
def no_otlp_variables(monkeypatch: pytest.MonkeyPatch) -> None:
    for name in OTLP_VARIABLES:
        monkeypatch.delenv(name, raising=False)


@pytest.fixture
def no_global_provider() -> Iterator[None]:
    """The process starts with OpenTelemetry's proxy as its tracer provider, and gets it back."""
    saved = (trace._TRACER_PROVIDER, trace._TRACER_PROVIDER_SET_ONCE)
    trace._TRACER_PROVIDER = None
    trace._TRACER_PROVIDER_SET_ONCE = Once()
    yield
    provider = trace._TRACER_PROVIDER
    if isinstance(provider, TracerProvider):
        provider.shutdown()
    trace._TRACER_PROVIDER, trace._TRACER_PROVIDER_SET_ONCE = saved


ProcessorFactory = Callable[..., A2uiRequestProcessor]


@pytest.fixture
def processor() -> ProcessorFactory:
    """A processor on the basic catalog: Express at v1.0 by default, a renderer state bound on request."""

    def make(
        fmt: str = "express", version: str = "1.0", state: bool = False
    ) -> A2uiRequestProcessor:
        catalogs = [BasicCatalog(version)]
        factory = (
            DirectJsonFormatFactory()
            if fmt == "direct_json"
            else ExpressFormatFactory()
        )
        return A2uiRequestProcessor(
            catalogs,
            format_factory=factory,
            state=RendererState(catalogs) if state else None,
        )

    return make
