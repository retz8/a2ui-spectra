"""One event per outermost call, the block an error belongs to, and arguments by keyword."""

from __future__ import annotations

import asyncio
from types import SimpleNamespace
from typing import Any

import pytest
from a2ui.adk import SendA2uiToClientToolset
from a2ui.core import A2uiError
from a2ui.processor import A2uiRequestProcessor
from google.adk.models.llm_request import LlmRequest
from google.genai import types

BASIC_V1_0 = "https://a2ui.org/specification/v1_0/catalogs/basic/catalog.json"
# A stand-in for ADK's readonly context, of which the toolset reads nothing.
STAND_IN: Any = SimpleNamespace()
CARD = 'surface("card")\nroot = Text("Xi\'an Famous Foods")'
CARD_TEXT = f"Here is the card.\n<a2ui>\n{CARD}\n</a2ui>\n"
UNKNOWN = 'surface("other")\nroot = Heading("Booking")'


def json_block(
    surface: str, component: str = '{"id": "root", "component": "Text", "text": "Hi"}'
) -> str:
    return (
        '[{"version": "1.0", "createSurface": {"surfaceId": "'
        + surface
        + '", "catalogId": "'
        + BASIC_V1_0
        + '", "components": ['
        + component
        + "]}}]"
    )


def tool_of(processor: A2uiRequestProcessor) -> Any:
    toolset = SendA2uiToClientToolset(a2ui_enabled=True, a2ui_processor=processor)
    tools = asyncio.run(toolset.get_tools(STAND_IN))
    return next(tool for tool in tools if tool.name == "send_a2ui_json_to_client")


def run_tool(tool: Any, payload: str) -> Any:
    context: Any = SimpleNamespace(actions=SimpleNamespace(skip_summarization=False))
    return asyncio.run(
        tool.run_async(args={"a2ui_payload": payload}, tool_context=context)
    )


# One event per outermost call.


@pytest.mark.xfail(
    reason=(
        "Sub-task 9.5, at the pin: the agent SDK lacks names the hook table patches, so"
        " the wrapper leaves it unpatched"
    ),
    strict=True,
)
def test_the_processors_parse_response_is_one_parse(spans: Any, processor: Any) -> None:
    processor().parse_response(CARD_TEXT)

    span = spans.one()
    assert span.name == "parse"
    attributes = spans.attributes(span)
    assert attributes["a2ui.event.kind"] == "parse"
    assert attributes["a2ui.parse.entry_point"] == "parse_response"
    assert attributes["a2ui.parse.input"] == CARD_TEXT
    assert attributes["a2ui.parse.inference_format"] == "express"
    assert spans.parsed(span, "a2ui.parse.catalogs") == [
        {"catalogId": BASIC_V1_0, "protocolVersion": "v1.0"}
    ]
    assert [
        message["createSurface"]["surfaceId"]
        for message in spans.parsed(span, "a2ui.parse.messages")
    ] == ["card"]
    assert attributes["a2ui.sdk.name"] == "a2ui-agent-sdk"
    assert "a2ui.parse.wrapped" not in attributes
    assert "a2ui.parse.streamed" not in attributes
    assert span.instrumentation_scope is not None
    assert span.instrumentation_scope.name == "a2ui-spectra-instrumentation"
    assert span.instrumentation_scope.version == "0.0.1"


@pytest.mark.xfail(
    reason=(
        "Sub-task 9.5, at the pin: the agent SDK lacks names the hook table patches, so"
        " the wrapper leaves it unpatched"
    ),
    strict=True,
)
def test_the_a2a_path_calling_the_parser_directly_is_one_parse(
    spans: Any, processor: Any
) -> None:
    processor().parser.parse_response(CARD_TEXT)

    assert spans.attributes(spans.one())["a2ui.parse.entry_point"] == "parse_response"


