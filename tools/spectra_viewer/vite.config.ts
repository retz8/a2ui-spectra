import path from 'node:path';

import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import {defineConfig} from 'vite';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {'@': path.resolve(import.meta.dirname, 'src')},
  },
  // The viewer is one bundle, served from the local machine with web core inside it.
  build: {chunkSizeWarningLimit: 1024},
});
