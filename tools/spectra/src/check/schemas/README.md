# A2UI protocol schemas and catalogs

The schemas the schema check validates the agent's A2UI messages against, and the catalog definitions the catalog registry knows, one folder per protocol version. They are copied unchanged from `a2ui-project/a2ui` at `409ded29ccac3eebc541979ae5320771703248e8` (2026-10-24), under that repository's Apache 2.0 licence.

| File                               | Copied from                                       | Used by                                                                                                                              |
| ---------------------------------- | ------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| `v0_9/server_to_client.json`       | `specification/v0_9/json/server_to_client.json`   | The schema check                                                                                                                     |
| `v0_9/common_types.json`           | `specification/v0_9/json/common_types.json`       | The catalog check: the v0.9 catalogs' component definitions reach into it                                                            |
| `v0_9/catalogs/basic/catalog.json` | `specification/v0_9/catalogs/basic/catalog.json`  | The registry: the v0.9 basic catalog, also under the v0.9.1 URL; `specification/v0_9_1/catalogs/basic/catalog.json` is the same file |
| `v0_9_1/server_to_client.json`     | `specification/v0_9_1/json/server_to_client.json` | The schema check                                                                                                                     |
| `v1_0/agent_to_renderer.json`      | `specification/v1_0/json/agent_to_renderer.json`  | The schema check                                                                                                                     |
| `v1_0/common_types.json`           | `specification/v1_0/json/common_types.json`       | The schema check, and the catalog definition meta-schema                                                                             |
| `v1_0/catalog_definition.json`     | `specification/v1_0/json/catalog_definition.json` | The registry: a configured definition naming protocol version 1.0 is validated against it                                            |
| `v1_0/catalogs/basic/catalog.json` | `catalogs/basic/v1/catalog.json`                  | The registry: the v1.0 basic catalog                                                                                                 |

Only the files the checks and the registry load are copied. Each version's reference to `catalog.json` in the schema check is bound to a stand-in that accepts any component, any function and any theme; the catalog check binds the surface's real catalog definition there.

Moving the pin is copying these files again from the new commit.