@pytest.mark.xfail(
    reason=(
        "Sub-task 9.5, at the pin: the agent SDK lacks names the hook table patches, so"
        " the wrapper leaves it unpatched"
    ),
    strict=True,
)
def test_an_unwrapped_parse_says_so(spans: Any, processor: Any) -> None:
    processor().parse_response(CARD, False)

    attributes = spans.attributes(spans.one())
    assert attributes["a2ui.parse.wrapped"] is False
    assert attributes["a2ui.parse.input"] == CARD


@pytest.mark.xfail(
    reason=(
        "Sub-task 9.5, at the pin: the agent SDK lacks names the hook table patches, so"
        " the wrapper leaves it unpatched"
    ),
    strict=True,
)
def test_compile_on_its_own_is_one_parse(spans: Any, processor: Any) -> None:
    processor().parser.compile(CARD)

    span = spans.one()
    assert spans.attributes(span)["a2ui.parse.entry_point"] == "compile"
    assert len(spans.parsed(span, "a2ui.parse.messages")) == 1


@pytest.mark.xfail(
    reason=(
        "Sub-task 9.5, at the pin: the agent SDK lacks names the hook table patches, so"
        " the wrapper leaves it unpatched"
    ),
    strict=True,
)
def test_the_processors_prompt_is_one_prompt_generation(
    spans: Any, processor: Any
) -> None:
    section = processor().prompt_snippet

    span = spans.one()
    assert span.name == "prompt_generation"
    attributes = spans.attributes(span)
    assert attributes["a2ui.prompt.ui_section"] == section
    assert attributes["a2ui.prompt.inference_format"] == "express"
    assert "gen_ai.tool.name" not in attributes


@pytest.mark.xfail(
    reason=(
        "Sub-task 9.5, at the pin: the agent SDK lacks names the hook table patches, so"
        " the wrapper leaves it unpatched"
    ),
    strict=True,
)
def test_a_stream_is_one_parse(spans: Any, processor: Any) -> None:
    stream = processor().open_stream()
    for chunk in (CARD_TEXT[:20], CARD_TEXT[20:]):
        stream.feed(chunk)
    stream.close()

    span = spans.one()
    attributes = spans.attributes(span)
    assert attributes["a2ui.parse.entry_point"] == "open_stream"
    assert attributes["a2ui.parse.streamed"] is True
    assert attributes["a2ui.parse.input"] == CARD_TEXT
    assert [event.attributes["a2ui.parse.chunk.end"] for event in span.events] == [
        20,
        len(CARD_TEXT),
    ]


@pytest.mark.xfail(
    reason=(
        "Sub-task 9.5, at the pin: the agent SDK lacks names the hook table patches, so"
        " the wrapper leaves it unpatched"
    ),
    strict=True,
)
def test_the_tool_call_with_a_bound_state_is_one_parse(
    spans: Any, processor: Any
) -> None:
    result = run_tool(tool_of(processor(state=True)), CARD)

    span = spans.one()
    attributes = spans.attributes(span)
    assert attributes["a2ui.parse.entry_point"] == "tool_call"
    assert attributes["a2ui.parse.input"] == CARD
    assert attributes["gen_ai.tool.name"] == "send_a2ui_json_to_client"
    assert "gen_ai.tool.call.id" not in attributes
    assert spans.parsed(span, "gen_ai.tool.call.result") == result
    assert spans.parsed(span, "a2ui.parse.messages") == result["validated_a2ui_json"]


@pytest.mark.xfail(
    reason=(
        "Sub-task 9.5, at the pin: the agent SDK lacks names the hook table patches, so"
        " the wrapper leaves it unpatched"
    ),
    strict=True,
)
def test_the_tool_call_names_the_call_id_its_context_gives(
    spans: Any, processor: Any
) -> None:
    tool = tool_of(processor())
    context: Any = SimpleNamespace(
        function_call_id="call-1", actions=SimpleNamespace(skip_summarization=False)
    )
    asyncio.run(tool.run_async(args={"a2ui_payload": CARD}, tool_context=context))

    assert spans.attributes(spans.one())["gen_ai.tool.call.id"] == "call-1"


