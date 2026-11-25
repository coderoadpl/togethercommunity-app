import {
  err,
  ok,
  operatorTenantSlugSchema,
  validation,
  type AppError,
  type OperatorTenantReadiness,
  type Result,
  type StripeMode,
} from '#core/domain/index.js';

import { authorize } from '../authorize.js';
import type { Ctx } from '../context.js';
import type {
  EffectivePaymentConfig,
  EffectivePaymentConfigReader,
  ProductRepository,
  StorageCorsCache,
  TenantAccessReader,
  TenantRepository,
  TenantSecretRepository,
} from '../ports.js';
import { paymentConfigReader, paymentsReady, paymentSourcesOf, workspaceSecretsFromRows } from './payment-config.js';

export interface OperatorTenantReadinessDeps {
  tenants: Pick<TenantRepository, 'findBySlug' | 'findSettings'>;
  tenantAccess: Pick<TenantAccessReader, 'listStaffForTenant'>;
  tenantSecrets: Pick<TenantSecretRepository, 'listByTenant'>;
  paymentConfig?: EffectivePaymentConfigReader | undefined;
  storageCorsCache: Pick<StorageCorsCache, 'read'>;
  products: Pick<ProductRepository, 'listPublishedByTenant'>;
}

const WEBHOOK_ENDPOINT_SLOT = { live: 'stripe.webhookEndpointId', test: 'stripe.testWebhookEndpointId' } as const;

export const getOperatorTenantReadiness = async (
  ctx: Ctx,
  input: { slug: string },
  deps: OperatorTenantReadinessDeps,
): Promise<Result<OperatorTenantReadiness, AppError>> => {
  const denial = authorize(ctx, 'tenant:readiness');
  if (denial !== null) return err(denial);
  const parsed = operatorTenantSlugSchema.safeParse(input.slug);
  if (!parsed.success) return err(validation('Invalid tenant slug'));
  const tenant = await deps.tenants.findBySlug(parsed.data);
  if (tenant === null) return ok({
    tenantExists: false, ownerGrantPresent: false, storageConfigured: false,
    lastProbeOk: false, lastProbeAt: null, stripeConfigured: false, mode: null,
    webhookEndpointRegistered: false, legalUrlsSet: false, publishedProducts: 0,
  });
  const [staff, settings, secrets, probe, products] = await Promise.all([
    deps.tenantAccess.listStaffForTenant(tenant.id),
    deps.tenants.findSettings(tenant.id),
    deps.tenantSecrets.listByTenant(tenant.id),
    deps.storageCorsCache.read(tenant.id),
    deps.products.listPublishedByTenant(tenant.id),
  ]);
  const keys = new Set(secrets.map((secret) => secret.key));
  const storage = secrets.find((secret) => secret.key === 's3.configuration');
  const payments = paymentConfigReader(deps.paymentConfig, workspaceSecretsFromRows(secrets));
  const [live, test] = await Promise.all([payments.read(tenant.id, 'live'), payments.read(tenant.id, 'test')]);
  const mode = paymentsReady(live) ? 'live' : paymentsReady(test) ? 'test' : null;
  const endpointRegistered = (config: EffectivePaymentConfig, configMode: StripeMode): boolean =>
    config.source === 'organization' ? config.webhookReady : keys.has(WEBHOOK_ENDPOINT_SLOT[configMode]);
  const sources = paymentSourcesOf(live, test);
  return ok({
    tenantExists: true,
    ownerGrantPresent: staff.filter((grant) => grant.staffRole === 'owner').length === 1,
    storageConfigured: storage !== undefined,
    lastProbeOk: storage !== undefined && probe !== null
      && Date.parse(probe.checkedAt) >= Date.parse(storage.updatedAt)
      && probe.results.length > 0 && probe.results.every((result) => result.status === 'ok'),
    lastProbeAt: probe?.checkedAt ?? null,
    stripeConfigured: mode !== null,
    mode,
    webhookEndpointRegistered: mode === 'live' ? endpointRegistered(live, 'live') : mode === 'test' && endpointRegistered(test, 'test'),
    legalUrlsSet: settings?.termsUrl != null && settings.privacyUrl !== null,
    publishedProducts: products.length,
    ...(sources === null ? {} : { paymentSources: sources }),
  });
};
