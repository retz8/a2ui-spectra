"""The hooked names, in one table, and the hook each one gets.

Every hook leaves the SDK's call as it is: it returns what the call returns and
raises what it raises. What the hook records around the call runs guarded, and
a failure in it is one WARNING line.
"""

from __future__ import annotations

import contextvars
import inspect
import os
import sys
import types
import weakref
from collections.abc import Awaitable, Callable, Mapping
from dataclasses import dataclass
from typing import Any

import wrapt

from a2ui_spectra_instrumentation import events
from a2ui_spectra_instrumentation import log
from a2ui_spectra_instrumentation import state

Wrapper = Callable[[Any, Any, tuple[Any, ...], dict[str, Any]], Any]


@dataclass(frozen=True)
class Hook:
    """One hooked name: where it is, its group and its role.

    Its group is the set of names it stands or falls with.
    """

    # `core`, `atom` and `elemental` on the agent SDK; `toolset` on `a2ui-adk`.
    group: str
    module: str
    # The name's path in the module: `Class.method` or `function`.
    name: str
    # `parse_response`, `compile`, `open_stream`, `feed`, `close`, `generate`,
    # `whole_tree`, `apply`, `get_tools` or `resolve_processor`.
    role: str
    # The inference format a parser's hook belongs to.
    format: str | None = None


@dataclass(frozen=True)
class Generator:
    """A format's prompt generator class.

    It is read, not hooked, to name a generator's format.
    """

    # The group the class stands or falls with, as a hooked name's.
    group: str
    # The module that defines the class.
    module: str
    name: str
    format: str


_DIRECT_JSON = "a2ui.inference_formats.direct_json"
_EXPRESS = "a2ui.inference_formats.express"
_ATOM = "a2ui.inference_formats.experimental.atom"
_ELEMENTAL = "a2ui.inference_formats.experimental.elemental"

HOOKS: tuple[Hook, ...] = (
    Hook("core", "a2ui.parser", "Parser.parse_response", "parse_response"),
    Hook("core", "a2ui.utils", "RendererState.check_topology", "whole_tree"),
    Hook("core", "a2ui.utils", "RendererState.apply", "apply"),
    # Every format's prompt generation is the base class's one `generate()`.
    Hook("core", "a2ui.prompt", "PromptGenerator.generate", "generate"),
    Hook("core", _DIRECT_JSON, "DirectJsonParser.compile", "compile", "direct_json"),
    Hook(
        "core",
        _DIRECT_JSON,
        "DirectJsonParser.open_stream",
        "open_stream",
        "direct_json",
    ),
    Hook("core", _DIRECT_JSON, "DirectJsonResponseStream.feed", "feed"),
    Hook("core", _DIRECT_JSON, "DirectJsonResponseStream.close", "close"),
    Hook("core", _EXPRESS, "ExpressParser.compile", "compile", "express"),
    Hook("core", _EXPRESS, "ExpressParser.open_stream", "open_stream", "express"),
    Hook("core", _EXPRESS, "ExpressResponseStream.feed", "feed"),
    Hook("core", _EXPRESS, "ExpressResponseStream.close", "close"),
    Hook("atom", _ATOM, "AtomParser.compile", "compile", "atom"),
    Hook("elemental", _ELEMENTAL, "ElementalParser.compile", "compile", "elemental"),
    Hook("toolset", "a2ui.adk", "SendA2uiToClientToolset.get_tools", "get_tools"),
    # The toolset's module holds `validate_payload` by name, from `a2ui.utils`,
    # and its tool's call is the one parse that reaches it.
    Hook(
        "toolset",
        "a2ui.adk.send_a2ui_to_client_toolset",
        "validate_payload",
        "whole_tree",
    ),
    # What turns the processor or the provider a tool was given into the
    # processor of one call.
    Hook(
        "toolset",
        "a2ui.adk.send_a2ui_to_client_toolset",
        "_resolve_processor",
        "resolve_processor",
    ),
)