@pytest.mark.xfail(
    reason=(
        "Sub-task 9.5, at the pin: the agent SDK lacks names the hook table patches, so"
        " the wrapper leaves it unpatched"
    ),
    strict=True,
)
def test_the_toolsets_appended_prompt_is_one_prompt_generation(
    spans: Any, processor: Any
) -> None:
    tool = tool_of(processor())
    request = LlmRequest(
        config=types.GenerateContentConfig(system_instruction="You are an agent.")
    )
    asyncio.run(
        tool.process_llm_request(tool_context=SimpleNamespace(), llm_request=request)
    )

    span = spans.one()
    attributes = spans.attributes(span)
    instruction = request.config.system_instruction
    assert isinstance(instruction, str)
    assert attributes["a2ui.prompt.ui_section"] == instruction.removeprefix(
        "You are an agent.\n\n"
    )
    assert attributes["a2ui.prompt.ui_section"].endswith(
        "argument instead of writing the block in your reply."
    )
    assert attributes["gen_ai.tool.name"] == "send_a2ui_json_to_client"
    assert attributes["a2ui.prompt.inference_format"] == "express"


@pytest.mark.xfail(
    reason=(
        "Sub-task 9.5, at the pin: the agent SDK lacks names the hook table patches, so"
        " the wrapper leaves it unpatched"
    ),
    strict=True,
)
def test_the_toolsets_prompt_without_instructions_reads_the_processors_format(
    spans: Any, processor: Any
) -> None:
    tool = tool_of(processor("direct_json"))
    request = LlmRequest()
    asyncio.run(
        tool.process_llm_request(tool_context=SimpleNamespace(), llm_request=request)
    )

    attributes = spans.attributes(spans.one())
    assert attributes["a2ui.prompt.ui_section"] == request.config.system_instruction
    assert attributes["a2ui.prompt.inference_format"] == "direct_json"


# The block an error belongs to.


@pytest.mark.xfail(
    reason=(
        "Sub-task 9.5, at the pin: the agent SDK lacks names the hook table patches, so"
        " the wrapper leaves it unpatched"
    ),
    strict=True,
)
def test_a_rejected_block_is_the_block_being_compiled(
    spans: Any, processor: Any, support: Any
) -> None:
    text = f"First.\n<a2ui>\n{CARD}\n</a2ui>\nSecond.\n<a2ui>\n{UNKNOWN}\n</a2ui>\n"
    with pytest.raises(A2uiError):
        processor().parse_response(text)

    span = spans.one()
    [error] = spans.exceptions(span)
    assert (
        error["a2ui.parse.block.start"],
        error["a2ui.parse.block.end"],
    ) == support.block_range(text, UNKNOWN)
    assert error["exception.type"] == "A2uiCompilationValidationError"
    assert error["exception.stacktrace"]
    attributes = spans.attributes(span)
    assert attributes["error.type"] == "A2uiCompilationValidationError"
    assert span.status.description == error["exception.message"]
    assert [
        message["createSurface"]["surfaceId"]
        for message in spans.parsed(span, "a2ui.parse.messages")
    ] == ["card"]


@pytest.mark.xfail(
    reason=(
        "Sub-task 9.5, at the pin: the agent SDK lacks names the hook table patches, so"
        " the wrapper leaves it unpatched"
    ),
    strict=True,
)
def test_ranges_count_utf16_code_units(
    spans: Any, processor: Any, support: Any
) -> None:
    text = f"Here 🍜 is the card.\n<a2ui>\n{UNKNOWN}\n</a2ui>\n"
    with pytest.raises(A2uiError):
        processor().parse_response(text)

    [error] = spans.exceptions(spans.one())
    start, end = support.block_range(text, UNKNOWN)
    assert start == text.index(UNKNOWN) + 1
    assert (error["a2ui.parse.block.start"], error["a2ui.parse.block.end"]) == (
        start,
        end,
    )


