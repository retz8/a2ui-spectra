# Turn record v0.1

This directory contains version 0.1 of the A2UI turn record: a file format for one turn of an A2UI agent, with the earlier turns of its conversation. A fixture is a turn record.

**This version is a draft.** Any amendment bumps the version.

## v0.1 Documentation

- [Turn record](docs/turn_record.md)

## Schemas

- [`json/turn_record.json`](json/turn_record.json): the normative definition of the record file, in JSON Schema draft 2020-12.
- `json/gen-ai-*.json`: OpenTelemetry's GenAI content schemas, copied unchanged from the pinned commit named in the prose. `turn_record.json` references them by relative path.

The shared test data lives in [`conformance/`](../../../conformance).
