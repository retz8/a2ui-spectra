"""The facts a wrapper capture case's expected record states, read off the agent SDK for Python.

Runs one case's job, under conformance/wrapper_capture/, on the agent SDK at the pin, upstream main
`0888f88b2`, calling its public entry points as a driver does, and prints the facts as JSON: the
section the prompt generator wrote, or the messages the parse produced, before an error included;
each error's class, message and details, and the block it belongs to; and, for the toolset, the
object the tool returned. `write_wrapper_capture_records.py` runs it and assembles the records. It
shares no code with Spectra. From the repository root, in a Python 3.12 environment holding the SDK
and `a2ui-adk`, such as the repository's own:

    .venv/bin/python -I _dev/tools/wrapper_capture_facts.py \\
        conformance/test_data/wrapper_capture/v0_1/<case>/input.json

An error belongs to the block that was being compiled, or whose messages were being applied, when it
was raised, and its range is where that block's text, as the SDK's parser unwraps it, sits in the
input. An error raised after every block, by the tree check or by the toolset's validation of the
whole payload, belongs to no block.
"""

import asyncio
import importlib.metadata
import json
import sys
import traceback
import warnings
from pathlib import Path
from types import SimpleNamespace

from a2ui.core import A2uiError
from a2ui.core.basic_catalog import BasicCatalog
from a2ui.inference_formats import (
    AtomFormatFactory,
    DirectJsonFormatFactory,
    ElementalFormatFactory,
    ExpressFormatFactory,
    to_message_dicts,
)
from a2ui.parser import A2uiPart, ErrorPart, RawA2uiPart
from a2ui.processor import A2uiRequestProcessor, CatalogConfig

warnings.simplefilter("ignore")

FACTORIES = {
    "direct_json": DirectJsonFormatFactory,
    "express": ExpressFormatFactory,
    "elemental": ElementalFormatFactory,
    "atom": AtomFormatFactory,
}
CONFORMANCE = Path(__file__).resolve().parents[2] / "conformance"
# The functions that check every block at once, after each block is applied.
AFTER_EVERY_BLOCK = {"check_topology", "validate_payload"}


def utf16(text: str) -> int:
    return len(text.encode("utf-16-le")) // 2


def catalogs_of(job: dict) -> list:
    catalogs = []
    for catalog in job["catalogs"]:
        version = catalog["protocolVersion"].removeprefix("v")
        if "path" in catalog:
            catalogs.append(
                CatalogConfig.from_path(
                    str(CONFORMANCE / catalog["path"]), protocol_version=version
                ).catalog
            )
        else:
            catalogs.append(BasicCatalog(version))
    return catalogs


def processor_of(job: dict, state: bool = False) -> A2uiRequestProcessor:
    catalogs = catalogs_of(job)
    processor = A2uiRequestProcessor(
        catalogs, format_factory=FACTORIES[job["inferenceFormat"]]()
    )
    if state:
        processor = A2uiRequestProcessor(
            catalogs,
            format_factory=FACTORIES[job["inferenceFormat"]](),
            state=processor.create_state(),
        )
    return processor


def blocks_of(processor: A2uiRequestProcessor, text: str, wrapped: bool) -> list[list[int]]:
    """Each block's range in the text, as the parser unwraps it, in order."""
    if not wrapped:
        return [[0, utf16(text)]]
    ranges = []
    cursor = 0
    for raw in processor.parser.unwrap(text):
        if not isinstance(raw.part, RawA2uiPart):
            continue
        start = text.find(raw.part.a2ui_raw, cursor)
        if start < 0:
            raise SystemExit(f"A block's text is not in the input: {raw.part.a2ui_raw[:60]!r}")
        cursor = start + len(raw.part.a2ui_raw)
        ranges.append([utf16(text[:start]), utf16(text[:cursor])])
    return ranges


def after_every_block(error: BaseException) -> bool:
    return any(
        frame.name in AFTER_EVERY_BLOCK for frame in traceback.extract_tb(error.__traceback__)
    )


