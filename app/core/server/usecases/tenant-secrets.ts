import {
  err,
  notFound,
  ok,
  setTenantSecretInputSchema,
  stripeModeFromKey,
  validation,
  type AppError,
  type PaymentSources,
  type Result,
  type SetTenantSecretInput,
  type StripeMode,
  type TenantSecret,
  type TenantSecretKey,
  type TenantSecretMasked,
} from '#core/domain/index.js';

import { tenantUrl, type TenantUrlDeps } from '../tenant-url.js';
import type { Ctx } from '../context.js';
import { authorizeTenant } from '../authorize.js';
import type {
  Clock,
  EffectivePaymentConfigReader,
  IdGenerator,
  MarketingSesCredentialResolver,
  SecretCrypto,
  SesOnboardingControlPlane,
  TenantSecretRepository,
  TenantSesSettingsRepository,
} from '../ports.js';
import { refreshTenantSesIdentityStatus } from './marketing-ses-onboarding.js';
import { paymentConfigReader, paymentSourcesOf, workspaceSecretsFromRows } from './payment-config.js';
import type { SesWebhookBaseUrlResolver } from './ses-webhook-url.js';

export interface TenantSecretDeps {
  tenantSecrets: TenantSecretRepository;
  secretCrypto: SecretCrypto;
  ids: IdGenerator;
  clock: Clock;
  sesIdentity?: {
    settings: TenantSesSettingsRepository;
    credentials: MarketingSesCredentialResolver;
    controlPlane: SesOnboardingControlPlane;
    webhookBaseUrl: SesWebhookBaseUrlResolver;
  };
}

const sesCredentialKeys: readonly TenantSecretKey[] = [
  'ses.accessKeyId',
  'ses.secretAccessKey',
  'ses.region',
];

const sesCredentialsComplete = async (
  tenantId: string,
  deps: TenantSecretDeps,
): Promise<boolean> => {
  const stored = await deps.tenantSecrets.listByTenant(tenantId);
  return sesCredentialKeys.every((key) => stored.some((secret) => secret.key === key));
};

const checkSesIdentityAfterCredentialSave = async (
  tenantId: string,
  key: TenantSecretKey,
  deps: TenantSecretDeps,
): Promise<void> => {
  const sesIdentity = deps.sesIdentity;
  if (sesIdentity === undefined || !sesCredentialKeys.includes(key)) return;
  try {
    if (!await sesCredentialsComplete(tenantId, deps)) return;
    const settings = await sesIdentity.settings.findByTenant(tenantId);
    if (settings === null || settings.identity.trim() === '') return;
    await refreshTenantSesIdentityStatus(tenantId, settings, { ...sesIdentity, clock: deps.clock });
  } catch {
    return;
  }
};

const masked = (secret: TenantSecret): TenantSecretMasked => ({
  key: secret.key,
  maskedPreview: secret.maskedPreview,
  updatedAt: secret.updatedAt,
});

const maskValue = (value: string): string => {
  const suffix = value.slice(-4);
  return `••••${suffix}`;
};

export const buildTenantSecret = (
  tenantId: string,
  key: TenantSecretKey,
  value: string,
  deps: Pick<TenantSecretDeps, 'secretCrypto' | 'ids' | 'clock'>,
): TenantSecret => ({
  id: deps.ids.nextId(),
  tenantId,
  key,
  ...deps.secretCrypto.encrypt(value),
  maskedPreview: key === 'analyticsMetaCapiAccessToken' ? 'configured' : maskValue(value),
  updatedAt: deps.clock.nowIso(),
});

export const setTenantSecret = async (
  ctx: Ctx,
  input: SetTenantSecretInput,
  deps: TenantSecretDeps,
): Promise<Result<TenantSecretMasked, AppError>> => {
  const tenant = authorizeTenant(ctx, 'tenant:secret:write', { shopManagementKeyGrant: { secretKey: input.key } });
  if (!tenant.ok) return tenant;
  const parsed = setTenantSecretInputSchema.safeParse(input);
  if (!parsed.success) return err(validation('Invalid tenant secret', parsed.error.flatten()));
  if (parsed.data.key === 'stripe.restrictedKey' || parsed.data.key === 'stripe.testRestrictedKey') {
    const expected = parsed.data.key === 'stripe.testRestrictedKey' ? 'test' : 'live';
    if (stripeModeFromKey(parsed.data.value) !== expected) {
      return err(validation(`The Stripe ${expected} slot requires a ${expected} restricted key`));
    }
  }
  const stored = await deps.tenantSecrets.upsert(
    tenant.value,
    buildTenantSecret(tenant.value, parsed.data.key, parsed.data.value, deps),
  );
  await checkSesIdentityAfterCredentialSave(tenant.value, parsed.data.key, deps);
  return ok(masked(stored));
};

export interface TenantSecretsView {
  secrets: TenantSecretMasked[];
  stripeMode: StripeMode | null;
  stripeWebhookUrl: string;
  stripeTestLastEventAt: string | null;
  paymentSources?: PaymentSources;
}

export const stripeWebhookUrl = (
  tenantSlug: string | null,
  tenantId: string,
  deps: TenantUrlDeps,
): string => tenantUrl(tenantSlug, `/api/webhooks/stripe/${encodeURIComponent(tenantId)}`, deps);

export const getTenantSecretsMasked = async (
  ctx: Ctx,
  deps: TenantSecretDeps & TenantUrlDeps & { paymentConfig?: EffectivePaymentConfigReader | undefined },
): Promise<Result<TenantSecretsView, AppError>> => {
  const tenant = authorizeTenant(ctx, 'tenant:secret:read');
  if (!tenant.ok) return tenant;
  const rows = await deps.tenantSecrets.listByTenant(tenant.value);
  const payments = paymentConfigReader(deps.paymentConfig, workspaceSecretsFromRows(rows), deps.secretCrypto);
  const [live, test] = await Promise.all([payments.read(tenant.value, 'live'), payments.read(tenant.value, 'test')]);
  const sources = paymentSourcesOf(live, test);
  return ok({
    secrets: rows.map(masked),
    stripeTestLastEventAt: rows.find((row) => row.key === 'stripe.testLastEventAt')?.updatedAt ?? null,
    stripeMode: live.keyMode,
    stripeWebhookUrl: stripeWebhookUrl(ctx.identity.tenantSlug, tenant.value, deps),
    ...(sources === null ? {} : { paymentSources: sources }),
  });
};

export const deleteTenantSecret = async (
  ctx: Ctx,
  key: TenantSecretKey,
  deps: TenantSecretDeps,
): Promise<Result<{ key: TenantSecretKey }, AppError>> => {
  const tenant = authorizeTenant(ctx, 'tenant:secret:write', { shopManagementKeyGrant: { secretKey: key } });
  if (!tenant.ok) return tenant;
  if (key === 'telemetry.mongodb') return err(validation('Use the telemetry disconnect flow'));
  if (!(await deps.tenantSecrets.delete(tenant.value, key))) {
    return err(notFound(`No secret "${key}" in this tenant`));
  }
  return ok({ key });
};
