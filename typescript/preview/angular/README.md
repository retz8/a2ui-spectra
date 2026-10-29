# a2ui-spectra-preview-angular

The Angular preview adapter of Spectra for A2UI: one standalone component that lets Spectra's viewer draw your catalog's surfaces with your own implementation, on upstream's Angular renderer, at the versions your real host uses. It runs the preview protocol through the core in [`../core/`](../core).

## Adding a preview page

1. Add the adapter as a dev dependency. It takes `@a2ui/angular` 0.13, `@a2ui/web_core` 0.14 and Angular 21 as peer dependencies, so the preview runs on yours.
2. Add a small page to the catalog's dev server: an application bootstrapped with the same `provideA2Ui` config your real host's app config has, and `provideMarkdownRenderer` when your host uses one, whose root component holds `<a2ui-spectra-preview />`:

   ```ts
   import {provideA2Ui, provideMarkdownRenderer} from '@a2ui/angular/v0_9';
   import {renderMarkdown} from '@a2ui/markdown-it';
   import {Component, provideZonelessChangeDetection} from '@angular/core';
   import {bootstrapApplication} from '@angular/platform-browser';
   import {SpectraPreviewComponent} from 'a2ui-spectra-preview-angular';

   import {myCatalog} from './catalog';

   @Component({
     selector: 'app-preview',
     imports: [SpectraPreviewComponent],
     template: '<a2ui-spectra-preview />',
   })
   class PreviewPage {}

   bootstrapApplication(PreviewPage, {
     providers: [
       provideZonelessChangeDetection(),
       provideA2Ui({catalogs: [myCatalog]}),
       provideMarkdownRenderer(renderMarkdown),
     ],
   });
   ```

3. Name the page's URL in Spectra's config file, under `preview`.

The component takes no inputs. It reads the page's renderer config, `useUniversalComponents` and `processorOptions` included, and for each processor it needs gives upstream's `<a2ui-v09-surface>` a fresh `A2uiRendererService` in a child injector, with Spectra's action handler in place of the config's. The config's catalogs are the page's claims: Spectra sends the page every surface whose catalog one of them carries, at a compatible protocol version. Opened on its own, outside Spectra, the page shows one line saying what it is.

The sample catalog app in [`../../../samples/preview/angular/`](../../../samples/preview/angular) is a worked example.

## What it reports

- **A component that throws while drawing.** Angular has no error boundary: the error reaches the application's `ErrorHandler`, which is not told which component threw. The adapter wraps the page's handler, reports each error as "A component did not render." with the error's name and message, and hands it on to the page's own handler. A page that sets `useUniversalComponents` has its components drawn as web core's universal elements, guarded at their updates through the core's web core part, which names them.
- **An error web core reports on the surface** through its error channel, such as an unknown component type.
- **A message the page's processor refuses.**
- **The surface's data model**, as it is created and whenever the agent's messages or typing in the page change it.
- **An action**, with the surface's data model at that moment, when a control is pressed.

## Commands

From `typescript/preview/angular/`:

- `yarn build`: builds the core, then the adapter with upstream's `ng-packagr` builder, compiled in partial mode into `dist/` in the Angular package format.
- `yarn lint` and `yarn lint:fix`: ESLint with the root ESLint preset.
- `yarn format` and `yarn format:check`: Prettier, with the root `.prettierignore`.

The adapter has no unit tests of its own. What it shares with the other adapters is the core's web core part, unit-tested there; the browser end-to-end test, `tools/spectra/src/samples_end_to_end.test.ts`, covers the rest through the Angular sample catalog app.
