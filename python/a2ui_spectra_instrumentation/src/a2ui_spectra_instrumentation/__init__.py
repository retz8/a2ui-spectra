"""OpenTelemetry instrumentation of upstream's A2UI agent SDK.

It reports the A2UI step to Spectra.

Switched on by launching the agent under `opentelemetry-instrument` with the
package installed, or with one line before the agent runs:

    import a2ui_spectra_instrumentation
    a2ui_spectra_instrumentation.instrument()
"""

from __future__ import annotations

from opentelemetry import trace

from a2ui_spectra_instrumentation import _instrumentor
from a2ui_spectra_instrumentation import version

A2uiInstrumentor = _instrumentor.A2uiInstrumentor
__version__ = version.__version__

__all__ = ["A2uiInstrumentor", "__version__", "instrument", "uninstrument"]


def instrument(*, tracer_provider: trace.TracerProvider | None = None) -> None:
    """Switches the wrapper on.

    It checks the SDK and hooks it. A second call does nothing, with
    OpenTelemetry's "already instrumented" warning.

    Args:
      tracer_provider: The provider the spans go to. By default the process's
        own, or one the wrapper starts when its first span is written, if the
        process has none by then and the environment names an OTLP endpoint.
    """
    # `A2uiInstrumentor()` is the one instrumentor each time: OpenTelemetry's
    # `BaseInstrumentor` makes a single instance a class.
    _instrumentor.A2uiInstrumentor().instrument(
        skip_dep_check=True, tracer_provider=tracer_provider
    )


def uninstrument() -> None:
    """Removes every hook. A tracer provider the wrapper started stays."""
    A2uiInstrumentor().uninstrument()
