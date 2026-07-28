import { beforeEach, describe, expect, it, vi } from 'vitest';

interface EntryEnv {
  NODE_ENV: string;
  PORT: number;
  WEB_DIST_DIR: string;
  EMAIL_DISPATCH_INTERVAL_MS: number;
  KSEF_DISPATCH_INTERVAL_MS: number;
}

const h = vi.hoisted(() => {
  const env: EntryEnv = {
    NODE_ENV: 'test',
    PORT: 47100,
    WEB_DIST_DIR: '/web-dist',
    EMAIL_DISPATCH_INTERVAL_MS: 1000,
    KSEF_DISPATCH_INTERVAL_MS: 1000,
  };
  const app = { fetch: vi.fn(), get: vi.fn(), use: vi.fn() };
  const deps = {
    dispatchEmails: vi.fn(),
    ksef: { marker: 'ksef' },
    logger: { marker: 'logger' },
  };
  return {
    env,
    app,
    deps,
    buildApp: vi.fn(() => app),
    createDeps: vi.fn(() => deps),
    dispatchKsefInBackground: vi.fn(),
    loadEnv: vi.fn(() => env),
    serve: vi.fn(),
    serveStatic: vi.fn((options: { root?: string; path?: string }) => options),
    startServerObservability: vi.fn(),
  };
});

vi.mock('@hono/node-server', () => ({ serve: h.serve }));
vi.mock('@hono/node-server/serve-static', () => ({ serveStatic: h.serveStatic }));
vi.mock('./app.js', () => ({ buildApp: h.buildApp }));
vi.mock('./composition.js', () => ({ createDeps: h.createDeps }));
vi.mock('./env.js', () => ({ loadEnv: h.loadEnv }));
vi.mock('./ksef-dispatch.js', () => ({
  dispatchKsefInBackground: h.dispatchKsefInBackground,
}));
vi.mock('./observability.js', () => ({
  startServerObservability: h.startServerObservability,
}));

const importEntry = () => import('./entry.node.js');

beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
  h.env.NODE_ENV = 'test';
  h.env.PORT = 47100;
  h.env.WEB_DIST_DIR = '/web-dist';
});

describe('entry.node composition', () => {
  it('starts observability, composes the app, and serves the SPA', async () => {
    await importEntry();

    expect(h.startServerObservability).toHaveBeenCalledOnce();
    expect(h.loadEnv).toHaveBeenCalledOnce();
    expect(h.createDeps).toHaveBeenCalledWith(h.env);
    expect(h.buildApp).toHaveBeenCalledWith(h.deps);
    expect(h.serveStatic).toHaveBeenNthCalledWith(1, { root: '/web-dist' });
    expect(h.serveStatic).toHaveBeenNthCalledWith(2, {
      path: '/web-dist/index.html',
    });
    expect(h.app.use).toHaveBeenCalledWith('*', h.serveStatic.mock.results[0]?.value);
    expect(h.app.get).toHaveBeenCalledWith('*', h.serveStatic.mock.results[1]?.value);
    expect(h.serve).toHaveBeenCalledWith(
      { fetch: h.app.fetch, port: 47100, hostname: '0.0.0.0' },
      expect.any(Function),
    );
  });

  it('propagates listener startup failures', async () => {
    h.serve.mockImplementationOnce(() => {
      throw new Error('port unavailable');
    });

    await expect(importEntry()).rejects.toThrow('port unavailable');
  });
});
