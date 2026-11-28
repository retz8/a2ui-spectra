"""The pinned-API check: the version floor, and every hooked name.

Each is checked per distribution.

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

from packaging import requirements
from packaging import version as packaging_version

from a2ui_spectra_instrumentation import _hooks
from a2ui_spectra_instrumentation import _log
from a2ui_spectra_instrumentation import _package

_EXPERIMENTAL: tuple[_hooks.Group, ...] = ("atom", "elemental")


@dataclass
class Target:
    """A hooked name, resolved: its holder and its attribute there."""

    hook: _hooks.Hook
    owner: Any
    attribute: str


@dataclass
class Plan:
    """What the check found.

    The SDK's version, every name to hook, and the format classes.
    """

    sdk_version: str
    targets: list[Target] = field(default_factory=list)
    # Each format's prompt generator class, by format.
    generators: list[tuple[type, str]] = field(default_factory=list)
    # Each function the hooks call, by its name; one the SDK lacks is absent.
    reads: dict[str, Any] = field(default_factory=dict)


def installed_version(distribution: str) -> str | None:
    try:
        return importlib.metadata.version(distribution)
    except importlib.metadata.PackageNotFoundError:
        return None


class Unusable(Exception):
    """A name of the pinned API cannot be used; its text says why."""


def _fault(fault: Exception) -> str:
    return f"{type(fault).__name__}: {fault}"


def _import(module: str, name: str) -> Any:
    """A module of the SDK, imported.

    A module that is not there is a missing name. One that fails as it runs,
    with any other error, could not be imported: the agent that never imports
    it runs without it, so the wrapper must not raise that error into it.
    """
    try:
        return importlib.import_module(module)
    except ImportError as error:
        raise Unusable(f"{module}.{name} is missing") from error
    except Exception as error:
        raise Unusable(f"{module} could not be imported ({_fault(error)})") from error


def _resolve(module: str, name: str) -> tuple[Any, str, Any]:
    """The holder of a dotted name, the attribute, and the callable it names."""
    holder: Any = _import(module, name)
    *path, attribute = name.split(".")
    try:
        for part in path:
            holder = getattr(holder, part)
        found = getattr(holder, attribute)
    except AttributeError as error:
        raise Unusable(f"{module}.{name} is missing") from error
    except Exception as error:
        raise Unusable(
            f"{module}.{name} could not be read ({_fault(error)})"
        ) from error
    if not callable(found):
        raise Unusable(f"{module}.{name} is missing")
    return holder, attribute, found


def _resolve_class(module: str, name: str) -> type:
    """A class a module defines, or an Unusable naming it."""
    try:
        found = getattr(_import(module, name), name)
    except AttributeError as error:
        raise Unusable(f"{module}.{name} is missing") from error
    if not isinstance(found, type):
        raise Unusable(f"{module}.{name} is missing")
    return found


def _add_group(plan: Plan, group: _hooks.Group) -> None:
    """Adds every name and class of a group, or none.

    An Unusable names the first one that cannot be used.
    """
    targets = []
    for hook in _hooks.HOOKS:
        if hook.group == group:
            holder, attribute, _ = _resolve(hook.module, hook.name)
            targets.append(Target(hook, holder, attribute))
    generators = [
        (_resolve_class(generator.module, generator.name), generator.format)
        for generator in _hooks.GENERATORS
        if generator.group == group
    ]
    plan.targets.extend(targets)
    plan.generators.extend(generators)


def refuse(distribution: str, version: str | None, why: str) -> None:
    """Writes the one line a refusal writes: what is left unpatched, and why."""
    # The floor is the agent SDK's alone; `a2ui-adk` is named by its release.
    _log.logger.warning(
        "a2ui-spectra-instrumentation left %s %s unpatched: %s; it was written"
        " against %s, %s%s",
        distribution,
        version if version is not None else "(not installed)",
        why,
        _package.PINS[distribution],
        _package.RELEASE,
        f" ({_package.FLOOR})" if distribution == _package.AGENT_SDK else "",
    )


def _at_or_above_floor(version: str) -> bool:
    try:
        return requirements.Requirement(_package.FLOOR).specifier.contains(
            packaging_version.Version(version), prereleases=True
        )
    except packaging_version.InvalidVersion:
        return False


def check() -> Plan | None:
    """The names to hook, or None when the agent SDK is refused."""
    version = installed_version(_package.AGENT_SDK)
    if version is None:
        refuse(_package.AGENT_SDK, None, "it is not installed")
        return None
    if not _at_or_above_floor(version):
        refuse(_package.AGENT_SDK, version, "it is below the version floor")
        return None
    plan = Plan(sdk_version=version)
    try:
        _add_group(plan, "core")
        for read in _hooks.READS:
            try:
                plan.reads[read.name] = _resolve(read.module, read.name)[2]
            except Unusable:
                if read.required:
                    raise
    except Unusable as unusable:
        refuse(_package.AGENT_SDK, version, str(unusable))
        return None
    for group in _EXPERIMENTAL:
        try:
            _add_group(plan, group)
        except Unusable as unusable:
            _log.logger.debug(
                "a2ui-spectra-instrumentation: %s is not hooked: %s",
                group.capitalize(),
                unusable,
            )
    _check_toolset(plan)
    return plan


def _check_toolset(plan: Plan) -> None:
    """Adds the toolset's names.

    It adds none when `a2ui-adk` is not installed or lacks one of them. An
    extension that is not there to import is skipped with no line; one that
    fails as it is imported is skipped with the refusal's line.
    """
    adk_version = installed_version(_package.ADK)
    if adk_version is None:
        return
    try:
        importlib.import_module("a2ui.adk")
    except ImportError:
        return
    except Exception as error:
        refuse(
            _package.ADK,
            adk_version,
            f"a2ui.adk could not be imported ({_fault(error)})",
        )
        return
    try:
        _add_group(plan, "toolset")
    except Unusable as unusable:
        refuse(_package.ADK, adk_version, str(unusable))
