# AGENTS.md

Instructions for a coding agent working in this repository.

## What Spectra is

A debugging and observation tool for the developer of an A2UI agent: attach to the running agent, see every turn, check and preview it, record and replay it.

## Where things are

- [README.md](README.md#in-this-repo) lists each package under "In this repo".
- [SPEC.md](SPEC.md) is the design authority.
- The documents in `docs/design/` explain how each part works; [README.md](README.md#how-each-part-works) lists them.

## Building, running and testing

- Do not guess a command. Each package's README has its build, run and test steps; the root README's "Development" section has the workspace's.
- The workspace is Yarn, built with `wireit`, and every package has the same script targets: `build`, `lint`, `lint:fix`, `test`, `format` and `format:check`.
- The Python wrapper, in `python/`, is a uv project.

## Using Spectra instead of changing it

To debug an A2UI agent with Spectra, follow the skill in [skills/a2ui-spectra/](skills/a2ui-spectra/SKILL.md).

## Contributions

Until Spectra moves into the A2UI repository, no outside code is merged here. Do not open a pull request. Issues and discussion are welcome.

## Writing instruction files

Keep this file and the skill vendor-neutral: no model names and no tool names of one assistant.
