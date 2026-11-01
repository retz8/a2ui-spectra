"""The wrapper's one logger, and the line a failure inside the wrapper writes."""

import logging

logger = logging.getLogger("a2ui_spectra_instrumentation")


def report_fault(where: str, fault: BaseException) -> None:
    """Writes the one line a failure inside a hook writes; the SDK's call goes on as if unhooked."""
    logger.warning(
        "a2ui-spectra-instrumentation: %s failed (%s: %s); this call's A2UI"
        " step is not recorded",
        where,
        type(fault).__name__,
        fault,
    )
