"""The wrapper capture suite's Python driver.

Runs one job of `conformance/wrapper_capture/` on upstream's agent SDK at the pin,
with `a2ui-spectra-instrumentation` switched on by its one-line form, which
starts the tracer provider from the `OTEL_EXPORTER_OTLP_*` variables the harness
sets. From `conformance/`:

    uv run --project wrapper_driver/python python wrapper_driver/python/driver.py <job>

The SDK's `A2uiError` passes and the driver exits 0, the provider's shutdown
flushing the export. Any other failure exits non-zero with its message on
stderr. It prints nothing and carries no trace context.
"""

from __future__ import annotations

import asyncio
import json
import sys
from pathlib import Path
from types import SimpleNamespace
from typing import Any

import a2ui_spectra_instrumentation

a2ui_spectra_instrumentation.instrument()

from a2ui.core import A2uiError, CatalogApi
from a2ui.core.basic_catalog import BasicCatalog
from a2ui.inference_format import InferenceFormatFactory
from a2ui.inference_formats import (
    AtomFormatFactory,
    DirectJsonFormatFactory,
    ElementalFormatFactory,
    ExpressFormatFactory,
)
from a2ui.processor import A2uiRequestProcessor, CatalogConfig
from a2ui.utils import RendererState

# Catalog paths in a job are relative to `conformance/`.
CONFORMANCE = Path(__file__).resolve().parents[2]

FACTORIES: dict[str, type[InferenceFormatFactory]] = {
    "direct_json": DirectJsonFormatFactory,
    "express": ExpressFormatFactory,
    "elemental": ElementalFormatFactory,
    "atom": AtomFormatFactory,
}


def read_text(path: Path) -> str:
    """A file's text exactly, line endings included."""
    with open(path, encoding="utf-8", newline="") as file:
        return file.read()


def catalogs_of(job: dict[str, Any]) -> list[CatalogApi]:
    catalogs: list[CatalogApi] = []
    for catalog in job["catalogs"]:
        version = catalog["protocolVersion"].removeprefix("v")
        if "path" in catalog:
            config = CatalogConfig.from_path(
                str(CONFORMANCE / catalog["path"]), protocol_version=version
            )
            catalogs.append(config.catalog)
        else:
            catalogs.append(BasicCatalog(version))
    return catalogs


def processor_of(job: dict[str, Any], job_dir: Path) -> A2uiRequestProcessor:
    catalogs = catalogs_of(job)
    examples = (
        json.loads(read_text(job_dir / job["examples"])) if "examples" in job else None
    )
    state = RendererState(catalogs) if job.get("rendererState", False) else None
    return A2uiRequestProcessor(
        catalogs,
        examples=examples,
        format_factory=FACTORIES[job["inferenceFormat"]](),
        state=state,
    )


def chunks_of(text: str, ends: list[int]) -> list[str]:
    """The text cut at each chunk's end, given in UTF-16 code units."""
    encoded = text.encode("utf-16-le", errors="surrogatepass")
    chunks = []
    start = 0
    for end in ends:
        chunks.append(
            encoded[start * 2 : end * 2].decode("utf-16-le", errors="surrogatepass")
        )
        start = end
    return chunks


def open_stream(
    processor: A2uiRequestProcessor, job: dict[str, Any], text: str, ends: list[int]
) -> None:
    """Feeds each chunk in order, stopping at the first that raises, and closes unless one raised."""
    stream = processor.open_stream(
        wrapped=job.get("wrapped", True),
        after_rejected_block=job.get("afterRejectedBlock", "end"),
    )
    for chunk in chunks_of(text, ends):
        try:
            stream.feed(chunk)
        except A2uiError:
            return
    stream.close()


async def tool_call(processor: A2uiRequestProcessor, payload: str) -> None:
    """Runs the toolset's tool with the payload, in a context that names no call id."""
    from a2ui.adk import SendA2uiToClientToolset

    toolset = SendA2uiToClientToolset(a2ui_enabled=True, a2ui_processor=processor)
    # Stand-ins for ADK's contexts: the toolset reads nothing of the first,
    # and the tool only sets `actions.skip_summarization` on the second.
    readonly_context: Any = SimpleNamespace()
    tools = await toolset.get_tools(readonly_context)
    tool = next(tool for tool in tools if tool.name == "send_a2ui_json_to_client")
    context: Any = SimpleNamespace(actions=SimpleNamespace(skip_summarization=False))
    await tool.run_async(args={"a2ui_payload": payload}, tool_context=context)


def run(job_path: Path) -> None:
    job = json.loads(read_text(job_path))
    job_dir = job_path.parent
    processor = processor_of(job, job_dir)
    entry_point = job["entryPoint"]
    if entry_point == "generate":
        processor.prompt_snippet
        return
    text = read_text(job_dir / job["text"])
    if entry_point == "parse_response":
        processor.parse_response(text, job.get("wrapped", True))
    elif entry_point == "open_stream":
        open_stream(
            processor, job, text, json.loads(read_text(job_dir / job["chunks"]))
        )
    elif entry_point == "compile":
        processor.parser.compile(text)
    elif entry_point == "tool_call":
        asyncio.run(tool_call(processor, text))
    else:
        raise ValueError(f"Unknown entry point: {entry_point}")


def main() -> int:
    if len(sys.argv) != 2:
        print("usage: driver.py <job>", file=sys.stderr)
        return 2
    try:
        run(Path(sys.argv[1]))
    except A2uiError:
        pass
    except Exception as error:
        print(f"{type(error).__name__}: {error}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
