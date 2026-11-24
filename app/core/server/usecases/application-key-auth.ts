import {
  appError,
  capabilitiesForPrincipal,
  applicationKeyCapabilities,
  err,
  ok,
  unauthorized,
  type AppError,
  type Capability,
  type ApplicationKey,
  type Identity,
  type Result,
  type Tenant,
} from '#core/domain/index.js';

import type { Ctx } from '../context.js';
import type {
  AccountIdentityReader,
  ApiKeyCrypto,
  Clock,
  ApplicationKeyRateLimitRepository,
  ApplicationKeyRepository,
  TenantAccessReader,
} from '../ports.js';

const APPLICATION_KEY_RATE_LIMITS = [
  { period: 'minute', durationMs: 60_000, limit: 300 },
  { period: 'day', durationMs: 86_400_000, limit: 20_000 },
] as const;

type RateLimitWindow = (typeof APPLICATION_KEY_RATE_LIMITS)[number];

const APPLICATION_KEY_HASH_DOMAIN = 'together:application-key:';

export const applicationKeyHash = (apiKeyCrypto: Pick<ApiKeyCrypto, 'hash'>, secret: string): string =>
  apiKeyCrypto.hash(`${APPLICATION_KEY_HASH_DOMAIN}${secret}`);

export interface ApplicationKeyAuthDeps {
  applicationKeys: Pick<ApplicationKeyRepository, 'findByHash'>;
  apiKeyCrypto: ApiKeyCrypto;
  accountIdentities: AccountIdentityReader;
  tenantAccess: Pick<TenantAccessReader, 'findStaffGrant'>;
  applicationKeyRateLimits: ApplicationKeyRateLimitRepository;
  clock: Clock;
}

export interface ApplicationKeyAuthentication {
  ctx: Ctx;
  apiKey: ApplicationKey;
}

export type ApplicationKeyAttribution =
  | { match: 'missing' }
  | { match: 'none' }
  | { match: 'matched'; apiKeyId: string; issuerUserId: string };

type EntitlementTenant = Pick<Tenant, 'id' | 'slug' | 'name'>;

const invalidKey = (): AppError => unauthorized('Invalid API key');

const usableKey = (found: ApplicationKey | null, tenantId: string, now: string): Result<ApplicationKey, AppError> =>
  found === null
  || found.tenantId !== tenantId
  || found.revokedAt !== null
  || Date.parse(found.expiresAt) <= Date.parse(now)
    ? err(invalidKey())
    : ok(found);

const issuerIdentity = async (
  tenant: EntitlementTenant,
  issuerUserId: string,
  deps: ApplicationKeyAuthDeps,
): Promise<Result<Identity, AppError>> => {
  const account = await deps.accountIdentities.findById(issuerUserId);
  if (account === null || !account.emailVerified) return err(invalidKey());
  const grant = await deps.tenantAccess.findStaffGrant(issuerUserId, { tenantId: tenant.id });
  if (grant?.staffRole !== 'owner' || grant.source !== 'direct' || grant.tenant.id !== tenant.id) return err(invalidKey());
  return ok({
    userId: account.userId,
    email: account.email,
    name: account.name,
    emailVerified: true,
    image: null,
    tenantAccess: 'staff',
    tenantId: tenant.id,
    tenantSlug: tenant.slug,
    tenantName: tenant.name,
    staffRole: 'owner',
    memberId: null,
    memberDisplayName: null,
    memberBannedAt: null,
    memberDmOptOutAt: null,
    memberLanguage: null,
    memberVideoAutoplay: null,
  });
};

const windowStartedAt = (now: string, window: RateLimitWindow): string =>
  new Date(Math.floor(Date.parse(now) / window.durationMs) * window.durationMs).toISOString();

const rateLimited = (window: RateLimitWindow, startedAt: string, now: string): AppError =>
  appError('rate_limited', 'API key rate limit exceeded', {
    period: window.period,
    retryAfterSeconds: Math.max(1, Math.ceil((Date.parse(startedAt) + window.durationMs - Date.parse(now)) / 1000)),
  });

export const claimApplicationKeyRateLimit = async (
  apiKeyId: string,
  tenantId: string,
  weight: number,
  deps: Pick<ApplicationKeyAuthDeps, 'applicationKeyRateLimits' | 'clock'>,
): Promise<Result<() => Promise<void>, AppError>> => {
  const now = deps.clock.nowIso();
  const [minute, day] = APPLICATION_KEY_RATE_LIMITS;
  const minuteStartedAt = windowStartedAt(now, minute);
  const dayStartedAt = windowStartedAt(now, day);
  const limits = deps.applicationKeyRateLimits;
  if (!await limits.claim(tenantId, { apiKeyId, period: minute.period, windowStartedAt: minuteStartedAt, limit: minute.limit, weight })) {
    return err(rateLimited(minute, minuteStartedAt, now));
  }
  if (await limits.claim(tenantId, { apiKeyId, period: day.period, windowStartedAt: dayStartedAt, limit: day.limit, weight })) {
    return ok(async () => {
      await limits.release(tenantId, { apiKeyId, period: minute.period, windowStartedAt: minuteStartedAt, weight });
      await limits.release(tenantId, { apiKeyId, period: day.period, windowStartedAt: dayStartedAt, weight });
    });
  }
  await limits.release(tenantId, { apiKeyId, period: minute.period, windowStartedAt: minuteStartedAt, weight });
  return err(rateLimited(day, dayStartedAt, now));
};

const keyCapabilities = (apiKey: Pick<ApplicationKey, 'scopes'>): Capability[] => {
  const ownerCapabilities = capabilitiesForPrincipal('owner');
  return applicationKeyCapabilities(apiKey.scopes).filter((capability) => ownerCapabilities.includes(capability));
};

export const authenticateApplicationKey = async (
  tenant: EntitlementTenant,
  presentedSecret: string,
  deps: ApplicationKeyAuthDeps,
): Promise<{ result: Result<ApplicationKeyAuthentication, AppError>; attribution: ApplicationKeyAttribution }> => {
  const secret = presentedSecret.trim();
  if (!secret) return { result: err(unauthorized('Missing API key')), attribution: { match: 'missing' } };
  const found = await deps.applicationKeys.findByHash(tenant.id, applicationKeyHash(deps.apiKeyCrypto, secret));
  const attribution: ApplicationKeyAttribution = found === null
    ? { match: 'none' }
    : { match: 'matched', apiKeyId: found.id, issuerUserId: found.issuedByUserId };
  const apiKey = usableKey(found, tenant.id, deps.clock.nowIso());
  if (!apiKey.ok) return { result: apiKey, attribution };
  const identity = await issuerIdentity(tenant, apiKey.value.issuedByUserId, deps);
  if (!identity.ok) return { result: identity, attribution };
  return {
    attribution,
    result: ok({
      apiKey: apiKey.value,
      ctx: {
        identity: identity.value,
        capabilities: keyCapabilities(apiKey.value),
        machineActor: { kind: 'application_key', apiKeyId: apiKey.value.id },
      },
    }),
  };
};
