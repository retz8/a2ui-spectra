"""A failure inside the wrapper leaves the SDK's result as it is.

The SDK's return and exception stay as they are, with one line. An error the
wrapper records keeps nothing of the caller alive.
"""

from __future__ import annotations

import asyncio
import gc
import logging
import weakref
from collections.abc import Callable
from types import SimpleNamespace
from typing import TYPE_CHECKING, Any

import pytest
from a2ui.adk import SendA2uiToClientToolset
from a2ui.core import A2uiError
from a2ui.inference_formats import to_message_dicts
from a2ui.parser import A2uiPart
from google.adk.models.llm_request import LlmRequest
from google.genai import types

import a2ui_spectra_instrumentation
from a2ui_spectra_instrumentation import events
from a2ui_spectra_instrumentation import hooks
from a2ui_spectra_instrumentation import state

# The fixtures' types, for the type check only: mypy names the tests by their
# path from the repository root.
if TYPE_CHECKING:
    from python.a2ui_spectra_instrumentation.tests import conftest

CARD = 'surface("card")\nroot = Text("Hi")'
UNKNOWN = 'surface("card")\nroot = Heading("Hi")'
CARD_TEXT = f"Here is the card.\n<a2ui>\n{CARD}\n</a2ui>\n"
REJECTED = f"Here is the card.\n<a2ui>\n{UNKNOWN}\n</a2ui>\n"
TOOL_NAME = "send_a2ui_json_to_client"


def fault(*args: Any, **kwargs: Any) -> None:
    raise RuntimeError("injected")


def messages(parts: list[Any]) -> list[Any]:
    return [
        message
        for part in parts
        if isinstance(part, A2uiPart)
        for message in to_message_dicts(part.a2ui)
    ]


def unhooked(processor: conftest.ProcessorFactory, text: str) -> Any:
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
    spans: conftest.Recorded,
    processor: conftest.ProcessorFactory,
    support: conftest.Support,
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
    spans: conftest.Recorded,
    processor: conftest.ProcessorFactory,
    support: conftest.Support,
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


# Every other entry point: each call as the agent makes it, giving what two
# runs are compared by.

Call = Callable[["conftest.ProcessorFactory"], Any]


def tool_of(processor: conftest.ProcessorFactory) -> Any:
    """The toolset's tool, hooked when the wrapper is switched on."""
    toolset = SendA2uiToClientToolset(a2ui_enabled=True, a2ui_processor=processor())
    tools = asyncio.run(toolset.get_tools(SimpleNamespace()))  # type: ignore[arg-type]
    return next(tool for tool in tools if tool.name == TOOL_NAME)


def compile_alone(processor: conftest.ProcessorFactory) -> Any:
    return to_message_dicts(processor().parser.compile(CARD))


def stream(processor: conftest.ProcessorFactory) -> Any:
    opened = processor().open_stream()
    return messages([*opened.feed(CARD_TEXT), *opened.close()])


def generate(processor: conftest.ProcessorFactory) -> Any:
    return processor().prompt_snippet


def tool_call(processor: conftest.ProcessorFactory) -> Any:
    context: Any = SimpleNamespace(actions=SimpleNamespace(skip_summarization=False))
    return asyncio.run(
        tool_of(processor).run_async(args={"a2ui_payload": CARD}, tool_context=context)
    )


def tool_prompt(processor: conftest.ProcessorFactory) -> Any:
    request = LlmRequest(
        config=types.GenerateContentConfig(system_instruction="You are an agent.")
    )
    asyncio.run(
        tool_of(processor).process_llm_request(
            tool_context=SimpleNamespace(), llm_request=request
        )
    )
    return request.config.system_instruction


@pytest.mark.parametrize(
    ("call", "where", "lines"),
    [
        (compile_alone, (events.ParseEvent, "__init__"), 1),
        (compile_alone, (events.ParseEvent, "take_messages"), 1),
        (stream, (events.ParseEvent, "__init__"), 1),
        (stream, (events.ParseEvent, "feed"), 1),
        # One line for the `feed` and one for the `close`.
        (stream, (events.ParseEvent, "take_parts"), 2),
        (generate, (events.PromptEvent, "__init__"), 1),
        (generate, (events.PromptEvent, "take_section"), 1),
        (tool_call, (events.ParseEvent, "__init__"), 1),
        (tool_call, (events.ParseEvent, "take_tool_result"), 1),
        (tool_prompt, (events.PromptEvent, "__init__"), 1),
        (tool_prompt, (events.PromptEvent, "take_section"), 1),
    ],
    ids=[
        "compile, before the call",
        "compile, after it returns",
        "a stream, when it opens",
        "a stream, when a chunk is fed",
        "a stream, after its calls return",
        "generate, before the call",
        "generate, after it returns",
        "the tool's call, before it",
        "the tool's call, after it returns",
        "the tool's prompt, before the call",
        "the tool's prompt, after it returns",
    ],
)
def test_a_fault_at_any_entry_point_leaves_the_return_as_it_is(
    call: Call,
    where: tuple[type, str],
    lines: int,
    monkeypatch: pytest.MonkeyPatch,
    caplog: pytest.LogCaptureFixture,
    spans: conftest.Recorded,
    processor: conftest.ProcessorFactory,
    support: conftest.Support,
) -> None:
    monkeypatch.setattr(*where, fault)
    with caplog.at_level(logging.WARNING):
        returned = call(processor)

    written = support.lines(caplog)
    assert len(written) == lines
    assert all(line.levelno == logging.WARNING for line in written)
    assert all("injected" in line.getMessage() for line in written)
    assert spans.all() == []
    monkeypatch.undo()
    a2ui_spectra_instrumentation.uninstrument()
    assert returned == call(processor)


