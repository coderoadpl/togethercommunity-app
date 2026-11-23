import type { Hono } from 'hono';

import { API_PATHS, TENANT_HEADER } from '#core/contract/index.js';
import { err, tenantNotFound, type AppError, type Result } from '#core/domain/index.js';
import { lookupParcelLocker, resolveTenant, type Clock, type PickupPointDirectory, type PublicRateLimitRepository, type ResolveTenantDeps, type TenantRepository } from '#core/server/index.js';
import { safeErrorMessage } from '#core/server/log-safety.js';

import type { AppVars } from './app-vars.js';
import type { PublicRateLimitPolicies } from './public-rate-limit.js';
import { respond } from './respond.js';
import { recordException } from './telemetry.js';

interface ErrorLogger {
  error(message: string): void;
}

export interface ParcelLockerRouteDeps extends ResolveTenantDeps {
  tenants: TenantRepository;
  pickupPoints?: PickupPointDirectory | undefined;
  rateLimitBuckets: PublicRateLimitRepository;
  publicRateLimitPolicies: Pick<PublicRateLimitPolicies, 'parcelLockerLookupsPublic'>;
  clock: Clock;
  logger: ErrorLogger;
}

export const lookupBudgetSpentOnError = (buckets: PublicRateLimitRepository, logger: ErrorLogger): PublicRateLimitRepository => ({
  claim: async (input) => {
    try {
      return await buckets.claim(input);
    } catch (cause) {
      recordException(cause);
      logger.error(`[parcel-locker] the ${input.scope} lookup budget could not be claimed, so the locker is not verified: ${safeErrorMessage(cause)}`);
      return false;
    }
  },
  purgeExpired: (before) => buckets.purgeExpired(before),
});

const respondLookup = <T>(result: Result<T, AppError>): Response =>
  respond(result, { headers: { vary: `Host, ${TENANT_HEADER}` } });

export const registerPublicParcelLockerRoutes = (app: Hono<AppVars>, deps: ParcelLockerRouteDeps): void => {
  const publicShareBuckets = lookupBudgetSpentOnError(deps.rateLimitBuckets, deps.logger);
  app.get(API_PATHS.publicParcelLocker, async (c) => {
    const tenant = await resolveTenant(c.req.header('host') ?? '', c.req.header(TENANT_HEADER) ?? null, deps);
    if (!tenant.ok) return respondLookup(tenant);
    if (!tenant.value) return respondLookup(err(tenantNotFound()));
    return respondLookup(await lookupParcelLocker(tenant.value.tenant.id, { code: c.req.param('code') ?? '' }, {
      tenants: deps.tenants,
      pickupPoints: deps.pickupPoints,
      publicShare: { buckets: publicShareBuckets, clock: deps.clock, window: deps.publicRateLimitPolicies.parcelLockerLookupsPublic },
    }));
  });
};
