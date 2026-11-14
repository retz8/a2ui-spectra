"""A failure inside the wrapper leaves the SDK's return and exception as they are, with one line; an error the wrapper records keeps nothing of the caller alive."""

from __future__ import annotations

import gc
import logging
import weakref
from typing import Any

import pytest
from a2ui.core import A2uiError
from a2ui.inference_formats import to_message_dicts
from a2ui.parser import A2uiPart

import a2ui_spectra_instrumentation
from a2ui_spectra_instrumentation import events

CARD_TEXT = 'Here is the card.\n<a2ui>\nsurface("card")\nroot = Text("Hi")\n</a2ui>\n'
REJECTED = 'Here is the card.\n<a2ui>\nsurface("card")\nroot = Heading("Hi")\n</a2ui>\n'


def fault(*args: Any, **kwargs: Any) -> None:
    raise RuntimeError("injected")


def messages(parts: list[Any]) -> list[Any]:
    return [
        message
        for part in parts
        if isinstance(part, A2uiPart)
        for message in to_message_dicts(part.a2ui)
    ]


def unhooked(processor: Any, text: str) -> Any:
    """What the SDK does with the wrapper switched off."""
    a2ui_spectra_instrumentation.uninstrument()
    try:
        return processor().parse_response(text)
    except A2uiError as error:
        return error


@pytest.mark.parametrize(
    "where",
    [
        (events.ParseEvent, "__init__"),
        (events.ParseEvent, "take_parts"),
        (events.Event, "end"),
    ],
    ids=["before the call", "after it returns", "when the span is written"],
)
def test_a_fault_leaves_the_return_as_it_is(
    where: tuple[type, str],
    monkeypatch: pytest.MonkeyPatch,
    caplog: pytest.LogCaptureFixture,
    spans: Any,
    processor: Any,
    support: Any,
) -> None:
    monkeypatch.setattr(*where, fault)
    with caplog.at_level(logging.WARNING):
        parts = processor().parse_response(CARD_TEXT)

    [line] = support.lines(caplog)
    assert line.levelno == logging.WARNING
    assert "injected" in line.getMessage()
    monkeypatch.undo()
    assert messages(parts) == messages(unhooked(processor, CARD_TEXT))


@pytest.mark.parametrize(
    "where",
    [(events.ParseEvent, "__init__"), (events.ParseEvent, "fail")],
    ids=["before the call", "after it raises"],
)
def test_a_fault_leaves_the_exception_as_it_is(
    where: tuple[type, str],
    monkeypatch: pytest.MonkeyPatch,
    caplog: pytest.LogCaptureFixture,
    spans: Any,
    processor: Any,
    support: Any,
) -> None:
    monkeypatch.setattr(*where, fault)
    with caplog.at_level(logging.WARNING), pytest.raises(A2uiError) as raised:
        processor().parse_response(REJECTED)

    assert len(support.lines(caplog)) == 1
    monkeypatch.undo()
    expected = unhooked(processor, REJECTED)
    assert type(raised.value) is type(expected)
    assert str(raised.value) == str(expected)
    assert raised.value.__cause__ is None or type(raised.value.__cause__) is type(
        expected.__cause__
    )
    assert spans.all() == []


class Held:
    """Stands for what the agent's frame holds, such as the generator it reads tokens from."""


def test_a_raising_feed_keeps_nothing_of_the_caller_alive(
    spans: Any, processor: Any
) -> None:
    def caller(stream: Any) -> weakref.ref[Held]:
        held = Held()
        try:
            stream.feed(REJECTED)
        except A2uiError:
            pass
        return weakref.ref(held)

    stream = processor().open_stream()
    held = caller(stream)
    gc.collect()

    assert held() is None
    assert [event.name for event in spans.one().events][-1] == "exception"


def test_a_block_read_past_keeps_nothing_of_the_caller_alive(
    spans: Any, processor: Any
) -> None:
    def caller(stream: Any) -> weakref.ref[Held]:
        held = Held()
        stream.feed(REJECTED)
        return weakref.ref(held)

    stream = processor().open_stream(after_rejected_block="continue")
    held = caller(stream)
    gc.collect()

    # The stream is still open, its event holding the block it read past.
    assert held() is None
    stream.close()
    span = spans.one()
    assert [event.name for event in span.events] == ["a2ui.parse.chunk", "exception"]
    assert spans.attributes(span)["error.type"] == "A2uiCompilationValidationError"
    assert not span.status.is_ok


def test_a_raising_parse_keeps_nothing_of_the_caller_alive(
    spans: Any, processor: Any
) -> None:
    def caller() -> weakref.ref[Held]:
        held = Held()
        try:
            processor().parse_response(REJECTED)
        except A2uiError:
            pass
        return weakref.ref(held)

    held = caller()
    gc.collect()

    assert held() is None
    assert not spans.one().status.is_ok
