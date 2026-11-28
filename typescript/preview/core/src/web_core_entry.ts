/**
 * The preview core's web-core entry, `a2ui-spectra-preview/web-core`:
 * `startWebPreviewPage`, which runs a web adapter's page with web core's
 * message processor, with the types its options take, and `identityOf`, the
 * component a failure names.
 */
export {
  type DrawnSurface,
  identityOf,
  type MadeProcessor,
  type ProcessorInputs,
  startWebPreviewPage,
  type WebPreviewPageOptions,
} from './web_core.js';
