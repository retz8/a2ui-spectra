"""The pinned-API check: the version floor and the hooked names, per distribution."""

from __future__ import annotations

import logging
import sys
from typing import Any

import pytest
from a2ui.adk import SendA2uiToClientToolset
from a2ui.inference_formats import AtomParser, ElementalParser, ExpressParser
from a2ui.parser import Parser
from a2ui.utils import RendererState
from opentelemetry.sdk.trace import TracerProvider

import a2ui_spectra_instrumentation
from a2ui_spectra_instrumentation import check

WRAPPER_LOGGER = "a2ui_spectra_instrumentation"


def test_a_missing_core_name_leaves_everything_unpatched(
    monkeypatch: pytest.MonkeyPatch,
    caplog: pytest.LogCaptureFixture,
    provider: TracerProvider,
    support: Any,
) -> None:
    monkeypatch.delattr(RendererState, "check_topology")
    with caplog.at_level(logging.DEBUG, logger=WRAPPER_LOGGER):
        a2ui_spectra_instrumentation.instrument(tracer_provider=provider)

    assert not support.hooked(Parser, "parse_response")
    assert not support.hooked(ExpressParser, "compile")
    assert not support.hooked(SendA2uiToClientToolset, "get_tools")
    [line] = support.lines(caplog)
    assert line.levelno == logging.WARNING
    message = line.getMessage()
    assert "a2ui-agent-sdk 0.10.0" in message
    assert "a2ui.utils.RendererState.check_topology is missing" in message
    assert "a2ui-agent-sdk 0.10.0, upstream's release of 2026-11-02" in message


def test_a_missing_experimental_format_is_skipped_and_the_rest_patched(
    monkeypatch: pytest.MonkeyPatch,
    caplog: pytest.LogCaptureFixture,
    provider: TracerProvider,
    support: Any,
) -> None:
    monkeypatch.setitem(sys.modules, "a2ui.inference_formats.experimental.atom", None)
    with caplog.at_level(logging.DEBUG, logger=WRAPPER_LOGGER):
        a2ui_spectra_instrumentation.instrument(tracer_provider=provider)

    assert not support.hooked(AtomParser, "compile")
    assert support.hooked(ElementalParser, "compile")
    assert support.hooked(ExpressParser, "compile")
    assert support.hooked(Parser, "parse_response")
    assert support.hooked(SendA2uiToClientToolset, "get_tools")
    [line] = support.lines(caplog)
    assert line.levelno == logging.DEBUG
    assert "Atom is not hooked" in line.getMessage()


def test_an_unimportable_adk_extension_is_skipped_silently(
    monkeypatch: pytest.MonkeyPatch,
    caplog: pytest.LogCaptureFixture,
    provider: TracerProvider,
    support: Any,
) -> None:
    monkeypatch.setitem(sys.modules, "a2ui.adk", None)
    with caplog.at_level(logging.DEBUG, logger=WRAPPER_LOGGER):
        a2ui_spectra_instrumentation.instrument(tracer_provider=provider)

    assert support.hooked(Parser, "parse_response")
    assert not support.hooked(SendA2uiToClientToolset, "get_tools")
    assert support.lines(caplog) == []


def test_an_sdk_at_the_floor_is_refused(
    monkeypatch: pytest.MonkeyPatch,
    caplog: pytest.LogCaptureFixture,
    provider: TracerProvider,
    support: Any,
) -> None:
    real = check.installed_version
    monkeypatch.setattr(
        check,
        "installed_version",
        lambda name: "0.9.0" if name == "a2ui-agent-sdk" else real(name),
    )
    with caplog.at_level(logging.DEBUG, logger=WRAPPER_LOGGER):
        a2ui_spectra_instrumentation.instrument(tracer_provider=provider)

    assert not support.hooked(Parser, "parse_response")
    [line] = support.lines(caplog)
    assert line.levelno == logging.WARNING
    message = line.getMessage()
    assert "a2ui-agent-sdk 0.9.0" in message
    assert "below the version floor" in message
    assert "a2ui-agent-sdk >= 0.10.0" in message


def test_the_pinned_sdk_passes_with_no_line(
    caplog: pytest.LogCaptureFixture, provider: TracerProvider, support: Any
) -> None:
    with caplog.at_level(logging.DEBUG, logger=WRAPPER_LOGGER):
        a2ui_spectra_instrumentation.instrument(tracer_provider=provider)

    assert support.hooked(Parser, "parse_response")
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
