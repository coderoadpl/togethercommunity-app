import {
  err,
  notFound,
  ok,
  setTenantSecretInputSchema,
  stripeModeFromKey,
  validation,
  type AppError,
  type Result,
  type SetTenantSecretInput,
  type StripeMode,
  type TenantSecret,
  type TenantSecretKey,
  type TenantSecretMasked,
} from '#core/domain/index.js';

import type { Ctx } from '../context.js';
import { authorizeTenant } from '../authorize.js';
import type { Clock, IdGenerator, SecretCrypto, TenantSecretRepository } from '../ports.js';

export interface TenantSecretDeps {
  tenantSecrets: TenantSecretRepository;
  secretCrypto: SecretCrypto;
  ids: IdGenerator;
  clock: Clock;
}

const masked = (secret: TenantSecret): TenantSecretMasked => ({
  key: secret.key,
  maskedPreview: secret.maskedPreview,
  updatedAt: secret.updatedAt,
});

const maskValue = (value: string): string => {
  const suffix = value.slice(-4);
  return `••••${suffix}`;
};

export const setTenantSecret = async (
  ctx: Ctx,
  input: SetTenantSecretInput,
  deps: TenantSecretDeps,
): Promise<Result<TenantSecretMasked, AppError>> => {
  const tenant = authorizeTenant(ctx, 'tenant:secret:write');
  if (!tenant.ok) return tenant;
  const parsed = setTenantSecretInputSchema.safeParse(input);
  if (!parsed.success) return err(validation('Invalid tenant secret', parsed.error.flatten()));
  const encrypted = deps.secretCrypto.encrypt(parsed.data.value);
  const stored = await deps.tenantSecrets.upsert(tenant.value, {
    id: deps.ids.nextId(),
    tenantId: tenant.value,
    key: parsed.data.key,
    ...encrypted,
    maskedPreview: maskValue(parsed.data.value),
    updatedAt: deps.clock.nowIso(),
  });
  return ok(masked(stored));
};

export interface TenantSecretsView {
  secrets: TenantSecretMasked[];
  stripeMode: StripeMode | null;
  stripeWebhookUrl: string;
}

const readStripeMode = (rows: TenantSecret[], secretCrypto: SecretCrypto): StripeMode | null => {
  const stored = rows.find((row) => row.key === 'stripe.restrictedKey');
  if (stored === undefined) return null;
  const decrypted = secretCrypto.decrypt(stored);
  if (!decrypted.ok) return null;
  return stripeModeFromKey(decrypted.value);
};

export const stripeWebhookUrl = (appBaseUrl: string, tenantId: string): string =>
  `${appBaseUrl.replace(/\/$/, '')}/api/webhooks/stripe/${encodeURIComponent(tenantId)}`;

export const getTenantSecretsMasked = async (
  ctx: Ctx,
  deps: TenantSecretDeps & { appBaseUrl: string },
): Promise<Result<TenantSecretsView, AppError>> => {
  const tenant = authorizeTenant(ctx, 'tenant:secret:read');
  if (!tenant.ok) return tenant;
  const rows = await deps.tenantSecrets.listByTenant(tenant.value);
  return ok({
    secrets: rows.map(masked),
    stripeMode: readStripeMode(rows, deps.secretCrypto),
    stripeWebhookUrl: stripeWebhookUrl(deps.appBaseUrl, tenant.value),
  });
};

export const deleteTenantSecret = async (
  ctx: Ctx,
  key: TenantSecretKey,
  deps: TenantSecretDeps,
): Promise<Result<{ key: TenantSecretKey }, AppError>> => {
  const tenant = authorizeTenant(ctx, 'tenant:secret:write');
  if (!tenant.ok) return tenant;
  if (!(await deps.tenantSecrets.delete(tenant.value, key))) {
    return err(notFound(`No secret "${key}" in this tenant`));
  }
  return ok({ key });
};