# The classes a generator's format is read from. The format packages do not
# export them.
GENERATORS: tuple[Generator, ...] = (
    Generator(
        "core",
        f"{_DIRECT_JSON}.prompt_generator",
        "DirectJsonPromptGenerator",
        "direct_json",
    ),
    Generator(
        "core", f"{_EXPRESS}.prompt_generator", "ExpressPromptGenerator", "express"
    ),
    Generator("atom", f"{_ATOM}.prompt_generator", "AtomPromptGenerator", "atom"),
    Generator(
        "elemental",
        f"{_ELEMENTAL}.prompt_generator",
        "ElementalPromptGenerator",
        "elemental",
    ),
)

# The methods hooked on the tool `get_tools` returns named `send_a2ui_json_to_client`.
TOOL_METHODS = ("run_async", "process_llm_request")

# The toolset's module, on whose logger the tool calls `error` for each error it
# swallows.
TOOLSET_MODULE = "a2ui.adk.send_a2ui_to_client_toolset"

# Names the hooks call, checked with the core names.
READS: tuple[tuple[str, str], ...] = (("a2ui.parser", "to_message_dicts"),)


# Calling through, guarded.


def _safely(where: str, action: Callable[[], object]) -> None:
    try:
        action()
    except Exception as fault:
        log.report_fault(where, fault)


def _leave(event: events.Event, token: contextvars.Token[events.Event | None]) -> None:
    """The outermost call on an event is over.

    The event is no longer the open one, and keeps no error.
    """
    events.leave(token)
    event.release()


def _arguments(
    wrapped: Any, args: tuple[Any, ...], kwargs: dict[str, Any]
) -> dict[str, Any]:
    """The call's arguments, bound to the wrapped call's signature.

    Defaults are applied.
    """
    bound = inspect.signature(wrapped).bind(*args, **kwargs)
    bound.apply_defaults()
    return dict(bound.arguments)


def _first(arguments: dict[str, Any]) -> Any:
    return next(iter(arguments.values()), None)


def _unrecorded(wrapped: Any, args: tuple[Any, ...], kwargs: dict[str, Any]) -> Any:
    """A call the wrapper does not record.

    The calls nested in it open no event either.
    """
    token = events.enter(events.Silent())
    try:
        return wrapped(*args, **kwargs)
    finally:
        events.leave(token)


async def _await_unrecorded(awaitable: Awaitable[Any]) -> Any:
    token = events.enter(events.Silent())
    try:
        return await awaitable
    finally:
        events.leave(token)


def _inner(
    event: events.Event,
    wrapped: Any,
    args: tuple[Any, ...],
    kwargs: dict[str, Any],
    where: str,
    before: Callable[[], object] | None = None,
    whole_tree: bool = False,
) -> Any:
    """A hooked call made while an event is open.

    It opens none, and tells the open one.
    """
    if before is not None:
        _safely(where, before)
    event.depth += 1
    if whole_tree:
        event.start_whole_tree()
    try:
        return wrapped(*args, **kwargs)
    except Exception as error:
        _safely(where, lambda: event.escaped(error))
        raise
    finally:
        event.depth -= 1
        if whole_tree:
            event.whole_tree -= 1


def _outermost(
    event: events.Event,
    wrapped: Any,
    args: tuple[Any, ...],
    kwargs: dict[str, Any],
    where: str,
    returned: Callable[[Any], object],
) -> Any:
    """The outermost call: the event is open while it runs, and ends with it.

    A cancellation or an interrupt is no error of the call: it passes, and the
    event ends without a span.
    """
    token = events.enter(event)
    try:
        result = wrapped(*args, **kwargs)
    except Exception as error:
        _safely(where, lambda: event.fail(error))
        raise
    except BaseException:
        _safely(where, event.abandon)
        raise
    else:
        _safely(where, lambda: returned(result))
        return result
    finally:
        _leave(event, token)


async def _outermost_awaited(
    event: events.Event,
    awaitable: Awaitable[Any],
    where: str,
    returned: Callable[[Any], object],
    failed: Callable[[Exception], object] | None = None,
) -> Any:
    """The outermost call, awaited: `_outermost` for a hooked coroutine.

    What a raised error is recorded by is the event's `fail`, unless given.
    """
    token = events.enter(event)
    try:
        result = await awaitable
    except Exception as error:
        _safely(where, lambda: (failed or event.fail)(error))
        raise
    except BaseException:
        _safely(where, event.abandon)
        raise
    else:
        _safely(where, lambda: returned(result))
        return result
    finally:
        _leave(event, token)


