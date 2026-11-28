"""The pinned-API check: the version floor and the hooked names.

Each is checked per distribution.
"""

from __future__ import annotations

import importlib
import logging
import sys
from collections.abc import Callable
from typing import TYPE_CHECKING, Any, get_args

import pytest
import wrapt
from a2ui.adk import SendA2uiToClientToolset, send_a2ui_to_client_toolset
from a2ui.inference_formats import AtomParser, ElementalParser, ExpressParser
from a2ui.inference_formats.experimental.atom import (
    prompt_generator as atom_prompt_generator,
)
from a2ui.inference_formats.express import prompt_generator as express_prompt_generator
from a2ui import parser as a2ui_parser
from a2ui.core import common as a2ui_core_common
from a2ui.parser import Parser
from a2ui.prompt import PromptGenerator
from a2ui.utils import RendererState
from opentelemetry import trace
from opentelemetry.sdk.trace import TracerProvider

import a2ui_spectra_instrumentation
from a2ui_spectra_instrumentation import _check
from a2ui_spectra_instrumentation import _hooks
from a2ui_spectra_instrumentation import _state

# The fixtures' types, for the type check only: mypy names the tests by their
# path from the repository root.
if TYPE_CHECKING:
    from python.a2ui_spectra_instrumentation.tests import conftest


def test_a_missing_core_name_leaves_everything_unpatched(
    monkeypatch: pytest.MonkeyPatch,
    caplog: pytest.LogCaptureFixture,
    provider: TracerProvider,
    support: conftest.Support,
) -> None:
    monkeypatch.delattr(RendererState, "check_topology")
    with caplog.at_level(logging.DEBUG, logger=support.logger):
        a2ui_spectra_instrumentation.instrument(tracer_provider=provider)

    assert not support.hooked(Parser, "parse_response")
    assert not support.hooked(ExpressParser, "compile")
    assert not support.hooked(SendA2uiToClientToolset, "get_tools")
    [line] = support.lines(caplog)
    assert line.levelno == logging.WARNING
    message = line.getMessage()
    assert "a2ui.utils.RendererState.check_topology is missing" in message
    assert "a2ui-agent-sdk 0.11.0, upstream's release of 2026-11-10" in message


def test_a_missing_core_formats_generator_class_leaves_everything_unpatched(
    monkeypatch: pytest.MonkeyPatch,
    caplog: pytest.LogCaptureFixture,
    provider: TracerProvider,
    support: conftest.Support,
) -> None:
    monkeypatch.delattr(express_prompt_generator, "ExpressPromptGenerator")
    with caplog.at_level(logging.DEBUG, logger=support.logger):
        a2ui_spectra_instrumentation.instrument(tracer_provider=provider)

    assert not support.hooked(PromptGenerator, "generate")
    assert not support.hooked(Parser, "parse_response")
    assert not support.hooked(SendA2uiToClientToolset, "get_tools")
    [line] = support.lines(caplog)
    assert line.levelno == logging.WARNING
    assert (
        "a2ui.inference_formats.express.prompt_generator.ExpressPromptGenerator is"
        " missing"
        in line.getMessage()
    )


def test_a_missing_experimental_format_is_skipped_and_the_rest_patched(
    monkeypatch: pytest.MonkeyPatch,
    caplog: pytest.LogCaptureFixture,
    provider: TracerProvider,
    support: conftest.Support,
) -> None:
    monkeypatch.setitem(sys.modules, "a2ui.inference_formats.experimental.atom", None)
    with caplog.at_level(logging.DEBUG, logger=support.logger):
        a2ui_spectra_instrumentation.instrument(tracer_provider=provider)

    assert not support.hooked(AtomParser, "compile")
    assert support.hooked(ElementalParser, "compile")
    assert support.hooked(ExpressParser, "compile")
    assert support.hooked(Parser, "parse_response")
    assert support.hooked(SendA2uiToClientToolset, "get_tools")
    [line] = support.lines(caplog)
    assert line.levelno == logging.DEBUG
    assert "Atom is not hooked" in line.getMessage()


def test_a_missing_experimental_generator_class_skips_its_format(
    monkeypatch: pytest.MonkeyPatch,
    caplog: pytest.LogCaptureFixture,
    provider: TracerProvider,
    support: conftest.Support,
) -> None:
    monkeypatch.delattr(atom_prompt_generator, "AtomPromptGenerator")
    with caplog.at_level(logging.DEBUG, logger=support.logger):
        a2ui_spectra_instrumentation.instrument(tracer_provider=provider)

    assert not support.hooked(AtomParser, "compile")
    assert support.hooked(ElementalParser, "compile")
    assert support.hooked(PromptGenerator, "generate")
    [line] = support.lines(caplog)
    assert line.levelno == logging.DEBUG
    message = line.getMessage()
    assert "Atom is not hooked" in message
    assert "AtomPromptGenerator is missing" in message


