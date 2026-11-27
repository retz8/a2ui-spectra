"""`A2uiInstrumentor`, the wrapper as an OpenTelemetry instrumentor."""

from __future__ import annotations

from collections.abc import Collection
from typing import Any

from opentelemetry import trace

# The module opts out of type checking as a whole, so mypy sees none of its names.
from opentelemetry.instrumentation.instrumentor import (  # type: ignore[attr-defined]
    BaseInstrumentor,
)

from a2ui_spectra_instrumentation import check
from a2ui_spectra_instrumentation import package
from a2ui_spectra_instrumentation import patching
from a2ui_spectra_instrumentation import provider
from a2ui_spectra_instrumentation import state
from a2ui_spectra_instrumentation import version


class A2uiInstrumentor(BaseInstrumentor):  # type: ignore[misc]
    """Instruments upstream's A2UI agent SDK, and `a2ui-adk`'s toolset, at the pin.

    `opentelemetry-instrument` loads it through the `opentelemetry_instrumentor`
    entry point; `a2ui_spectra_instrumentation.instrument()` is the one-line form.
    """

    def instrumentation_dependencies(self) -> Collection[str]:
        return package._instruments

    def _instrument(self, **kwargs: Any) -> None:
        plan = check.check()
        if plan is None:
            return
        chosen_provider = provider.tracer_provider(kwargs.get("tracer_provider"))
        tracer = trace.get_tracer(
            package.SCOPE_NAME, version.__version__, tracer_provider=chosen_provider
        )
        state.activate(_active(plan, tracer))
        try:
            patching.apply(plan)
        except BaseException:
            state.deactivate()
            raise

    def _uninstrument(self, **kwargs: Any) -> None:
        patching.remove()
        state.deactivate()


def _active(plan: check.Plan, tracer: trace.Tracer) -> state.Active:
    parsers = tuple(
        (target.owner, target.hook.format)
        for target in plan.targets
        if target.hook.role == "compile" and target.hook.format is not None
    )
    return state.Active(
        tracer=tracer,
        sdk_version=plan.sdk_version,
        to_message_dicts=plan.reads["to_message_dicts"],
        to_protocol_version=plan.to_protocol_version,
        parsers=parsers,
        generators=tuple(plan.generators),
    )