def error_fact(error: BaseException, block: list[int] | None) -> dict:
    details = [detail.to_dict() for detail in getattr(error, "details", None) or []]
    return {
        "type": type(error).__name__,
        "message": str(error),
        **({"details": details} if details else {}),
        **({"block": block} if block is not None and not after_every_block(error) else {}),
    }


def messages_of(parts) -> list:
    return [
        message
        for part in parts
        if isinstance(part, A2uiPart)
        for message in to_message_dicts(part.a2ui)
    ]


def generate(job: dict) -> dict:
    processor = processor_of(job)
    try:
        return {"section": processor.prompt_snippet}
    except A2uiError as error:
        return {"errors": [error_fact(error, None)]}


def parse_response(job: dict, text: str) -> dict:
    processor = processor_of(job)
    wrapped = job.get("wrapped", True)
    try:
        parts = processor.parse_response(text, wrapped)
    except A2uiError as error:
        partial = getattr(error, "partial_results", [])
        failing = sum(isinstance(part, A2uiPart) for part in partial)
        blocks = blocks_of(processor, text, wrapped)
        block = blocks[failing] if failing < len(blocks) else None
        return {"messages": messages_of(partial), "errors": [error_fact(error, block)]}
    return {"messages": messages_of(parts), "errors": []}


def open_stream(job: dict, text: str, ends: list[int]) -> dict:
    """Feeds the chunks in order, stopping at the first that raises, and closes the stream unless one did."""
    processor = processor_of(job)
    wrapped = job.get("wrapped", True)
    stream = processor.open_stream(
        wrapped=wrapped, after_rejected_block=job.get("afterRejectedBlock", "end")
    )
    messages: list = []
    raised: list = []
    fed = 0

    def take(parts, chunk: int | None) -> None:
        for part in parts:
            if isinstance(part, A2uiPart):
                messages.extend(to_message_dicts(part.a2ui))
            elif isinstance(part, ErrorPart):
                raised.append((part.error, chunk))

    def facts(closed: bool) -> dict:
        blocks = stream_error_blocks(job, text, wrapped)
        if len(blocks) != len(raised):
            raise SystemExit(
                f"Fed one character at a time, the stream raised {len(blocks)} errors,"
                f" not {len(raised)}"
            )
        errors = [
            {**error_fact(error, block), "chunk": chunk}
            for (error, chunk), block in zip(raised, blocks)
        ]
        return {"messages": messages, "errors": errors, "fed": fed, "closed": closed}

    start = 0
    for end in ends:
        fed += 1
        try:
            take(stream.feed(text_slice(text, start, end)), fed - 1)
        except A2uiError as error:
            take(getattr(error, "partial_results", []), fed - 1)
            raised.append((error, fed - 1))
            return facts(closed=False)
        start = end
    try:
        take(stream.close(), None)
    except A2uiError as error:
        take(getattr(error, "partial_results", []), None)
        raised.append((error, None))
    return facts(closed=True)


def stream_error_blocks(job: dict, text: str, wrapped: bool) -> list:
    """The block of each error the stream raises or reads past, in order.

    The text is fed one character at a time: when an error comes, the text fed
    ends inside the block it belongs to, or at that block's closing tag, so the
    block is the last one opened by then.
    """
    processor = processor_of(job)
    stream = processor.open_stream(
        wrapped=wrapped, after_rejected_block=job.get("afterRejectedBlock", "end")
    )
    blocks = open_blocks(processor, job["inferenceFormat"], text, wrapped)

    def block_at(position: int) -> list[int] | None:
        opened = [block for block in blocks if block[0] <= position]
        return opened[-1] if opened else None

    found: list = []
    position = 0
    for character in text:
        position += utf16(character)
        try:
            parts = stream.feed(character)
        except A2uiError:
            return [*found, block_at(position)]
        found.extend(block_at(position) for part in parts if isinstance(part, ErrorPart))
    try:
        parts = stream.close()
    except A2uiError:
        return [*found, block_at(position)]
    return [*found, *(block_at(position) for part in parts if isinstance(part, ErrorPart))]


def text_slice(text: str, start: int, end: int) -> str:
    """The text between two UTF-16 offsets."""
    encoded = text.encode("utf-16-le")
    return encoded[start * 2 : end * 2].decode("utf-16-le")


