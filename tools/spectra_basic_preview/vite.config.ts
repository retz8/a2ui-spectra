import react from '@vitejs/plugin-react';
import {defineConfig} from 'vite';

import {bundleReport} from '../../vite_bundle_report.mjs';

// Served by the a2ui-spectra tool under `preview/`, beside the viewer, so its assets are relative.
export default defineConfig({
  base: './',
  // The report says what the build bundled, for the binary's third-party notices.
  plugins: [bundleReport(), react()],
  build: {chunkSizeWarningLimit: 1024},
});
