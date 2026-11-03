"""The A2UI step's events: the open event, and the span each one becomes when it ends.

A context-local variable holds the open event. The outermost hooked call opens
one, and a hooked call made while one is open opens none: it annotates the open
one instead. A stream's event lives with its stream object and is the open event
only while its `feed` or `close` runs.

An event is kept in memory while it is open and becomes one span when it ends,
with the start time, parent and span events it recorded on the way. An event
that never ends, such as an abandoned stream's, is never exported.
"""

from __future__ import annotations

import contextvars
import json
import time
import traceback
from collections.abc import Iterable, Mapping
from typing import Any

from opentelemetry import context as otel_context
from opentelemetry.trace import SpanKind, Status, StatusCode
from opentelemetry.util.types import AttributeValue

from .log import logger
from .package import AGENT_SDK
from .state import Active

# A block's range in the input: start inclusive, end exclusive, in UTF-16 code units.
Block = tuple[int, int]

# The toolset's tool, by its name.
TOOL_NAME = "send_a2ui_json_to_client"
# The key of the toolset's result that holds the messages it validated.
VALIDATED_KEY = "validated_a2ui_json"

_open: contextvars.ContextVar[Event | None] = contextvars.ContextVar(
    "a2ui_spectra_instrumentation_open_event", default=None
)


def current() -> Event | None:
    """The open event, if a hooked call is running."""
    return _open.get()


def enter(event: Event) -> contextvars.Token[Event | None]:
    return _open.set(event)


def leave(token: contextvars.Token[Event | None]) -> None:
    _open.reset(token)


def utf16_length(text: str) -> int:
    return len(text.encode("utf-16-le", errors="surrogatepass")) // 2


def json_text(value: Any) -> str:
    """An array or object the record holds, in its wire form: its JSON text."""
    return json.dumps(value, ensure_ascii=False, separators=(",", ":"), default=str)


def stack_trace(error: BaseException) -> str:
    return "".join(traceback.format_exception(type(error), error, error.__traceback__))


def error_details(error: BaseException) -> list[Any]:
    """The SDK's structured details of an error, as it gives them."""
    details = getattr(error, "details", None)
    if not isinstance(details, list):
        return []
    return [
        detail.to_dict() if callable(getattr(detail, "to_dict", None)) else detail
        for detail in details
    ]


def record_version(active: Active, version: Any) -> str:
    """A protocol version in the record's form: `v0.9`, `v0.9.1`, `v1.0`."""
    if active.to_protocol_version is not None:
        try:
            version = active.to_protocol_version(version)
        except (TypeError, ValueError):
            pass
    text = str(getattr(version, "value", version))
    return text if text.startswith("v") else f"v{text}"


def catalogs_of(active: Active, owner: object) -> list[dict[str, str]] | None:
    """The catalogs a parser or a prompt generator holds, in the record's shape."""
    catalogs = getattr(owner, "catalogs", None)
    if not isinstance(catalogs, Iterable):
        return None
    shaped = []
    for catalog in catalogs:
        catalog_id = getattr(catalog, "catalog_id", None)
        version = getattr(catalog, "protocol_version", None)
        if not isinstance(catalog_id, str) or version is None:
            return None
        shaped.append({
            "catalogId": catalog_id,
            "protocolVersion": record_version(active, version),
        })
    return shaped or None


# What an event keeps of an error raised under a whole-tree check: it belongs to no block.
_WHOLE_TREE = object()


