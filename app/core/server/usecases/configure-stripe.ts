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
} from '#core/domain/index.js';

import { authorizeTenant } from '../authorize.js';
import type { Ctx } from '../context.js';
import { configureStripeSlot, type ConfigureStripeDeps, type ConfigureStripeResult } from './configure-stripe-slot.js';

export type { ConfigureStripeDeps, ConfigureStripeResult } from './configure-stripe-slot.js';

export const configureStripe = async (
  ctx: Ctx,
  input: ConfigureStripeInput,
  deps: ConfigureStripeDeps,
): Promise<Result<ConfigureStripeResult, AppError>> => {
  const tenant = authorizeTenant(ctx, 'tenant:secret:write', { shopManagementKeyGrant: { operation: 'stripe:configure' } });
  if (!tenant.ok) return tenant;
  const parsed = configureStripeInputSchema.safeParse(input);
  if (!parsed.success) return err(validation('Invalid Stripe configuration', parsed.error.flatten()));
  const mode = stripeModeFromKey(parsed.data.restrictedKey);
  if (mode === null || mode !== parsed.data.mode) {
    return err(validation(`The Stripe ${parsed.data.mode} slot requires a ${parsed.data.mode} restricted key`));
  }
  return configureStripeSlot(
    { tenantId: tenant.value, tenantSlug: ctx.identity.tenantSlug, mode, restrictedKey: parsed.data.restrictedKey },
    deps,
  );
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
