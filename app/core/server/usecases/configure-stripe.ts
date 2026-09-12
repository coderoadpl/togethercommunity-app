import {
  configureStripeInputSchema,
  err,
  integrationUnavailable,
  ok,
  stripeModeFromKey,
  validation,
  type AppError,
  type ConfigureStripeInput,
  type Result,
  type StripeMode,
} from '#core/domain/index.js';

import { authorizeTenant } from '../authorize.js';
import type { Ctx } from '../context.js';
import type { PaymentProvider } from '../ports.js';
import { setTenantSecret, stripeWebhookUrl, type TenantSecretDeps } from './tenant-secrets.js';

export interface ConfigureStripeDeps extends TenantSecretDeps {
  appBaseUrl: string;
  payment: PaymentProvider;
}

export interface ConfigureStripeResult {
  mode: StripeMode;
  webhookUrl: string;
}

export const configureStripe = async (
  ctx: Ctx,
  input: ConfigureStripeInput,
  deps: ConfigureStripeDeps,
): Promise<Result<ConfigureStripeResult, AppError>> => {
  const tenant = authorizeTenant(ctx, 'tenant:secret:write');
  if (!tenant.ok) return tenant;
  const parsed = configureStripeInputSchema.safeParse(input);
  if (!parsed.success) return err(validation('Invalid Stripe configuration', parsed.error.flatten()));
  const mode = stripeModeFromKey(parsed.data.restrictedKey);
  if (mode === null || mode !== parsed.data.mode) {
    return err(validation(`The Stripe ${parsed.data.mode} slot requires a ${parsed.data.mode} restricted key`));
  }
  if (
    deps.payment.configureWebhook === undefined ||
    deps.payment.deleteWebhookEndpoint === undefined
  ) {
    return err(integrationUnavailable('The payment provider cannot configure Stripe webhooks'));
  }
  const deleteWebhookEndpoint = deps.payment.deleteWebhookEndpoint;
  const webhookUrl = stripeWebhookUrl(deps.appBaseUrl, tenant.value) + (mode === 'test' ? '?mode=test' : '');
  const configured = await deps.payment.configureWebhook({
    tenantId: tenant.value,
    restrictedKey: parsed.data.restrictedKey,
    webhookUrl,
  });
  if (!configured.ok) return configured;
  const cleanup = async (): Promise<void> => {
    await deleteWebhookEndpoint({
      restrictedKey: parsed.data.restrictedKey,
      webhookEndpointId: configured.value.webhookEndpointId,
    });
  };
  try {
    for (const secret of [
      { key: mode === 'test' ? 'stripe.testWebhookSecret' as const : 'stripe.webhookSecret' as const, value: configured.value.webhookSecret },
      { key: mode === 'test' ? 'stripe.testRestrictedKey' as const : 'stripe.restrictedKey' as const, value: parsed.data.restrictedKey },
      ...(mode === 'test' ? [{ key: 'stripe.testWebhookEndpointId' as const, value: configured.value.webhookEndpointId }] : []),
    ]) {
      const stored = await setTenantSecret(ctx, secret, deps);
      if (!stored.ok) {
        await cleanup();
        return stored;
      }
    }
  } catch (cause) {
    await cleanup();
    throw cause;
  }
  return ok({ mode, webhookUrl });
};

export const removeStripeTestMode = async (
  ctx: Ctx,
  deps: ConfigureStripeDeps,
): Promise<Result<{ removed: true }, AppError>> => {
  const tenant = authorizeTenant(ctx, 'tenant:secret:write');
  if (!tenant.ok) return tenant;
  const key = await deps.tenantSecrets.findByKey(tenant.value, 'stripe.testRestrictedKey');
  const endpoint = await deps.tenantSecrets.findByKey(tenant.value, 'stripe.testWebhookEndpointId');
  if (key !== null && endpoint !== null) {
    const decryptedKey = deps.secretCrypto.decrypt(key);
    if (!decryptedKey.ok) return decryptedKey;
    const decryptedEndpoint = deps.secretCrypto.decrypt(endpoint);
    if (!decryptedEndpoint.ok) return decryptedEndpoint;
    if (stripeModeFromKey(decryptedKey.value) !== 'test') return err(validation('The test slot contains an invalid key'));
    if (deps.payment.deleteWebhookEndpoint === undefined) return err(integrationUnavailable('Webhook removal is unavailable'));
    const removed = await deps.payment.deleteWebhookEndpoint({
      restrictedKey: decryptedKey.value, webhookEndpointId: decryptedEndpoint.value,
    });
    if (!removed.ok) return removed;
  }
  for (const secret of ['stripe.testRestrictedKey', 'stripe.testWebhookSecret', 'stripe.testWebhookEndpointId', 'stripe.testLastEventAt'] as const) {
    await deps.tenantSecrets.delete(tenant.value, secret);
  }
  return ok({ removed: true });
};
