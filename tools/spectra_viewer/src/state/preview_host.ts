/**
 * The preview pages, each in an iframe of its own: the configured pages in
 * config order, then the built-in page. Every page is loaded at connect and
 * stays loaded for the session, outside the viewer's React tree, so a turn
 * or a pane that remounts keeps the page and its processor. The iframe a
 * surface is routed to is laid over the Preview pane's frame; the others are
 * hidden.
 *
 * Each page's address carries the viewer's origin. A page that sends no
 * ready message within a few seconds is unanswered, and is reloaded every
 * few seconds until it answers. A render goes to a page's window with the
 * page's origin as its target, and only a message from one of the viewer's
 * own iframes, at that page's origin, is taken. Each render keeps the turn
 * and step it was asked for, so a press, which names its render, goes on as
 * pressed there even after a newer render went out.
 *
 * The iframes come after the viewer's tree, so a sentinel on each side of
 * them hands focus that leaves a page back beside the Preview pane, whose
 * own stop hands focus to the shown page.
 */
import {
  isPageMessage,
  type PageMessage,
  PREVIEW_PROTOCOL,
  type RenderMessage,
  type Report,
  VIEWER_PARAMETER,
} from 'a2ui-spectra-preview';
import {useSyncExternalStore} from 'react';

import {type Side, stopBeside} from '@/model/frame_focus.ts';
import type {PreviewPageState} from '@/model/preview.ts';

import type {Press, RenderContext} from './press.ts';

/** The built-in page's id and label. */
export const BUILT_IN = 'built-in';

/** Where Spectra serves the built-in page. */
const BUILT_IN_PATH = '/preview/';

/** How long a page has to say it is ready, and how often an unanswered page is reloaded. */
const ANSWER_MS = 5000;

/** How many of a page's latest renders keep their turn and step, for a press that comes late. */
const KEPT_RENDERS = 50;

export interface PageSnapshot extends PreviewPageState {
  /** The render last sent, by its surface and its messages. */
  sentKey?: string;
  /** What the page reported for the render last sent. */
  reports: Report[];
  /** The shown surface's data model, as the page sent it for the render last sent. */
  dataModel?: {surfaceId: string; dataModel: unknown};
}

/** A place on the screen, in the viewport's pixels. */
export interface Place {
  left: number;
  top: number;
  width: number;
  height: number;
}

interface Page {
  state: PageSnapshot;
  /** Its address, with the viewer's origin. */
  url: string;
  origin: string;
  iframe: HTMLIFrameElement;
  /** The running number of the render last sent. */
  render: number;
  timer?: ReturnType<typeof setTimeout>;
  /** The render asked for last, sent once the page is ready. */
  wanted?: {key: string; surfaceId: string; messages: unknown[]; context?: RenderContext};
  /** The turn and step of each of the latest renders, by its number. */
  contexts: Map<number, RenderContext>;
  seen: Set<string>;
}

/** The key a render is compared by: its surface and its messages. */
export function renderKeyOf(surfaceId: string, messages: readonly unknown[]): string {
  return `${surfaceId}\n${JSON.stringify(messages)}`;
}

/** What Tab can stop at. */
const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), iframe, [tabindex]';

const HIDDEN: Partial<CSSStyleDeclaration> = {
  visibility: 'hidden',
  left: '-10000px',
  top: '0px',
  width: '384px',
  height: '640px',
};

class PreviewHost {
  #pages: Page[] = [];
  #configured: string | undefined;
  #snapshot: readonly PageSnapshot[] = [];
  #listeners = new Set<() => void>();
  #container: HTMLDivElement | undefined;
  #renders = 0;
  #shown: string | undefined;
  #started = false;
  #presses = new Set<(press: Press) => void>();
  /** The Preview pane's stop, which takes the shown page's place in the tab order. */
  #entry: HTMLElement | undefined;
  #after: HTMLElement | undefined;

  subscribe = (listener: () => void): (() => void) => {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  };

  getSnapshot = (): readonly PageSnapshot[] => this.#snapshot;

  /** Calls back with each press a page reports, with the turn and step of its render. */
  onPress = (listener: (press: Press) => void): (() => void) => {
    this.#presses.add(listener);
    return () => this.#presses.delete(listener);
  };

