import path from 'node:path';

import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import {defineConfig} from 'vite';

import {bundleReport} from '../../vite_bundle_report.mjs';

export default defineConfig({
  // The report says what the build bundled, for the binary's third-party notices.
  plugins: [bundleReport(), react(), tailwindcss()],
  resolve: {
    alias: {'@': path.resolve(import.meta.dirname, 'src')},
  },
  // The viewer is one bundle, served from the local machine with web core inside it.
  build: {chunkSizeWarningLimit: 1024},
});
