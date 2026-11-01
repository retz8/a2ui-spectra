"""The facts a wrapper capture case's expected record states, read off the agent SDK for Python.

Runs one case's job, under conformance/wrapper_capture/, on the agent SDK at upstream main
`825beac28`, calling its public entry points as a driver does, and prints the facts as JSON: the
section the prompt generator wrote, or the messages the parse produced, before an error included;
each error's class, message and details, and the block it belongs to; and, for the toolset, the
object the tool returned. `write_wrapper_capture_records.py` runs it and assembles the records. It
shares no code with Spectra. From the repository root, in a Python environment holding the SDK and
`a2ui-adk`, such as the `a2ui-upstream` worktree's own:

    ../a2ui-upstream/.venv/bin/python -I _dev/tools/wrapper_capture_facts.py \\
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
    blocks = open_blocks(processor, job["inferenceFormat"], text, wrapped)
    messages: list = []
    errors: list = []
    fed = 0

    def block_at(position: int) -> list[int] | None:
        # The last block opened at or before the position.
        opened = [block for block in blocks if block[0] <= position]
        return opened[-1] if opened else None

    def take(parts, position: int, chunk: int | None) -> None:
        for part in parts:
            if isinstance(part, A2uiPart):
                messages.extend(to_message_dicts(part.a2ui))
            elif isinstance(part, ErrorPart):
                errors.append({**error_fact(part.error, block_at(position)), "chunk": chunk})

    start = 0
    for end in ends:
        fed += 1
        try:
            take(stream.feed(text_slice(text, start, end)), end, fed - 1)
        except A2uiError as error:
            take(getattr(error, "partial_results", []), end, fed - 1)
            errors.append({**error_fact(error, block_at(end)), "chunk": fed - 1})
            return {"messages": messages, "errors": errors, "fed": fed, "closed": False}
        start = end
    try:
        take(stream.close(), utf16(text), None)
    except A2uiError as error:
        take(getattr(error, "partial_results", []), utf16(text), None)
        errors.append({**error_fact(error, block_at(utf16(text))), "chunk": None})
    return {"messages": messages, "errors": errors, "fed": fed, "closed": True}


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
    from a2ui.adk import SendA2uiToClientToolset

    processor = processor_of(job, state=job.get("rendererState", False))
    toolset = SendA2uiToClientToolset(a2ui_enabled=True, a2ui_processor=processor)
    tool = toolset._ui_tool
    raised: list[BaseException] = []
    parse_payload = tool._parse_payload

    def recording(processor, payload):
        try:
            return parse_payload(processor, payload)
        except Exception as error:
            raised.append(error)
            raise

    tool._parse_payload = recording
    context = SimpleNamespace(actions=SimpleNamespace(skip_summarization=False))
    result = asyncio.run(tool.run_async(args={"a2ui_payload": payload}, tool_context=context))
    blocks = blocks_of(processor, payload, processor.parser.has_format_content(payload))
    errors = [error_fact(error, blocks[0] if len(blocks) == 1 else None) for error in raised]
    messages = result.get("validated_a2ui_json", []) if isinstance(result, dict) else []
    return {"messages": messages, "errors": errors, "toolResult": result}


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
