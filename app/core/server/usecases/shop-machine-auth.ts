import {
  appError,
  capabilitiesForPrincipal,
  err,
  forbidden,
  ok,
  shopManagementCapabilities,
  unauthorized,
  type AppError,
  type Capability,
  type Identity,
  type Result,
  type ShopManagementKey,
  type ShopManagementKeyEvent,
  type ShopManagementScope,
  type Tenant,
} from '#core/domain/index.js';

import type { Ctx } from '../context.js';
import type {
  AccountIdentityReader,
  ApiKeyCrypto,
  Clock,
  IdGenerator,
  ShopManagementKeyEventRepository,
  ShopManagementKeyRateLimitRepository,
  ShopManagementKeyRepository,
  TenantAccessReader,
} from '../ports.js';

const SHOP_MANAGEMENT_KEY_RATE_LIMITS = [
  { period: 'minute', durationMs: 60_000, limit: 60 },
  { period: 'day', durationMs: 86_400_000, limit: 10_000 },
] as const;

type RateLimitWindow = (typeof SHOP_MANAGEMENT_KEY_RATE_LIMITS)[number];

export interface ShopMachineAuthDeps {
  shopManagementKeys: Pick<ShopManagementKeyRepository, 'findByHash'>;
  apiKeyCrypto: ApiKeyCrypto;
  accountIdentities: AccountIdentityReader;
  tenantAccess: Pick<TenantAccessReader, 'findStaffGrant' | 'findMember'>;
  shopManagementKeyRateLimits: ShopManagementKeyRateLimitRepository;
  clock: Clock;
}

export interface ShopMachineAuthentication {
  ctx: Ctx;
  apiKey: ShopManagementKey;
}

type ShopTenant = Pick<Tenant, 'id' | 'slug' | 'name'>;

const invalidKey = (): AppError => unauthorized('Invalid API key');

export type ShopKeyAttribution =
  | { match: 'missing' }
  | { match: 'none' }
  | { match: 'matched'; apiKeyId: string; issuerUserId: string };

interface ShopMachineAuthOutcome {
  result: Result<ShopMachineAuthentication, AppError>;
  attribution: ShopKeyAttribution;
}

const findStoredKey = async (
  tenantId: string,
  secret: string,
  deps: Pick<ShopMachineAuthDeps, 'shopManagementKeys' | 'apiKeyCrypto'>,
): Promise<ShopManagementKey | null> => {
  const found = await deps.shopManagementKeys.findByHash(tenantId, deps.apiKeyCrypto.hash(secret));
  return found?.tenantId === tenantId ? found : null;
};

const attributionOf = (found: ShopManagementKey | null): ShopKeyAttribution =>
  found === null
    ? { match: 'none' }
    : { match: 'matched', apiKeyId: found.id, issuerUserId: found.issuedByUserId };

const usableShopKey = (
  found: ShopManagementKey | null,
  deps: Pick<ShopMachineAuthDeps, 'clock'>,
): Result<ShopManagementKey, AppError> =>
  found === null
  || found.revokedAt !== null
  || Date.parse(found.expiresAt) <= Date.parse(deps.clock.nowIso())
    ? err(invalidKey())
    : ok(found);

const issuerIdentity = async (
  tenant: ShopTenant,
  issuerUserId: string,
  deps: ShopMachineAuthDeps,
): Promise<Result<Identity, AppError>> => {
  const account = await deps.accountIdentities.findById(issuerUserId);
  if (account === null || !account.emailVerified) return err(invalidKey());
  const grant = await deps.tenantAccess.findStaffGrant(issuerUserId, { tenantId: tenant.id });
  if (grant?.staffRole !== 'owner' || grant.tenant.id !== tenant.id) return err(invalidKey());
  const member = await deps.tenantAccess.findMember(tenant.id, issuerUserId);
  return ok({
    userId: account.userId,
    email: account.email,
    name: account.name,
    emailVerified: true,
    image: member?.avatarUrl ?? null,
    tenantAccess: 'staff',
    tenantId: tenant.id,
    tenantSlug: tenant.slug,
    tenantName: tenant.name,
    staffRole: 'owner',
    memberId: member?.id ?? null,
    memberDisplayName: member?.displayName ?? null,
    memberBannedAt: member?.bannedAt ?? null,
    memberDmOptOutAt: member?.dmOptOutAt ?? null,
    memberLanguage: member?.language ?? null,
    memberVideoAutoplay: member?.videoAutoplay ?? null,
  });
};

