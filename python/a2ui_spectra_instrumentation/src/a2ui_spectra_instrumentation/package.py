"""What the wrapper instruments: the agent SDK, at the pin it was written against."""

# The instrumentation scope's name.
SCOPE_NAME = "a2ui-spectra-instrumentation"

# The agent SDK and the ADK extension, by their distribution names.
AGENT_SDK = "a2ui-agent-sdk"
ADK = "a2ui-adk"

# The version floor: the agent SDK's first release after 0.9.0, which the
# hooked names are first public in. It is also the package's `instruments`
# extra, which `opentelemetry-instrument` checks before loading the wrapper.
FLOOR = "a2ui-agent-sdk > 0.9.0"
_instruments = (FLOOR,)

# The commit the hooked names were read from.
PIN = "upstream main 825beac28"
