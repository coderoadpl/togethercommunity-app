import {
  createShopManagementKeyInputSchema,
  err,
  forbidden,
  notFound,
  ok,
  SHOP_MANAGEMENT_KEY_MAX_LIFETIME_MS,
  toShopManagementKeyPublic,
  validation,
  type AppError,
  type CreateShopManagementKeyInput,
  type Result,
  type ShopManagementKey,
  type ShopManagementKeyEvent,
  type ShopManagementKeyEventPage,
  type ShopManagementKeyPublic,
  type ShopManagementKeysSwitch,
} from '#core/domain/index.js';

import { authorizeTenant } from '../authorize.js';
import type { Ctx } from '../context.js';
import { ownerSessionTenant } from '../owner-session.js';
import type {
  ApiKeyCrypto,
  ChangeProposalWithdrawalEvent,
  Clock,
  IdGenerator,
  ShopManagementKeyEventRepository,
  ShopManagementKeyRepository,
} from '../ports.js';

export interface ShopManagementKeyDeps {
  shopManagementKeys: ShopManagementKeyRepository;
  apiKeyCrypto: ApiKeyCrypto;
  ids: IdGenerator;
  clock: Clock;
  shopManagementKeysSwitch: ShopManagementKeysSwitch;
}

export interface CreatedShopManagementKey {
  apiKey: ShopManagementKeyPublic;
  secret: string;
}

export interface ShopManagementKeyEventReadDeps {
  shopManagementKeyEvents: Pick<ShopManagementKeyEventRepository, 'list'>;
}

const keyOwnerSession = (ctx: Ctx, tenant: Result<string, AppError>): Result<string, AppError> =>
  ownerSessionTenant(ctx, tenant, 'Shop management keys require a verified owner session');

const lifecycleEvent = (
  ctx: Ctx,
  tenantId: string,
  kind: 'created' | 'revoked' | 'purged',
  apiKeyId: string,
  deps: Pick<ShopManagementKeyDeps, 'ids' | 'clock'>,
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

const proposalWithdrawalEvent = (
  ctx: Ctx,
  deps: Pick<ShopManagementKeyDeps, 'ids' | 'clock'>,
): ChangeProposalWithdrawalEvent => {
  const at = deps.clock.nowIso();
  return () => ({ id: deps.ids.nextId(), actorUserId: ctx.identity.userId, at });
};

export const createShopManagementKey = async (
  ctx: Ctx,
  input: CreateShopManagementKeyInput,
  deps: ShopManagementKeyDeps,
): Promise<Result<CreatedShopManagementKey, AppError>> => {
  const tenant = keyOwnerSession(ctx, authorizeTenant(ctx, 'api-key:write'));
  if (!tenant.ok) return tenant;
  if (deps.shopManagementKeysSwitch === 'disabled') {
    return err(forbidden('Shop management keys are disabled on this deployment (SHOP_MANAGEMENT_KEYS=disabled)'));
  }
  const parsed = createShopManagementKeyInputSchema.safeParse(input);
  if (!parsed.success) return err(validation('Invalid shop management key', parsed.error.flatten()));

  const createdAt = deps.clock.nowIso();
  const lifetimeMs = Date.parse(parsed.data.expiresAt) - Date.parse(createdAt);
  if (lifetimeMs <= 0) return err(validation('API key expiry must be in the future'));
  if (lifetimeMs > SHOP_MANAGEMENT_KEY_MAX_LIFETIME_MS) {
    return err(validation('Shop management key expiry cannot exceed 30 days'));
  }

  const secret = deps.apiKeyCrypto.generateSecret();
  const key: ShopManagementKey = {
    id: deps.ids.nextId(),
    tenantId: tenant.value,
    name: parsed.data.name,
    keyHash: deps.apiKeyCrypto.hash(secret),
    scopes: [...new Set(parsed.data.scopes)],
    mode: parsed.data.mode,
    issuedByUserId: ctx.identity.userId,
    createdAt,
    expiresAt: parsed.data.expiresAt,
    revokedAt: null,
  };
  await deps.shopManagementKeys.create(tenant.value, key, lifecycleEvent(ctx, tenant.value, 'created', key.id, deps));
  return ok({ apiKey: toShopManagementKeyPublic(key), secret });
};

export const listShopManagementKeys = async (
  ctx: Ctx,
  deps: Pick<ShopManagementKeyDeps, 'shopManagementKeys'>,
): Promise<Result<ShopManagementKeyPublic[], AppError>> => {
  const tenant = keyOwnerSession(ctx, authorizeTenant(ctx, 'api-key:write'));
  if (!tenant.ok) return tenant;
  return ok((await deps.shopManagementKeys.listByTenant(tenant.value)).map(toShopManagementKeyPublic));
};

export const revokeShopManagementKey = async (
  ctx: Ctx,
  input: { id: string },
  deps: Pick<ShopManagementKeyDeps, 'shopManagementKeys' | 'ids' | 'clock'>,
): Promise<Result<ShopManagementKeyPublic, AppError>> => {
  const tenant = keyOwnerSession(ctx, authorizeTenant(ctx, 'api-key:write'));
  if (!tenant.ok) return tenant;
  const revoked = await deps.shopManagementKeys.revoke(
    tenant.value,
    input.id,
    deps.clock.nowIso(),
    lifecycleEvent(ctx, tenant.value, 'revoked', input.id, deps),
    proposalWithdrawalEvent(ctx, deps),
  );
  if (!revoked) return err(notFound(`No active shop management key "${input.id}" in this tenant`));
  return ok(toShopManagementKeyPublic(revoked));
};

export const purgeShopManagementKeys = async (
  ctx: Ctx,
  deps: Pick<ShopManagementKeyDeps, 'shopManagementKeys' | 'ids' | 'clock'>,
): Promise<Result<{ purged: number }, AppError>> => {
  const tenant = keyOwnerSession(ctx, authorizeTenant(ctx, 'api-key:write'));
  if (!tenant.ok) return tenant;
  const purged = await deps.shopManagementKeys.purge(
    tenant.value,
    (apiKeyId) => lifecycleEvent(ctx, tenant.value, 'purged', apiKeyId, deps),
    proposalWithdrawalEvent(ctx, deps),
  );
  return ok({ purged });
};

export const listShopManagementKeyEvents = async (
  ctx: Ctx,
  input: { apiKeyId?: string; cursor?: string; limit: number },
  deps: ShopManagementKeyEventReadDeps,
): Promise<Result<ShopManagementKeyEventPage, AppError>> => {
  const tenant = keyOwnerSession(ctx, authorizeTenant(ctx, 'api-key:write'));
  if (!tenant.ok) return tenant;
  return ok(await deps.shopManagementKeyEvents.list(tenant.value, {
    limit: input.limit,
    ...(input.apiKeyId === undefined ? {} : { apiKeyId: input.apiKeyId }),
    ...(input.cursor === undefined ? {} : { cursor: input.cursor }),
  }));
};