@pytest.mark.xfail(
    reason=(
        "Sub-task 9.5, at the pin: the agent SDK lacks names the hook table patches, so"
        " the wrapper leaves it unpatched"
    ),
    strict=True,
)
def test_an_error_applying_a_blocks_messages_is_that_blocks(
    spans: Any, processor: Any, support: Any
) -> None:
    block = json_block("default")
    text = f"<a2ui-json>\n{block}\n</a2ui-json>\nAgain.\n<a2ui-json>\n{block}\n</a2ui-json>\n"
    with pytest.raises(A2uiError, match="already exists"):
        processor("direct_json").parse_response(text)

    [error] = spans.exceptions(spans.one())
    second = support.block_range(text, block, text.index(block) + 1)
    assert (error["a2ui.parse.block.start"], error["a2ui.parse.block.end"]) == second


@pytest.mark.xfail(
    reason=(
        "Sub-task 9.5, at the pin: the agent SDK lacks names the hook table patches, so"
        " the wrapper leaves it unpatched"
    ),
    strict=True,
)
def test_an_error_of_the_tree_check_belongs_to_no_block(
    spans: Any, processor: Any
) -> None:
    block = json_block(
        "card", '{"id": "root", "component": "Column", "children": ["missing"]}'
    )
    with pytest.raises(A2uiError, match="missing"):
        processor("direct_json").parse_response(f"<a2ui-json>\n{block}\n</a2ui-json>\n")

    [error] = spans.exceptions(spans.one())
    assert error["exception.type"] == "A2uiIntegrityError"
    assert "a2ui.parse.block.start" not in error


@pytest.mark.xfail(
    reason=(
        "Sub-task 9.5, at the pin: the agent SDK lacks names the hook table patches, so"
        " the wrapper leaves it unpatched"
    ),
    strict=True,
)
def test_the_toolsets_whole_payload_check_belongs_to_no_block(
    spans: Any, processor: Any
) -> None:
    payload = (
        '[{"version": "v0.9", "createSurface": {"surfaceId": "s", "catalogId":'
        ' "inline_catalog"}}]'
    )
    result = run_tool(tool_of(processor("direct_json", "0.9")), payload)

    span = spans.one()
    [error] = spans.exceptions(span)
    assert error["exception.message"] == "Catalog not found: inline_catalog"
    assert "a2ui.parse.block.start" not in error
    assert spans.parsed(span, "gen_ai.tool.call.result") == result
    assert "error" in result
    assert spans.parsed(span, "a2ui.parse.messages") == []


@pytest.mark.xfail(
    reason=(
        "Sub-task 9.5, at the pin: the agent SDK lacks names the hook table patches, so"
        " the wrapper leaves it unpatched"
    ),
    strict=True,
)
def test_the_toolsets_compile_error_is_its_block(
    spans: Any, processor: Any, support: Any
) -> None:
    payload = f"<a2ui>\n{UNKNOWN}\n</a2ui>"
    run_tool(tool_of(processor()), payload)

    [error] = spans.exceptions(spans.one())
    assert (
        error["a2ui.parse.block.start"],
        error["a2ui.parse.block.end"],
    ) == support.block_range(payload, UNKNOWN)


@pytest.mark.xfail(
    reason=(
        "Sub-task 9.5, at the pin: the agent SDK lacks names the hook table patches, so"
        " the wrapper leaves it unpatched"
    ),
    strict=True,
)
def test_a_streams_error_after_a_finished_block_is_its_own(
    spans: Any, processor: Any, support: Any
) -> None:
    text = f"<a2ui>\n{CARD}\n</a2ui>\nThen.\n<a2ui>\n{UNKNOWN}\n</a2ui>\n"
    stream = processor().open_stream()
    with pytest.raises(A2uiError):
        stream.feed(text)

    [error] = spans.exceptions(spans.one())
    assert (
        error["a2ui.parse.block.start"],
        error["a2ui.parse.block.end"],
    ) == support.block_range(text, UNKNOWN)


