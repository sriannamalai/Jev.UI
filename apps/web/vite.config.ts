/// <reference types="vitest/config" />
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const SERVER_ORIGIN = 'http://127.0.0.1:4173';

export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      '/api': {
        target: SERVER_ORIGIN,
        // changeOrigin rewrites the outgoing request's Host header to match
        // the target (127.0.0.1:4173), which satisfies the server's host
        // guard. The guard also rejects any Origin header that isn't
        // exactly http://127.0.0.1:4173 or http://localhost:4173, but the
        // dev server runs on a different port, so the browser's real Origin
        // would otherwise fail that check. The configure hook below
        // rewrites (not strips) the proxied request's origin header to the
        // server's own origin so the guard accepts it.
        changeOrigin: true,
        configure: (proxy) => {
          proxy.on('proxyReq', (proxyReq) => {
            proxyReq.setHeader('origin', SERVER_ORIGIN);
          });
        },
      },
    },
  },
  test: {
    environment: 'jsdom',
    setupFiles: ['./vitest.setup.ts'],
  },
});
