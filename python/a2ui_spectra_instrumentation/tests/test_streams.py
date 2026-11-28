"""A stream's span: closed, ended by a raising `feed`, or abandoned.

Also a stream fed after its end.
"""

from __future__ import annotations

import gc
from typing import TYPE_CHECKING

import pytest
from a2ui.core import A2uiError
from opentelemetry.sdk.trace import TracerProvider
from opentelemetry.sdk.trace.export import SimpleSpanProcessor
from opentelemetry.sdk.trace.export.in_memory_span_exporter import InMemorySpanExporter

import a2ui_spectra_instrumentation

# The fixtures' types, for the type check only: mypy names the tests by their
# path from the repository root.
if TYPE_CHECKING:
    from python.a2ui_spectra_instrumentation.tests import conftest

CARD = 'surface("card")\nroot = Text("Hi")'
TEXT = f"Here is the card.\n<a2ui>\n{CARD}\n</a2ui>\n"
REJECTED = 'Here is the card.\n<a2ui>\nsurface("card")\nroot = Heading("Hi")\n</a2ui>\n'


def test_a_closed_stream_is_one_span_from_open_to_close(
    spans: conftest.Recorded, processor: conftest.ProcessorFactory
) -> None:
    stream = processor().open_stream()
    stream.feed(TEXT[:10])
    stream.feed(TEXT[10:])
    assert spans.all() == []
    stream.close()

    span = spans.one()
    assert [event.name for event in span.events] == [
        "a2ui.parse.chunk",
        "a2ui.parse.chunk",
    ]
    assert spans.attributes(span)["a2ui.parse.input"] == TEXT
    assert len(spans.parsed(span, "a2ui.parse.messages")) == 1
    assert span.status.is_ok


def test_a_raising_feed_ends_the_span(
    spans: conftest.Recorded, processor: conftest.ProcessorFactory
) -> None:
    stream = processor().open_stream()
    with pytest.raises(A2uiError):
        stream.feed(REJECTED)

    span = spans.one()
    assert [event.name for event in span.events] == ["a2ui.parse.chunk", "exception"]
    assert spans.attributes(span)["a2ui.parse.input"] == REJECTED
    assert not span.status.is_ok

    assert stream.close() == []
    assert spans.all() == [span]


def test_a_stream_reading_past_a_rejected_block_records_it(
    spans: conftest.Recorded, processor: conftest.ProcessorFactory
) -> None:
    stream = processor().open_stream(after_rejected_block="continue")
    stream.feed(REJECTED)
    stream.feed(TEXT)
    stream.close()

    span = spans.one()
    assert [event.name for event in span.events] == [
        "a2ui.parse.chunk",
        "exception",
        "a2ui.parse.chunk",
    ]
    assert spans.attributes(span)["error.type"] == "A2uiCompilationValidationError"
    assert len(spans.parsed(span, "a2ui.parse.messages")) == 1


def test_a_stream_fed_more_chunks_than_a_span_holds_keeps_its_first_chunk_and_its_errors(
    spans: conftest.Recorded, processor: conftest.ProcessorFactory
) -> None:
    # OpenTelemetry's span holds 128 events by default and drops the oldest
    # past them; a reply streamed in small chunks, as Anthropic's are, feeds
    # hundreds.
    stream = processor().open_stream(after_rejected_block="continue")
    stream.feed(REJECTED)
    for character in "Some more text. " * 20:
        stream.feed(character)
    stream.feed(TEXT)
    stream.close()

    span = spans.one()
    names = [event.name for event in span.events]
    assert len(names) <= 128
    assert names.count("exception") == 1
    chunks = [event for event in span.events if event.name == "a2ui.parse.chunk"]
    ends = [spans.attributes(event)["a2ui.parse.chunk.end"] for event in chunks]
    assert ends[0] == len(REJECTED)
    assert ends[-1] == len(REJECTED) + 320 + len(TEXT)
    assert ends == sorted(ends)
    times = [event.timestamp for event in span.events]
    assert times == sorted(times)


def test_a_lower_limit_in_the_environment_is_the_limit_the_chunks_are_thinned_to(
    monkeypatch: pytest.MonkeyPatch,
    exporter: InMemorySpanExporter,
    processor: conftest.ProcessorFactory,
) -> None:
    # The SDK's provider reads its limit from the environment when it is made.
    monkeypatch.setenv("OTEL_SPAN_EVENT_COUNT_LIMIT", "32")
    provider = TracerProvider()
    provider.add_span_processor(SimpleSpanProcessor(exporter))
    a2ui_spectra_instrumentation.instrument(tracer_provider=provider)

    stream = processor().open_stream(after_rejected_block="continue")
    stream.feed(REJECTED)
    for character in "Some more text. " * 6:
        stream.feed(character)
    stream.feed(TEXT)
    stream.close()

    [span] = exporter.get_finished_spans()
    names = [event.name for event in span.events]
    assert len(names) == 32
    assert names.count("exception") == 1
    ends = [
        dict(event.attributes or {})["a2ui.parse.chunk.end"]
        for event in span.events
        if event.name == "a2ui.parse.chunk"
    ]
    assert ends[0] == len(REJECTED)
    assert ends[-1] == len(REJECTED) + 96 + len(TEXT)


def test_an_abandoned_stream_is_never_exported(
    spans: conftest.Recorded, processor: conftest.ProcessorFactory
) -> None:
    stream = processor().open_stream()
    stream.feed(TEXT)
    del stream
    gc.collect()

    assert spans.all() == []


def test_a_feed_after_the_end_passes_the_sdks_error_and_records_nothing(
    spans: conftest.Recorded, processor: conftest.ProcessorFactory
) -> None:
    stream = processor().open_stream()
    stream.feed(TEXT)
    stream.close()
    with pytest.raises(ValueError, match="closed"):
        stream.feed(TEXT)

    span = spans.one()
    assert [event.name for event in span.events] == ["a2ui.parse.chunk"]
    assert spans.attributes(span)["a2ui.parse.input"] == TEXT
