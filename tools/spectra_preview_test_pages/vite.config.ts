import react from '@vitejs/plugin-react';
import {defineConfig} from 'vite';

// The React and Lit test pages, each under its own folder of `dist/`; the Angular page is built
// by `ng build` into `dist/angular/`. Assets are relative, so the tests serve the pages anywhere.
export default defineConfig({
  base: './',
  plugins: [react()],
  build: {
    chunkSizeWarningLimit: 2048,
    rollupOptions: {input: {react: 'react/index.html', lit: 'lit/index.html'}},
  },
});
