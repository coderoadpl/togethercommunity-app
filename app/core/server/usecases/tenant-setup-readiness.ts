import {
  computeTenantSetupReadiness,
  ok,
  resolveTenantLogo,
  type AppError,
  type Result,
  type TenantSecret,
  type TenantSecretKey,
  type TenantSetupReadiness,
} from '#core/domain/index.js';

import type { Ctx } from '../context.js';
import { authorizeTenant } from '../authorize.js';
import { tenantLegalUrls } from './terms-consent.js';
import type {
  SpaceRepository,
  TenantRepository,
  TenantSecretRepository,
  TenantSesSettingsRepository,
} from '../ports.js';

export interface TenantSetupReadinessDeps {
  tenants: Pick<TenantRepository, 'findSettings'>;
  tenantSecrets: Pick<TenantSecretRepository, 'listByTenant'>;
  spaces: Pick<SpaceRepository, 'list'>;
  sesSettings: Pick<TenantSesSettingsRepository, 'findByTenant'> | null;
}

const SMTP_SECRET_KEYS: readonly TenantSecretKey[] = [
  'smtp.host',
  'smtp.port',
  'smtp.user',
  'smtp.password',
  'smtp.secure',
];

const SES_CREDENTIAL_KEYS: readonly TenantSecretKey[] = [
  'ses.accessKeyId',
  'ses.secretAccessKey',
  'ses.region',
];

export const getTenantSetupReadiness = async (
  ctx: Ctx,
  deps: TenantSetupReadinessDeps,
): Promise<Result<TenantSetupReadiness, AppError>> => {
  const tenant = authorizeTenant(ctx, 'tenant:onboarding:read');
  if (!tenant.ok) return tenant;
  const tenantId = tenant.value;

  const [settings, secrets, spaces, senderSettings] = await Promise.all([
    deps.tenants.findSettings(tenantId),
    deps.tenantSecrets.listByTenant(tenantId),
    deps.spaces.list(tenantId),
    deps.sesSettings === null ? Promise.resolve(null) : deps.sesSettings.findByTenant(tenantId),
  ]);

  const stored = new Set(secrets.map((secret: TenantSecret) => secret.key));
  const has = (key: TenantSecretKey): boolean => stored.has(key);
  const hasAll = (keys: readonly TenantSecretKey[]): boolean => keys.every(has);

  const senderIdentityConfigured = senderSettings !== null;
  const sesTransportConfigured =
    senderSettings !== null
    && senderSettings.identityVerifiedAt !== null
    && hasAll(SES_CREDENTIAL_KEYS);
  const smtpTransportConfigured = hasAll(SMTP_SECRET_KEYS);
  const resendTransportConfigured = has('resend.apiKey');

  const invoicingProvider = settings?.invoicingProvider ?? null;

  return ok(
    computeTenantSetupReadiness({
      stripeConfigured: has('stripe.restrictedKey') && has('stripe.webhookSecret'),
      emailSendingConfigured:
        senderIdentityConfigured
        && (sesTransportConfigured || smtpTransportConfigured || resendTransportConfigured),
      storageConfigured: has('s3.configuration'),
      legalTermsConfigured: tenantLegalUrls(settings) !== null,
      publicHomeConfigured: spaces.some((space) => space.publicReadOnly),
      billingPortalConfigured: (settings?.billingPortalUrl ?? null) !== null,
      videoConfigured: has('bunny.apiKey') && (settings?.bunnyStreamLibraryId ?? null) !== null,
      brandingConfigured:
        (settings === null ? null : resolveTenantLogo(settings, 'light')) !== null
        && (settings?.accentColor ?? null) !== null,
      invoicingConfigured:
        invoicingProvider === 'ksef'
          ? has('ksef.token') && has('ksef.contextNip')
          : invoicingProvider === 'ifirma'
            && has('ifirma.invoiceApiKey')
            && has('ifirma.username'),
    }),
  );
};
