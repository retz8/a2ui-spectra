"""A failure inside the wrapper leaves the SDK's return and exception as they are, with one line."""

from __future__ import annotations

import logging
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
