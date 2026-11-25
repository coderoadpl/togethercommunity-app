import {
  appError,
  capabilitiesForPrincipal,
  err,
  forbidden,
  ok,
  shopManagementCapabilities,
  SMOKE_TENANT_ID,
  unauthorized,
  type AppError,
  type Capability,
  type Identity,
  type Result,
  type ShopManagementKey,
  type ShopManagementKeyEvent,
  type ShopManagementKeyMode,
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

const PROPOSE_MODE_HASH_DOMAIN = 'together:shop-management-key:propose:';
const PURCHASE_SMOKE_HASH_DOMAIN = 'together:shop-management-key:purchase-smoke:';

export const shopManagementKeyHash = (
  apiKeyCrypto: Pick<ApiKeyCrypto, 'hash'>,
  secret: string,
  mode: ShopManagementKeyMode | 'purchase-smoke',
): string => apiKeyCrypto.hash(mode === 'purchase-smoke' ? `${PURCHASE_SMOKE_HASH_DOMAIN}${secret}` : mode === 'propose' ? `${PROPOSE_MODE_HASH_DOMAIN}${secret}` : secret);

const KEY_HASH_DOMAINS = ['direct', 'propose', 'purchase-smoke'] as const;

interface StoredKeyLookup {
  found: ShopManagementKey | null;
  foundInItsOwnDomain: boolean;
}

const findStoredKey = async (
  tenantId: string,
  secret: string,
  deps: Pick<ShopMachineAuthDeps, 'shopManagementKeys' | 'apiKeyCrypto'>,
): Promise<StoredKeyLookup> => {
  const hits = (await Promise.all(KEY_HASH_DOMAINS.map(async (domain) => ({
    domain,
    key: await deps.shopManagementKeys.findByHash(tenantId, shopManagementKeyHash(deps.apiKeyCrypto, secret, domain)),
  })))).flatMap(({ domain, key }) => (key?.tenantId === tenantId ? [{ domain, key }] : []));
  const [hit] = hits;
  if (hit === undefined) return { found: null, foundInItsOwnDomain: false };
  return { found: hit.key, foundInItsOwnDomain: hits.length === 1 && (hit.key.purpose ?? hit.key.mode) === hit.domain };
};

const attributionOf = (found: ShopManagementKey | null): ShopKeyAttribution =>
  found === null
    ? { match: 'none' }
    : { match: 'matched', apiKeyId: found.id, issuerUserId: found.issuedByUserId };

const usableShopKey = (
  { found, foundInItsOwnDomain }: StoredKeyLookup,
  deps: Pick<ShopMachineAuthDeps, 'clock'>,
): Result<ShopManagementKey, AppError> =>
  found === null
  || !foundInItsOwnDomain
  || (found.purpose === 'purchase-smoke' && (found.tenantId !== SMOKE_TENANT_ID || found.scopes.length !== 0 || found.mode !== 'direct'))
  || (found.purpose === undefined && found.scopes.length === 0)
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

export const shopManagementKeyCapabilities = (apiKey: Pick<ShopManagementKey, 'scopes' | 'mode' | 'purpose'>): Capability[] => {
  if (apiKey.purpose === 'purchase-smoke') return [];
  const ownerCapabilities = capabilitiesForPrincipal('owner');
  return shopManagementCapabilities(apiKey.scopes, apiKey.mode).filter((capability) => ownerCapabilities.includes(capability));
};

const authenticateStoredKey = async (
  tenant: ShopTenant,
  lookup: StoredKeyLookup,
  requiredScope: ShopManagementScope | null,
  deps: ShopMachineAuthDeps,
): Promise<Result<ShopMachineAuthentication, AppError>> => {
  const apiKey = usableShopKey(lookup, deps);
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
  const lookup = await findStoredKey(tenant.id, secret, deps);
  return {
    result: await authenticateStoredKey(tenant, lookup, requiredScope, deps),
    attribution: attributionOf(lookup.found),
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
