/**
 * The Lit preview adapter: one custom element, placed in the adopter's page
 * where their real host's context providers sit. It runs the preview
 * protocol through the core, with a web core message processor holding the
 * page's catalogs, and draws the surface each render names with upstream's
 * `<a2ui-surface>`, in its own light DOM so the page's styles reach it.
 * Opened on its own, outside Spectra, the page says what it is.
 */
// Registers `<a2ui-surface>`.
import '@a2ui/lit/v0_9';
import type {LitComponentApi} from '@a2ui/lit/v0_9';
import {type Catalog, MessageProcessor, type SurfaceModel} from '@a2ui/web_core/v0_9';
import {
  type PageEvents,
  type PreviewAdapter,
  type PreviewPage,
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
import {html, LitElement, nothing, type PropertyValues} from 'lit';
import {keyed} from 'lit/directives/keyed.js';

/** A processor the core made, and the way to stop watching it. */
interface Held {
  processor: MessageProcessor<LitComponentApi>;
  generation: number;
  stopWatching: () => void;
  surfaceId?: string;
}

/** What is drawn: a processor's surface, keyed by the processor so a new one remounts. */
interface Drawn {
  generation: number;
  surface: SurfaceModel<LitComponentApi>;
}

export class SpectraPreviewElement extends LitElement {
  static override properties = {catalogs: {attribute: false}};

  /**
   * The catalogs the page renders, implementations and all, as the real host
   * passes them to its message processor. They are the page's claims: each
   * catalog's id and protocol version tell Spectra which surfaces to send.
   * They are read once, when the element is first connected with them.
   */
  declare catalogs: ReadonlyArray<Catalog<LitComponentApi>> | undefined;

  readonly #origin = viewerOriginOf(window.location.search);
  #page: PreviewPage | undefined;
  #drawn: Drawn | undefined;

  override createRenderRoot(): this {
    return this;
  }

  override connectedCallback(): void {
    super.connectedCallback();
    this.#start();
  }

  override disconnectedCallback(): void {
    super.disconnectedCallback();
    this.#page?.stop();
    this.#page = undefined;
  }

  protected override updated(changed: PropertyValues<this>): void {
    if (changed.has('catalogs')) this.#start();
  }

  #start(): void {
    const origin = this.#origin;
    if (this.#page !== undefined || !this.isConnected || origin === undefined) return;
    if (this.catalogs === undefined) return;
    const catalogs = [...this.catalogs];
    let made = 0;
    let shown: Held | undefined;
    const show = (held: Held) => {
      shown = held;
      const surface =
        held.surfaceId === undefined ? undefined : held.processor.getSurface(held.surfaceId);
      const before = this.#drawn;
      if (before?.surface === surface && before?.generation === held.generation) return;
      this.#drawn = surface === undefined ? undefined : {generation: held.generation, surface};
      this.requestUpdate();
    };
    const adapter: PreviewAdapter<Held> = {
      createProcessor: (events: PageEvents) => {
        guardUniversalElements(events.componentFailed);
        const processor: MessageProcessor<LitComponentApi> = new MessageProcessor<LitComponentApi>(
          [...catalogs],
          actionHandlerFor(events, () => processor),
        );
        made += 1;
        const held: Held = {
          processor,
          generation: made,
          stopWatching: watchProcessor(processor, events, surface => {
            if (surface.id === held.surfaceId && shown === held) show(held);
          }),
        };
        return held;
      },
      feed: (held, message) => {
        held.processor.processMessages(
          message as Parameters<MessageProcessor<LitComponentApi>['processMessages']>[0],
        );
      },
      mount: (held, surfaceId) => {
        held.surfaceId = surfaceId;
        show(held);
      },
      teardown: held => {
        held.stopWatching();
        held.processor.dispose();
        if (shown === held) {
          shown = undefined;
          this.#drawn = undefined;
          this.requestUpdate();
        }
      },
    };
    this.#page = startPreviewPage({
      catalogs,
      adapter,
      transport: windowTransport(origin),
      errors: windowErrors(),
    });
  }

  override render() {
    if (this.#origin === undefined) {
      return html`<p style="margin: 16px; font: 14px/1.5 system-ui, sans-serif">
        ${STANDALONE_LINE}
      </p>`;
    }
    const drawn = this.#drawn;
    return drawn === undefined
      ? nothing
      : keyed(
          `${drawn.generation}:${drawn.surface.id}`,
          html`<a2ui-surface .surface=${drawn.surface}></a2ui-surface>`,
        );
  }
}

customElements.define('a2ui-spectra-preview', SpectraPreviewElement);

declare global {
  interface HTMLElementTagNameMap {
    'a2ui-spectra-preview': SpectraPreviewElement;
  }
}