const windowStartedAt = (now: string, window: RateLimitWindow): string =>
  new Date(Math.floor(Date.parse(now) / window.durationMs) * window.durationMs).toISOString();

const rateLimited = (window: RateLimitWindow, startedAt: string, now: string): AppError =>
  appError('rate_limited', 'API key rate limit exceeded', {
    period: window.period,
    retryAfterSeconds: Math.max(1, Math.ceil((Date.parse(startedAt) + window.durationMs - Date.parse(now)) / 1000)),
  });

const claimShopKeyRateLimit = async (
  apiKeyId: string,
  tenantId: string,
  deps: Pick<ShopMachineAuthDeps, 'shopManagementKeyRateLimits' | 'clock'>,
): Promise<Result<void, AppError>> => {
  const now = deps.clock.nowIso();
  const [minute, day] = SHOP_MANAGEMENT_KEY_RATE_LIMITS;
  const minuteStartedAt = windowStartedAt(now, minute);
  const dayStartedAt = windowStartedAt(now, day);
  const limits = deps.shopManagementKeyRateLimits;
  if (!await limits.claim(tenantId, { apiKeyId, period: minute.period, windowStartedAt: minuteStartedAt, limit: minute.limit })) {
    return err(rateLimited(minute, minuteStartedAt, now));
  }
  if (await limits.claim(tenantId, { apiKeyId, period: day.period, windowStartedAt: dayStartedAt, limit: day.limit })) {
    return ok(undefined);
  }
  await limits.release(tenantId, { apiKeyId, period: minute.period, windowStartedAt: minuteStartedAt });
  return err(rateLimited(day, dayStartedAt, now));
};

export const shopManagementKeyCapabilities = (apiKey: Pick<ShopManagementKey, 'scopes' | 'mode'>): Capability[] => {
  const ownerCapabilities = capabilitiesForPrincipal('owner');
  return shopManagementCapabilities(apiKey.scopes, apiKey.mode).filter((capability) => ownerCapabilities.includes(capability));
};

const authenticateStoredKey = async (
  tenant: ShopTenant,
  found: ShopManagementKey | null,
  requiredScope: ShopManagementScope | null,
  deps: ShopMachineAuthDeps,
): Promise<Result<ShopMachineAuthentication, AppError>> => {
  const apiKey = usableShopKey(found, deps);
  if (!apiKey.ok) return apiKey;
  const identity = await issuerIdentity(tenant, apiKey.value.issuedByUserId, deps);
  if (!identity.ok) return identity;
  const limited = await claimShopKeyRateLimit(apiKey.value.id, tenant.id, deps);
  if (!limited.ok) return limited;
  if (requiredScope !== null && !apiKey.value.scopes.includes(requiredScope)) {
    return err(forbidden(`${requiredScope} is not permitted`));
  }
  return ok({
    apiKey: apiKey.value,
    ctx: {
      identity: identity.value,
      capabilities: shopManagementKeyCapabilities(apiKey.value),
      machineActor: { kind: 'shop_management_key', apiKeyId: apiKey.value.id, mode: apiKey.value.mode },
    },
  });
};

export const authenticateShopManagementKey = async (
  tenant: ShopTenant,
  presentedSecret: string,
  requiredScope: ShopManagementScope | null,
  deps: ShopMachineAuthDeps,
): Promise<ShopMachineAuthOutcome> => {
  const secret = presentedSecret.trim();
  if (!secret) return { result: err(unauthorized('Missing API key')), attribution: { match: 'missing' } };
  const found = await findStoredKey(tenant.id, secret, deps);
  return {
    result: await authenticateStoredKey(tenant, found, requiredScope, deps),
    attribution: attributionOf(found),
  };
};

export interface ShopManagementKeyRequest {
  apiKeyId: string;
  actorUserId: string;
  method: NonNullable<ShopManagementKeyEvent['method']>;
  route: string;
  resourceId: string | null;
}

export interface ShopManagementKeyRequestDeps {
  shopManagementKeyEvents: Pick<ShopManagementKeyEventRepository, 'record'>;
  ids: IdGenerator;
  clock: Clock;
}

export const recordShopManagementKeyRequest = async (
  tenantId: string,
  request: ShopManagementKeyRequest,
  deps: ShopManagementKeyRequestDeps,
): Promise<void> => {
  await deps.shopManagementKeyEvents.record(tenantId, {
    id: deps.ids.nextId(),
    tenantId,
    kind: 'request',
    ...request,
    at: deps.clock.nowIso(),
  });
};
