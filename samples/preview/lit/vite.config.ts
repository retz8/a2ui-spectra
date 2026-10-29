import {defineConfig} from 'vite';

// The port the sample's a2ui-spectra.json names for its preview page.
export default defineConfig({
  server: {port: 9832, strictPort: true},
  build: {chunkSizeWarningLimit: 1024},
});
