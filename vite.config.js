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
    // Allow tunnel-proxied hosts (ngrok, localtunnel, cloudflared, etc.).
    // Vite blocks unknown Host headers by default to prevent DNS rebinding,
    // which rejects any request arriving through a public tunnel URL.
    // `true` disables the host check entirely (Vite 6: accepts `true` or an
    // explicit host array — NOT the string 'all').
    allowedHosts: true,
    // Bind to all interfaces so the tunnel agent can reach the dev server.
    host: true,
  },
  build: {
    target: 'esnext',
  },
});