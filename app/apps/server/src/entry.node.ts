import { serve } from '@hono/node-server';
import { serveStatic } from '@hono/node-server/serve-static';

import { buildApp } from './app.js';
import { buildCaddyDomainCheckApp } from './caddy-domain-check.js';
import { createDeps } from './composition.js';
import { loadEnv } from './env.js';
import { dispatchKsefInBackground } from './ksef-dispatch.js';
import { startServerObservability } from './observability.js';

startServerObservability();

const env = loadEnv();
const visualClockOverride = env.TOGETHER_VISUAL_CLOCK;
const deps =
  visualClockOverride === undefined
    ? createDeps(env)
    : createDeps(env, { clock: { nowIso: () => visualClockOverride } });
const app = buildApp(deps);

if (env.INTERNAL_PORT !== undefined) {
  const caddyApp = buildCaddyDomainCheckApp(deps.tenantDomains, deps.tenants, {
    appBaseUrl: deps.appBaseUrl,
    baseDomain: deps.baseDomain,
    singleTenantMode: deps.singleTenantMode,
  });
  serve({ fetch: caddyApp.fetch, port: env.INTERNAL_PORT, hostname: '0.0.0.0' });
}

if (env.NODE_ENV !== 'test' && deps.devSinkPurge !== undefined) {
  try {
    const purged = await deps.devSinkPurge.purge();
    process.stdout.write(
      `[dev-sink] purged ${String(purged.magicLinks)} magic links, ${String(purged.emails)} emails\n`,
    );
  } catch (error) {
    process.stderr.write(`[dev-sink] purge failed: ${String(error)}\n`);
  }
}

if (env.NODE_ENV !== 'test') {
  setInterval(() => {
    void deps.dispatchEmails('cron').then((result) => {
      if (!result.ok) process.stderr.write(`[email-outbox] ticker dispatch failed: ${result.error.message}\n`);
    });
  }, env.EMAIL_DISPATCH_INTERVAL_MS).unref();
  setInterval(() => {
    dispatchKsefInBackground(deps.ksef, deps.logger, 'node ticker');
  }, env.KSEF_DISPATCH_INTERVAL_MS).unref();
}

// Same process serves the SPA build — one origin per tenant domain, no CORS.
app.use('*', serveStatic({ root: env.WEB_DIST_DIR }));
app.get('*', serveStatic({ path: `${env.WEB_DIST_DIR}/index.html` }));

serve({ fetch: app.fetch, port: env.PORT, hostname: '0.0.0.0' }, (info) => {
  console.log(`together listening on http://localhost:${info.port}`);
});
