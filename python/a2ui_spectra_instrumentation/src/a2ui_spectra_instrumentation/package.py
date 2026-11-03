"""What the wrapper instruments: the agent SDK, at the pin it was written against."""

# The instrumentation scope's name.
SCOPE_NAME = "a2ui-spectra-instrumentation"

# The agent SDK and the ADK extension, by their distribution names.
AGENT_SDK = "a2ui-agent-sdk"
ADK = "a2ui-adk"

# The version floor: the agent SDK's release the hooked names are first public
# in. It is also the package's `instruments` extra, which
# `opentelemetry-instrument` checks before loading the wrapper.
FLOOR = "a2ui-agent-sdk >= 0.10.0"
_instruments = (FLOOR,)

# The releases the hooked names were read from, by distribution.
PINS = {AGENT_SDK: "a2ui-agent-sdk 0.10.0", ADK: "a2ui-adk 0.2.0"}
RELEASE = "upstream's release of 2026-11-02"
