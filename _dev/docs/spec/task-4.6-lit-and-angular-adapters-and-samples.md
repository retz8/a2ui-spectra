# Sub-task 4.6 — The Lit and Angular adapters and the sample catalog apps

The Lit and Angular preview adapters, the web core part of the core they share with the React adapter, the three sample catalog apps with their preview pages, and the end-to-end test through them. Sub-task 4.6 of the Phase 4 spec, `_dev/docs/spec/phase-4-checks-and-preview.md`, carrying out its decision 13, the core and the adapters, and its decision 20, the sample catalog apps, with the end-to-end test of its decision 22; and the adapters reporting the shown surface's data model as it changes, as sub-task 4.5's decision 7 has it.

## Scope

- The core's web core part, shared by the three adapters.
- The Lit adapter.
- The Angular adapter, its build and its component failures.
- The sample catalog and the three sample apps, each with its preview page and its config file.
- The stub agent's canned A2UI conversation in the sample catalog.
- The browser end-to-end test, the unit tests, the done line and the other documents.

Out of scope: the Lit and Angular samples by hand through the tunnel, in light and dark, sub-task 4.7; a v1.0 surface through the Lit and Angular adapters, which stays unproven in Phase 4, the built-in page proving the React adapter on v1.0.

## Locked decisions

### 1. One sample catalog

One sample catalog, with one definition and one catalog id, shared by the three sample apps and implemented in React, Lit and Angular, one implementation per app. The end-to-end test starts Spectra once per sample, with only that sample's page configured.

### 2. Its protocol version

The sample catalog is a v0.9 catalog: its definition names no version, so it serves v0.9 and v0.9.1 surfaces.

### 3. Its custom component

The custom component is a `CustomSlider` as upstream's Lit and Angular explorers have it at the pin, with a label, a value, a minimum and a maximum: it binds a number and writes it back to the data model. The sample catalog is the v0.9 basic catalog's components and the `CustomSlider` under the sample's own id, its definition copying the basic catalog's components as upstream's `samples/agent/adk/custom-components-example/inline_catalog_0.9.json` does. Each sample page passes only the sample catalog.

### 4. Where the samples live

A top-level `samples/preview/` holds the shared definition, `catalog.json`, as a plain file, and the three apps, `react/`, `lit/` and `angular/`, each a private workspace, named `a2ui-spectra-sample-preview-react`, `a2ui-spectra-sample-preview-lit` and `a2ui-spectra-sample-preview-angular`. The root workspaces gain `samples/preview/*`. The React and Lit apps run on Vite and the Angular app on the Angular CLI.

### 5. Each sample's config file

Each sample's folder commits its own `a2ui-spectra.json`, naming the shared catalog definition and its own preview page at a fixed localhost port, and no agent URL. The end-to-end test uses it as written, with `--config`, and starts the sample's dev server on that port with a strict port, so a clash fails.

### 6. The core's web core part

The core takes `@a2ui/web_core` ^0.14 as a peer dependency and holds the processor setup the three adapters share: the action handler sending the action with the surface's data model at that moment, each created surface's error channel reported, and its data model reported as the surface appears and on every change. The guard on web core's `A2uiLitElement` moves into it from the React adapter. Each adapter still makes its own processor and passes it to the core's setup; the four things an adapter gives the core, making a processor, feeding it one message, mounting a surface and tearing down, stay as sub-task 4.4 has them.

### 7. The Lit adapter

The Lit adapter is a custom element, `<a2ui-spectra-preview>`, with a `catalogs` property: the Lit counterpart of the React adapter's component, placed in the adopter's page where their real host's context providers sit. It renders upstream's `<a2ui-surface>` into its own light DOM. Every Lit component, the basic catalog's and a custom one, is an `A2uiLitElement` subclass, so the core's guard names a component that throws.

### 8. The Angular adapter

