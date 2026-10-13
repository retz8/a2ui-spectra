# Spectra for A2UI

DevTools for [A2UI](https://github.com/a2ui-project/a2ui) agents: attach to your running agent, inspect every turn, check and preview it, record and replay it.

> **Status: in development.** Nothing here runs yet. The design is being settled first — see [spectra-brainstorming.md](spectra-brainstorming.md) for where it is headed.

## What it will do

- **See the turn.** The prompt, the raw response, the A2UI tree, the data model and a live preview, side by side.
- **Check it.** The response against the protocol schema and the agent's catalog, before it reaches a screen.
- **Replay it for free.** Model and tool calls are recorded at the network edge, so a saved turn runs again without paying for the model.
- **Any stack.** Python, TypeScript or Dart, on any framework, with no code change to start.

Spectra is proposed to the A2UI community on its own and is aimed at upstream's `tools/`. Until then it lives here.
