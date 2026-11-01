"""A stream's span: closed, ended by a raising `feed`, abandoned, and fed after its end."""

from __future__ import annotations

import gc
from typing import Any

import pytest
from a2ui.core import A2uiError

CARD = 'surface("card")\nroot = Text("Hi")'
TEXT = f"Here is the card.\n<a2ui>\n{CARD}\n</a2ui>\n"
REJECTED = 'Here is the card.\n<a2ui>\nsurface("card")\nroot = Heading("Hi")\n</a2ui>\n'


def test_a_closed_stream_is_one_span_from_open_to_close(
    spans: Any, processor: Any
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


def test_a_raising_feed_ends_the_span(spans: Any, processor: Any) -> None:
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
    spans: Any, processor: Any
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


def test_an_abandoned_stream_is_never_exported(spans: Any, processor: Any) -> None:
    stream = processor().open_stream()
    stream.feed(TEXT)
    del stream
    gc.collect()

    assert spans.all() == []


def test_a_feed_after_the_end_passes_the_sdks_error_and_records_nothing(
    spans: Any, processor: Any
) -> None:
    stream = processor().open_stream()
    stream.feed(TEXT)
    stream.close()
    with pytest.raises(ValueError, match="closed"):
        stream.feed(TEXT)

    span = spans.one()
    assert [event.name for event in span.events] == ["a2ui.parse.chunk"]
    assert spans.attributes(span)["a2ui.parse.input"] == TEXT
