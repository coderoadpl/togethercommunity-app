import { createServer, type Server } from 'node:http';

import { createServer as createViteServer, type ViteDevServer } from 'vite';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import webConfig from '../apps/web/vite.config.js';

const listen = async (server: Server): Promise<string> => {
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const address = server.address();
  if (address === null || typeof address === 'string') throw new Error('Development test server did not bind');
  return `http://127.0.0.1:${String(address.port)}`;
};

const close = async (server: Server | undefined): Promise<void> => {
  if (server === undefined) return;
  await new Promise<void>((resolve, reject) => {
    server.close((error) => error === undefined ? resolve() : reject(error));
    server.closeAllConnections();
  });
};

describe('sales links on the Vite development origin', () => {
  let api: Server | undefined;
  let frontend: Server | undefined;
  let vite: ViteDevServer | undefined;
  let origin: string;

  beforeAll(async () => {
    api = createServer((request, response) => {
      response.setHeader('content-type', 'text/plain');
      response.end(`Server checkout: ${request.url ?? ''}`);
    });
    const apiOrigin = await listen(api);
    const offerProxy = webConfig.server?.proxy?.['/offer'];
    if (offerProxy === undefined || typeof offerProxy === 'string') throw new Error('Sales-link proxy is missing');
    vite = await createViteServer({
      ...webConfig,
      configFile: false,
      optimizeDeps: { noDiscovery: true, include: [] },
      server: {
        ...webConfig.server,
        middlewareMode: true,
        hmr: false,
        proxy: { '/offer': { ...offerProxy, target: apiOrigin } },
      },
    });
    const middleware = vite.middlewares;
    frontend = createServer((request, response) => {
      middleware(request, response, () => {
        response.statusCode = 404;
        response.end();
      });
    });
    origin = await listen(frontend);
  });

  afterAll(async () => {
    await close(frontend);
    await vite?.close();
    await close(api);
  });

  it.each(['checkout=together', 'test&checkout=together', 'status=success', 'status=cancelled'])(
    'serves the Vite application and its modules for %s',
    async (query) => {
      const response = await fetch(`${origin}/offer/bundle?${query}`);
      expect(response.status).toBe(200);
      const html = await response.text();
      expect(html).toContain('/@vite/client');
      expect(html).toContain('/src/main.tsx');
      expect(html).not.toContain('/assets/');
      const main = await fetch(`${origin}/src/main.tsx`);
      expect(main.status).toBe(200);
      expect(main.headers.get('content-type')).toContain('javascript');
    },
  );

  it.each(['', '?test', '?status=pending'])(
    'proxies the automatic checkout handoff for /offer/bundle%s',
    async (query) => {
      const response = await fetch(`${origin}/offer/bundle${query}`);
      expect(await response.text()).toBe(`Server checkout: /offer/bundle${query}`);
    },
  );

  it.each(['checkout=together', 'status=success', 'status=cancelled'])(
    'keeps crawler previews on the server for %s',
    async (query) => {
      const response = await fetch(`${origin}/offer/bundle?${query}`, { headers: { 'user-agent': 'Twitterbot/1.0' } });
      expect(await response.text()).toBe(`Server checkout: /offer/bundle?${query}`);
    },
  );
});
