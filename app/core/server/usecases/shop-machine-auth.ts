import {
  capabilitiesForPrincipal,
  err,
  forbidden,
  ok,
  shopManagementCapabilitiesForApiKey,
  shopManagementScopeSchema,
  unauthorized,
  type AppError,
  type Identity,
  type Result,
  type ShopManagementScope,
  type Tenant,
  type TenantApiKey,
} from '#core/domain/index.js';

import type { Ctx } from '../context.js';
import type {
  AccountIdentityReader,
  ApiKeyCrypto,
  ApiKeyRateLimitRepository,
  Clock,
  TenantAccessReader,
  TenantApiKeyRepository,
} from '../ports.js';
import { apiKeyRateLimited, apiKeyRateLimitWindows, type ApiKeyRateLimitWindow } from './m2m-transactional-email.js';

const SHOP_MANAGEMENT_KEY_RATE_LIMITS = { perMinute: 60, perDay: 10_000 } as const;

export interface ShopMachineAuthDeps {
  tenantApiKeys: Pick<TenantApiKeyRepository, 'findByHash'>;
  apiKeyCrypto: ApiKeyCrypto;
  accountIdentities: AccountIdentityReader;
  tenantAccess: Pick<TenantAccessReader, 'findStaffGrant' | 'findMember'>;
  apiKeyRateLimits: ApiKeyRateLimitRepository;
  clock: Clock;
}

export interface ShopMachineAuthentication {
  ctx: Ctx;
  apiKey: TenantApiKey;
}

type ShopTenant = Pick<Tenant, 'id' | 'slug' | 'name'>;

const invalidKey = (): AppError => unauthorized('Invalid API key');

const hasOnlyShopScopes = (apiKey: TenantApiKey): boolean =>
  apiKey.scopes !== null
  && apiKey.scopes.length > 0
  && apiKey.scopes.every((scope) => shopManagementScopeSchema.safeParse(scope).success);

export type ShopKeyAttribution =
  | { match: 'missing' }
  | { match: 'none' }
  | { match: 'matched'; apiKeyId: string; kind: TenantApiKey['kind']; issuerUserId: string | null };

interface ShopMachineAuthOutcome {
  result: Result<ShopMachineAuthentication, AppError>;
  attribution: ShopKeyAttribution;
}

type KeyLookupDeps = Pick<ShopMachineAuthDeps, 'tenantApiKeys' | 'apiKeyCrypto'>;

const findStoredKey = async (
  tenantId: string,
  secret: string,
  deps: KeyLookupDeps,
): Promise<TenantApiKey | null> => {
  const found = await deps.tenantApiKeys.findByHash(tenantId, deps.apiKeyCrypto.hash(secret));
  return found?.tenantId === tenantId ? found : null;
};

const attributionOf = (found: TenantApiKey | null): ShopKeyAttribution =>
  found === null
    ? { match: 'none' }
    : { match: 'matched', apiKeyId: found.id, kind: found.kind, issuerUserId: found.issuedByUserId };

export const identifyShopManagementKey = async (
  tenantId: string,
  presentedSecret: string,
  deps: KeyLookupDeps,
): Promise<ShopKeyAttribution> => {
  const secret = presentedSecret.trim();
  return secret ? attributionOf(await findStoredKey(tenantId, secret, deps)) : { match: 'missing' };
};

const usableShopKey = (
  found: TenantApiKey | null,
  deps: Pick<ShopMachineAuthDeps, 'clock'>,
): Result<TenantApiKey & { issuedByUserId: string }, AppError> => {
  if (
    found === null
    || found.kind !== 'shop_management'
    || found.revokedAt !== null
    || found.expiresAt === null
    || Date.parse(found.expiresAt) <= Date.parse(deps.clock.nowIso())
    || found.issuedByUserId === null
    || !hasOnlyShopScopes(found)
  ) {
    return err(invalidKey());
  }
  return ok({ ...found, issuedByUserId: found.issuedByUserId });
};

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

const claimShopKeyRateLimit = async (
  apiKeyId: string,
  tenantId: string,
  deps: Pick<ShopMachineAuthDeps, 'apiKeyRateLimits' | 'clock'>,
): Promise<Result<void, AppError>> => {
  const now = deps.clock.nowIso();
  const { minute, day } = apiKeyRateLimitWindows(now, SHOP_MANAGEMENT_KEY_RATE_LIMITS);
  const claim = (window: ApiKeyRateLimitWindow) => deps.apiKeyRateLimits.claim(tenantId, {
    apiKeyId,
    period: window.period,
    windowStartedAt: window.windowStartedAt,
    limit: window.limit,
  });
  if (!await claim(minute)) return err(apiKeyRateLimited(minute, now));
  if (await claim(day)) return ok(undefined);
  await deps.apiKeyRateLimits.release(tenantId, { apiKeyId, period: minute.period, windowStartedAt: minute.windowStartedAt });
  return err(apiKeyRateLimited(day, now));
};

const shopManagementKeyCapabilities = (apiKey: TenantApiKey) => {
  const ownerCapabilities = capabilitiesForPrincipal('owner');
  return shopManagementCapabilitiesForApiKey(apiKey).filter((capability) => ownerCapabilities.includes(capability));
};

const authenticateStoredKey = async (
  tenant: ShopTenant,
  found: TenantApiKey | null,
  requiredScope: ShopManagementScope,
  deps: ShopMachineAuthDeps,
): Promise<Result<ShopMachineAuthentication, AppError>> => {
  const apiKey = usableShopKey(found, deps);
  if (!apiKey.ok) return apiKey;
  const identity = await issuerIdentity(tenant, apiKey.value.issuedByUserId, deps);
  if (!identity.ok) return identity;
  const limited = await claimShopKeyRateLimit(apiKey.value.id, tenant.id, deps);
  if (!limited.ok) return limited;
  if (!(apiKey.value.scopes ?? []).includes(requiredScope)) {
    return err(forbidden(`${requiredScope} is not permitted`));
  }
  return ok({
    apiKey: apiKey.value,
    ctx: {
      identity: identity.value,
      capabilities: shopManagementKeyCapabilities(apiKey.value),
      machineActor: { kind: 'shop_management_key', apiKeyId: apiKey.value.id },
    },
  });
};

export const authenticateShopManagementKey = async (
  tenant: ShopTenant,
  presentedSecret: string,
  requiredScope: ShopManagementScope,
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
