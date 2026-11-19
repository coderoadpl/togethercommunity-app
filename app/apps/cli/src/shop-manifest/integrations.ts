import { z } from 'zod';
import { configureShipxInputSchema, configureStripeInputSchema, err, ok, SHIPX_ENVIRONMENTS, stripeModeFromKey, validation, type AppError, type Result } from '#core/domain/index.js';
import { inpostGeowidgetTokenSchema } from '#core/domain/shipping.js';
import {
  integrationReferenceError, paymentKeyValueError, SHOP_OPERATOR_SECRET_ENV, shipxCredentialReferences, type ShopManifestIntegrations, type ShopManifestSettings,
} from '#core/domain/shop-manifest.js';

type ManifestEnvironment = Readonly<Record<string, string | undefined>>;
type PublishingShop = { slug: string; desired: ShopManifestSettings; integrations: ShopManifestIntegrations };
export type CredentialHolder = { source: string; integrations: ShopManifestIntegrations };
type SourcedValue = { source: string; value: string };

const PUBLISHED_CREDENTIAL_MESSAGE =
  'A published parcel-locker token must differ from every ShipX token and organization ID in the manifest and from the operator secret';
const OPERATOR_SECRET_SOURCE = 'operator secret';

const presentValue = (value: string | null | undefined): string | undefined => {
  const trimmed = value?.trim();
  return trimmed === undefined || trimmed === '' ? undefined : trimmed;
};

const sourced = (source: string, values: ReadonlyArray<string | undefined>): SourcedValue[] =>
  values.flatMap((value) => value === undefined ? [] : [{ source, value }]);

export const publishedCredentialError = (
  shops: readonly PublishingShop[], holders: readonly CredentialHolder[], environment: ManifestEnvironment, resolveReferences: boolean,
): AppError | null => {
  const valueOf = (name: string | undefined) => name === undefined ? undefined : presentValue(environment[name]);
  const published = shops.flatMap((shop) => sourced(shop.slug, [
    resolveReferences ? valueOf(shop.integrations.parcelLocker?.tokenEnv) : undefined,
    presentValue(shop.desired.inpostGeowidgetToken),
  ]));
  if (published.length === 0) return null;
  const credentials = [
    ...holders.flatMap((holder) => sourced(holder.source, shipxCredentialReferences(holder.integrations.shipx).map(valueOf))),
    ...sourced(OPERATOR_SECRET_SOURCE, [valueOf(SHOP_OPERATOR_SECRET_ENV)]),
  ];
  const matches = published.flatMap((token) => credentials.filter((credential) => credential.value === token.value)
    .map((credential) => ({ publishing: token.source, credential: credential.source })));
  if (matches.length === 0) return null;
  const publishingWorkspaces = [...new Set(matches.map((match) => match.publishing))];
  const credentialSources = [...new Set(matches.map((match) => match.credential))];
  return validation(
    `${PUBLISHED_CREDENTIAL_MESSAGE}: ${publishingWorkspaces.join(', ')} would publish a credential of ${credentialSources.join(', ')}`,
    { publishingWorkspaces, credentialSources },
  );
};

const resolvedIntegrationsSchema = z.object({
  stripe: configureStripeInputSchema.optional(),
  shipx: configureShipxInputSchema.optional(),
  parcelLocker: z.object({ inpostGeowidgetToken: inpostGeowidgetTokenSchema }).strict().optional(),
}).strict();
export type ResolvedManifestIntegrations = z.output<typeof resolvedIntegrationsSchema>;

const PUBLIC_TOKEN_REUSE_MESSAGE = 'The parcel-locker public token must differ from the ShipX token and organization ID';

const publicTokenRepeatsCarrierCredential = (
  integrations: ShopManifestIntegrations, environment: Readonly<Record<string, string | undefined>>,
): boolean => {
  const valueOf = (name: string | undefined) => name === undefined ? undefined : environment[name]?.trim();
  const publicToken = valueOf(integrations.parcelLocker?.tokenEnv);
  if (publicToken === undefined) return false;
  return shipxCredentialReferences(integrations.shipx).some((name) => valueOf(name) === publicToken);
};

const resolvedShipx = (shipx: NonNullable<ShopManifestIntegrations['shipx']>, environment: ManifestEnvironment) => ({
  ...(shipx.sender === undefined ? {} : { sender: shipx.sender }),
  ...Object.fromEntries(SHIPX_ENVIRONMENTS.flatMap((slot) => {
    const references = shipx[slot];
    if (references === undefined) return [];
    return [[slot, {
      ...(references.organizationIdEnv === undefined ? {} : { organizationId: environment[references.organizationIdEnv] }),
      ...(references.tokenEnv === undefined ? {} : { token: environment[references.tokenEnv] }),
    }]];
  })),
});

export const resolveManifestIntegrations = (
  integrations: ShopManifestIntegrations, environment: Readonly<Record<string, string | undefined>>,
): Result<ResolvedManifestIntegrations, AppError> => {
  const referenceError = integrationReferenceError(integrations);
  if (referenceError !== null) return err(validation(referenceError));
  const carrierReferences = shipxCredentialReferences(integrations.shipx);
  const references = [integrations.stripe?.restrictedKeyEnv, ...carrierReferences, integrations.parcelLocker?.tokenEnv];
  for (const name of references) {
    if (name !== undefined && !environment[name]?.trim()) return err(validation(`Missing environment variable ${name}`));
  }
  const nonPaymentReferences = [...carrierReferences, integrations.parcelLocker?.tokenEnv];
  const keyError = paymentKeyValueError(nonPaymentReferences.map((name) => name === undefined ? undefined : environment[name]));
  if (keyError !== null) return err(validation(keyError));
  if (publicTokenRepeatsCarrierCredential(integrations, environment)) return err(validation(PUBLIC_TOKEN_REUSE_MESSAGE));
  const parsed = resolvedIntegrationsSchema.safeParse({
    ...(integrations.stripe == null ? {} : { stripe: {
      mode: integrations.stripe.mode, restrictedKey: environment[integrations.stripe.restrictedKeyEnv],
    } }),
    ...(integrations.shipx == null ? {} : { shipx: resolvedShipx(integrations.shipx, environment) }),
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
