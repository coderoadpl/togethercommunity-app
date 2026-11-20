import {
  createEntitlementKeyInputSchema,
  ENTITLEMENT_KEY_MAX_LIFETIME_MS,
  err,
  forbidden,
  notFound,
  ok,
  toEntitlementKeyPublic,
  validation,
  type AppError,
  type CreateEntitlementKeyInput,
  type EntitlementKey,
  type EntitlementKeyPublic,
  type Result,
  type ShopManagementKeyEvent,
  type ShopManagementKeysSwitch,
} from '#core/domain/index.js';

import { authorizeTenant, requireDirectGrant } from '../authorize.js';
import type { Ctx } from '../context.js';
import { ownerSessionTenant } from '../owner-session.js';
import type { ApiKeyCrypto, Clock, EntitlementKeyRepository, IdGenerator, ProductRepository } from '../ports.js';
import { entitlementKeyHash } from './entitlement-key-auth.js';

export interface EntitlementKeyDeps {
  entitlementKeys: EntitlementKeyRepository;
  products: Pick<ProductRepository, 'findById'>;
  apiKeyCrypto: ApiKeyCrypto;
  ids: IdGenerator;
  clock: Clock;
  shopManagementKeysSwitch: ShopManagementKeysSwitch;
}

export interface CreatedEntitlementKey {
  apiKey: EntitlementKeyPublic;
  secret: string;
}

const OWNER_SESSION_REFUSAL = 'Entitlement keys require a verified owner in their own session';

const keyOwnerSession = (ctx: Ctx): Result<string, AppError> =>
  requireDirectGrant(ctx, ownerSessionTenant(ctx, authorizeTenant(ctx, 'api-key:write'), OWNER_SESSION_REFUSAL), OWNER_SESSION_REFUSAL);

const lifecycleEvent = (
  ctx: Ctx,
  tenantId: string,
  kind: 'created' | 'revoked',
  apiKeyId: string,
  deps: Pick<EntitlementKeyDeps, 'ids' | 'clock'>,
): ShopManagementKeyEvent => ({
  id: deps.ids.nextId(),
  tenantId,
  apiKeyId,
  kind,
  actorUserId: ctx.identity.userId,
  method: null,
  route: null,
  resourceId: null,
  at: deps.clock.nowIso(),
});

const unknownProducts = async (
  tenantId: string,
  productIds: readonly string[],
  deps: Pick<EntitlementKeyDeps, 'products'>,
): Promise<string[]> => {
  const found = await Promise.all(productIds.map(async (productId) => ({
    productId,
    product: await deps.products.findById(tenantId, productId),
  })));
  return found.filter(({ product }) => product?.tenantId !== tenantId).map(({ productId }) => productId);
};

export const createEntitlementKey = async (
  ctx: Ctx,
  input: CreateEntitlementKeyInput,
  deps: EntitlementKeyDeps,
): Promise<Result<CreatedEntitlementKey, AppError>> => {
  const tenant = keyOwnerSession(ctx);
  if (!tenant.ok) return tenant;
  if (deps.shopManagementKeysSwitch === 'disabled') {
    return err(forbidden('Entitlement keys are disabled on this deployment (SHOP_MANAGEMENT_KEYS=disabled)'));
  }
  const parsed = createEntitlementKeyInputSchema.safeParse(input);
  if (!parsed.success) return err(validation('Invalid entitlement key', parsed.error.flatten()));

  const createdAt = deps.clock.nowIso();
  const lifetimeMs = Date.parse(parsed.data.expiresAt) - Date.parse(createdAt);
  if (lifetimeMs <= 0) return err(validation('API key expiry must be in the future'));
  if (lifetimeMs > ENTITLEMENT_KEY_MAX_LIFETIME_MS) return err(validation('Entitlement key expiry cannot exceed 90 days'));

  const productIds = parsed.data.productIds === undefined ? null : [...new Set(parsed.data.productIds)];
  if (productIds !== null) {
    const unknown = await unknownProducts(tenant.value, productIds, deps);
    if (unknown.length > 0) return err(validation('Unknown product in this workspace', { productIds: unknown }));
  }

  const secret = deps.apiKeyCrypto.generateSecret();
  const key: EntitlementKey = {
    id: deps.ids.nextId(),
    tenantId: tenant.value,
    name: parsed.data.name,
    keyHash: entitlementKeyHash(deps.apiKeyCrypto, secret),
    scopes: [...new Set(parsed.data.scopes)],
    productIds,
    issuedByUserId: ctx.identity.userId,
    createdAt,
    expiresAt: parsed.data.expiresAt,
    revokedAt: null,
  };
  await deps.entitlementKeys.create(tenant.value, key, lifecycleEvent(ctx, tenant.value, 'created', key.id, deps));
  return ok({ apiKey: toEntitlementKeyPublic(key), secret });
};

export const listEntitlementKeys = async (
  ctx: Ctx,
  deps: Pick<EntitlementKeyDeps, 'entitlementKeys'>,
): Promise<Result<EntitlementKeyPublic[], AppError>> => {
  const tenant = keyOwnerSession(ctx);
  if (!tenant.ok) return tenant;
  return ok((await deps.entitlementKeys.listByTenant(tenant.value)).map(toEntitlementKeyPublic));
};

export const revokeEntitlementKey = async (
  ctx: Ctx,
  input: { id: string },
  deps: Pick<EntitlementKeyDeps, 'entitlementKeys' | 'ids' | 'clock'>,
): Promise<Result<EntitlementKeyPublic, AppError>> => {
  const tenant = keyOwnerSession(ctx);
  if (!tenant.ok) return tenant;
  const revoked = await deps.entitlementKeys.revoke(
    tenant.value,
    input.id,
    deps.clock.nowIso(),
    lifecycleEvent(ctx, tenant.value, 'revoked', input.id, deps),
  );
  if (!revoked) return err(notFound(`No active entitlement key "${input.id}" in this tenant`));
  return ok(toEntitlementKeyPublic(revoked));
};
