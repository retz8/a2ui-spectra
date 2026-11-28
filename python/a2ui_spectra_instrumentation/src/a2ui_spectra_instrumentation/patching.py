"""Applying the hooks the check resolved, and removing them."""

from __future__ import annotations

import logging
from typing import Any

import wrapt
from opentelemetry.instrumentation.utils import unwrap

from a2ui_spectra_instrumentation import check
from a2ui_spectra_instrumentation import hooks

# A hook's class: wrapt 2's `BaseObjectProxy`, wrapt 1's `ObjectProxy`.
_PROXY: type = getattr(wrapt, "BaseObjectProxy", wrapt.ObjectProxy)

# Each attribute hooked, on the object that holds it, in the order hooked.
_applied: list[tuple[Any, str]] = []

# The toolset module's logger, while its `error` is hooked.
_hooked_loggers: list[logging.Logger] = []


def apply(plan: check.Plan) -> None:
    """Hooks every name of the plan.

    On a failure, it removes what it hooked and raises.
    """
    try:
        for target in plan.targets:
            current = getattr(target.owner, target.attribute)
            if isinstance(current, _PROXY):
                # A module that took a hooked function by name after it was
                # hooked holds the hook already; removing restores the original.
                _applied.append((target.owner, target.attribute))
                continue
            wrapt.wrap_function_wrapper(
                target.owner, target.attribute, hooks.wrapper_for(target.hook)
            )
            _applied.append((target.owner, target.attribute))
        if any(target.hook.group == "toolset" for target in plan.targets):
            logger = logging.getLogger(hooks.TOOLSET_MODULE)
            wrapt.wrap_function_wrapper(logger, "error", hooks.error_line_hook)
            _hooked_loggers.append(logger)
    except BaseException:
        remove()
        raise


def remove() -> None:
    """Removes every hook, the ones on the toolset's tools included."""
    while _applied:
        owner, attribute = _applied.pop()
        unwrap(owner, attribute)
    while _hooked_loggers:
        # The hook is the logger's own attribute, over its class's method.
        vars(_hooked_loggers.pop()).pop("error", None)
    hooks.unhook_tools()
