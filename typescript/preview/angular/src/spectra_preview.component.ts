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
  A2uiRendererService,
  type RendererConfiguration,
  SurfaceComponent,
} from '@a2ui/angular/v0_9';
import {NgComponentOutlet} from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  ErrorHandler,
  inject,
  Injector,
  signal,
} from '@angular/core';
import {
  type PageEvents,
  type PreviewAdapter,
  STANDALONE_LINE,
  startPreviewPage,
  viewerOriginOf,
  windowErrors,
  windowTransport,
} from 'a2ui-spectra-preview';
import {
  actionHandlerFor,
  guardUniversalElements,
  watchProcessor,
} from 'a2ui-spectra-preview/web-core';

/** A processor the core made: its service, the injector holding it, and the way to stop watching it. */
interface Held {
  injector: Injector & {destroy(): void};
  service: A2uiRendererService;
  generation: number;
  stopWatching: () => void;
  surfaceId?: string;
}

/** What is drawn: a surface under its processor's injector, keyed by the processor so a new one remounts. */
interface Drawn {
  generation: number;
  surfaceId: string;
  injector: Injector;
}

/** Where the page's error handler reports: the current processor's events. */
let reportTo: PageEvents['componentFailed'] | undefined;

const WRAPPED = Symbol.for('a2ui-spectra-preview-angular.wrapped');

/**
 * Reports every error the page's handler is given, then hands it on. Angular
 * has no error boundary: a component that throws while drawing reaches the
 * application's `ErrorHandler`, which is not told which component it was.
 */
function wrapErrorHandler(handler: ErrorHandler): void {
  const marked = handler as ErrorHandler & {[WRAPPED]?: true};
  if (marked[WRAPPED]) return;
  const handOn = handler.handleError.bind(handler);
  Object.defineProperty(marked, WRAPPED, {value: true});
  handler.handleError = (error: unknown) => {
    reportTo?.({error});
    handOn(error);
  };
}

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
  readonly #origin = viewerOriginOf(window.location.search);
  protected readonly standalone = this.#origin === undefined;
  protected readonly drawn = signal<Drawn | undefined>(undefined);

  constructor() {
    const origin = this.#origin;
    if (origin === undefined) return;
    const config: RendererConfiguration = inject(A2UI_RENDERER_CONFIG);
    const parent = inject(Injector);
    wrapErrorHandler(inject(ErrorHandler));
    let made = 0;
    let shown: Held | undefined;
    const show = (held: Held) => {
      shown = held;
      const surfaceId = held.surfaceId;
      const surface =
        surfaceId === undefined ? undefined : held.service.processor.getSurface(surfaceId);
      const before = this.drawn();
      if (before?.generation === held.generation && before.surfaceId === surface?.id) return;
      this.drawn.set(
        surface === undefined
          ? undefined
          : {generation: held.generation, surfaceId: surface.id, injector: held.injector},
      );
    };
    const adapter: PreviewAdapter<Held> = {
      createProcessor: (events: PageEvents) => {
        reportTo = events.componentFailed;
        guardUniversalElements(events.componentFailed);
        const injector = Injector.create({
          providers: [
            {
              provide: A2UI_RENDERER_CONFIG,
              useValue: {
                ...config,
                actionHandler: actionHandlerFor(events, () => service.processor),
              },
            },
            {provide: A2uiRendererService},
          ],
          parent,
        }) as Held['injector'];
        const service = injector.get(A2uiRendererService);
        made += 1;
        const held: Held = {
          injector,
          service,
          generation: made,
          stopWatching: watchProcessor(service.processor, events, surface => {
            if (surface.id === held.surfaceId && shown === held) show(held);
          }),
        };
        return held;
      },
      feed: (held, message) => {
        held.service.processMessages(
          message as Parameters<A2uiRendererService['processMessages']>[0],
        );
      },
      mount: (held, surfaceId) => {
        held.surfaceId = surfaceId;
        show(held);
      },
      teardown: held => {
        held.stopWatching();
        if (shown === held) {
          shown = undefined;
          this.drawn.set(undefined);
        }
        // The service disposes of its processor as its injector is destroyed.
        held.injector.destroy();
      },
    };
    const page = startPreviewPage({
      catalogs: config.catalogs,
      adapter,
      transport: windowTransport(origin),
      errors: windowErrors(),
    });
    inject(DestroyRef).onDestroy(() => {
      page.stop();
      reportTo = undefined;
    });
  }
}
