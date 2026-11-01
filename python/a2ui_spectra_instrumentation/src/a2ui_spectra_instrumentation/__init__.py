"""OpenTelemetry instrumentation of upstream's A2UI agent SDK, reporting the A2UI step to Spectra.

Switched on by launching the agent under `opentelemetry-instrument` with the
package installed, or with one line before the agent runs:

    import a2ui_spectra_instrumentation
    a2ui_spectra_instrumentation.instrument()
"""

from __future__ import annotations

from typing import Any

from .instrumentor import A2uiInstrumentor
from .version import __version__

__all__ = ["A2uiInstrumentor", "__version__", "instrument", "uninstrument"]


def instrument(**kwargs: Any) -> None:
    """Switches the wrapper on: checks the SDK, hooks it, and starts a tracer provider if needed.

    Args:
      tracer_provider: The provider the spans go to. By default the process's,
        or one the wrapper starts when the process has none and the environment
        names an OTLP endpoint.
    """
    A2uiInstrumentor().instrument(skip_dep_check=True, **kwargs)


def uninstrument() -> None:
    """Removes every hook. A tracer provider the wrapper started stays."""
    A2uiInstrumentor().uninstrument()
