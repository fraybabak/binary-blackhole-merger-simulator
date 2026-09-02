import { defineConfig } from 'vite';

// ES-module workers so physics.worker.js can import the shared state layout
// both in the dev server and in the production bundle.
export default defineConfig({
  worker: {
    format: 'es',
  },
  server: {
    port: 5173,
    open: false,
  },
  build: {
    target: 'esnext',
  },
});