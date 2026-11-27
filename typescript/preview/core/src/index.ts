/**
 * The preview core: the preview protocol's messages, and the page that runs
 * it, which every adapter starts with its own framework's processor.
 */
export * from './protocol.js';
export {claimsOf, type ClaimedCatalog} from './claims.js';
export {type Applied, type Difference, differenceOf, keysOf} from './difference.js';
export {
  errorText,
  type ErrorSource,
  type PageEvents,
  type PreviewAdapter,
  type PreviewPage,
  type PreviewPageOptions,
  type PreviewTransport,
  startPreviewPage,
} from './page.js';
export {
  isFromViewer,
  STANDALONE_LINE,
  viewerOriginOf,
  windowErrors,
  windowTransport,
} from './window.js';
export {guardElementUpdates, type UpdatingElementClass} from './guard.js';