class Event:
    """One event of the A2UI step, open from its outermost call to its end."""

    kind = ""

    def __init__(self, active: Active) -> None:
        self.active = active
        # Times come from one wall-clock reading and a monotonic clock, so the
        # span events keep their order.
        self._wall = time.time_ns()
        self._monotonic = time.monotonic_ns()
        self.start = self._wall
        # The span current when the event opened is its parent.
        self.context = otel_context.get_current()
        self.format: str | None = None
        self.catalogs: list[dict[str, str]] | None = None
        self.tool_name: str | None = None
        self.span_events: list[tuple[str, dict[str, AttributeValue], int]] = []
        # The errors recorded as `exception` span events, in order, and their blocks.
        self.errors: list[BaseException] = []
        self.error_blocks: list[Block | None] = []
        # Each error seen leaving a hooked call, with what the event kept of it then.
        self.noted: list[tuple[BaseException, object]] = []
        # How deep in hooked calls the event is: 0 in its outermost call.
        self.depth = 0
        # How many whole-tree checks are running: an error raised under one
        # belongs to no block.
        self.whole_tree = 0
        self.ended = False

    def now(self) -> int:
        return self._wall + (time.monotonic_ns() - self._monotonic)

    # What hooked calls nested in the event tell it. A prompt generation's
    # event takes only a generator's format and catalogs.

    def adopt_parser(self, parser: object, fmt: str | None) -> None:
        pass

    def adopt_generator(self, generator: object, fmt: str | None) -> None:
        pass

    def note_compile(self, text: object) -> None:
        pass

    def start_whole_tree(self) -> None:
        self.whole_tree += 1

    def seen(self, error: BaseException) -> object:
        """What the event keeps of an error when it first sees it, to place it by."""
        return None

    def place(self, error: BaseException, seen: object) -> Block | None:
        """The block an error belongs to, from what the event kept when it first saw it."""
        return None

    # Errors.

    def _seen_before(self, error: BaseException) -> tuple[bool, object]:
        for noted, kept in self.noted:
            if noted is error:
                return True, kept
        return False, None

    def escaped(self, error: BaseException) -> None:
        """An error left a hooked call nested in the event."""
        noted, _ = self._seen_before(error)
        if not noted:
            self.noted.append((error, self.seen(error)))

    def record(self, error: BaseException, placed: bool = True) -> None:
        """Records an error as one `exception` span event, once; one not placed belongs to no block."""
        if any(seen is error for seen in self.errors):
            return
        noted, kept = self._seen_before(error)
        block = (
            self.place(error, kept if noted else self.seen(error)) if placed else None
        )
        self.errors.append(error)
        self.error_blocks.append(block)
        attributes: dict[str, AttributeValue] = {
            "exception.type": type(error).__name__,
            "exception.message": str(error),
            "exception.stacktrace": stack_trace(error),
        }
        if block is not None:
            attributes["a2ui.parse.block.start"] = block[0]
            attributes["a2ui.parse.block.end"] = block[1]
            self.placed(attributes, block)
        details = error_details(error)
        if details:
            attributes["a2ui.parse.error.details"] = json_text(details)
        self.span_events.append(("exception", attributes, self.now()))

    def placed(self, attributes: dict[str, AttributeValue], block: Block) -> None:
        """An error was placed in a block, its range in these attributes."""

    def fail(self, error: BaseException) -> None:
        """The outermost call raised: the error is recorded and the event ends."""
        self.record(error)
        self.end()

    # The end.

    def attributes(self) -> dict[str, AttributeValue] | None:
        """The span's attributes, or None when the event cannot be stated."""
        raise NotImplementedError

    def abandon(self, why: str | None = None) -> None:
        """Ends the event without a span."""
        self.ended = True
        if why is not None:
            logger.debug("a2ui-spectra-instrumentation: %s", why)

    def end(self) -> None:
        """Ends the event, writing it as one span."""
        if self.ended:
            return
        self.ended = True
        attributes = self.attributes()
        if attributes is None:
            return
        if self.errors:
            attributes["error.type"] = type(self.errors[0]).__name__
        span = self.active.tracer.start_span(
            self.kind,
            context=self.context,
            kind=SpanKind.INTERNAL,
            attributes=attributes,
            start_time=self.start,
        )
        for name, event_attributes, at in self.span_events:
            span.add_event(name, event_attributes, timestamp=at)
        if self.errors:
            span.set_status(Status(StatusCode.ERROR, str(self.errors[0])))
        span.end(end_time=self.now())

    def _sdk(self) -> dict[str, AttributeValue]:
        return {"a2ui.sdk.name": AGENT_SDK, "a2ui.sdk.version": self.active.sdk_version}


class Silent(Event):
    """Stands open for a call the wrapper does not record, so the calls nested in it record nothing either."""

    def __init__(self) -> None:
        self.depth = 0
        self.whole_tree = 0
        self.ended = True

    def escaped(self, error: BaseException) -> None:
        pass

    def record(self, error: BaseException, placed: bool = True) -> None:
        pass

    def fail(self, error: BaseException) -> None:
        pass

    def end(self) -> None:
        pass