# The parsing entry points.


def parse_response_hook(
    wrapped: Any, instance: Any, args: tuple[Any, ...], kwargs: dict[str, Any]
) -> Any:
    """Hooks `Parser.parse_response`: an outermost call is one `parse`."""
    active = state.current()
    if active is None:
        return wrapped(*args, **kwargs)
    where = "the parse_response hook"
    open_event = events.current()
    if open_event is not None:
        return _inner(
            open_event,
            wrapped,
            args,
            kwargs,
            where,
            before=lambda: open_event.adopt_parser(instance, None),
        )
    try:
        arguments = _arguments(wrapped, args, kwargs)
        event = events.ParseEvent(active, "parse_response", _first(arguments))
        event.wrapped = arguments.get("wrapped") is not False
        event.adopt_parser(instance, None)
    except Exception as fault:
        log.report_fault(where, fault)
        return _unrecorded(wrapped, args, kwargs)

    def returned(parts: Any) -> None:
        event.take_parts(parts)
        event.end()

    return _outermost(event, wrapped, args, kwargs, where, returned)


def compile_hook_for(inference_format: str | None) -> Wrapper:
    """The hook on a parser's `compile`, for one inference format."""

    def compile_hook(
        wrapped: Any, instance: Any, args: tuple[Any, ...], kwargs: dict[str, Any]
    ) -> Any:
        """Hooks a parser's `compile`: an outermost call is one `parse`."""
        active = state.current()
        if active is None:
            return wrapped(*args, **kwargs)
        where = "the compile hook"
        open_event = events.current()
        if open_event is not None:

            def before() -> None:
                open_event.adopt_parser(instance, inference_format)
                open_event.note_compile(_first(_arguments(wrapped, args, kwargs)))

            return _inner(open_event, wrapped, args, kwargs, where, before=before)
        try:
            text = _first(_arguments(wrapped, args, kwargs))
            event = events.ParseEvent(active, "compile", text)
            event.adopt_parser(instance, inference_format)
            event.note_compile(text)
        except Exception as fault:
            log.report_fault(where, fault)
            return _unrecorded(wrapped, args, kwargs)

        def returned(messages: Any) -> None:
            event.take_messages(messages)
            event.end()

        return _outermost(event, wrapped, args, kwargs, where, returned)

    return compile_hook


# A stream's event lives with its stream object.
_streams: weakref.WeakKeyDictionary[Any, events.ParseEvent] = (
    weakref.WeakKeyDictionary()
)


def _stream_event(stream: Any) -> events.ParseEvent | None:
    try:
        return _streams.get(stream)
    except TypeError:
        return None


def open_stream_hook_for(inference_format: str | None) -> Wrapper:
    """The hook on a parser's `open_stream`, for one inference format."""

    def open_stream_hook(
        wrapped: Any, instance: Any, args: tuple[Any, ...], kwargs: dict[str, Any]
    ) -> Any:
        """Hooks `open_stream`: the stream it returns is one `parse`."""
        active = state.current()
        if active is None:
            return wrapped(*args, **kwargs)
        where = "the open_stream hook"
        open_event = events.current()
        if open_event is not None:
            return _inner(open_event, wrapped, args, kwargs, where)
        try:
            arguments = _arguments(wrapped, args, kwargs)
            event = events.ParseEvent(active, "open_stream")
            event.streamed = True
            event.stream_parser = instance
            event.wrapped = arguments.get("wrapped") is not False
            event.adopt_parser(instance, inference_format)
        except Exception as fault:
            log.report_fault(where, fault)
            return _unrecorded(wrapped, args, kwargs)

        def returned(stream: Any) -> None:
            _streams[stream] = event

        return _outermost(event, wrapped, args, kwargs, where, returned)

    return open_stream_hook


