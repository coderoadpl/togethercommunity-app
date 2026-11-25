import {
  err,
  integrationUnavailable,
  ok,
  type AppError,
  type Result,
  type StripeMode,
} from '#core/domain/index.js';

import type { PaymentProvider } from '../ports.js';
import type { TenantUrlDeps } from '../tenant-url.js';
import { buildTenantSecret, stripeWebhookUrl, type TenantSecretDeps } from './tenant-secrets.js';

export interface ConfigureStripeDeps extends TenantSecretDeps, TenantUrlDeps {
  payment: PaymentProvider;
}

export interface ConfigureStripeResult {
  mode: StripeMode;
  webhookUrl: string;
}

export const configureStripeSlot = async (
  slot: { tenantId: string; tenantSlug: string | null; mode: StripeMode; restrictedKey: string },
  deps: ConfigureStripeDeps,
): Promise<Result<ConfigureStripeResult, AppError>> => {
  const { tenantId, mode, restrictedKey } = slot;
  if (
    deps.payment.configureWebhook === undefined ||
    deps.payment.deleteWebhookEndpoint === undefined
  ) {
    return err(integrationUnavailable('The payment provider cannot configure Stripe webhooks'));
  }
  const deleteWebhookEndpoint = deps.payment.deleteWebhookEndpoint;
  const webhookUrl =
    stripeWebhookUrl(slot.tenantSlug, tenantId, deps) + (mode === 'test' ? '?mode=test' : '');
  const configured = await deps.payment.configureWebhook({
    tenantId,
    restrictedKey,
    webhookUrl,
  });
  if (!configured.ok) return configured;
  const cleanup = async (): Promise<void> => {
    await deleteWebhookEndpoint({
      restrictedKey,
      webhookEndpointId: configured.value.webhookEndpointId,
    });
  };
  try {
    const records = [
      { key: mode === 'test' ? 'stripe.testWebhookSecret' as const : 'stripe.webhookSecret' as const, value: configured.value.webhookSecret },
      { key: mode === 'test' ? 'stripe.testRestrictedKey' as const : 'stripe.restrictedKey' as const, value: restrictedKey },
      { key: mode === 'test' ? 'stripe.testWebhookEndpointId' as const : 'stripe.webhookEndpointId' as const, value: configured.value.webhookEndpointId },
    ].map((secret) => buildTenantSecret(tenantId, secret.key, secret.value, deps));
    await deps.tenantSecrets.upsertMany(tenantId, records);
  } catch (cause) {
    await cleanup();
    throw cause;
  }
  return ok({ mode, webhookUrl });
};
