import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

import pkg from '../../package.json' with { type: 'json' };
import deployment from '../../vercel.json' with { type: 'json' };

const commitSha =
  (process.env['APP_COMMIT_SHA'] ?? process.env['VERCEL_GIT_COMMIT_SHA'])?.slice(0, 7) ||
  'unknown';
const appBaseDomain = process.env['APP_BASE_DOMAIN'];
const crawlerPatterns = deployment.rewrites.flatMap((rewrite) =>
  (rewrite.has ?? []).filter((condition) => condition.type === 'header' && condition.key === 'user-agent')
    .map((condition) => new RegExp(condition.value, 'i')),
);

export default defineConfig({
  root: 'apps/web',
  plugins: [react()],
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
    __APP_COMMIT_SHA__: JSON.stringify(commitSha),
    ...(appBaseDomain ? { 'import.meta.env.VITE_APP_BASE_DOMAIN': JSON.stringify(appBaseDomain) } : {}),
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
      '/offer': {
        target: 'http://localhost:48730',
        changeOrigin: false,
        bypass(request) {
          if (crawlerPatterns.some((pattern) => pattern.test(request.headers['user-agent'] ?? ''))) return;
          const query = new URL(request.url ?? '/', 'http://localhost').searchParams;
          if (query.get('checkout') === 'together' || ['success', 'cancelled'].includes(query.get('status') ?? '')) {
            return '/index.html';
          }
        },
      },
      '/manifest.webmanifest': { target: 'http://localhost:48730', changeOrigin: false },
    },
  },
});
