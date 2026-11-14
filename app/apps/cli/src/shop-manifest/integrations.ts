import { z } from 'zod';
import { configureShipxInputSchema, configureStripeInputSchema, err, ok, stripeModeFromKey, validation, type AppError, type Result } from '#core/domain/index.js';
import { inpostGeowidgetTokenSchema } from '#core/domain/shipping.js';
import type { ShopManifestIntegrations } from '#core/domain/shop-manifest.js';

const resolvedIntegrationsSchema = z.object({
  stripe: configureStripeInputSchema.optional(),
  shipx: configureShipxInputSchema.optional(),
  parcelLocker: z.object({ inpostGeowidgetToken: inpostGeowidgetTokenSchema }).strict().optional(),
}).strict();
export type ResolvedManifestIntegrations = z.output<typeof resolvedIntegrationsSchema>;

export const resolveManifestIntegrations = (
  integrations: ShopManifestIntegrations, environment: Readonly<Record<string, string | undefined>>,
): Result<ResolvedManifestIntegrations, AppError> => {
  const references = [integrations.stripe?.restrictedKeyEnv, integrations.shipx?.organizationIdEnv,
    integrations.shipx?.tokenEnv, integrations.parcelLocker?.tokenEnv];
  for (const name of references) {
    if (name !== undefined && !environment[name]?.trim()) return err(validation(`Missing environment variable ${name}`));
  }
  const parsed = resolvedIntegrationsSchema.safeParse({
    ...(integrations.stripe == null ? {} : { stripe: {
      mode: integrations.stripe.mode, restrictedKey: environment[integrations.stripe.restrictedKeyEnv],
    } }),
    ...(integrations.shipx == null ? {} : { shipx: {
      environment: integrations.shipx.environment, sender: integrations.shipx.sender,
      ...(integrations.shipx.organizationIdEnv === undefined ? {} : { organizationId: environment[integrations.shipx.organizationIdEnv] }),
      ...(integrations.shipx.tokenEnv === undefined ? {} : { token: environment[integrations.shipx.tokenEnv] }),
    } }),
    ...(integrations.parcelLocker == null ? {} : { parcelLocker: {
      inpostGeowidgetToken: environment[integrations.parcelLocker.tokenEnv],
    } }),
  });
  if (!parsed.success) return err(validation('Invalid integration environment configuration'));
  if (parsed.data.stripe && stripeModeFromKey(parsed.data.stripe.restrictedKey) !== parsed.data.stripe.mode) {
    return err(validation('Stripe restricted key does not match the manifest mode'));
  }
  return ok(parsed.data);
};
