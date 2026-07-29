import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

interface EntryEnv {
  NODE_ENV: string;
  PORT: number;
  WEB_DIST_DIR: string;
  EMAIL_DISPATCH_INTERVAL_MS: number;
  KSEF_DISPATCH_INTERVAL_MS: number;
  TOGETHER_VISUAL_CLOCK?: string;
}

const harness = vi.hoisted(() => {
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
    createDeps: vi.fn((
      envArg: EntryEnv,
      optionsArg?: { clock: { nowIso(): string } },
    ) => {
      void envArg;
      void optionsArg;
      return deps;
    }),
    dispatchKsefInBackground: vi.fn(),
    loadEnv: vi.fn(() => env),
    serve: vi.fn(),
    serveStatic: vi.fn((options: { root?: string; path?: string }) => options),
    startServerObservability: vi.fn(),
  };
});

vi.mock('@hono/node-server', () => ({ serve: harness.serve }));
vi.mock('@hono/node-server/serve-static', () => ({ serveStatic: harness.serveStatic }));
vi.mock('./app.js', () => ({ buildApp: harness.buildApp }));
vi.mock('./composition.js', () => ({ createDeps: harness.createDeps }));
vi.mock('./env.js', () => ({ loadEnv: harness.loadEnv }));
vi.mock('./ksef-dispatch.js', () => ({
  dispatchKsefInBackground: harness.dispatchKsefInBackground,
}));
vi.mock('./observability.js', () => ({
  startServerObservability: harness.startServerObservability,
}));

const importEntry = () => import('./entry.node.js');

beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
  harness.env.NODE_ENV = 'test';
  harness.env.PORT = 47100;
  harness.env.WEB_DIST_DIR = '/web-dist';
  delete harness.env.TOGETHER_VISUAL_CLOCK;
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('entry.node composition', () => {
  it('starts observability, composes the app, and serves the SPA', async () => {
    await importEntry();

    expect(harness.startServerObservability).toHaveBeenCalledOnce();
    expect(harness.loadEnv).toHaveBeenCalledOnce();
    expect(harness.createDeps).toHaveBeenCalledWith(harness.env);
    expect(harness.buildApp).toHaveBeenCalledWith(harness.deps);
    expect(harness.serveStatic).toHaveBeenNthCalledWith(1, { root: '/web-dist' });
    expect(harness.serveStatic).toHaveBeenNthCalledWith(2, {
      path: '/web-dist/index.html',
    });
    expect(harness.app.use).toHaveBeenCalledWith(
      '*',
      harness.serveStatic.mock.results[0]?.value,
    );
    expect(harness.app.get).toHaveBeenCalledWith(
      '*',
      harness.serveStatic.mock.results[1]?.value,
    );
    expect(harness.serve).toHaveBeenCalledWith(
      { fetch: harness.app.fetch, port: 47100, hostname: '0.0.0.0' },
      expect.any(Function),
    );
  });

  it('injects the visual clock only when explicitly configured', async () => {
    harness.env.TOGETHER_VISUAL_CLOCK = '2026-07-01T12:00:00.000Z';

    await importEntry();

    const options = harness.createDeps.mock.calls[0]?.[1];
    expect(options?.clock.nowIso()).toBe('2026-07-01T12:00:00.000Z');
  });

  it('propagates listener startup failures', async () => {
    harness.serve.mockImplementationOnce(() => {
      throw new Error('port unavailable');
    });

    await expect(importEntry()).rejects.toThrow('port unavailable');
  });

  it('runs and unreferences production background tickers', async () => {
    vi.useFakeTimers();
    harness.env.NODE_ENV = 'production';
    harness.deps.dispatchEmails.mockResolvedValueOnce({
      ok: false,
      error: new Error('outbox unavailable'),
    });
    const stderr = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    const setIntervalSpy = vi.spyOn(globalThis, 'setInterval');

    await importEntry();

    expect(setIntervalSpy).toHaveBeenCalledTimes(2);
    expect(setIntervalSpy).toHaveBeenNthCalledWith(
      1,
      expect.any(Function),
      harness.env.EMAIL_DISPATCH_INTERVAL_MS,
    );
    expect(setIntervalSpy).toHaveBeenNthCalledWith(
      2,
      expect.any(Function),
      harness.env.KSEF_DISPATCH_INTERVAL_MS,
    );
    expect(setIntervalSpy.mock.results[0]?.value.hasRef()).toBe(false);
    expect(setIntervalSpy.mock.results[1]?.value.hasRef()).toBe(false);

    await vi.advanceTimersByTimeAsync(harness.env.EMAIL_DISPATCH_INTERVAL_MS);

    expect(harness.deps.dispatchEmails).toHaveBeenCalledWith('cron');
    expect(harness.dispatchKsefInBackground).toHaveBeenCalledWith(
      harness.deps.ksef,
      harness.deps.logger,
      'node ticker',
    );
    expect(stderr).toHaveBeenCalledWith(
      '[email-outbox] ticker dispatch failed: outbox unavailable\n',
    );
  });
});
