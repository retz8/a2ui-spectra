/**
 * The preview core's main entry: the preview protocol's messages, with the
 * guards the viewer reads a page's messages with; `startPreviewPage`, which
 * runs a page's side of the protocol, with the types its options take; and
 * the viewer's origin and the standalone line every adapter reads.
 */
export {
  type Claim,
  isPageMessage,
  isReadyMessage,
  type PageMessage,
  type PingMessage,
  PREVIEW_PROTOCOL,
  type PreviewAction,
  type RenderMessage,
  type Report,
  VIEWER_PARAMETER,
} from './protocol.js';
export type {ClaimedCatalog} from './claims.js';
export {
  type ErrorSource,
  type PageEvents,
  type PreviewAdapter,
  type PreviewPage,
  type PreviewPageOptions,
  type PreviewTransport,
  startPreviewPage,
} from './page.js';
export {STANDALONE_LINE, viewerOriginOf} from './window.js';
