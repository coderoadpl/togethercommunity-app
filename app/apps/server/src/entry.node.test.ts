import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { err, notFound, ok, orderSchema, tenantSchema, tenantSettingsSchema, type MetaCapiEvent } from '#core/domain/index.js';
import type { MetaCapiJob } from '#core/server/meta-capi-ports.js';
import type { MetaCapiDispatchDeps } from '#core/server/usecases/meta-capi.js';

import type * as GracefulShutdown from './graceful-shutdown.js';
import type { ShutdownPlan } from './graceful-shutdown.js';
import { SERVER_HEADERS_TIMEOUT_MS, SERVER_KEEP_ALIVE_TIMEOUT_MS, SHUTDOWN_DRAIN_TIMEOUT_MS, SHUTDOWN_RELEASE_STEP_LIMIT } from './node-server-limits.js';

interface EntryEnv {
  NODE_ENV: string;
  INTERNAL_PORT?: number;
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
  const app = { fetch: vi.fn(() => new Response('ok')), get: vi.fn(), use: vi.fn() };
  const meta: { metaCapi: MetaCapiDispatchDeps | undefined } = { metaCapi: undefined };
  const deps = {
    ...meta,
    auth: { flushAuthEmails: vi.fn(async () => undefined) },
    close: vi.fn(async () => undefined),
    tenantDomains: { marker: 'tenant-domains' },
    tenants: { marker: 'tenants' },
    appBaseUrl: 'http://localhost:47100',
    baseDomain: 'localhost',
    singleTenantMode: true,
    dispatchEmails: vi.fn(),
    dispatchAutoInvoices: vi.fn(),
    releaseExpiredStockReservations: vi.fn(),
    ksef: { marker: 'ksef' },
    logger: { marker: 'logger', warn: vi.fn() },
  };
  return {
    env,
    app,
    deps,
    buildApp: vi.fn(() => app),
    createDeps: vi.fn((
      envArg: EntryEnv,
      optionsArg?: {
        clock?: { nowIso(): string };
        keepAlive?: (task: Promise<unknown>) => void;
        trackBackgroundWork?: (task: Promise<unknown>) => void;
      },
    ) => {
      void envArg;
      void optionsArg;
      return deps;
    }),
    dispatchKsef: vi.fn(async () => undefined),
    loadEnv: vi.fn(() => env),
    serve: vi.fn((options: { port: number; fetch(request: Request): unknown }) => ({
      port: options.port,
      keepAliveTimeout: 5_000,
      headersTimeout: 60_000,
    })),
    shutdownGracefully: vi.fn((plan: ShutdownPlan) => {
      void plan;
      return new Promise<void>(() => undefined);
    }),
    buildCaddyDomainCheckApp: vi.fn(() => ({ fetch: vi.fn() })),
    serveStatic: vi.fn((options: { root?: string; path?: string }) => options),
    startServerObservability: vi.fn(),
  };
});

vi.mock('@hono/node-server', () => ({ serve: harness.serve }));
vi.mock('@hono/node-server/serve-static', () => ({ serveStatic: harness.serveStatic }));
vi.mock('./app.js', () => ({ buildApp: harness.buildApp }));
vi.mock('./caddy-domain-check.js', () => ({ buildCaddyDomainCheckApp: harness.buildCaddyDomainCheckApp }));
vi.mock('./graceful-shutdown.js', async (importOriginal) => ({
  ...await importOriginal<typeof GracefulShutdown>(),
  shutdownGracefully: harness.shutdownGracefully,
}));
vi.mock('./composition.js', () => ({ createDeps: harness.createDeps }));
vi.mock('./env.js', () => ({ loadEnv: harness.loadEnv }));
vi.mock('./ksef-dispatch.js', () => ({
  dispatchKsef: harness.dispatchKsef,
}));
vi.mock('./observability.js', () => ({
  startServerObservability: harness.startServerObservability,
}));

const importEntry = () => import('./entry.node.js');

beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
  harness.env.NODE_ENV = 'test';
  harness.deps.metaCapi = undefined;
  harness.env.PORT = 47100;
  harness.env.WEB_DIST_DIR = '/web-dist';
  delete harness.env.TOGETHER_VISUAL_CLOCK;
  delete harness.env.INTERNAL_PORT;
  vi.spyOn(process, 'on').mockImplementation(() => process);
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
    expect(harness.createDeps).toHaveBeenCalledWith(harness.env, {
      keepAlive: expect.any(Function),
      trackBackgroundWork: expect.any(Function),
    });
    expect(harness.buildApp).toHaveBeenCalledWith(harness.deps);
    expect(harness.serveStatic).toHaveBeenNthCalledWith(1, { root: '/web-dist' });
    expect(harness.serveStatic).toHaveBeenNthCalledWith(2, {
      path: '/web-dist/index.html',
    });
    expect(harness.app.use).toHaveBeenCalledWith(
      '*',
      harness.serveStatic.mock.results[0]?.value,
    );
    expect(harness.app.get.mock.calls).toEqual([
      ['*', expect.objectContaining({ name: 'forwardedPathNotFound' })],
      ['*', harness.serveStatic.mock.results[1]?.value],
    ]);
    expect(harness.serve).toHaveBeenCalledWith(
      { fetch: expect.any(Function), port: 47100, hostname: '0.0.0.0' },
      expect.any(Function),
    );
    const request = new Request('http://localhost/api/health');
    expect(harness.serve.mock.calls[0]?.[0].fetch(request)).toBe(harness.app.fetch.mock.results[0]?.value);
    expect(harness.app.fetch).toHaveBeenCalledWith(request);
    expect(harness.serve.mock.results[0]?.value).toMatchObject({
      keepAliveTimeout: SERVER_KEEP_ALIVE_TIMEOUT_MS,
      headersTimeout: SERVER_HEADERS_TIMEOUT_MS,
    });
  });

  it('injects the visual clock only when explicitly configured', async () => {
    harness.env.TOGETHER_VISUAL_CLOCK = '2026-07-01T12:00:00.000Z';

    await importEntry();

    const options = harness.createDeps.mock.calls[0]?.[1];
    expect(options?.clock?.nowIso()).toBe('2026-07-01T12:00:00.000Z');
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
    const now = '2026-11-01T10:00:00.000Z';
    const job: MetaCapiJob = {
      order: orderSchema.parse({ id: 'purchase', tenantId: 'workspace', memberId: 'buyer', productId: 'book',
        priceId: null, couponId: null, discountCents: 0, kind: 'one_time', status: 'paid', amountCents: 9900, currency: 'PLN', provider: 'stripe',
        providerObjectIds: { checkoutSession: 'cs_live_purchase' }, paidAt: now, createdAt: now }),
      consent: { consent: 'granted', withdrawnAt: null }, consentAt: now, memberDeleted: false,
      email: 'buyer@example.org', sourceUrl: 'https://example.org/checkout/book', attempts: 0,
      capture: { at: now, ip: null, userAgent: null, fbp: null, textVersion: 'version', textSnapshot: '{}' },
    };
    let pending = true;
    const events: MetaCapiEvent[] = [];
    const send = vi.fn<MetaCapiDispatchDeps['gateway']['send']>(async () => ({ ok: true, fbtraceId: 'trace' }));
    const workspace = {
      tenants: { findSettings: async () => tenantSettingsSchema.parse({ name: 'Workspace', billingPortalUrl: null,
        bunnyStreamLibraryId: null, analyticsMetaCapiEnabled: true, analyticsMetaPixelId: '1234567890' }) },
      secrets: { resolve: async () => ok('test-token') },
    };
    harness.deps.metaCapi = {
      clock: { nowIso: () => now }, hash: { sha256: () => 'a'.repeat(64) },
      directory: { listAll: async () => [tenantSchema.parse({ id: 'workspace', slug: 'workspace', name: 'Workspace', status: 'active', plan: 'self_hosted', contentVersion: 1 })] },
      ...workspace, gateway: { send },
      repository: { findOrder: async () => job, decide: async () => err(notFound()), listMemberConsents: async () => [], listDueTenantIds: async () => ['workspace'],
        listEvents: async () => events, processNext: async (_tenantId, _at, process) => {
          if (!pending) return false;
          const outcome = await process(job, workspace);
          if ('event' in outcome) { events.push(outcome.event); pending = false; }
          return true;
        } },
    };
    harness.deps.dispatchEmails.mockResolvedValueOnce({
      ok: false,
      error: new Error('outbox unavailable'),
    });
    harness.deps.dispatchAutoInvoices.mockResolvedValue({
      ok: true,
      value: { processed: false, processedCount: 0, orderId: null },
    });
    harness.deps.releaseExpiredStockReservations.mockRejectedValueOnce(new Error('stock unavailable'));
    const stderr = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    const setIntervalSpy = vi.spyOn(globalThis, 'setInterval');

    await importEntry();

    expect(setIntervalSpy).toHaveBeenCalledTimes(3);
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
    expect(setIntervalSpy).toHaveBeenNthCalledWith(
      3,
      expect.any(Function),
      harness.env.KSEF_DISPATCH_INTERVAL_MS,
    );
    expect(setIntervalSpy.mock.results[0]?.value.hasRef()).toBe(false);
    expect(setIntervalSpy.mock.results[1]?.value.hasRef()).toBe(false);
    expect(setIntervalSpy.mock.results[2]?.value.hasRef()).toBe(false);

    await vi.advanceTimersByTimeAsync(harness.env.EMAIL_DISPATCH_INTERVAL_MS);

    expect(harness.deps.releaseExpiredStockReservations).toHaveBeenCalledOnce();
    expect(stderr).toHaveBeenCalledWith(expect.stringContaining('[stock] expired reservation sweep failed:'));
    expect(harness.deps.dispatchEmails).toHaveBeenCalledWith('cron');
    expect(send).toHaveBeenCalledOnce();
    expect(events).toMatchObject([{ transactionId: 'purchase', status: 'sent', fbtraceId: 'trace' }]);
    expect(pending).toBe(false);
    expect(harness.deps.logger.warn).not.toHaveBeenCalled();
    expect(harness.app.fetch).not.toHaveBeenCalled();
    expect(harness.dispatchKsef).toHaveBeenCalledWith(
      harness.deps.ksef,
      harness.deps.logger,
      'node ticker',
    );
    expect(harness.deps.dispatchAutoInvoices).toHaveBeenCalledOnce();
    expect(stderr).toHaveBeenCalledWith(
      '[email-outbox] ticker dispatch failed: outbox unavailable\n',
    );
  });

  it('waits for an in-flight Meta conversion tick when the tickers stop', async () => {
    vi.useFakeTimers();
    harness.env.NODE_ENV = 'production';
    let finishListing = (): void => undefined;
    const listAll = vi.fn(() => new Promise<[]>((resolve) => {
      finishListing = () => {
        resolve([]);
      };
    }));
    harness.deps.metaCapi = {
      clock: { nowIso: () => '2026-11-01T10:00:00.000Z' }, hash: { sha256: () => 'a'.repeat(64) },
      directory: { listAll },
      tenants: { findSettings: async () => null },
      secrets: { resolve: async () => ok('test-token') }, gateway: { send: async () => ({ ok: true, fbtraceId: null }) },
      repository: { findOrder: async () => null, decide: async () => err(notFound()), listMemberConsents: async () => [], listDueTenantIds: async () => ['workspace'],
        listEvents: async () => [], processNext: async () => false },
    };
    harness.deps.dispatchEmails.mockResolvedValue({ ok: true, value: undefined });
    harness.deps.dispatchAutoInvoices.mockResolvedValue({ ok: true, value: undefined });
    harness.deps.releaseExpiredStockReservations.mockResolvedValue(undefined);
    const signalHandlers = new Map<string, (signal: NodeJS.Signals) => void>();
    vi.spyOn(process, 'on').mockImplementation((event, listener) => {
      if (typeof event === 'string') signalHandlers.set(event, listener);
      return process;
    });
    vi.spyOn(process.stdout, 'write').mockImplementation(() => true);

    await importEntry();
    await vi.advanceTimersByTimeAsync(harness.env.EMAIL_DISPATCH_INTERVAL_MS);
    expect(listAll).toHaveBeenCalledOnce();
    signalHandlers.get('SIGTERM')?.('SIGTERM');

    const plan = harness.shutdownGracefully.mock.calls[0]?.[0];
    let stopped = false;
    const stopping = plan?.tickers.stop().then(() => { stopped = true; });
    await vi.advanceTimersByTimeAsync(0);
    expect(stopped).toBe(false);
    finishListing();
    await stopping;
    expect(stopped).toBe(true);
    await vi.advanceTimersByTimeAsync(harness.env.EMAIL_DISPATCH_INTERVAL_MS * 3);
    expect(listAll).toHaveBeenCalledOnce();
  });

  it('drains both listeners and releases auth mail and database connections on SIGTERM', async () => {
    harness.env.INTERNAL_PORT = 47101;
    const signalHandlers = new Map<string, (signal: NodeJS.Signals) => void>();
    const once = vi.spyOn(process, 'once');
    vi.spyOn(process, 'on').mockImplementation((event, listener) => {
      if (typeof event === 'string') signalHandlers.set(event, listener);
      return process;
    });
    vi.spyOn(process.stdout, 'write').mockImplementation(() => true);

    await importEntry();

    expect([...signalHandlers.keys()]).toEqual(['SIGTERM', 'SIGINT']);
    expect(once).not.toHaveBeenCalled();
    signalHandlers.get('SIGTERM')?.('SIGTERM');
    signalHandlers.get('SIGTERM')?.('SIGTERM');
    signalHandlers.get('SIGINT')?.('SIGINT');

    expect(harness.shutdownGracefully).toHaveBeenCalledOnce();
    const plan = harness.shutdownGracefully.mock.calls[0]?.[0];
    expect(plan?.servers.map(({ server }) => 'port' in server && server.port)).toEqual([47100, 47101]);
    expect(plan?.drainTimeoutMs).toBe(SHUTDOWN_DRAIN_TIMEOUT_MS);
    expect(plan?.release.map((step) => step.name)).toEqual(['auth e-mail flush', 'database connections']);
    for (const step of plan?.release ?? []) await step.run();
    expect(harness.deps.auth.flushAuthEmails).toHaveBeenCalledOnce();
    expect(harness.deps.close).toHaveBeenCalledOnce();
  });

  it('waits for tracked background work and keeps the release steps within the documented limit', async () => {
    harness.startServerObservability.mockReturnValueOnce(async () => undefined);
    const signalHandlers = new Map<string, (signal: NodeJS.Signals) => void>();
    vi.spyOn(process, 'on').mockImplementation((event, listener) => {
      if (typeof event === 'string') signalHandlers.set(event, listener);
      return process;
    });
    vi.spyOn(process.stdout, 'write').mockImplementation(() => true);

    await importEntry();
    const options = harness.createDeps.mock.calls[0]?.[1];
    let finish = (): void => undefined;
    options?.trackBackgroundWork?.(new Promise<void>((resolve) => { finish = resolve; }));
    signalHandlers.get('SIGTERM')?.('SIGTERM');

    const plan = harness.shutdownGracefully.mock.calls[0]?.[0];
    expect(plan?.release.map((step) => step.name)).toEqual(['auth e-mail flush', 'database connections', 'trace export']);
    expect(plan?.release.length).toBeLessThanOrEqual(SHUTDOWN_RELEASE_STEP_LIMIT);
    let settled = false;
    const waiting = plan?.work.settled().then(() => { settled = true; });
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(settled).toBe(false);
    finish();
    await waiting;
    expect(settled).toBe(true);
  });
});
