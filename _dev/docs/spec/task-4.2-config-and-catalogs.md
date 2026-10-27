# Sub-task 4.2 — The config file and the catalogs

The config file, the catalog registry, and the message box's credentials and offer. Sub-task 4.2 of the Phase 4 spec, `_dev/docs/spec/phase-4-checks-and-preview.md`, carrying out its decisions 1 to 5 and 11: the upstream pin, the config file, the catalog definitions, the message box's offer, the credentials from the shell, and Structure and the rejection count on real catalogs.

## Scope

- The config file, `a2ui-spectra.json`, and the `--config <path>` option on both entry points, with the agent's URL, the catalog paths, the preview pages and the headers; the schema the file is validated against, served by the running tool.
- The catalog registry: the basic catalogs of v0.9 and v1.0 and v1.0's catalog definition meta-schema copied at the pin, the configured and the inline catalogs, the v0.9.1 alias; the API serving the definitions.
- The message box advertising the configured catalogs, and sending the agent's credentials from the shell; the card fetch at start carrying them.
- Structure and the rejection count on real catalogs.
- The protocol schemas re-copied where they changed between the pins; SPEC.md's upstream reference line at the pin.
- The unit tests, the end-to-end test and the test data.

Out of scope, as the Phase 4 spec has it: the turn record's amendments and the three checks, sub-task 4.3; routing a surface to a page and the use of the preview pages, sub-task 4.4; a `--header` option on the command line and the box sending catalogs inline, the backlog.

## Locked decisions

### 1. The config file's shape

Four top-level settings. `agent` is an object holding `url` and a `headers` map. `catalogs` is a list of paths. `preview` is a list of page URLs. A `$schema` key is accepted and ignored by the loader. Later phases add their settings as further top-level keys.

### 2. Paths resolve against the config file's directory

A relative path in `catalogs` is resolved against the directory the config file sits in, wherever Spectra is launched from. An absolute path passes through unchanged.

### 3. The loader is strict

Spectra stops at start, naming the file, the key and the problem, when `--config` names a file that does not exist; when the file is not valid JSON or a setting has the wrong type; when the file holds an unknown key; when a `catalogs` entry does not load; when two configured definitions carry the same catalog id; and when a configured definition claims a basic catalog's id. The default `a2ui-spectra.json` being absent is the one quiet case.

### 4. Precedence and the optional URL

A command-line option takes precedence over the file, and the file over the default. With `agent.url` in the file, `attach`'s argument and `run`'s option may be omitted; with neither given, Spectra stops naming both ways. Ports and the allowed hosts stay command-line only.

### 5. The config schema

The schema the loader validates against is written once, as the same document an editor validates against. The running tool serves it at a fixed path, and the README shows the `$schema` line that points there. A stable public URL for it is Phase 9's.

### 6. Read once at start

Configured catalogs are read into the registry at start. A changed definition needs a restart, which the README says. Reload belongs to Phase 8, the dev loop.

### 7. The preview list

The `preview` setting is loaded and validated in this sub-task and consumed in sub-task 4.4.

### 8. The substitution

The bare `${VAR}` form only, with no default and no escape, replaced from Spectra's environment when the box sends. It runs on header values only.

### 9. The box's own headers win

A configured header with the same name as one of the box's own transport headers does not replace it. The README says so in one line.

### 10. An unset variable at start

An unset variable is reported once at start. The card fetch goes ahead with the headers that resolved and without the one that did not, and the wait line names the status the card answered with, when it answered with one, and the unset variable beside it. The box refuses to send, naming the variable, in the line where the composer already says why it cannot send.

### 11. Id clashes in the registry

Resolution order is the Phase 4 spec's: the built-in basic catalogs, the configured catalogs, the inline catalogs of the turn's own host message. Repeated ids among configured files, and a configured file claiming a basic catalog's id, stop at start, as decision 3 has it. An inline catalog whose id a configured catalog already carries is not an error: the order resolves it to the configured definition, and the viewer shows which definition was used.

### 12. What a configured definition is validated against

A definition naming protocol version "1.0" is validated against upstream's catalog definition meta-schema, copied at the pin. A definition naming no version, or "0.9", must parse as JSON, carry a string `catalogId`, and compile as a draft 2020-12 schema. Both are then built through web core's `fromJson`. A component or function the definition's maps name that `fromJson` dropped, for not being listed under `anyComponent` or `anyFunction`, is an error at start.

### 13. The inline branch's two shapes

Under v1.0 an inline catalog is a full definition and is built as a file is. Under v0.9 and v0.9.1 the legacy shape that upstream's capabilities schema fixes, with `functions` as an array and a `theme` map and no `$defs`, is normalised into the file shape before `fromJson`: the functions into a map, the theme under `$defs`, and `anyComponent` and `anyFunction` synthesised from the maps. An inline item that already carries `$defs` passes as it is.

### 14. The alias on both faces

The v0.9.1 basic catalog URL is a second id of the v0.9 basic catalog. A schema-only catalog built from the copied v0.9 definition under the v0.9.1 URL is registered in the rejection count's and the viewer replay's processor beside web core's own, so a surface naming either URL resolves. Under the "v0.9.1" capabilities key the box advertises both URLs; under "v0.9" the v0.9 URL alone; under each version, every configured catalog whose protocol version matches, as the Phase 4 spec's decision 4 has it. The agent's own catalog ids from its card are shown as they come.

### 15. One route for the definitions

`GET /api/catalogs` answers every built-in and configured definition in one payload. Each entry carries the catalog id, its alias ids, its protocol version, where it came from and the definition itself. The viewer loads it once at connect, takes inline catalogs from the turn record, and names a configured catalog in the context bar by the title the payload carries.

### 16. The copies and the pin

The v0.9 basic catalog, the v1.0 basic catalog and v1.0's catalog definition meta-schema are copied from upstream at 409ded29c beside the protocol schemas, one folder per version, with the README's pin line moved to the commit and each source path named, following sub-task 2.4's copying rule. The protocol schema files that changed between the two pins are re-copied. SPEC.md's upstream reference line moves to the pin.

### 17. Tests and test data

Unit tests cover the loader, with precedence, path resolution, the strict failures and the substitution; the registry, with the resolution order, the alias, the id clashes, the meta-schema and the three facts, the dropped-entry error, and the legacy normalisation against Phase 1's custom components fixture; the box, with the configured headers on its requests and on the card fetch through the test fake agent, and the wait line's status wording; the offer with a configured catalog under the matching versions; and the rejection count and the viewer's replay on A2UIVerse's CircleCI recording with its definition configured, nesting where the stand-in left the tree flat and rejecting a bad prop.

The stub agent gains an option that makes it answer 401 on JSON-RPC without a bearer token, the card staying public. The end-to-end test writes a config file in a temporary directory with the agent's URL, the header as a `${VAR}` and a configured catalog, runs `attach --config` with no URL argument and the variable set, and sees the turn land with the configured id in the offer; a second run with the variable unset sees the box refuse with the wording of sub-task 4.1's board.

The CircleCI catalog definition from the A2UIVerse apps repo, and upstream's `custom_catalog_v1_0.json` and `composition_catalog_v1_0.json` from its conformance test data at the pin, join the test data with a README naming each source.

## Invariants

- The config file holds variable names, never values. No credential reaches the record, and HTTP headers are not recorded.
