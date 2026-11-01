"""The instrumentation while it is switched on: its tracer and what it read off the SDK."""

from __future__ import annotations

from collections.abc import Callable
from dataclasses import dataclass
from typing import Any

from opentelemetry.trace import Tracer


@dataclass(frozen=True)
class Active:
    """What every hook reads while the wrapper is switched on."""

    tracer: Tracer
    # The agent SDK's version, as its distribution reports it.
    sdk_version: str
    # `a2ui.parser.to_message_dicts`: messages as wire-format dicts.
    to_message_dicts: Callable[[Any], list[dict[str, Any]]]
    # `a2ui.core.common.to_protocol_version`, when the SDK has it.
    to_protocol_version: Callable[[Any], Any] | None
    # Each patched format's parser and prompt generator class, by format.
    parsers: tuple[tuple[type, str], ...]
    generators: tuple[tuple[type, str], ...]

    def parser_format(self, parser: object) -> str | None:
        return next((fmt for cls, fmt in self.parsers if isinstance(parser, cls)), None)

    def generator_format(self, generator: object) -> str | None:
        return next(
            (fmt for cls, fmt in self.generators if isinstance(generator, cls)), None
        )


_active: Active | None = None


def current() -> Active | None:
    """The switched-on instrumentation, or None: every hook then calls straight through."""
    return _active


def activate(active: Active) -> None:
    global _active
    _active = active


def deactivate() -> None:
    global _active
    _active = None
