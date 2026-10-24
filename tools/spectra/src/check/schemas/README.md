# A2UI protocol schemas

The schemas the schema check validates the agent's A2UI messages against, one folder per protocol version. They are copied unchanged from `a2ui-project/a2ui` at `020a9d6f694761ad16b35bc38945e4ccd0ac14e8` (2026-10-23), under that repository's Apache 2.0 licence.

| File                           | Copied from                                       |
| ------------------------------ | ------------------------------------------------- |
| `v0_9/server_to_client.json`   | `specification/v0_9/json/server_to_client.json`   |
| `v0_9_1/server_to_client.json` | `specification/v0_9_1/json/server_to_client.json` |
| `v1_0/agent_to_renderer.json`  | `specification/v1_0/json/agent_to_renderer.json`  |
| `v1_0/common_types.json`       | `specification/v1_0/json/common_types.json`       |

Only the files the check loads are copied. Each version's reference to `catalog.json` is bound to a stand-in that accepts any component, any function and any theme; components are the catalog check's.

Moving the pin is copying these files again from the new commit.
