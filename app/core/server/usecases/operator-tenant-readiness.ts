import {
  err,
  ok,
  operatorTenantSlugSchema,
  validation,
  type AppError,
  type OperatorTenantReadiness,
  type Result,
} from '#core/domain/index.js';

import { authorize } from '../authorize.js';
import type { Ctx } from '../context.js';
import type { ProductRepository, StorageCorsCache, TenantAccessReader, TenantRepository, TenantSecretRepository } from '../ports.js';

export interface OperatorTenantReadinessDeps {
  tenants: Pick<TenantRepository, 'findBySlug' | 'findSettings'>;
  tenantAccess: Pick<TenantAccessReader, 'listStaffForTenant'>;
  tenantSecrets: Pick<TenantSecretRepository, 'listByTenant'>;
  storageCorsCache: Pick<StorageCorsCache, 'read'>;
  products: Pick<ProductRepository, 'listPublishedByTenant'>;
}

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
  const live = keys.has('stripe.restrictedKey') && keys.has('stripe.webhookSecret');
  const test = keys.has('stripe.testRestrictedKey') && keys.has('stripe.testWebhookSecret');
  const mode = live ? 'live' : test ? 'test' : null;
  return ok({
    tenantExists: true,
    ownerGrantPresent: staff.filter((grant) => grant.staffRole === 'owner').length === 1,
    storageConfigured: storage !== undefined,
    lastProbeOk: storage !== undefined && probe !== null
      && Date.parse(probe.checkedAt) >= Date.parse(storage.updatedAt)
      && probe.results.length > 0 && probe.results.every((result) => result.status === 'ok'),
    lastProbeAt: probe?.checkedAt ?? null,
    stripeConfigured: live || test,
    mode,
    webhookEndpointRegistered: mode === 'live'
      ? keys.has('stripe.webhookEndpointId')
      : mode === 'test' && keys.has('stripe.testWebhookEndpointId'),
    legalUrlsSet: settings?.termsUrl != null && settings.privacyUrl !== null,
    publishedProducts: products.length,
  });
};
