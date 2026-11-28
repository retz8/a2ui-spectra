/**
 * The Angular preview adapter: one standalone component, placed in the
 * adopter's page, which bootstraps with the `provideA2Ui` config, and
 * `provideMarkdownRenderer` when the host uses one, that their real host's
 * app config has. It runs the preview protocol through the core: each
 * processor the core asks for lives in a fresh `A2uiRendererService`, in a
 * child injector given the page's config with Spectra's action handler in
 * place of the page's, and the surface each render names is drawn with
 * upstream's `<a2ui-v09-surface>` under that injector. Opened on its own,
 * outside Spectra, the page says what it is.
 */
import {
  A2UI_RENDERER_CONFIG,
  type AngularComponentImplementation,
  A2uiRendererService,
  type RendererConfiguration,
  SurfaceComponent,
} from '@a2ui/angular/v0_9';
import {NgComponentOutlet} from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  type DestroyableInjector,
  DestroyRef,
  ErrorHandler,
  inject,
  Injector,
  signal,
} from '@angular/core';
import {type PageEvents, STANDALONE_LINE, viewerOriginOf} from 'a2ui-spectra-preview';
import {type MadeProcessor, startWebPreviewPage} from 'a2ui-spectra-preview/web-core';

/** A processor the core made: its service, and the injector holding it. */
interface Made extends MadeProcessor<AngularComponentImplementation> {
  injector: DestroyableInjector;
}

/** What is drawn: a surface under its processor's injector, keyed by the processor so a new one remounts. */
interface Drawn {
  generation: number;
  surfaceId: string;
  injector: Injector;
}

/**
 * Reports every error the page's handler is given, then hands it on, until
 * the returned way to stop is called, which gives the handler back. Angular
 * has no error boundary: a component that throws while drawing reaches the
 * application's `ErrorHandler`, which is not told which component it was.
 */
function wrapErrorHandler(handler: ErrorHandler, report: (error: unknown) => void): () => void {
  const ownBefore = Object.prototype.hasOwnProperty.call(handler, 'handleError');
  const handOn = handler.handleError;
  let reporting = true;
  const wrapped = (error: unknown) => {
    if (reporting) report(error);
    handOn.call(handler, error);
  };
  handler.handleError = wrapped;
  return () => {
    reporting = false;
    // Wrapped again since, the later wrapper hands on to this one, which now only hands on.
    if (handler.handleError !== wrapped) return;
    if (ownBefore) handler.handleError = handOn;
    else delete (handler as Partial<ErrorHandler>).handleError;
  };
}

/**
 * The Angular preview adapter's component, `<a2ui-spectra-preview>`: draws the
 * surfaces Spectra sends, with the page's `provideA2Ui` config.
 */
@Component({
  selector: 'a2ui-spectra-preview',
  imports: [NgComponentOutlet],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (standalone) {
      <p style="margin: 16px; font: 14px/1.5 system-ui, sans-serif">{{ standaloneLine }}</p>
    } @else if (drawn(); as shown) {
      <ng-container
        *ngComponentOutlet="
          surfaceComponent;
          injector: shown.injector;
          inputs: {surfaceId: shown.surfaceId}
        "
      />
    }
  `,
})
export class SpectraPreviewComponent {
  protected readonly surfaceComponent = SurfaceComponent;
  protected readonly standaloneLine = STANDALONE_LINE;
  private readonly origin = viewerOriginOf(window.location.search);
  protected readonly standalone = this.origin === undefined;
  protected readonly drawn = signal<Drawn | undefined>(undefined);

  constructor() {
    const origin = this.origin;
    if (origin === undefined) return;
    const config: RendererConfiguration = inject(A2UI_RENDERER_CONFIG);
    const parent = inject(Injector);
    /** Where an error the page's handler is given is reported: the current processor's events. */
    let failed: PageEvents['componentFailed'] | undefined;
    const giveHandlerBack = wrapErrorHandler(inject(ErrorHandler), error => failed?.({error}));
    const page = startWebPreviewPage<AngularComponentImplementation, Made>({
      catalogs: config.catalogs,
      viewerOrigin: origin,
      processorOptions: config.processorOptions,
      makeProcessor: ({actionHandler, options, componentFailed}) => {
        failed = componentFailed;
        const injector = Injector.create({
          providers: [
            {
              provide: A2UI_RENDERER_CONFIG,
              useValue: {...config, actionHandler, processorOptions: options},
            },
            {provide: A2uiRendererService},
          ],
          parent,
        });
        const service = injector.get(A2uiRendererService);
        return {
          processor: service.processor,
          injector,
          feed: message =>
            service.processMessages(
              message as Parameters<A2uiRendererService['processMessages']>[0],
            ),
          // The service disposes of its processor as its injector is destroyed.
          dispose: () => injector.destroy(),
        };
      },
      draw: drawn =>
        this.drawn.set(
          drawn === undefined
            ? undefined
            : {
                generation: drawn.generation,
                surfaceId: drawn.surface.id,
                injector: drawn.made.injector,
              },
        ),
    });
    inject(DestroyRef).onDestroy(() => {
      page.stop();
      giveHandlerBack();
      failed = undefined;
    });
  }
}