def _stream_call(
    wrapped: Any,
    instance: Any,
    args: tuple[Any, ...],
    kwargs: dict[str, Any],
    where: str,
    before: Callable[[events.ParseEvent], object] | None,
    closing: bool,
) -> Any:
    """A `feed` or `close` on a stream with an event.

    The event is the open event while it runs.
    """
    if state.current() is None:
        return wrapped(*args, **kwargs)
    event = _stream_event(instance)
    if event is None or event.ended:
        # A stream opened unrecorded, or one that has ended: nothing in it is recorded.
        return _unrecorded(wrapped, args, kwargs)
    if before is not None:
        try:
            before(event)
        except Exception as fault:
            log.report_fault(where, fault)
            event.abandon()
            return _unrecorded(wrapped, args, kwargs)

    def returned(parts: Any) -> None:
        event.take_parts(parts)
        if closing:
            event.end()

    return _outermost(event, wrapped, args, kwargs, where, returned)


def feed_hook(
    wrapped: Any, instance: Any, args: tuple[Any, ...], kwargs: dict[str, Any]
) -> Any:
    """Hooks a stream's `feed`: the chunk joins the stream's `parse`."""

    def before(event: events.ParseEvent) -> None:
        event.feed(_first(_arguments(wrapped, args, kwargs)))

    return _stream_call(
        wrapped, instance, args, kwargs, "the feed hook", before, closing=False
    )


def close_hook(
    wrapped: Any, instance: Any, args: tuple[Any, ...], kwargs: dict[str, Any]
) -> Any:
    """Hooks a stream's `close`: the stream's `parse` ends."""
    return _stream_call(
        wrapped, instance, args, kwargs, "the close hook", None, closing=True
    )


def whole_tree_hook(
    wrapped: Any, instance: Any, args: tuple[Any, ...], kwargs: dict[str, Any]
) -> Any:
    """Hooks a whole-tree check: an error it raises belongs to no block.

    The checks are `RendererState.check_topology` and `validate_payload`.
    """
    open_event = events.current() if state.current() is not None else None
    if open_event is None:
        return wrapped(*args, **kwargs)
    return _inner(
        open_event, wrapped, args, kwargs, "the whole-tree check hook", whole_tree=True
    )


def apply_hook(
    wrapped: Any, instance: Any, args: tuple[Any, ...], kwargs: dict[str, Any]
) -> Any:
    """Hooks `RendererState.apply`: an error it raises is seen when raised."""
    open_event = events.current() if state.current() is not None else None
    if open_event is None:
        return wrapped(*args, **kwargs)
    return _inner(open_event, wrapped, args, kwargs, "the apply hook")


# The prompt generators.


def generate_hook(
    wrapped: Any, instance: Any, args: tuple[Any, ...], kwargs: dict[str, Any]
) -> Any:
    """Hooks `PromptGenerator.generate`: one `prompt_generation`.

    It records one only for a generator of a format's class.
    """
    active = state.current()
    if active is None:
        return wrapped(*args, **kwargs)
    where = "the generate hook"
    open_event = events.current()
    if open_event is not None:
        return _inner(
            open_event,
            wrapped,
            args,
            kwargs,
            where,
            before=lambda: open_event.adopt_generator(
                instance, active.generator_format(instance)
            ),
        )
    try:
        inference_format = active.generator_format(instance)
        if inference_format is None:
            # A generator of none of the format classes gives no event.
            event = None
        else:
            event = events.PromptEvent(active)
            event.adopt_generator(instance, inference_format)
    except Exception as fault:
        log.report_fault(where, fault)
        return _unrecorded(wrapped, args, kwargs)
    if event is None:
        return wrapped(*args, **kwargs)
    return _outermost(event, wrapped, args, kwargs, where, event.take_section)


# The toolset.

# The tools whose methods are hooked, and those left unhooked.
_tools: weakref.WeakSet[Any] = weakref.WeakSet()
_refused_tools: weakref.WeakSet[Any] = weakref.WeakSet()


def get_tools_hook(
    wrapped: Any, instance: Any, args: tuple[Any, ...], kwargs: dict[str, Any]
) -> Any:
    """Hooks the toolset's `get_tools`: it hooks the tool it returns."""
    awaitable = wrapped(*args, **kwargs)
    if state.current() is None:
        return awaitable

    async def returned() -> Any:
        tools = await awaitable
        _safely("the get_tools hook", lambda: hook_tools(tools))
        return tools

    return returned()


