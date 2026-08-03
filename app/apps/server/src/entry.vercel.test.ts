import { beforeEach, describe, expect, it, vi } from 'vitest';

const harness = vi.hoisted(() => {
  const app = { fetch: vi.fn() };
  const deps = { marker: 'deps' };
  const flush = vi.fn();
  const listener = vi.fn();
  const request = { marker: 'request' };
  const response = { marker: 'response' };
  return {
    app,
    deps,
    flush,
    listener,
    request,
    response,
    completeFlush: vi.fn(),
    buildApp: vi.fn(() => app),
    createDeps: vi.fn(() => deps),
    getRequestListener: vi.fn(() => listener),
    loadEnv: vi.fn(() => ({ marker: 'env' })),
    startServerObservability: vi.fn(() => flush),
  };
});

vi.mock('@hono/node-server', () => ({
  getRequestListener: harness.getRequestListener,
}));
vi.mock('./app.js', () => ({ buildApp: harness.buildApp }));
vi.mock('./composition.js', () => ({ createDeps: harness.createDeps }));
vi.mock('./env.js', () => ({ loadEnv: harness.loadEnv }));
vi.mock('./observability.js', () => ({
  startServerObservability: harness.startServerObservability,
}));

const importEntry = () => import('./entry.vercel.js');

beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
});

describe('entry.vercel composition', () => {
  it('creates the request listener from app.fetch', async () => {
    await importEntry();

    expect(harness.getRequestListener).toHaveBeenCalledOnce();
    expect(harness.getRequestListener).toHaveBeenCalledWith(harness.app.fetch);
  });

  it('awaits the observability flush when the listener rejects', async () => {
    const listenerError = new Error('listener failed');
    const flushResult = new Promise<undefined>((resolve) => {
      harness.completeFlush.mockImplementation(() => resolve(undefined));
    });
    harness.listener.mockRejectedValueOnce(listenerError);
    harness.flush.mockReturnValueOnce(flushResult);
    const { default: handler } = await importEntry();

    const result = Reflect.apply(handler, undefined, [harness.request, harness.response]);
    let settled = false;
    void result.then(
      () => {
        settled = true;
      },
      () => {
        settled = true;
      },
    );
    await vi.waitFor(() => {
      expect(harness.flush).toHaveBeenCalledOnce();
    });

    expect(harness.listener).toHaveBeenCalledWith(harness.request, harness.response);
    expect(settled).toBe(false);

    harness.completeFlush();
    await expect(result).rejects.toBe(listenerError);
  });
});