def test_an_unimportable_adk_extension_is_skipped_silently(
    monkeypatch: pytest.MonkeyPatch,
    caplog: pytest.LogCaptureFixture,
    provider: TracerProvider,
    support: conftest.Support,
) -> None:
    monkeypatch.setitem(sys.modules, "a2ui.adk", None)
    with caplog.at_level(logging.DEBUG, logger=support.logger):
        a2ui_spectra_instrumentation.instrument(tracer_provider=provider)

    assert support.hooked(Parser, "parse_response")
    assert not support.hooked(SendA2uiToClientToolset, "get_tools")
    assert support.lines(caplog) == []


def test_a_missing_toolset_name_skips_the_toolset_naming_its_own_release(
    monkeypatch: pytest.MonkeyPatch,
    caplog: pytest.LogCaptureFixture,
    provider: TracerProvider,
    support: conftest.Support,
) -> None:
    monkeypatch.delattr(send_a2ui_to_client_toolset, "validate_payload")
    with caplog.at_level(logging.DEBUG, logger=support.logger):
        a2ui_spectra_instrumentation.instrument(tracer_provider=provider)

    assert support.hooked(Parser, "parse_response")
    assert not support.hooked(SendA2uiToClientToolset, "get_tools")
    [line] = support.lines(caplog)
    assert line.levelno == logging.WARNING
    message = line.getMessage()
    assert "left a2ui-adk 0.3.0 unpatched" in message
    assert "send_a2ui_to_client_toolset.validate_payload is missing" in message
    assert message.endswith(
        "it was written against a2ui-adk 0.3.0, upstream's release of 2026-11-10"
    )


def test_a_missing_function_the_hooks_call_leaves_everything_unpatched(
    monkeypatch: pytest.MonkeyPatch,
    caplog: pytest.LogCaptureFixture,
    provider: TracerProvider,
    support: conftest.Support,
) -> None:
    monkeypatch.delattr(a2ui_parser, "to_message_dicts")
    with caplog.at_level(logging.DEBUG, logger=support.logger):
        a2ui_spectra_instrumentation.instrument(tracer_provider=provider)

    assert not support.hooked(Parser, "parse_response")
    [line] = support.lines(caplog)
    assert line.levelno == logging.WARNING
    assert "a2ui.parser.to_message_dicts is missing" in line.getMessage()


def test_an_sdk_without_to_protocol_version_is_patched_and_its_versions_written(
    monkeypatch: pytest.MonkeyPatch,
    caplog: pytest.LogCaptureFixture,
    spans_of: Callable[[], conftest.Recorded],
    processor: conftest.ProcessorFactory,
    support: conftest.Support,
) -> None:
    monkeypatch.delattr(a2ui_core_common, "to_protocol_version")
    with caplog.at_level(logging.DEBUG, logger=support.logger):
        spans = spans_of()
    processor().parser.compile('surface("card")\nroot = Text("Hi")')

    assert support.lines(caplog) == []
    assert spans.parsed(spans.one(), "a2ui.parse.catalogs") == [{
        "catalogId": "https://a2ui.org/specification/v1_0/catalogs/basic/catalog.json",
        "protocolVersion": "v1.0",
    }]


def test_every_role_of_the_hook_table_has_its_hook() -> None:
    assert set(_hooks.HOOK_FOR) == set(get_args(_hooks.Role))
    assert {hook.role for hook in _hooks.HOOKS} <= set(_hooks.HOOK_FOR)


def failing_import(module: str, error: Exception) -> Any:
    """`importlib.import_module`, failing for one module with the error given."""
    real = importlib.import_module

    def import_module(name: str, package: str | None = None) -> Any:
        if name == module:
            raise error
        return real(name, package)

    return import_module


def test_a_core_module_that_fails_to_import_is_a_refusal_not_an_error(
    monkeypatch: pytest.MonkeyPatch,
    caplog: pytest.LogCaptureFixture,
    provider: TracerProvider,
    support: conftest.Support,
) -> None:
    monkeypatch.setattr(
        importlib,
        "import_module",
        failing_import("a2ui.prompt", TypeError("metaclass conflict")),
    )
    with caplog.at_level(logging.DEBUG, logger=support.logger):
        a2ui_spectra_instrumentation.instrument(tracer_provider=provider)

    assert not support.hooked(Parser, "parse_response")
    assert not support.hooked(SendA2uiToClientToolset, "get_tools")
    [line] = support.lines(caplog)
    assert line.levelno == logging.WARNING
    message = line.getMessage()
    assert "a2ui.prompt could not be imported" in message
    assert "TypeError: metaclass conflict" in message
    assert "a2ui-agent-sdk 0.11.0, upstream's release of 2026-11-10" in message


