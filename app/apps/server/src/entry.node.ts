import { serve } from '@hono/node-server';
import { serveStatic } from '@hono/node-server/serve-static';

import { safeErrorMessage, safeLogMessage } from '#core/server/log-safety.js';

import { buildApp } from './app.js';
import { buildCaddyDomainCheckApp } from './caddy-domain-check.js';
import { createDeps } from './composition.js';
import { loadEnv } from './env.js';
import { forwardedPathNotFound } from './forwarded-paths.js';
import {
  applyConnectionTimeouts,
  createPendingWork,
  createSignalHandler,
  drainable,
  shutdownGracefully,
  startBackgroundTickers,
  trackRequests,
  type BackgroundTicker,
} from './graceful-shutdown.js';
import { dispatchKsef } from './ksef-dispatch.js';
import { SHUTDOWN_DRAIN_TIMEOUT_MS, SHUTDOWN_RELEASE_TIMEOUT_MS } from './node-server-limits.js';
import { startServerObservability } from './observability.js';

const flushObservability = startServerObservability();

const env = loadEnv();
const visualClockOverride = env.TOGETHER_VISUAL_CLOCK;
const pendingWork = createPendingWork();
const deps = createDeps(env, {
  keepAlive: pendingWork.track,
  trackBackgroundWork: pendingWork.track,
  ...(visualClockOverride === undefined ? {} : { clock: { nowIso: () => visualClockOverride } }),
});
const app = buildApp(deps);

if (env.NODE_ENV !== 'test') {
  process.stdout.write(
    `[tenant-routing] mode=${deps.singleTenantMode ? 'single-tenant' : 'subdomain'} base-url=${deps.appBaseUrl}${deps.singleTenantMode ? '' : ` base-domain=${deps.baseDomain}`}\n`,
  );
}

const internalServer = env.INTERNAL_PORT === undefined
  ? undefined
  : serve({
      fetch: trackRequests(buildCaddyDomainCheckApp(deps.tenantDomains, deps.tenants, {
        appBaseUrl: deps.appBaseUrl,
        baseDomain: deps.baseDomain,
        singleTenantMode: deps.singleTenantMode,
      }).fetch, pendingWork),
      port: env.INTERNAL_PORT,
      hostname: '0.0.0.0',
    });

if (env.NODE_ENV !== 'test' && deps.devSinkPurge !== undefined) {
  try {
    const purged = await deps.devSinkPurge.purge();
    process.stdout.write(
      `[dev-sink] purged ${String(purged.magicLinks)} magic links, ${String(purged.emails)} emails\n`,
    );
  } catch (error) {
    process.stderr.write(`[dev-sink] purge failed: ${safeErrorMessage(error)}\n`);
  }
}

const productionTickers: BackgroundTicker[] = [
  {
    intervalMs: env.EMAIL_DISPATCH_INTERVAL_MS,
    run: async () => {
      await Promise.all([
        deps.releaseExpiredStockReservations().catch((error: unknown) => {
          process.stderr.write(`[stock] expired reservation sweep failed: ${safeErrorMessage(error)}\n`);
        }),
        deps.dispatchEmails('cron').then((result) => {
          if (!result.ok) process.stderr.write(`[email-outbox] ticker dispatch failed: ${safeLogMessage(result.error.message)}\n`);
        }, (error: unknown) => {
          process.stderr.write(`[email-outbox] ticker dispatch failed: ${safeErrorMessage(error)}\n`);
        }),
      ]);
    },
  },
  {
    intervalMs: env.KSEF_DISPATCH_INTERVAL_MS,
    run: () => dispatchKsef(deps.ksef, deps.logger, 'node ticker'),
  },
  {
    intervalMs: env.KSEF_DISPATCH_INTERVAL_MS,
    run: () => deps.dispatchAutoInvoices().then((result) => {
      if (!result.ok) process.stderr.write(`[auto-invoice] ticker dispatch failed: ${safeLogMessage(result.error.message)}\n`);
    }, (error: unknown) => {
      process.stderr.write(`[auto-invoice] ticker dispatch failed: ${safeErrorMessage(error)}\n`);
    }),
  },
];
const tickers = startBackgroundTickers(env.NODE_ENV === 'test' ? [] : productionTickers);

// Same process serves the SPA build — one origin per tenant domain, no CORS.
app.use('*', serveStatic({ root: env.WEB_DIST_DIR }));
app.get('*', forwardedPathNotFound);
app.get('*', serveStatic({ path: `${env.WEB_DIST_DIR}/index.html` }));

const server = serve({ fetch: trackRequests(app.fetch, pendingWork), port: env.PORT, hostname: '0.0.0.0' }, (info) => {
  console.log(`together listening on http://localhost:${info.port}`);
});
const listeners = internalServer === undefined ? [server] : [server, internalServer];
for (const listener of listeners) applyConnectionTimeouts(listener);
const servers = listeners.map(drainable);

const shutdown = createSignalHandler(
  () => shutdownGracefully({
    servers,
    tickers,
    work: pendingWork,
    release: [
      { name: 'auth e-mail flush', run: () => deps.auth.flushAuthEmails() },
      { name: 'database connections', run: () => deps.close() },
      ...(flushObservability === undefined ? [] : [{ name: 'trace export', run: flushObservability }]),
    ],
    drainTimeoutMs: SHUTDOWN_DRAIN_TIMEOUT_MS,
    releaseTimeoutMs: SHUTDOWN_RELEASE_TIMEOUT_MS,
    log: (line) => {
      process.stderr.write(`${line}\n`);
    },
  }).then(
    () => {
      process.stdout.write('[shutdown] complete\n');
      process.exit(0);
    },
    (error: unknown) => {
      process.stderr.write(`[shutdown] failed: ${safeErrorMessage(error)}\n`);
      process.exit(1);
    },
  ),
  (line) => {
    process.stdout.write(`${line}\n`);
  },
);
const onSignal = (signal: NodeJS.Signals): void => {
  void shutdown(signal);
};
process.on('SIGTERM', onSignal);
process.on('SIGINT', onSignal);
