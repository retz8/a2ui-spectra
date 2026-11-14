/**
 * The Angular sample's preview page: the sample catalog and the v1.0 basic
 * catalog drawn through the Angular preview adapter's component, the page
 * bootstrapped with the renderer config a host using them has in its app
 * config: universal components on, which the v1.0 basic catalog's
 * components need.
 */
import {provideA2Ui, provideMarkdownRenderer} from '@a2ui/angular/v0_9';
import {renderMarkdown} from '@a2ui/markdown-it';
import {Component, provideZonelessChangeDetection} from '@angular/core';
import {bootstrapApplication} from '@angular/platform-browser';
import {SpectraPreviewComponent} from 'a2ui-spectra-preview-angular';

import {basicV10, sampleCatalog} from './catalog';

@Component({
  selector: 'sample-preview',
  imports: [SpectraPreviewComponent],
  template: '<a2ui-spectra-preview />',
})
class PreviewPage {}

bootstrapApplication(PreviewPage, {
  providers: [
    provideZonelessChangeDetection(),
    provideA2Ui({catalogs: [sampleCatalog, basicV10], useUniversalComponents: true}),
    provideMarkdownRenderer(renderMarkdown),
  ],
}).catch(error => console.error(error));