def compile_rejected(processor: conftest.ProcessorFactory) -> Any:
    return processor().parser.compile(UNKNOWN)


def feed_rejected(processor: conftest.ProcessorFactory) -> Any:
    return processor().open_stream().feed(REJECTED)


def tool_prompt_without_a_request(processor: conftest.ProcessorFactory) -> Any:
    return asyncio.run(
        tool_of(processor).process_llm_request(
            tool_context=SimpleNamespace(), llm_request=None
        )
    )


def raised_by(call: Call, processor: conftest.ProcessorFactory) -> Exception:
    with pytest.raises(Exception) as raised:
        call(processor)
    return raised.value


@pytest.mark.parametrize(
    ("call", "where"),
    [
        (compile_rejected, (events.ParseEvent, "__init__")),
        (compile_rejected, (events.ParseEvent, "fail")),
        (feed_rejected, (events.ParseEvent, "feed")),
        (feed_rejected, (events.ParseEvent, "fail")),
        (tool_prompt_without_a_request, (events.PromptEvent, "__init__")),
        (tool_prompt_without_a_request, (events.PromptEvent, "fail")),
    ],
    ids=[
        "compile, before the call",
        "compile, after it raises",
        "a stream, when a chunk is fed",
        "a stream, after its feed raises",
        "the tool's prompt, before the call",
        "the tool's prompt, after it raises",
    ],
)
def test_a_fault_at_any_entry_point_leaves_the_exception_as_it_is(
    call: Call,
    where: tuple[type, str],
    monkeypatch: pytest.MonkeyPatch,
    caplog: pytest.LogCaptureFixture,
    spans: conftest.Recorded,
    processor: conftest.ProcessorFactory,
    support: conftest.Support,
) -> None:
    monkeypatch.setattr(*where, fault)
    with caplog.at_level(logging.WARNING):
        raised = raised_by(call, processor)

    assert len(support.lines(caplog)) == 1
    assert spans.all() == []
    monkeypatch.undo()
    a2ui_spectra_instrumentation.uninstrument()
    expected = raised_by(call, processor)
    assert type(raised) is type(expected)
    assert str(raised) == str(expected)


def test_the_tools_prompt_raising_gives_the_failed_form_and_its_own_error(
    spans: conftest.Recorded, processor: conftest.ProcessorFactory
) -> None:
    raised = raised_by(tool_prompt_without_a_request, processor)

    span = spans.one()
    attributes = spans.attributes(span)
    assert span.name == "prompt_generation"
    assert attributes["error.type"] == type(raised).__name__
    assert attributes["gen_ai.tool.name"] == TOOL_NAME
    assert attributes["a2ui.prompt.inference_format"] == "express"
    assert "a2ui.prompt.ui_section" not in attributes
    a2ui_spectra_instrumentation.uninstrument()
    expected = raised_by(tool_prompt_without_a_request, processor)
    assert type(raised) is type(expected)
    assert str(raised) == str(expected)


@pytest.mark.parametrize(
    "call", [tool_call, tool_prompt], ids=["its call", "its prompt"]
)
def test_the_tool_under_an_open_event_opens_none(
    call: Call, spans: conftest.Recorded, processor: conftest.ProcessorFactory
) -> None:
    active = state.current()
    assert active is not None
    token = events.enter(events.PromptEvent(active))
    try:
        returned = call(processor)
    finally:
        events.leave(token)

    assert spans.all() == []
    a2ui_spectra_instrumentation.uninstrument()
    assert returned == call(processor)


class Lacking:
    """A tool by the toolset's tool's name that has no `process_llm_request`."""

    name = TOOL_NAME

    async def run_async(self, **kwargs: Any) -> None:
        return None


def test_a_tool_that_lacks_a_method_is_left_unhooked_with_one_line(
    caplog: pytest.LogCaptureFixture,
    spans: conftest.Recorded,
    support: conftest.Support,
) -> None:
    tool = Lacking()
    with caplog.at_level(logging.WARNING):
        hooks.hook_tools([tool])
        hooks.hook_tools([tool])

    [line] = support.lines(caplog)
    assert line.levelno == logging.WARNING
    assert "process_llm_request" in line.getMessage()
    assert "run_async" not in vars(tool)


class Held:
    """Stands for what the agent's frame holds.

    For example, the generator it reads tokens from.
    """


def test_a_raising_feed_keeps_nothing_of_the_caller_alive(
    spans: conftest.Recorded, processor: conftest.ProcessorFactory
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
    spans: conftest.Recorded, processor: conftest.ProcessorFactory
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
    spans: conftest.Recorded, processor: conftest.ProcessorFactory
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