class PromptEvent(Event):
    """A `prompt_generation`: the UI section a prompt generator wrote, or a toolset appended."""

    kind = "prompt_generation"

    def __init__(self, active: Active) -> None:
        super().__init__(active)
        self.ui_section: str | None = None

    def adopt_generator(self, generator: object, fmt: str | None) -> None:
        if self.format is None and fmt is not None:
            self.format = fmt
            self.catalogs = catalogs_of(self.active, generator)

    def take_section(self, section: object) -> None:
        if isinstance(section, str):
            self.ui_section = section
        self.end()

    def attributes(self) -> dict[str, AttributeValue] | None:
        if self.format is None or self.catalogs is None:
            self.abandon_reason("its inference format or catalogs are unknown")
            return None
        if not self.errors and self.ui_section is None:
            self.abandon_reason("it produced no section")
            return None
        attributes: dict[str, AttributeValue] = {"a2ui.event.kind": self.kind}
        if not self.errors and self.ui_section is not None:
            attributes["a2ui.prompt.ui_section"] = self.ui_section
        attributes["a2ui.prompt.inference_format"] = self.format
        attributes["a2ui.prompt.catalogs"] = json_text(self.catalogs)
        attributes.update(self._sdk())
        if self.tool_name is not None:
            attributes["gen_ai.tool.name"] = self.tool_name
        return attributes

    def abandon_reason(self, why: str) -> None:
        logger.debug(
            "a2ui-spectra-instrumentation: a prompt generation is not recorded: %s", why
        )


