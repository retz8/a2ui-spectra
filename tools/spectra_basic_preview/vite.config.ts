import react from '@vitejs/plugin-react';
import {defineConfig} from 'vite';

// Served by the a2ui-spectra tool under `preview/`, beside the viewer, so its assets are relative.
export default defineConfig({
  base: './',
  plugins: [react()],
  build: {chunkSizeWarningLimit: 1024},
});
