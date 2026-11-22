import type { Hono } from 'hono';

import { API_PATHS, TENANT_HEADER } from '#core/contract/index.js';
import { err, tenantNotFound, type AppError, type Result } from '#core/domain/index.js';
import { lookupParcelLocker, resolveTenant, type PickupPointDirectory, type ResolveTenantDeps, type TenantRepository } from '#core/server/index.js';

import type { AppVars } from './app-vars.js';
import { respond } from './respond.js';

export interface ParcelLockerRouteDeps extends ResolveTenantDeps {
  tenants: TenantRepository;
  pickupPoints?: PickupPointDirectory | undefined;
}

const respondLookup = <T>(result: Result<T, AppError>): Response =>
  respond(result, { headers: { vary: `Host, ${TENANT_HEADER}` } });

export const registerPublicParcelLockerRoutes = (app: Hono<AppVars>, deps: ParcelLockerRouteDeps): void => {
  app.get(API_PATHS.publicParcelLocker, async (c) => {
    const tenant = await resolveTenant(c.req.header('host') ?? '', c.req.header(TENANT_HEADER) ?? null, deps);
    if (!tenant.ok) return respondLookup(tenant);
    if (!tenant.value) return respondLookup(err(tenantNotFound()));
    return respondLookup(await lookupParcelLocker(tenant.value.tenant.id, { code: c.req.param('code') ?? '' }, deps));
  });
};
