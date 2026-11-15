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
import { claimApiKeyRateLimit } from './m2m-transactional-email.js';

const SHOP_MANAGEMENT_KEY_RATE_LIMITS = { perMinute: 60, perDay: 10_000 } as const;

export interface ShopMachineAuthDeps {
  tenantApiKeys: Pick<TenantApiKeyRepository, 'findActiveByHash'>;
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

const issuerNotOwner = (): AppError =>
  forbidden('The API key issuer is no longer a verified owner of this workspace');

const hasOnlyShopScopes = (apiKey: TenantApiKey): boolean =>
  apiKey.scopes !== null
  && apiKey.scopes.length > 0
  && apiKey.scopes.every((scope) => shopManagementScopeSchema.safeParse(scope).success);

const findUsableShopKey = async (
  tenantId: string,
  presentedSecret: string,
  deps: ShopMachineAuthDeps,
): Promise<Result<TenantApiKey & { issuedByUserId: string }, AppError>> => {
  const secret = presentedSecret.trim();
  if (!secret) return err(unauthorized('Missing API key'));
  const found = await deps.tenantApiKeys.findActiveByHash(tenantId, deps.apiKeyCrypto.hash(secret));
  if (
    found === null
    || found.tenantId !== tenantId
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
  if (account === null || !account.emailVerified) return err(issuerNotOwner());
  const grant = await deps.tenantAccess.findStaffGrant(issuerUserId, { tenantId: tenant.id });
  if (grant?.staffRole !== 'owner' || grant.tenant.id !== tenant.id) return err(issuerNotOwner());
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

const shopManagementKeyCapabilities = (apiKey: TenantApiKey) => {
  const ownerCapabilities = capabilitiesForPrincipal('owner');
  return shopManagementCapabilitiesForApiKey(apiKey).filter((capability) => ownerCapabilities.includes(capability));
};

export const authenticateShopManagementKey = async (
  tenant: ShopTenant,
  presentedSecret: string,
  requiredScope: ShopManagementScope,
  deps: ShopMachineAuthDeps,
): Promise<Result<ShopMachineAuthentication, AppError>> => {
  const apiKey = await findUsableShopKey(tenant.id, presentedSecret, deps);
  if (!apiKey.ok) return apiKey;
  const identity = await issuerIdentity(tenant, apiKey.value.issuedByUserId, deps);
  if (!identity.ok) return identity;
  const limited = await claimApiKeyRateLimit(apiKey.value.id, tenant.id, deps.clock.nowIso(), {
    rateLimits: deps.apiKeyRateLimits,
    limits: SHOP_MANAGEMENT_KEY_RATE_LIMITS,
  });
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
