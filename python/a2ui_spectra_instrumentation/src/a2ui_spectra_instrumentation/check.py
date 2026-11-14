"""The pinned-API check: the version floor, and every hooked name, per distribution.

The agent SDK's core names stand or fall together, Direct JSON's and Express's
prompt generator classes with them; Atom's and Elemental's names and generator
classes are each hooked when present; the toolset's stand or fall together. A
refusal is one WARNING line naming the distribution and the version found, the
first missing name, and the pin the wrapper was written against.
"""

from __future__ import annotations

import importlib
import importlib.metadata
from dataclasses import dataclass, field
from typing import Any

from packaging.requirements import Requirement
from packaging.version import InvalidVersion, Version

from .hooks import GENERATORS, HOOKS, READS, Hook
from .log import logger
from .package import ADK, AGENT_SDK, FLOOR, PINS, RELEASE

_EXPERIMENTAL = ("atom", "elemental")


@dataclass
class Target:
    """A hooked name, resolved: the object that holds it and its attribute there."""

    hook: Hook
    owner: Any
    attribute: str


@dataclass
class Plan:
    """What the check found: the SDK's version, every name to hook, and the format classes."""

    sdk_version: str
    targets: list[Target] = field(default_factory=list)
    # Each format's prompt generator class, by format.
    generators: list[tuple[type, str]] = field(default_factory=list)
    reads: dict[str, Any] = field(default_factory=dict)
    to_protocol_version: Any = None


def installed_version(distribution: str) -> str | None:
    try:
        return importlib.metadata.version(distribution)
    except importlib.metadata.PackageNotFoundError:
        return None


def _resolve(module: str, name: str) -> tuple[Any, str, Any]:
    """The holder of a dotted name, the attribute, and the callable it names."""
    try:
        holder: Any = importlib.import_module(module)
    except ImportError as error:
        raise LookupError(f"{module}.{name}") from error
    *path, attribute = name.split(".")
    try:
        for part in path:
            holder = getattr(holder, part)
        found = getattr(holder, attribute)
    except AttributeError as error:
        raise LookupError(f"{module}.{name}") from error
    if not callable(found):
        raise LookupError(f"{module}.{name}")
    return holder, attribute, found


def _resolve_class(module: str, name: str) -> type:
    """A class a module defines, or a LookupError naming it."""
    try:
        found = getattr(importlib.import_module(module), name)
    except (ImportError, AttributeError) as error:
        raise LookupError(f"{module}.{name}") from error
    if not isinstance(found, type):
        raise LookupError(f"{module}.{name}")
    return found


def _add_group(plan: Plan, group: str) -> None:
    """Adds every name and class of a group, or none, raising a LookupError naming the first missing."""
    targets = []
    for hook in HOOKS:
        if hook.group == group:
            holder, attribute, _ = _resolve(hook.module, hook.name)
            targets.append(Target(hook, holder, attribute))
    generators = [
        (_resolve_class(generator.module, generator.name), generator.format)
        for generator in GENERATORS
        if generator.group == group
    ]
    plan.targets.extend(targets)
    plan.generators.extend(generators)


def _refuse(distribution: str, version: str | None, why: str) -> None:
    logger.warning(
        "a2ui-spectra-instrumentation left %s %s unpatched: %s; it was written"
        " against %s, %s (%s)",
        distribution,
        version if version is not None else "(not installed)",
        why,
        PINS[distribution],
        RELEASE,
        FLOOR,
    )


def _above_floor(version: str) -> bool:
    try:
        return Requirement(FLOOR).specifier.contains(Version(version), prereleases=True)
    except InvalidVersion:
        return False


def check() -> Plan | None:
    """The names to hook, or None when the agent SDK is refused."""
    version = installed_version(AGENT_SDK)
    if version is None:
        _refuse(AGENT_SDK, None, "it is not installed")
        return None
    if not _above_floor(version):
        _refuse(AGENT_SDK, version, "it is below the version floor")
        return None
    plan = Plan(sdk_version=version)
    try:
        _add_group(plan, "core")
        for module, name in READS:
            plan.reads[name] = _resolve(module, name)[2]
    except LookupError as missing:
        _refuse(AGENT_SDK, version, f"{missing} is missing")
        return None
    try:
        plan.to_protocol_version = _resolve("a2ui.core.common", "to_protocol_version")[
            2
        ]
    except LookupError:
        plan.to_protocol_version = None
    for group in _EXPERIMENTAL:
        try:
            _add_group(plan, group)
        except LookupError as missing:
            logger.debug(
                "a2ui-spectra-instrumentation: %s is not hooked: %s is missing",
                group.capitalize(),
                missing,
            )
    _check_toolset(plan)
    return plan


def _check_toolset(plan: Plan) -> None:
    """Adds the toolset's names, unless `a2ui-adk` is not installed or lacks one."""
    adk_version = installed_version(ADK)
    if adk_version is None:
        return
    try:
        importlib.import_module("a2ui.adk")
    except ImportError:
        return
    try:
        _add_group(plan, "toolset")
    except LookupError as missing:
        _refuse(ADK, adk_version, f"{missing} is missing")
