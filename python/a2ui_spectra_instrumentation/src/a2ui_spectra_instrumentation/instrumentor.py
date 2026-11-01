"""`A2uiInstrumentor`, the wrapper as an OpenTelemetry instrumentor."""

from __future__ import annotations

from collections.abc import Collection
from typing import Any

from opentelemetry import trace

# The module opts out of type checking as a whole, so mypy sees none of its names.
from opentelemetry.instrumentation.instrumentor import (  # type: ignore[attr-defined]
    BaseInstrumentor,
)

from . import check, patching, state
from .check import Plan
from .package import SCOPE_NAME, _instruments
from .provider import tracer_provider
from .version import __version__


class A2uiInstrumentor(BaseInstrumentor):  # type: ignore[misc]
    """Instruments upstream's A2UI agent SDK, and `a2ui-adk`'s toolset, at the pin.

    `opentelemetry-instrument` loads it through the `opentelemetry_instrumentor`
    entry point; `a2ui_spectra_instrumentation.instrument()` is the one-line form.
    """

    def instrumentation_dependencies(self) -> Collection[str]:
        return _instruments

    def _instrument(self, **kwargs: Any) -> None:
        plan = check.check()
        if plan is None:
            return
        provider = tracer_provider(kwargs.get("tracer_provider"))
        tracer = trace.get_tracer(SCOPE_NAME, __version__, tracer_provider=provider)
        state.activate(_active(plan, tracer))
        try:
            patching.apply(plan)
        except BaseException:
            state.deactivate()
            raise

    def _uninstrument(self, **kwargs: Any) -> None:
        patching.remove()
        state.deactivate()


def _active(plan: Plan, tracer: trace.Tracer) -> state.Active:
    parsers = []
    generators = []
    for target in plan.targets:
        if target.hook.format is None:
            continue
        if target.hook.role == "compile":
            parsers.append((target.owner, target.hook.format))
        elif target.hook.role == "generate":
            generators.append((target.owner, target.hook.format))
    return state.Active(
        tracer=tracer,
        sdk_version=plan.sdk_version,
        to_message_dicts=plan.reads["to_message_dicts"],
        to_protocol_version=plan.to_protocol_version,
        parsers=tuple(parsers),
        generators=tuple(generators),
    )