def hook_tools(tools: Any) -> None:
    """Hooks `run_async` and `process_llm_request` on the toolset's tool."""
    for tool in tools if isinstance(tools, list) else []:
        if (
            getattr(tool, "name", None) != events.TOOL_NAME
            or tool in _tools
            or tool in _refused_tools
        ):
            continue
        missing = next(
            (name for name in TOOL_METHODS if not callable(getattr(tool, name, None))),
            None,
        )
        if missing is not None:
            _refused_tools.add(tool)
            log.logger.warning(
                "a2ui-spectra-instrumentation left the %s tool unhooked: it has no %s",
                events.TOOL_NAME,
                missing,
            )
            continue
        wrapt.wrap_function_wrapper(tool, "run_async", run_async_hook)
        wrapt.wrap_function_wrapper(
            tool, "process_llm_request", process_llm_request_hook
        )
        _tools.add(tool)


def unhook_tools() -> None:
    """Removes the hooks on the toolset's tools, and forgets the tools."""
    for tool in list(_tools):
        for name in TOOL_METHODS:
            vars(tool).pop(name, None)
    _tools.clear()
    _refused_tools.clear()


_WRAPT_FOLDER = os.path.dirname(os.path.abspath(wrapt.__file__))


def _frames_the_hook_adds(hook_frame: types.FrameType | None) -> int:
    """How many frames stand between a hooked logger method and its caller.

    The hook's own, and wrapt's when wrapt runs without its C extension.
    """
    added = 1
    frame = hook_frame.f_back if hook_frame is not None else None
    while frame is not None and os.path.abspath(frame.f_code.co_filename).startswith(
        _WRAPT_FOLDER
    ):
        added += 1
        frame = frame.f_back
    return added


def error_line_hook(
    wrapped: Any, instance: Any, args: tuple[Any, ...], kwargs: dict[str, Any]
) -> Any:
    """Hooks `error` on the toolset module's logger: the error the tool swallows.

    The tool catches every error of its call and calls the logger's `error`
    while it handles it, the one place it shows the error. In a tool call's
    event the hook records that error, belonging to no block, unless an inner
    call's hook recorded it already. It is a hook on the method and not a
    logging filter, so that the agent's logging setup, a level or a disabled
    logger, does not decide whether the error is recorded, and no other line of
    the module reaches it. The line is written as without the hook, at the
    place the tool wrote it.
    """

    hook_frame = inspect.currentframe()

    def count_out_the_hook() -> None:
        # The logger finds the line's place by counting frames up from itself.
        kwargs["stacklevel"] = kwargs.get("stacklevel", 1) + _frames_the_hook_adds(
            hook_frame
        )

    where = "the toolset's error line hook"
    _safely(where, lambda: swallowed(sys.exc_info()[1]))
    _safely(where, count_out_the_hook)
    return wrapped(*args, **kwargs)


def swallowed(error: BaseException | None) -> None:
    """Records an error the toolset's tool swallowed, in its call's event."""
    open_event = events.current() if state.current() is not None else None
    if (
        isinstance(error, Exception)
        and isinstance(open_event, events.ParseEvent)
        and open_event.entry_point == "tool_call"
        and open_event.depth == 0
        and not open_event.ended
    ):
        open_event.record(error, placed=False)


def run_async_hook(
    wrapped: Any, instance: Any, args: tuple[Any, ...], kwargs: dict[str, Any]
) -> Any:
    """Hooks the tool's `run_async`: an outermost call is one `parse`."""
    awaitable = wrapped(*args, **kwargs)
    active = state.current()
    if active is None:
        return awaitable
    return _run_tool(active, awaitable, wrapped, args, kwargs)


async def _run_tool(
    active: state.Active,
    awaitable: Awaitable[Any],
    wrapped: Any,
    args: tuple[Any, ...],
    kwargs: dict[str, Any],
) -> Any:
    """The tool's call is one `parse`, its input the `a2ui_payload` argument."""
    where = "the run_async hook"
    if events.current() is not None:
        return await awaitable
    try:
        arguments = _arguments(wrapped, args, kwargs)
        tool_args = arguments.get("args")
        payload = (
            tool_args.get("a2ui_payload") if isinstance(tool_args, Mapping) else None
        )
        event = events.ParseEvent(active, "tool_call", payload)
        event.tool_name = events.TOOL_NAME
        call_id = getattr(arguments.get("tool_context"), "function_call_id", None)
        if isinstance(call_id, str) and call_id:
            event.call_id = call_id
    except Exception as fault:
        log.report_fault(where, fault)
        return await _await_unrecorded(awaitable)
    return await _outermost_awaited(event, awaitable, where, event.take_tool_result)


