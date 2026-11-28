/**
 * The Angular test page: the Angular preview adapter's component with the
 * test catalog, in which the thrower is an Angular component, and an error
 * handler and an action handler of the page's own, which record what they
 * are given. Universal components are on, which the basic catalog's
 * components need, and a component of Angular's own inside one of them
 * throws to the window; with `native` in the page's address they are off, so
 * that Angular draws a surface of the thrower alone itself and its throw
 * reaches the error handler; with `options` the config carries a host's
 * processor options, whose channel to the agent records what it is sent.
 * Opened on its own, outside Spectra, the page bootstraps without
 * the renderer config, so the browser tests see the adapter needs none
 * there. `window.spectraTestPage` holds what the handlers recorded and
 * destroys the application.
 */
import {
  AngularCatalog,
  BASIC_COMPONENTS,
  BASIC_FUNCTIONS,
  CatalogComponent,
  createComponentImplementation,
  provideA2Ui,
} from '@a2ui/angular';
import {BasicCatalogThemeSchema} from '@a2ui/web_core/v0_9/basic_catalog';
import {
  ChangeDetectionStrategy,
  Component,
  ErrorHandler,
  Injectable,
  provideZonelessChangeDetection,
} from '@angular/core';
import {bootstrapApplication} from '@angular/platform-browser';
import {VIEWER_PARAMETER} from 'a2ui-spectra-preview';
import {SpectraPreviewComponent} from 'a2ui-spectra-preview-angular';

import {
  hostProcessorOptions,
  OPTIONS_PARAMETER,
  TEST_CATALOG_ID,
  THROWER_FAILURE,
  throwerApi,
} from '../shared/thrower';

@Component({
  selector: 'test-thrower',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: '<span class="thrower">{{ text() }}</span>',
})
class ThrowerComponent extends CatalogComponent<typeof throwerApi> {
  protected text(): string {
    if (this.props()['fail']?.value() === true) throw new Error(THROWER_FAILURE);
    return this.props()['text']?.value() ?? 'Thrower';
  }
}

const testCatalog = new AngularCatalog(
  TEST_CATALOG_ID,
  '0.9',
  [...BASIC_COMPONENTS, createComponentImplementation(throwerApi, ThrowerComponent)],
  BASIC_FUNCTIONS,
  BasicCatalogThemeSchema,
);

const pageErrors: string[] = [];
const pageActions: unknown[] = [];
/** What the host's own channel to its agent is sent. */
const hostSent: unknown[] = [];

@Injectable()
class RecordingErrorHandler extends ErrorHandler {
  override handleError(error: unknown): void {
    pageErrors.push(String(error));
    super.handleError(error);
  }
}

@Component({
  selector: 'test-page',
  imports: [SpectraPreviewComponent],
  template: '<a2ui-spectra-preview />',
})
class TestPage {}

const parameters = new URLSearchParams(window.location.search);
const inSpectra = parameters.has(VIEWER_PARAMETER);

bootstrapApplication(TestPage, {
  providers: [
    provideZonelessChangeDetection(),
    {provide: ErrorHandler, useClass: RecordingErrorHandler},
    ...(inSpectra
      ? [
          provideA2Ui({
            catalogs: [testCatalog],
            useUniversalComponents: !parameters.has('native'),
            ...(parameters.has(OPTIONS_PARAMETER) && {
              processorOptions: hostProcessorOptions(hostSent),
            }),
            actionHandler: action => {
              pageActions.push(action);
            },
          }),
        ]
      : []),
  ],
})
  .then(application => {
    const handler = application.injector.get(ErrorHandler);
    Object.assign(window, {
      spectraTestPage: {
        pageErrors,
        pageActions,
        hostSent,
        destroy: () => application.destroy(),
        /** Whether the page's error handler holds a handleError other than its class's. */
        errorHandlerReplaced: () => Object.prototype.hasOwnProperty.call(handler, 'handleError'),
      },
    });
  })
  .catch(error => console.error(error));
