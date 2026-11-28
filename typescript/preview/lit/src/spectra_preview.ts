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
import {type Catalog, MessageProcessor} from '@a2ui/web_core/v0_9';
import {type PreviewPage, STANDALONE_LINE, viewerOriginOf} from 'a2ui-spectra-preview';
import {
  type DrawnSurface,
  type MadeProcessor,
  startWebPreviewPage,
} from 'a2ui-spectra-preview/web-core';
import {html, LitElement, nothing, type PropertyValues} from 'lit';
import {keyed} from 'lit/directives/keyed.js';

type Made = MadeProcessor<LitComponentApi>;

/**
 * The Lit preview adapter's element, `<a2ui-spectra-preview>`: draws the
 * surfaces Spectra sends, with the page's catalogs.
 */
export class SpectraPreviewElement extends LitElement {
  static override properties = {catalogs: {attribute: false}};

  /**
   * The catalogs the page renders, implementations and all, as the real host
   * passes them to its message processor. They are the page's claims: each
   * catalog's id and protocol version tell Spectra which surfaces to send.
   * They are read once, when the element is first connected with them.
   */
  declare catalogs: ReadonlyArray<Catalog<LitComponentApi>> | undefined;

  private readonly origin = viewerOriginOf(window.location.search);
  private page: PreviewPage | undefined;
  private drawn: DrawnSurface<LitComponentApi, Made> | undefined;

  override createRenderRoot(): this {
    return this;
  }

  override connectedCallback(): void {
    super.connectedCallback();
    this.start();
  }

  override disconnectedCallback(): void {
    super.disconnectedCallback();
    this.page?.stop();
    this.page = undefined;
  }

  protected override updated(changed: PropertyValues<this>): void {
    if (changed.has('catalogs')) this.start();
  }

  private start(): void {
    const origin = this.origin;
    if (this.page !== undefined || !this.isConnected || origin === undefined) return;
    if (this.catalogs === undefined) return;
    const catalogs = [...this.catalogs];
    this.page = startWebPreviewPage<LitComponentApi, Made>({
      catalogs,
      viewerOrigin: origin,
      makeProcessor: ({actionHandler}) => {
        const processor = new MessageProcessor<LitComponentApi>([...catalogs], actionHandler);
        return {processor, dispose: () => processor.dispose()};
      },
      draw: drawn => {
        this.drawn = drawn;
        this.requestUpdate();
      },
    });
  }

  // Declared as LitElement declares it, so that the types name nothing from lit-html, which the
  // adapter reaches only through lit.
  override render(): unknown {
    if (this.origin === undefined) {
      return html`<p style="margin: 16px; font: 14px/1.5 system-ui, sans-serif">
        ${STANDALONE_LINE}
      </p>`;
    }
    const drawn = this.drawn;
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