class ParseEvent(Event):
    """A `parse`: one outermost call to a public parsing entry point."""

    kind = "parse"

    def __init__(self, active: Active, entry_point: str, text: object = "") -> None:
        super().__init__(active)
        self.entry_point = entry_point
        self.input = text if isinstance(text, str) else ""
        self.wrapped = True
        # A stream's chunks, its parser, and how far its input reaches.
        self.streamed = False
        self.chunks: list[str] = []
        self.fed = 0
        self.stream_parser: object = None
        self.messages: list[Any] = []
        # The block being compiled, and where the search for the next one starts.
        self.current_block: Block | None = None
        self._cursor = 0
        # How many tree checks a stream has run: one for each block it finished.
        self.tree_checks = 0
        self.call_id: str | None = None
        self.tool_result: object = None
        self.has_tool_result = False
        # A stream's placed errors: each one's attributes and the block located
        # when it surfaced.
        self.located: list[tuple[dict[str, AttributeValue], Block]] = []

    def adopt_parser(self, parser: object, fmt: str | None) -> None:
        if self.format is None:
            self.format = fmt if fmt is not None else self.active.parser_format(parser)
        if self.catalogs is None:
            self.catalogs = catalogs_of(self.active, parser)

    # The block rule.

    def note_compile(self, text: object) -> None:
        """A block is handed to `compile`: it is the current block, found in the input."""
        if self.streamed or not isinstance(text, str):
            return
        found = self.input.find(text, self._cursor)
        if found < 0:
            self.current_block = None
            return
        end = found + len(text)
        self.current_block = (
            utf16_length(self.input[:found]),
            utf16_length(self.input[:end]),
        )
        self._cursor = end

    def start_whole_tree(self) -> None:
        super().start_whole_tree()
        self.current_block = None
        self.tree_checks += 1

    def seen(self, error: BaseException) -> object:
        """Whether a tree check was running, and the current block or, for a stream, the blocks it had done."""
        if self.whole_tree:
            return _WHOLE_TREE
        if not self.streamed:
            return self.current_block
        return self._done()

    def place(self, error: BaseException, seen: object) -> Block | None:
        if seen is _WHOLE_TREE:
            return None
        if not self.streamed:
            return seen if isinstance(seen, tuple) else None
        text = self.text()
        if not self.wrapped:
            return (0, utf16_length(text))
        done = seen if isinstance(seen, int) else self._done()
        return self._rejected_block(error, text) or self._next_block(text, done)

    def placed(self, attributes: dict[str, AttributeValue], block: Block) -> None:
        if self.streamed:
            self.located.append((attributes, block))

    def _state_blocks_whole(self) -> None:
        """States each of a stream's errors' blocks whole, in the stream's whole input.

        An error is located when it surfaces, in the input fed so far, where a
        block rejected while it arrives is cut where the input then ended, and
        a `raw_content` may hold only the part of the block compiled so far. Its
        range becomes the block of the whole input, as `unwrap` finds it, that
        holds the located start.
        """
        if not self.located:
            return
        text = self.text()
        blocks = (
            [(start, end) for start, end, _ in self._unwrapped_blocks(text)]
            if self.wrapped
            else [(0, utf16_length(text))]
        )
        for attributes, (start, end) in self.located:
            whole = next(
                (block for block in blocks if block[0] <= start < block[1]), None
            ) or next(
                (block for block in blocks if block[0] < end and start < block[1]),
                None,
            )
            if whole is None:
                continue
            attributes["a2ui.parse.block.start"] = whole[0]
            attributes["a2ui.parse.block.end"] = max(whole[1], end)

    def _done(self) -> int:
        """The blocks a stream has done: one tree check for each it finished, one error for each it rejected."""
        return self.tree_checks + sum(block is not None for block in self.error_blocks)

    def _rejected_block(self, error: BaseException, text: str) -> Block | None:
        """The block the error names: its `raw_content`, found in the input after the last error's block."""
        raw = getattr(error, "raw_content", None)
        if not isinstance(raw, str) or not raw.strip():
            return None
        found = text.find(raw.strip(), self._cursor)
        if found < 0:
            return None
        self._cursor = found + len(raw.strip())
        return (utf16_length(text[:found]), utf16_length(text[: self._cursor]))

    def _next_block(self, text: str, done: int) -> Block | None:
        """The block after those the stream had done, among those `unwrap` finds in the input.

        The last block found stands in when there are fewer.
        """
        blocks = self._unwrapped_blocks(text)
        if not blocks:
            return None
        block = blocks[min(done, len(blocks) - 1)]
        self._cursor = max(self._cursor, block[2])
        return block[0], block[1]

    def _unwrapped_blocks(self, text: str) -> list[tuple[int, int, int]]:
        """Each block the parser's `unwrap` finds in the text: its range, and its end in code points."""
        unwrap = getattr(self.stream_parser, "unwrap", None)
        if not callable(unwrap):
            return []
        blocks = []
        cursor = 0
        for raw in unwrap(text):
            block = getattr(getattr(raw, "part", None), "a2ui_raw", None)
            if not isinstance(block, str):
                continue
            found = text.find(block, cursor)
            if found < 0:
                continue
            cursor = found + len(block)
            blocks.append(
                (utf16_length(text[:found]), utf16_length(text[:cursor]), cursor)
            )
        return blocks

    def escaped(self, error: BaseException) -> None:
        super().escaped(error)
        # The toolset's tool swallows what its inner calls raise, so they are
        # recorded as they leave them.
        if self.entry_point == "tool_call" and self.depth == 1:
            self.record(error)

    # A stream.

    def feed(self, chunk: object) -> None:
        if not isinstance(chunk, str):
            return
        self.chunks.append(chunk)
        self.fed += utf16_length(chunk)
        self.span_events.append(
            ("a2ui.parse.chunk", {"a2ui.parse.chunk.end": self.fed}, self.now())
        )

    def text(self) -> str:
        return "".join(self.chunks) if self.streamed else self.input

    # What the calls return.

    def take_messages(self, messages: object) -> None:
        if isinstance(messages, (list, tuple)):
            self.messages.extend(self.active.to_message_dicts(list(messages)))

    def take_parts(self, parts: object) -> None:
        """The parts a call returned: their messages, and the errors a stream read past."""
        if not isinstance(parts, (list, tuple)):
            return
        for part in parts:
            messages = getattr(part, "a2ui", None)
            if isinstance(messages, list):
                self.take_messages(messages)
                continue
            error = getattr(part, "error", None)
            if isinstance(error, BaseException):
                self.record(error)

    def fail(self, error: BaseException) -> None:
        self.take_parts(getattr(error, "partial_results", None))
        super().fail(error)

    def take_tool_result(self, result: object) -> None:
        self.tool_result = result
        self.has_tool_result = True
        if isinstance(result, Mapping):
            self.take_messages(result.get(VALIDATED_KEY))
        self.end()

    def attributes(self) -> dict[str, AttributeValue] | None:
        self._state_blocks_whole()
        attributes: dict[str, AttributeValue] = {
            "a2ui.event.kind": self.kind,
            "a2ui.parse.input": self.text(),
            "a2ui.parse.entry_point": self.entry_point,
        }
        if not self.wrapped:
            attributes["a2ui.parse.wrapped"] = False
        if self.streamed:
            attributes["a2ui.parse.streamed"] = True
        if self.format is not None:
            attributes["a2ui.parse.inference_format"] = self.format
        if self.catalogs is not None:
            attributes["a2ui.parse.catalogs"] = json_text(self.catalogs)
        attributes["a2ui.parse.messages"] = json_text(self.messages)
        attributes.update(self._sdk())
        if self.tool_name is not None:
            attributes["gen_ai.tool.name"] = self.tool_name
            if self.call_id is not None:
                attributes["gen_ai.tool.call.id"] = self.call_id
            if self.has_tool_result:
                attributes["gen_ai.tool.call.result"] = json_text(self.tool_result)
        return attributes
