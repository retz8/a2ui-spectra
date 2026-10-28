/**
 * The web carrier: the page in an iframe, the viewer its parent window.
 * The viewer names its own origin in the page's address; the page sends to
 * that origin only, and takes messages only from its parent at that origin.
 */
import type {PageMessage} from './protocol.js';
import {VIEWER_PARAMETER} from './protocol.js';
import type {ErrorSource, PreviewTransport} from './page.js';

/** The line a page shows when it is opened on its own, outside Spectra. */
export const STANDALONE_LINE = 'This is a Spectra preview page. It previews only inside Spectra.';

/** The viewer's origin from the page's query string, or none when it names no origin. */
export function viewerOriginOf(search: string): string | undefined {
  const value = new URLSearchParams(search).get(VIEWER_PARAMETER);
  if (value === null) return undefined;
  try {
    const {origin} = new URL(value);
    return origin === value ? origin : undefined;
  } catch {
    return undefined;
  }
}

/** Whether a message event comes from the viewer: the parent window, at the viewer's origin. */
export function isFromViewer(
  event: {origin: string; source: unknown},
  viewerOrigin: string,
  parent: unknown,
): boolean {
  return event.origin === viewerOrigin && event.source === parent;
}

/** The transport between the page and the viewer that embeds it. */
export function windowTransport(viewerOrigin: string, page: Window = window): PreviewTransport {
  const parent = page.parent;
  return {
    send: (message: PageMessage) => parent.postMessage(message, viewerOrigin),
    listen: onMessage => {
      const handler = (event: MessageEvent) => {
        if (isFromViewer(event, viewerOrigin, parent)) onMessage(event.data);
      };
      page.addEventListener('message', handler);
      return () => page.removeEventListener('message', handler);
    },
  };
}

/** The window's error events: an uncaught error, and a promise rejected with no handler. */
export function windowErrors(page: Window = window): ErrorSource {
  return {
    listen: onError => {
      const onErrorEvent = (event: ErrorEvent) => onError(event.error ?? event.message);
      const onRejection = (event: PromiseRejectionEvent) => onError(event.reason);
      page.addEventListener('error', onErrorEvent);
      page.addEventListener('unhandledrejection', onRejection);
      return () => {
        page.removeEventListener('error', onErrorEvent);
        page.removeEventListener('unhandledrejection', onRejection);
      };
    },
  };
}