The Angular adapter is a standalone component, `<a2ui-spectra-preview>`, with no inputs. It reads the page's own `provideA2Ui` config, and `provideMarkdownRenderer` when the page uses it, as the real host's app config has them. For each processor the core makes, it builds a child injector with a fresh `A2uiRendererService`, given the page's config with Spectra's action handler in place of the page's, and draws `<a2ui-v09-surface>` under it. Its claims come from the config's catalogs.

### 9. The Angular adapter's build

The Angular adapter is built as upstream builds `@a2ui/angular`: an `angular.json` with the `@angular/build:ng-packagr` builder and partial compilation, run under wireit. It takes `@angular/core`, `@angular/common` and `@angular/platform-browser` at ^21.2.5 as peer dependencies, the range `@a2ui/angular` 0.13.0 takes.

### 10. An Angular component that throws

The Angular adapter wraps the page's `ErrorHandler`. Each error is reported as a component failure with no component, "A component did not render." with the error's name and message, and then passed on to the page's own handler. A page that sets `useUniversalComponents` has its components named through the core's guard.

### 11. The stub agent picks the sample catalog by negotiation

In the stub agent's canned A2UI conversation, when the host's capabilities offer the sample catalog's id, the stub answers in the newest version that offers it, v0.9.1 under the message box's offer, with a surface in the sample catalog created with `sendDataModel`: a `CustomSlider` bound to a value and a `Button` whose action's context carries it. Its reply echoes the action's context and the data model it received. When the sample catalog is not offered, the conversation is as before.

### 12. The browser end-to-end test

A new test file in `tools/spectra`, beside the existing end-to-end test, run under Node and against the binary. It drives Chromium through Playwright 1.58.1, upstream's version, as a library from `node:test`; CI gains upstream's Chromium install step. For each sample in turn, on one A2A version, the stub's default: the surface is drawn in the Preview pane by the sample's page, the pane's header naming the page's URL and the `CustomSlider` drawn; the slider is moved and the `Button` pressed; the pending action carries the value; it is sent; and the new turn lands with the stub's reply echoing the value in the action's context and in the data model.

### 13. Unit tests

Unit tests of the core's web core part under Node, against a real web core processor. The Lit and Angular adapters have no unit tests of their own.

### 14. Other documents

- The Phase 4 spec is amended in place: decision 13, the core and the adapters, gaining the core's web core peer dependency and the processor setup it holds, the Angular adapter reading the page's `provideA2Ui` config, and its build with upstream's ng-packagr builder; decision 20, the sample catalog apps, becoming one v0.9 sample catalog, the basic components and the `CustomSlider`, implemented once per framework under `samples/preview/`, each app committing its own `a2ui-spectra.json`; decision 22, the tests, gaining the browser test on Playwright's Chromium, one sample at a time on one A2A version, and the stub agent picking the sample catalog by negotiation.
- `_dev/TODO.md`: the 4.6 line names this spec.
- `_dev/a2ui-findings.md` gains a finding: neither the Lit nor the Angular renderer catches a component's failure. Lit's `A2uiLitElement` has no catch around its update, and `<a2ui-surface>`'s covers only the root; Angular's component host has none, and the error reaches the `ErrorHandler` without the component.
- The READMEs: the core's, for its web core part; the React adapter's, its setup moved to the core; the Lit and Angular adapters', new; each sample's, as the worked example of running it with Spectra; the tool's, for the browser test and installing Chromium; `conformance/README.md`, for the canned conversation in the sample catalog.
- The CI workflow: upstream's Chromium install step.
- SPEC.md, the turn record and the design canvas are unchanged.

### 15. Done when

The unit tests and the browser end-to-end test pass, under Node and against the binary, locally and in CI; and one render error provoked per new adapter, checked once through Playwright on the dev machine by a script that is not committed: the Lit one reaching the Preview pane's strip with its component named, the Angular one as "A component did not render.", each counted.

## Invariants

- The turn record is unchanged.
- The viewer's UI is unchanged.
