"""`A2uiInstrumentor`, the wrapper as an OpenTelemetry instrumentor."""

from __future__ import annotations

from collections.abc import Callable, Collection
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
    """Instruments upstream's A2UI agent SDK and `a2ui-adk`'s toolset.

    It hooks both as they are at the pin.

    `opentelemetry-instrument` loads it through the `opentelemetry_instrumentor`
    entry point; `a2ui_spectra_instrumentation.instrument()` is the one-line form.
    """

    def instrumentation_dependencies(self) -> Collection[str]:
        return package._instruments

    def _instrument(self, **kwargs: Any) -> None:
        """Checks the SDK and hooks it, or leaves it unpatched with one line.

        Nothing the wrapper meets while it switches on is raised into the
        agent: an agent with the wrapper on starts as it does without it.
        """
        try:
            plan = check.check()
        except Exception as fault:
            check.refuse(
                package.AGENT_SDK,
                check.installed_version(package.AGENT_SDK),
                f"its check failed ({type(fault).__name__}: {fault})",
            )
            return
        if plan is None:
            return
        given = kwargs.get("tracer_provider")
        # With no provider given, the tracer is the global provider's, whichever
        # that is when a span is written: the agent's own, or the one the
        # wrapper starts when its first event ends.
        tracer = trace.get_tracer(
            package.SCOPE_NAME, version.__version__, tracer_provider=given
        )
        state.activate(
            _active(plan, tracer, provider.LateStart() if given is None else _nothing)
        )
        try:
            patching.apply(plan)
        except Exception as fault:
            state.deactivate()
            check.refuse(
                package.AGENT_SDK,
                plan.sdk_version,
                f"hooking it failed ({type(fault).__name__}: {fault})",
            )
            return
        except BaseException:
            state.deactivate()
            raise

    def _uninstrument(self, **kwargs: Any) -> None:
        patching.remove()
        state.deactivate()


def _nothing() -> None:
    """With a provider given, the wrapper starts none."""


def _active(
    plan: check.Plan, tracer: trace.Tracer, start_provider: Callable[[], None]
) -> state.Active:
    parsers = tuple(
        (target.owner, target.hook.format)
        for target in plan.targets
        if target.hook.role == "compile" and target.hook.format is not None
    )
    return state.Active(
        tracer=tracer,
        start_provider=start_provider,
        sdk_version=plan.sdk_version,
        to_message_dicts=plan.reads["to_message_dicts"],
        to_protocol_version=plan.reads.get("to_protocol_version"),
        parsers=parsers,
        generators=tuple(plan.generators),
    )