def process_llm_request_hook(
    wrapped: Any, instance: Any, args: tuple[Any, ...], kwargs: dict[str, Any]
) -> Any:
    """Hooks the tool's `process_llm_request`: one `prompt_generation`.

    It records what the tool appends to the instructions.
    """
    awaitable = wrapped(*args, **kwargs)
    active = state.current()
    if active is None:
        return awaitable
    return _append_prompt(active, awaitable, wrapped, instance, args, kwargs)


def _system_text(llm_request: Any) -> str | None:
    """The request's system instruction, when it is text."""
    instruction = getattr(
        getattr(llm_request, "config", None), "system_instruction", None
    )
    if instruction is None:
        return ""
    return instruction if isinstance(instruction, str) else None


def _adopt_processor(event: events.Event, processor: Any) -> None:
    """Adopts the format and catalogs of a processor's prompt generator.

    What is no processor, such as a provider of one, gives the event nothing.
    """
    generator = getattr(getattr(processor, "format", None), "prompt_generator", None)
    active = state.current()
    if generator is not None and active is not None:
        event.adopt_generator(generator, active.generator_format(generator))


def resolve_processor_hook(
    wrapped: Any, instance: Any, args: tuple[Any, ...], kwargs: dict[str, Any]
) -> Any:
    """Hooks the toolset's `_resolve_processor`: the processor of one call.

    The open event adopts its format and catalogs. A tool may hold a provider
    of processors, which names neither.
    """
    awaitable = wrapped(*args, **kwargs)
    open_event = events.current() if state.current() is not None else None
    if open_event is None:
        return awaitable

    async def resolved() -> Any:
        processor = await awaitable
        _safely(
            "the _resolve_processor hook",
            lambda: _adopt_processor(open_event, processor),
        )
        return processor

    return resolved()


async def _append_prompt(
    active: state.Active,
    awaitable: Awaitable[Any],
    wrapped: Any,
    tool: Any,
    args: tuple[Any, ...],
    kwargs: dict[str, Any],
) -> Any:
    """What the tool appends to the instructions is one `prompt_generation`."""
    where = "the process_llm_request hook"
    if events.current() is not None:
        return await awaitable
    try:
        llm_request = _arguments(wrapped, args, kwargs).get("llm_request")
        before = _system_text(llm_request)
        event = events.PromptEvent(active)
        event.tool_name = events.TOOL_NAME
    except Exception as fault:
        log.report_fault(where, fault)
        return await _await_unrecorded(awaitable)

    # The processor the call resolved is adopted as it resolves. A call that
    # failed before that falls back on what the tool holds, when it is one.
    held = getattr(tool, "_processor", None)

    def failed(error: Exception) -> None:
        _adopt_processor(event, held)
        event.fail(error)

    def appended(_: Any) -> None:
        _adopt_processor(event, held)
        after = _system_text(llm_request)
        section = None
        if before is not None and after is not None and after.startswith(before):
            section = after[len(before) :]
            if before and section.startswith("\n\n"):
                section = section[2:]
        if section:
            event.take_section(section)
        else:
            event.abandon("the toolset appended no text to the instructions")

    return await _outermost_awaited(event, awaitable, where, appended, failed)


def wrapper_for(hook: Hook) -> Wrapper:
    """The hook a hooked name gets."""
    if hook.role == "parse_response":
        return parse_response_hook
    if hook.role == "compile":
        return compile_hook_for(hook.format)
    if hook.role == "open_stream":
        return open_stream_hook_for(hook.format)
    if hook.role == "feed":
        return feed_hook
    if hook.role == "close":
        return close_hook
    if hook.role == "generate":
        return generate_hook
    if hook.role == "whole_tree":
        return whole_tree_hook
    if hook.role == "apply":
        return apply_hook
    if hook.role == "get_tools":
        return get_tools_hook
    if hook.role == "resolve_processor":
        return resolve_processor_hook
    raise ValueError(f"No hook for the role {hook.role}")
