import react from '@vitejs/plugin-react';
import {defineConfig} from 'vite';

// The port the sample's a2ui-spectra.json names for its preview page.
export default defineConfig({
  plugins: [react()],
  server: {port: 9831, strictPort: true},
  build: {chunkSizeWarningLimit: 1024},
});
