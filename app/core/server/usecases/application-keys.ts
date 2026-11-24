import {
  createApplicationKeyInputSchema,
  APPLICATION_KEY_MAX_LIFETIME_MS,
  err,
  forbidden,
  notFound,
  ok,
  toApplicationKeyPublic,
  validation,
  type AppError,
  type CreateApplicationKeyInput,
  type ApplicationKey,
  type ApplicationKeyPublic,
  type Product,
  type Result,
  type ShopManagementKeyEvent,
  type ShopManagementKeysSwitch,
} from '#core/domain/index.js';

import { authorizeTenant, requireDirectGrant } from '../authorize.js';
import type { Ctx } from '../context.js';
import { ownerSessionTenant } from '../owner-session.js';
import type { ApiKeyCrypto, Clock, ApplicationKeyRepository, IdGenerator } from '../ports.js';
import { applicationKeyHash } from './application-key-auth.js';

export interface ApplicationKeyDeps {
  applicationKeys: ApplicationKeyRepository;
  products: { findById(tenantId: string, productId: string): Promise<Pick<Product, 'id' | 'tenantId'> | null> };
  apiKeyCrypto: ApiKeyCrypto;
  ids: IdGenerator;
  clock: Clock;
  shopManagementKeysSwitch: ShopManagementKeysSwitch;
}

export interface CreatedApplicationKey {
  apiKey: ApplicationKeyPublic;
  secret: string;
}

const OWNER_SESSION_REFUSAL = 'Application keys require a verified owner in their own session';

const keyOwnerSession = (ctx: Ctx, tenant: Result<string, AppError>): Result<string, AppError> =>
  requireDirectGrant(ctx, ownerSessionTenant(ctx, tenant, OWNER_SESSION_REFUSAL), OWNER_SESSION_REFUSAL);

const lifecycleEvent = (
  ctx: Ctx,
  tenantId: string,
  kind: 'created' | 'revoked',
  apiKeyId: string,
  deps: Pick<ApplicationKeyDeps, 'ids' | 'clock'>,
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
  deps: Pick<ApplicationKeyDeps, 'products'>,
): Promise<string[]> => {
  const found = await Promise.all(productIds.map(async (productId) => ({
    productId,
    product: await deps.products.findById(tenantId, productId),
  })));
  return found.filter(({ product }) => product?.tenantId !== tenantId).map(({ productId }) => productId);
};

export const createApplicationKey = async (
  ctx: Ctx,
  input: CreateApplicationKeyInput,
  deps: ApplicationKeyDeps,
): Promise<Result<CreatedApplicationKey, AppError>> => {
  const tenant = keyOwnerSession(ctx, authorizeTenant(ctx, 'api-key:write'));
  if (!tenant.ok) return tenant;
  if (deps.shopManagementKeysSwitch === 'disabled') {
    return err(forbidden('Application keys are disabled on this deployment (SHOP_MANAGEMENT_KEYS=disabled)'));
  }
  const parsed = createApplicationKeyInputSchema.safeParse(input);
  if (!parsed.success) return err(validation('Invalid application key', parsed.error.flatten()));

  const createdAt = deps.clock.nowIso();
  const lifetimeMs = Date.parse(parsed.data.expiresAt) - Date.parse(createdAt);
  if (lifetimeMs <= 0) return err(validation('API key expiry must be in the future'));
  if (lifetimeMs > APPLICATION_KEY_MAX_LIFETIME_MS) return err(validation('Application key expiry cannot exceed 90 days'));

  const productIds = parsed.data.productIds === undefined ? null : [...new Set(parsed.data.productIds)];
  if (productIds !== null) {
    const unknown = await unknownProducts(tenant.value, productIds, deps);
    if (unknown.length > 0) return err(validation('Unknown product in this workspace', { productIds: unknown }));
  }

  const secret = deps.apiKeyCrypto.generateSecret();
  const key: ApplicationKey = {
    id: deps.ids.nextId(),
    tenantId: tenant.value,
    name: parsed.data.name,
    keyHash: applicationKeyHash(deps.apiKeyCrypto, secret),
    scopes: [...new Set(parsed.data.scopes)],
    productIds,
    issuedByUserId: ctx.identity.userId,
    createdAt,
    expiresAt: parsed.data.expiresAt,
    revokedAt: null,
  };
  await deps.applicationKeys.create(tenant.value, key, lifecycleEvent(ctx, tenant.value, 'created', key.id, deps));
  return ok({ apiKey: toApplicationKeyPublic(key), secret });
};

export const listApplicationKeys = async (
  ctx: Ctx,
  deps: Pick<ApplicationKeyDeps, 'applicationKeys'>,
): Promise<Result<ApplicationKeyPublic[], AppError>> => {
  const tenant = keyOwnerSession(ctx, authorizeTenant(ctx, 'api-key:write'));
  if (!tenant.ok) return tenant;
  return ok((await deps.applicationKeys.listByTenant(tenant.value)).map(toApplicationKeyPublic));
};

export const revokeApplicationKey = async (
  ctx: Ctx,
  input: { id: string },
  deps: Pick<ApplicationKeyDeps, 'applicationKeys' | 'ids' | 'clock'>,
): Promise<Result<ApplicationKeyPublic, AppError>> => {
  const tenant = keyOwnerSession(ctx, authorizeTenant(ctx, 'api-key:write'));
  if (!tenant.ok) return tenant;
  const revoked = await deps.applicationKeys.revoke(
    tenant.value,
    input.id,
    deps.clock.nowIso(),
    lifecycleEvent(ctx, tenant.value, 'revoked', input.id, deps),
  );
  if (!revoked) return err(notFound(`No active application key "${input.id}" in this tenant`));
  return ok(toApplicationKeyPublic(revoked));
};
