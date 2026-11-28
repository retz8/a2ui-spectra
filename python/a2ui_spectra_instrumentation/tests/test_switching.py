"""Switching the wrapper off, and on through `opentelemetry-instrument`."""

from __future__ import annotations

import asyncio
import json
import logging
import os
import subprocess
import sys
from pathlib import Path
from types import SimpleNamespace
from typing import TYPE_CHECKING, Any

from a2ui.adk import SendA2uiToClientToolset
from a2ui.adk import send_a2ui_to_client_toolset
from a2ui.inference_formats import ExpressParser
from a2ui.inference_formats.direct_json import DirectJsonResponseStream
from a2ui.parser import Parser
from a2ui.prompt import PromptGenerator
import a2ui.utils
from a2ui.utils import RendererState

import a2ui_spectra_instrumentation

# The fixtures' types, for the type check only: mypy names the tests by their
# path from the repository root.
if TYPE_CHECKING:
    from python.a2ui_spectra_instrumentation.tests import conftest

# A stand-in for ADK's readonly context, of which the toolset reads nothing.
STAND_IN: Any = SimpleNamespace()
CARD = 'surface("card")\nroot = Text("Hi")'


def test_uninstrument_removes_every_hook(
    spans: conftest.Recorded,
    processor: conftest.ProcessorFactory,
    support: conftest.Support,
) -> None:
    toolset = SendA2uiToClientToolset(a2ui_enabled=True, a2ui_processor=processor())
    [tool] = asyncio.run(toolset.get_tools(STAND_IN))
    assert support.hooked(tool, "run_async")

    a2ui_spectra_instrumentation.uninstrument()

    for owner, name in [
        (Parser, "parse_response"),
        (PromptGenerator, "generate"),
        (RendererState, "apply"),
        (ExpressParser, "compile"),
        (DirectJsonResponseStream, "feed"),
        (a2ui.utils, "validate_payload"),
        (send_a2ui_to_client_toolset, "validate_payload"),
        (send_a2ui_to_client_toolset, "_resolve_processor"),
        (SendA2uiToClientToolset, "get_tools"),
    ]:
        assert not support.hooked(owner, name), name
    assert "error" not in vars(logging.getLogger(send_a2ui_to_client_toolset.__name__))
    assert "run_async" not in vars(tool)
    assert "process_llm_request" not in vars(tool)
    processor().parse_response(CARD, False)
    context: Any = SimpleNamespace(actions=SimpleNamespace(skip_summarization=False))
    asyncio.run(tool.run_async(args={"a2ui_payload": CARD}, tool_context=context))
    assert spans.all() == []


CHILD = """
import json
import wrapt
from a2ui.core.basic_catalog import BasicCatalog
from a2ui.parser import Parser
from a2ui.processor import A2uiRequestProcessor
from opentelemetry import trace
from opentelemetry.sdk.trace import TracerProvider

before = isinstance(trace.get_tracer_provider(), TracerProvider)
A2uiRequestProcessor([BasicCatalog("1.0")]).prompt_snippet
print(json.dumps({
    "hooked": isinstance(
        vars(Parser)["parse_response"], getattr(wrapt, "BaseObjectProxy", wrapt.ObjectProxy)
    ),
    "sdk_provider_before_the_first_event": before,
    "sdk_provider": isinstance(trace.get_tracer_provider(), TracerProvider),
}))
"""


def test_the_launcher_switches_it_on_and_the_first_event_starts_the_provider() -> None:
    launcher = Path(sys.executable).with_name("opentelemetry-instrument")
    env = {
        name: value
        for name, value in os.environ.items()
        if not name.startswith(("OTEL_", "PYTHONPATH"))
    }
    env["OTEL_EXPORTER_OTLP_ENDPOINT"] = "http://127.0.0.1:9"
    env["OTEL_EXPORTER_OTLP_PROTOCOL"] = "http/protobuf"
    child = subprocess.run(
        [str(launcher), sys.executable, "-c", CHILD],
        env=env,
        capture_output=True,
        text=True,
        timeout=120,
        check=True,
    )

    assert json.loads(child.stdout.strip().splitlines()[-1]) == {
        "hooked": True,
        "sdk_provider_before_the_first_event": False,
        "sdk_provider": True,
    }
