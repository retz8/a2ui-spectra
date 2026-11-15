"""The wheel's build hook: the binary in the scripts folder, the wheel tagged.

The binary is beside this file, as `a2ui-spectra`, or `a2ui-spectra.exe` for
Windows, and `A2UI_SPECTRA_WHEEL_TAG` names the platform's tag.
"""

import os
from typing import Any

from hatchling.builders.hooks.plugin.interface import BuildHookInterface

BINARIES = ("a2ui-spectra", "a2ui-spectra.exe")
TAG_VARIABLE = "A2UI_SPECTRA_WHEEL_TAG"


class CustomBuildHook(BuildHookInterface):
    """Puts the binary in the wheel's scripts folder and tags the wheel."""

    def initialize(self, version: str, build_data: dict[str, Any]) -> None:
        tag = os.environ.get(TAG_VARIABLE, "")
        if tag == "":
            raise RuntimeError(f"{TAG_VARIABLE} names the wheel's tag, and is not set.")
        found = [
            name for name in BINARIES if os.path.isfile(os.path.join(self.root, name))
        ]
        if len(found) != 1:
            raise RuntimeError(
                f"One of {' and '.join(BINARIES)} belongs beside {__file__}; found"
                f" {', '.join(found) or 'none'}."
            )
        build_data["tag"] = tag
        build_data["pure_python"] = False
        build_data["shared_scripts"][found[0]] = found[0]
