# Turn record v0.1

This directory contains version 0.1 of the A2UI turn record: a file format for one turn of an A2UI agent, with the earlier turns of its conversation. A fixture is a turn record. Every capture path writes it: Spectra's proxies and receiver, the wrappers, and any producer of the A2UI step.

## Status

**This version is a draft.** It is amended in place until the first release of Spectra ships it, which closes it. A release reads the versions it knows and refuses a record of any other, one of a newer version with a line naming the version met, the versions it reads and Spectra as the side to upgrade. The rules are in the turn record's [Versions](docs/turn_record.md#versions) section.

## The specification

- [Turn record](docs/turn_record.md): the file, its events and their attributes, the producers of the A2UI step, and the rules a reader follows.
- How Spectra writes and reads it, part by part: the design docs under [`docs/design/`](../../../docs/design), such as [The A2UI step](../../../docs/design/a2ui-step.md).

## The schemas

- [`json/turn_record.json`](json/turn_record.json): the normative definition of the record file, in JSON Schema draft 2020-12.
- `json/gen-ai-*.json`: OpenTelemetry's GenAI content schemas, copied unchanged from the pinned release named in the prose. `turn_record.json` references them by relative path.

## The test data

The shared test data, which every capture path in every language is held to, lives in [`conformance/`](../../../conformance/README.md).
