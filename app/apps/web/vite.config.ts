import { fileURLToPath } from 'node:url';

import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  root: 'apps/web',
  plugins: [react()],
  resolve: {
    alias: {
      '@core': fileURLToPath(new URL('../../core', import.meta.url)),
      '@adapters': fileURLToPath(new URL('../../adapters', import.meta.url)),
    },
  },
  build: {
    outDir: '../../dist/web',
    emptyOutDir: true,
  },
  server: {
    port: 48731,
    // Tenant subdomains must reach the dev server too: acme.localhost:48731
    allowedHosts: ['.localhost'],
    proxy: {
      // changeOrigin stays false so the API sees the original Host header —
      // tenant resolution depends on it.
      '/api': { target: 'http://localhost:48730', changeOrigin: false },
    },
  },
});
