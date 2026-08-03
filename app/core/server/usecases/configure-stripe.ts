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
  if (mode === null) {
    return err(validation('A Stripe restricted key starts with rk_test_ or rk_live_'));
  }
  if (
    deps.payment.configureWebhook === undefined ||
    deps.payment.deleteWebhookEndpoint === undefined
  ) {
    return err(integrationUnavailable('The payment provider cannot configure Stripe webhooks'));
  }
  const deleteWebhookEndpoint = deps.payment.deleteWebhookEndpoint;
  const webhookUrl = stripeWebhookUrl(deps.appBaseUrl, tenant.value);
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
      { key: 'stripe.webhookSecret' as const, value: configured.value.webhookSecret },
      { key: 'stripe.restrictedKey' as const, value: parsed.data.restrictedKey },
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
