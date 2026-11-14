import {
  createApiKeyInputSchema,
  err,
  forbidden,
  IMPORT_API_KEY_MAX_LIFETIME_MS,
  isImportApiKeyScope,
  notFound,
  ok,
  SHOP_MANAGEMENT_KEY_MAX_LIFETIME_MS,
  toTenantApiKeyPublic,
  validation,
  type AppError,
  type CreateApiKeyInput,
  type ImportAuditEvent,
  type Result,
  type TenantApiKey,
  type TenantApiKeyPublic,
  type TenantAuditEventInput,
} from '#core/domain/index.js';

import type { Ctx } from '../context.js';
import { authorizeTenant } from '../authorize.js';
import type {
  ApiKeyCrypto,
  Clock,
  IdGenerator,
  ImportAuditEventRepository,
  TenantApiKeyRepository,
} from '../ports.js';

export interface ApiKeyDeps {
  tenantApiKeys: TenantApiKeyRepository;
  apiKeyCrypto: ApiKeyCrypto;
  ids: IdGenerator;
  clock: Clock;
}

export interface CreatedApiKey {
  apiKey: TenantApiKeyPublic;
  secret: string;
}

export interface ImportAuditReadDeps {
  tenantApiKeys: Pick<TenantApiKeyRepository, 'listByTenant'>;
  importAuditEvents: Pick<ImportAuditEventRepository, 'listByApiKey'>;
}

const shopManagementKeyDenial = (ctx: Ctx): AppError | null =>
  ctx.identity.staffRole === 'owner'
    && ctx.identity.emailVerified
    && ctx.impersonation === undefined
    && ctx.capabilities === undefined
    ? null
    : forbidden('Shop management keys require a verified owner session');

const shopManagementAudit = (
  ctx: Ctx,
  tenantId: string,
  kind: 'api_key.shop_management_created' | 'api_key.shop_management_revoked',
  apiKey: Pick<TenantApiKey, 'id' | 'name'>,
  deps: Pick<ApiKeyDeps, 'ids' | 'clock'>,
): TenantAuditEventInput => ({
  id: deps.ids.nextId(),
  tenantId,
  kind,
  actorUserId: ctx.identity.userId,
  actorEmail: ctx.identity.email,
  subjectMemberId: null,
  reason: `${apiKey.name} (${apiKey.id})`,
  at: deps.clock.nowIso(),
});

export const createTenantApiKey = async (
  ctx: Ctx,
  input: CreateApiKeyInput,
  deps: ApiKeyDeps,
): Promise<Result<CreatedApiKey, AppError>> => {
  const tenant = authorizeTenant(ctx, 'api-key:write');
  if (!tenant.ok) return tenant;

  const parsed = createApiKeyInputSchema.safeParse(input);
  if (!parsed.success) return err(validation('Invalid API key', parsed.error.flatten()));
  const kind = parsed.data.kind ?? 'legacy';
  if (kind === 'shop_management') {
    const denial = shopManagementKeyDenial(ctx);
    if (denial !== null) return err(denial);
  }

  const createdAt = deps.clock.nowIso();
  const expiresAt = parsed.data.expiresAt ?? null;
  if (expiresAt !== null && Date.parse(expiresAt) <= Date.parse(createdAt)) {
    return err(validation('API key expiry must be in the future'));
  }
  if (
    expiresAt !== null
    && parsed.data.scopes?.some(isImportApiKeyScope) === true
    && Date.parse(expiresAt) - Date.parse(createdAt) > IMPORT_API_KEY_MAX_LIFETIME_MS
  ) {
    return err(validation('Import API key expiry cannot exceed 30 days'));
  }
  if (
    kind === 'shop_management'
    && expiresAt !== null
    && Date.parse(expiresAt) - Date.parse(createdAt) > SHOP_MANAGEMENT_KEY_MAX_LIFETIME_MS
  ) {
    return err(validation('Shop management key expiry cannot exceed 30 days'));
  }

  const secret = deps.apiKeyCrypto.generateSecret();
  const apiKey: TenantApiKey = {
    id: deps.ids.nextId(),
    tenantId: tenant.value,
    name: parsed.data.name,
    keyHash: deps.apiKeyCrypto.hash(secret),
    kind,
    scopes: parsed.data.scopes ?? null,
    issuedByUserId: kind === 'shop_management' ? ctx.identity.userId : null,
    createdAt,
    expiresAt,
    revokedAt: null,
  };
  if (kind === 'shop_management') {
    await deps.tenantApiKeys.createShopManagement(
      tenant.value,
      apiKey,
      shopManagementAudit(ctx, tenant.value, 'api_key.shop_management_created', apiKey, deps),
    );
  } else {
    await deps.tenantApiKeys.create(tenant.value, apiKey);
  }
  return ok({ apiKey: toTenantApiKeyPublic(apiKey), secret });
};

export const listTenantApiKeys = async (
  ctx: Ctx,
  deps: ApiKeyDeps,
): Promise<Result<TenantApiKeyPublic[], AppError>> => {
  const tenant = authorizeTenant(ctx, 'api-key:read');
  if (!tenant.ok) return tenant;
  const keys = await deps.tenantApiKeys.listByTenant(tenant.value);
  return ok(keys.map(toTenantApiKeyPublic));
};

export const revokeTenantApiKey = async (
  ctx: Ctx,
  input: { id: string },
  deps: ApiKeyDeps,
): Promise<Result<TenantApiKeyPublic, AppError>> => {
  const tenant = authorizeTenant(ctx, 'api-key:write');
  if (!tenant.ok) return tenant;

  const existing = (await deps.tenantApiKeys.listByTenant(tenant.value)).find((key) => key.id === input.id);
  if (existing?.kind === 'shop_management') {
    const denial = shopManagementKeyDenial(ctx);
    if (denial !== null) return err(denial);
  }
  const revoked = existing?.kind === 'shop_management'
    ? await deps.tenantApiKeys.revokeShopManagement(
      tenant.value,
      existing.id,
      deps.clock.nowIso(),
      shopManagementAudit(ctx, tenant.value, 'api_key.shop_management_revoked', existing, deps),
    )
    : await deps.tenantApiKeys.revoke(tenant.value, input.id, deps.clock.nowIso());
  if (!revoked) return err(notFound(`No API key "${input.id}" in this tenant`));
  return ok(toTenantApiKeyPublic(revoked));
};

export const listImportAuditForApiKey = async (
  ctx: Ctx,
  input: { id: string; cursor?: string; limit: number },
  deps: ImportAuditReadDeps,
): Promise<Result<{ events: ImportAuditEvent[]; nextCursor: string | null }, AppError>> => {
  const tenant = authorizeTenant(ctx, 'api-key:write');
  if (!tenant.ok) return tenant;
  const keys = await deps.tenantApiKeys.listByTenant(tenant.value);
  if (!keys.some((key) => key.id === input.id)) {
    return err(notFound(`No API key "${input.id}" in this tenant`));
  }
  return ok(await deps.importAuditEvents.listByApiKey(tenant.value, input.id, {
    ...(input.cursor === undefined ? {} : { cursor: input.cursor }),
    limit: input.limit,
  }));
};
