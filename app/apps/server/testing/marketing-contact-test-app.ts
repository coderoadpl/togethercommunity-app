import { serve } from '@hono/node-server';
import { Hono } from 'hono';

import type { Identity, ImpersonationPrincipal } from '#core/domain/index.js';

import type { AppVars } from '../src/app-vars.js';
import { registerM2mMarketingContactRoutes, registerSessionMarketingContactRoutes, registerMarketingImportWorkerRoute } from '../src/marketing-contact-routes.js';

export const createMarketingContactTestApp = (deps: Parameters<typeof registerSessionMarketingContactRoutes>[1], identity: Identity, impersonation?: ImpersonationPrincipal) => {
  const app = new Hono<AppVars>();
  app.use('*', async (c, next) => { c.set('identity', identity); if (impersonation !== undefined) c.set('impersonation', impersonation); await next(); });
  registerM2mMarketingContactRoutes(app, deps);
  registerSessionMarketingContactRoutes(app, deps);
  registerMarketingImportWorkerRoute(app, deps);
  return { request: app.request, listen: () => serve({ fetch: app.fetch, hostname: '127.0.0.1', port: 0 }) };
};

export const listenMarketingTestApp = (app: Pick<Hono<AppVars>, 'fetch'>) => serve({ fetch: app.fetch, hostname: '127.0.0.1', port: 0 });