TAGS = {"direct_json": "<a2ui-json>"}


def open_blocks(
    processor: A2uiRequestProcessor, format_name: str, text: str, wrapped: bool
) -> list[list[int]]:
    """Each block's range, a block whose closing tag never came running to the end of the text."""
    if not wrapped:
        return [[0, utf16(text)]]
    closed = blocks_of(processor, text, wrapped)
    tag = TAGS.get(format_name, "<a2ui>")
    openings = []
    cursor = 0
    while (found := text.find(tag, cursor)) >= 0:
        cursor = found + len(tag)
        openings.append(utf16(text[:cursor]))
    if len(openings) > len(closed):
        closed.append([openings[len(closed)], utf16(text)])
    return closed


def compile_block(job: dict, text: str) -> dict:
    processor = processor_of(job)
    try:
        messages = to_message_dicts(processor.parser.compile(text))
    except A2uiError as error:
        return {"messages": [], "errors": [error_fact(error, [0, utf16(text)])]}
    return {"messages": messages, "errors": []}


def tool_call(job: dict, payload: str) -> dict:
    """Runs the toolset's tool on the payload, and takes every error it swallows.

    The tool logs each error it swallows while it handles it; a stand-in for the
    toolset module's logger reads that error then. An error belongs to the block
    that was being compiled, or whose messages were being applied, when it was
    raised, read off the traceback; one the tool raised itself belongs to none.
    """
    from a2ui.adk import SendA2uiToClientToolset
    from a2ui.adk import send_a2ui_to_client_toolset as toolset_module

    processor = processor_of(job, state=job.get("rendererState", False))
    toolset = SendA2uiToClientToolset(a2ui_enabled=True, a2ui_processor=processor)
    tool = toolset._ui_tool
    swallowed: list[BaseException] = []
    logger = toolset_module.logger

    class Recording:
        def error(self, *args, **kwargs):
            error = sys.exc_info()[1]
            if error is not None:
                swallowed.append(error)
            return logger.error(*args, **kwargs)

        def __getattr__(self, name):
            return getattr(logger, name)

    toolset_module.logger = Recording()
    try:
        context = SimpleNamespace(actions=SimpleNamespace(skip_summarization=False))
        result = asyncio.run(
            tool.run_async(args={"a2ui_payload": payload}, tool_context=context)
        )
    finally:
        toolset_module.logger = logger
    errors = [error_fact(error, compiled_block(error, payload)) for error in swallowed]
    messages = result.get("validated_a2ui_json", []) if isinstance(result, dict) else []
    return {"messages": messages, "errors": errors, "toolResult": result}


def compiled_block(error: BaseException, payload: str) -> list[int] | None:
    """The range of the block being compiled or applied when the error was raised, if one was."""
    tb = error.__traceback__
    while tb is not None:
        frame = tb.tb_frame
        text = frame.f_locals.get("format_content")
        if frame.f_code.co_name in ("compile", "_apply_block") and isinstance(text, str):
            for block in (text, text.strip()):
                start = payload.find(block)
                if block and start >= 0:
                    return [utf16(payload[:start]), utf16(payload[: start + len(block)])]
            return None
        tb = tb.tb_next
    return None


def main() -> None:
    job_path = Path(sys.argv[1])
    job = json.loads(job_path.read_text())
    text = (job_path.parent / job["text"]).read_text() if "text" in job else None
    entry = job["entryPoint"]
    if entry == "generate":
        facts = generate(job)
    elif entry == "parse_response":
        facts = parse_response(job, text)
    elif entry == "open_stream":
        ends = json.loads((job_path.parent / job["chunks"]).read_text())
        facts = open_stream(job, text, ends)
    elif entry == "compile":
        facts = compile_block(job, text)
    else:
        facts = tool_call(job, text)
    facts["sdk"] = {
        "name": "a2ui-agent-sdk",
        "version": importlib.metadata.version("a2ui-agent-sdk"),
    }
    print(json.dumps(facts, ensure_ascii=False))


if __name__ == "__main__":
    main()