  /** Loads the pages: the configured ones, in order, and the built-in one last. */
  configure(configured: readonly string[]): void {
    const key = JSON.stringify(configured);
    if (key === this.#configured) return;
    this.#configured = key;
    this.#start();
    for (const page of this.#pages) this.#remove(page);
    const origin = window.location.origin;
    const pages: Array<{id: string; label: string; url: URL}> = [];
    for (const address of configured) {
      try {
        pages.push({id: address, label: address, url: new URL(address)});
      } catch {
        // The server validated each URL; one this browser cannot read is left out.
      }
    }
    pages.push({id: BUILT_IN, label: BUILT_IN, url: new URL(BUILT_IN_PATH, origin)});
    this.#pages = pages.map(({id, label, url}) => {
      url.searchParams.set(VIEWER_PARAMETER, origin);
      const iframe = document.createElement('iframe');
      iframe.title = id === BUILT_IN ? 'Spectra’s built-in preview' : `Preview page ${label}`;
      Object.assign(iframe.style, {
        position: 'fixed',
        border: '0',
        borderRadius: '6px',
        background: 'transparent',
        ...HIDDEN,
      });
      const page: Page = {
        state: {id, label, status: 'waiting', claims: [], reports: []},
        url: url.href,
        origin: url.origin,
        iframe,
        render: 0,
        contexts: new Map(),
        seen: new Set(),
      };
      iframe.src = page.url;
      this.#container!.insertBefore(iframe, this.#after!);
      this.#arm(page);
      return page;
    });
    this.#publish();
  }

  /**
   * Asks a page to draw a surface from its list of messages, for a turn and
   * step. A render the page already has is not sent again, and takes the
   * turn and step asked for last; one asked of a page not ready yet is sent
   * once it is.
   */
  render(
    pageId: string,
    surfaceId: string,
    messages: readonly unknown[],
    context?: RenderContext,
  ): void {
    const page = this.#pages.find(candidate => candidate.state.id === pageId);
    if (page === undefined) return;
    const key = renderKeyOf(surfaceId, messages);
    page.wanted = {key, surfaceId, messages: [...messages], ...(context && {context})};
    if (page.state.status !== 'ready') return;
    if (page.state.sentKey !== key) this.#send(page);
    else if (context !== undefined) page.contexts.set(page.render, context);
  }

  /** Lays the iframe of a page over a place on the screen, hiding every other; none hides them all. */
  place(pageId: string | undefined, place?: Place): void {
    this.#shown = place === undefined ? undefined : pageId;
    for (const page of this.#pages) {
      if (place !== undefined && page.state.id === pageId) {
        Object.assign(page.iframe.style, {
          visibility: 'visible',
          left: `${place.left}px`,
          top: `${place.top}px`,
          width: `${place.width}px`,
          height: `${place.height}px`,
        });
      } else {
        Object.assign(page.iframe.style, HIDDEN);
      }
    }
  }