@pytest.mark.xfail(
    reason=(
        "Sub-task 9.5, at the pin: the agent SDK lacks names the hook table patches, so"
        " the wrapper leaves it unpatched"
    ),
    strict=True,
)
@pytest.mark.parametrize("mode", ["end", "continue"])
def test_a_streams_error_is_the_block_it_rejected_though_the_chunk_runs_on(
    mode: str, spans: Any, processor: Any, support: Any
) -> None:
    text = f"<a2ui>\n{UNKNOWN}\n</a2ui>\nThen.\n<a2ui>\n{CARD}\n</a2ui>\n"
    cut = text.index(CARD) + 5
    stream = processor().open_stream(after_rejected_block=mode)
    try:
        stream.feed(text[:cut])
        stream.feed(text[cut:])
        stream.close()
    except A2uiError:
        assert mode == "end"

    [error] = spans.exceptions(spans.one())
    assert (
        error["a2ui.parse.block.start"],
        error["a2ui.parse.block.end"],
    ) == support.block_range(text, UNKNOWN)


@pytest.mark.xfail(
    reason=(
        "Sub-task 9.5, at the pin: the agent SDK lacks names the hook table patches, so"
        " the wrapper leaves it unpatched"
    ),
    strict=True,
)
def test_a_direct_json_streams_error_is_counted_past_the_blocks_it_finished(
    spans: Any, processor: Any, support: Any
) -> None:
    rejected = json_block("b", '{"id": "root", "component": "Heading", "text": "Hi"}')
    text = "".join(
        f"Block.\n<a2ui-json>\n{block}\n</a2ui-json>\n"
        for block in (json_block("a"), rejected, json_block("c"))
    )
    stream = processor("direct_json").open_stream(after_rejected_block="continue")
    stream.feed(text)
    stream.close()

    span = spans.one()
    [error] = spans.exceptions(span)
    assert (
        error["a2ui.parse.block.start"],
        error["a2ui.parse.block.end"],
    ) == support.block_range(text, rejected)
    assert [
        message["createSurface"]["surfaceId"]
        for message in spans.parsed(span, "a2ui.parse.messages")
    ] == ["a", "c"]


@pytest.mark.xfail(
    reason=(
        "Sub-task 9.5, at the pin: the agent SDK lacks names the hook table patches, so"
        " the wrapper leaves it unpatched"
    ),
    strict=True,
)
@pytest.mark.parametrize(
    ("fmt", "payload", "error_type"),
    [
        ("direct_json", "[]", "A2uiParseError"),
        ("express", "", "A2uiValidationError"),
    ],
    ids=["no messages", "no payload"],
)
def test_an_error_the_tool_raises_itself_is_recorded_with_no_block(
    fmt: str, payload: str, error_type: str, spans: Any, processor: Any
) -> None:
    result = run_tool(tool_of(processor(fmt)), payload)

    span = spans.one()
    [error] = spans.exceptions(span)
    assert error["exception.type"] == error_type
    assert error["exception.stacktrace"]
    assert "a2ui.parse.block.start" not in error
    assert result["error"].endswith(error["exception.message"])
    assert spans.attributes(span)["error.type"] == error_type
    assert span.status.description == error["exception.message"]
    assert spans.parsed(span, "gen_ai.tool.call.result") == result


# Arguments passed by keyword.


@pytest.mark.xfail(
    reason=(
        "Sub-task 9.5, at the pin: the agent SDK lacks names the hook table patches, so"
        " the wrapper leaves it unpatched"
    ),
    strict=True,
)
def test_arguments_by_keyword(spans: Any, processor: Any) -> None:
    parser = processor().parser
    parser.parse_response(content=CARD, wrapped=False)
    parser.compile(format_content=CARD, is_final=True)
    stream = parser.open_stream(wrapped=False)
    stream.feed(chunk=CARD)
    stream.close()

    first, second, third = spans.all()
    assert spans.attributes(first)["a2ui.parse.input"] == CARD
    assert spans.attributes(first)["a2ui.parse.wrapped"] is False
    assert spans.attributes(second)["a2ui.parse.input"] == CARD
    assert spans.attributes(third)["a2ui.parse.input"] == CARD
    assert spans.attributes(third)["a2ui.parse.wrapped"] is False
