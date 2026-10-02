import type { Hono, MiddlewareHandler } from 'hono';

import { API_PATHS, SCHEDULER_OPERATOR_SECRET_HEADER, provisionTenantInputSchema } from '#core/contract/index.js';
import { err, unauthorized, validation } from '#core/domain/index.js';
import { getOperatorTenantReadiness, provisionTenant, type ProvisionTenantDeps } from '#core/server/index.js';

import type { AppVars } from './app-vars.js';
import { operatorContext } from './marketing-worker-context.js';
import { secretEquals } from './secret-equals.js';
import { respond } from './respond.js';

export const operatorTenantSecretGuard = (secret: string): MiddlewareHandler<AppVars> =>
  async (c, next) => {
    if (!secretEquals(c.req.header(SCHEDULER_OPERATOR_SECRET_HEADER), secret)) {
      return respond(err(unauthorized('Invalid operator secret')));
    }
    await next();
  };

export const registerOperatorTenantRoutes = (
  app: Hono<AppVars>,
  deps: ProvisionTenantDeps & { operatorSecret: string },
): void => {
  app.post(API_PATHS.operatorTenantProvision, async (c) => {
    if (!secretEquals(c.req.header(SCHEDULER_OPERATOR_SECRET_HEADER), deps.operatorSecret)) {
      return respond(err(unauthorized('Invalid operator secret')));
    }
    const body: unknown = await c.req.json().catch(() => null);
    const parsed = provisionTenantInputSchema.safeParse(body);
    if (!parsed.success) return respond(err(validation('Invalid tenant provisioning payload')));
    return respond(await provisionTenant(operatorContext(), parsed.data, deps));
  });
  app.get(API_PATHS.operatorTenantReadiness, async (c) => {
    if (!secretEquals(c.req.header(SCHEDULER_OPERATOR_SECRET_HEADER), deps.operatorSecret)) {
      return respond(err(unauthorized('Invalid operator secret')));
    }
    return respond(await getOperatorTenantReadiness(operatorContext(), { slug: c.req.param('slug') }, deps));
  });
};