  #start(): void {
    if (this.#started) return;
    this.#started = true;
    const container = document.createElement('div');
    container.dataset.spectraPreviewFrames = '';
    Object.assign(container.style, {position: 'fixed', left: '0', top: '0', zIndex: '10'});
    document.body.append(container);
    this.#container = container;
    const sentinel = (side: Side) => {
      const element = document.createElement('span');
      element.tabIndex = 0;
      element.setAttribute('aria-hidden', 'true');
      element.addEventListener('focus', event => this.#leave(side, event.relatedTarget));
      return element;
    };
    this.#after = sentinel('after');
    container.append(sentinel('before'), this.#after);
    window.addEventListener('message', event => this.#receive(event));
    // A divider dragged across a frame would lose the pointer to the page; frames ignore it until it is let go.
    const pass = (on: boolean) => {
      for (const page of this.#pages) page.iframe.style.pointerEvents = on ? '' : 'none';
    };
    window.addEventListener('pointerdown', () => pass(false), true);
    window.addEventListener('pointerup', () => pass(true), true);
    window.addEventListener('pointercancel', () => pass(true), true);
  }

  #remove(page: Page): void {
    if (page.timer !== undefined) clearTimeout(page.timer);
    page.iframe.remove();
  }

  /** Waits for the page's ready message; with none in time, the page is unanswered and is reloaded. */
  #arm(page: Page): void {
    if (page.timer !== undefined) clearTimeout(page.timer);
    page.timer = setTimeout(() => {
      if (page.state.status === 'ready') return;
      if (page.state.status === 'waiting') this.#update(page, {status: 'unanswered'});
      page.iframe.src = page.url;
      this.#arm(page);
    }, ANSWER_MS);
  }

  #receive(event: MessageEvent): void {
    const page = this.#pages.find(candidate => candidate.iframe.contentWindow === event.source);
    if (page === undefined || event.origin !== page.origin || !isPageMessage(event.data)) return;
    const message: PageMessage = event.data;
    if (message.type === 'a2ui-spectra-preview/ready') {
      if (message.protocol !== PREVIEW_PROTOCOL) {
        this.#update(page, {status: 'mismatch', protocol: message.protocol, claims: []});
        return;
      }
      if (page.timer !== undefined) clearTimeout(page.timer);
      page.timer = undefined;
      // A page that is ready again, reloaded, holds nothing: the render asked for last goes again.
      const {sentKey: _sent, protocol: _protocol, dataModel: _dataModel, ...rest} = page.state;
      page.state = {...rest, status: 'ready', claims: message.claims, reports: []};
      page.seen = new Set();
      if (page.wanted !== undefined) this.#send(page);
      else this.#publish();
    } else if (message.type === 'a2ui-spectra-preview/report') {
      if (message.render !== page.render) return;
      const key = JSON.stringify(message.report);
      if (page.seen.has(key)) return;
      page.seen.add(key);
      this.#update(page, {reports: [...page.state.reports, message.report]});
    } else if (message.type === 'a2ui-spectra-preview/data-model') {
      if (message.render !== page.render) return;
      this.#update(page, {
        dataModel: {surfaceId: message.surfaceId, dataModel: message.dataModel},
      });
    } else {
      // A press goes on as pressed in its own render, whatever went out since.
      const context = page.contexts.get(message.render);
      if (context === undefined) return;
      const press: Press = {action: message.action, dataModel: message.dataModel, context};
      for (const listener of this.#presses) listener(press);
    }
  }

  #send(page: Page): void {
    const wanted = page.wanted;
    if (wanted === undefined) return;
    this.#renders += 1;
    page.render = this.#renders;
    page.seen = new Set();
    if (wanted.context !== undefined) page.contexts.set(page.render, wanted.context);
    for (const number of page.contexts.keys()) {
      if (number <= page.render - KEPT_RENDERS) page.contexts.delete(number);
    }
    const render: RenderMessage = {
      type: 'a2ui-spectra-preview/render',
      render: page.render,
      surfaceId: wanted.surfaceId,
      messages: wanted.messages,
    };
    page.iframe.contentWindow?.postMessage(render, page.origin);
    const {dataModel: _dataModel, ...rest} = page.state;
    page.state = rest;
    this.#update(page, {sentKey: wanted.key, reports: []});
  }

  #update(page: Page, change: Partial<PageSnapshot>): void {
    page.state = {...page.state, ...change};
    this.#publish();
  }

  #publish(): void {
    this.#snapshot = this.#pages.map(page => page.state);
    for (const listener of this.#listeners) listener();
  }

  /** Sets the Preview pane's stop, or clears it when the pane goes. */
  setEntry(element: HTMLElement | undefined): void {
    this.#entry = element;
  }

  /** Gives focus to the shown page. */
  focusShown(): void {
    this.#pages.find(page => page.state.id === this.#shown)?.iframe.focus();
  }

  /**
   * Hands focus that reached a sentinel to the viewer's stop beside the
   * Preview pane. Focus that leaves a page comes from no element of the
   * viewer's, or from the page's iframe; focus from one of the viewer's own
   * elements came by Tab past its last stop.
   */
  #leave(side: Side, from: EventTarget | null): void {
    const container = this.#container!;
    const stops = [...document.querySelectorAll<HTMLElement>(FOCUSABLE)].filter(
      element =>
        element.tabIndex >= 0 &&
        !container.contains(element) &&
        element.getClientRects().length > 0,
    );
    const fromViewer = from instanceof Node && !container.contains(from);
    const entry = this.#shown === undefined ? undefined : this.#entry;
    stopBeside(stops, entry, side, fromViewer)?.focus();
  }

  /** Whether a page's iframe is laid over the Preview pane now. */
  isShown(pageId: string): boolean {
    return this.#shown === pageId;
  }
}

export const previewHost = new PreviewHost();

/** The preview pages as they stand: configured ones in config order, then the built-in one. */
export function usePreviewPages(): readonly PageSnapshot[] {
  return useSyncExternalStore(previewHost.subscribe, previewHost.getSnapshot);
}