def test_an_adk_extension_that_fails_to_import_skips_the_toolset_with_one_line(
    monkeypatch: pytest.MonkeyPatch,
    caplog: pytest.LogCaptureFixture,
    provider: TracerProvider,
    support: conftest.Support,
) -> None:
    monkeypatch.setattr(
        importlib,
        "import_module",
        failing_import("a2ui.adk", TypeError("metaclass conflict")),
    )
    with caplog.at_level(logging.DEBUG, logger=support.logger):
        a2ui_spectra_instrumentation.instrument(tracer_provider=provider)

    assert support.hooked(Parser, "parse_response")
    assert not support.hooked(SendA2uiToClientToolset, "get_tools")
    [line] = support.lines(caplog)
    assert line.levelno == logging.WARNING
    message = line.getMessage()
    assert "left a2ui-adk" in message
    assert "a2ui.adk could not be imported (TypeError: metaclass conflict)" in message


@pytest.mark.usefixtures("no_global_provider", "no_otlp_variables")
def test_a_failure_while_hooking_is_a_refusal_and_nothing_stays_hooked(
    monkeypatch: pytest.MonkeyPatch,
    caplog: pytest.LogCaptureFixture,
    support: conftest.Support,
) -> None:
    monkeypatch.setenv("OTEL_EXPORTER_OTLP_ENDPOINT", "http://127.0.0.1:9")
    real = wrapt.wrap_function_wrapper
    calls = 0

    def failing_on_the_third(*args: Any, **kwargs: Any) -> Any:
        nonlocal calls
        calls += 1
        if calls == 3:
            raise RuntimeError("the attribute is read-only")
        return real(*args, **kwargs)

    monkeypatch.setattr(wrapt, "wrap_function_wrapper", failing_on_the_third)
    with caplog.at_level(logging.WARNING, logger=support.logger):
        a2ui_spectra_instrumentation.instrument()

    assert not support.hooked(Parser, "parse_response")
    assert not support.hooked(RendererState, "check_topology")
    assert _state.current() is None
    assert isinstance(trace.get_tracer_provider(), trace.ProxyTracerProvider)
    [line] = support.lines(caplog)
    assert line.levelno == logging.WARNING
    message = line.getMessage()
    assert "left a2ui-agent-sdk" in message
    assert "hooking it failed (RuntimeError: the attribute is read-only)" in message


def test_an_sdk_below_the_floor_is_refused(
    monkeypatch: pytest.MonkeyPatch,
    caplog: pytest.LogCaptureFixture,
    provider: TracerProvider,
    support: conftest.Support,
) -> None:
    real = _check.installed_version
    monkeypatch.setattr(
        _check,
        "installed_version",
        lambda name: "0.10.0" if name == "a2ui-agent-sdk" else real(name),
    )
    with caplog.at_level(logging.DEBUG, logger=support.logger):
        a2ui_spectra_instrumentation.instrument(tracer_provider=provider)

    assert not support.hooked(Parser, "parse_response")
    [line] = support.lines(caplog)
    assert line.levelno == logging.WARNING
    message = line.getMessage()
    assert "a2ui-agent-sdk 0.10.0 unpatched" in message
    assert "below the version floor" in message
    assert "a2ui-agent-sdk >= 0.11.0" in message


def test_the_pinned_sdk_passes_with_no_line(
    caplog: pytest.LogCaptureFixture,
    provider: TracerProvider,
    support: conftest.Support,
) -> None:
    with caplog.at_level(logging.DEBUG, logger=support.logger):
        a2ui_spectra_instrumentation.instrument(tracer_provider=provider)

    assert support.hooked(Parser, "parse_response")
    assert support.hooked(PromptGenerator, "generate")
    assert support.hooked(AtomParser, "compile")
    assert support.hooked(SendA2uiToClientToolset, "get_tools")
    assert support.lines(caplog) == []


def test_a_second_instrument_gets_the_base_instrumentors_warning(
    caplog: pytest.LogCaptureFixture, provider: TracerProvider
) -> None:
    a2ui_spectra_instrumentation.instrument(tracer_provider=provider)
    with caplog.at_level(logging.WARNING):
        a2ui_spectra_instrumentation.instrument(tracer_provider=provider)

    assert [record.getMessage() for record in caplog.records] == [
        "Attempting to instrument while already instrumented"
    ]
