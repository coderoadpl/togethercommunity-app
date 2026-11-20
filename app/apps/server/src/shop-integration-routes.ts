import { SHOP_INTEGRATION_ROUTES, shopIntegrationContracts } from '#core/contract/index.js';
import { err, internal, ok, shopIntegrationSecretKeySchema, validation, type Tenant } from '#core/domain/index.js';
import {
  configureShipx,
  configureStorageConnection,
  configureStripe,
  customDomainOrigin,
  deleteShopIntegrationSecret,
  getShipxSettings,
  getShopIntegrationSecrets,
  probeStripePermissions,
  setShopIntegrationSecret,
  tenantUrl,
} from '#core/server/index.js';

import type { AppDeps } from './composition.js';
import { readJson } from './read-json.js';
import { respond } from './respond.js';
import type { ShopMachineRoute } from './shop-machine-auth.js';

const storageCorsOrigins = async (tenant: Tenant, deps: AppDeps): Promise<string[]> => {
  const domains = await deps.tenantDomains.listByTenant(tenant.id);
  return [...new Set([
    new URL(tenantUrl(tenant.slug, '/', deps)).origin,
    new URL(deps.appBaseUrl).origin,
    ...domains
      .filter((domain) => domain.kind === 'custom' && domain.verified)
      .map((domain) => customDomainOrigin(domain.domain, deps)),
  ])];
};

const shipxUnavailable = () => respond(err(internal('InPost ShipX is unavailable')));

export const shopIntegrationRoutes = (deps: AppDeps): readonly ShopMachineRoute[] => [
  {
    ...SHOP_INTEGRATION_ROUTES.listSecrets,
    handler: async (_c, { ctx }) => respond(await getShopIntegrationSecrets(ctx, deps)),
  },
  {
    ...SHOP_INTEGRATION_ROUTES.setSecret,
    proposeMode: { kind: 'refuse', reason: 'secret' },
    resourceIdField: 'key',
    resourceIdSchema: shopIntegrationSecretKeySchema,
    handler: async (c, { ctx }) => {
      const parsed = shopIntegrationContracts.setSecret.input.safeParse(await readJson(c.req.raw));
      if (!parsed.success) return respond(err(validation('Invalid integration secret', parsed.error.flatten())));
      const result = await setShopIntegrationSecret(ctx, parsed.data, deps);
      return respond(result.ok ? ok({ secret: result.value }) : result);
    },
  },
  {
    ...SHOP_INTEGRATION_ROUTES.deleteSecret,
    proposeMode: { kind: 'refuse', reason: 'secret' },
    resourceIdSchema: shopIntegrationSecretKeySchema,
    handler: async (c, { ctx }) => respond(await deleteShopIntegrationSecret(ctx, c.req.param('key') ?? '', deps)),
  },
  {
    ...SHOP_INTEGRATION_ROUTES.stripeConfigure,
    proposeMode: { kind: 'refuse', reason: 'secret' },
    handler: async (c, { ctx }) => {
      const parsed = shopIntegrationContracts.stripeConfigure.input.safeParse(await readJson(c.req.raw));
      if (!parsed.success) return respond(err(validation('Invalid Stripe configuration', parsed.error.flatten())));
      return respond(await configureStripe(ctx, parsed.data, {
        appBaseUrl: deps.appBaseUrl,
        baseDomain: deps.baseDomain,
        singleTenantMode: deps.singleTenantMode,
        payment: deps.payment,
        tenantSecrets: deps.tenantSecrets,
        secretCrypto: deps.secretCrypto,
        ids: deps.ids,
        clock: deps.clock,
      }));
    },
  },
  {
    ...SHOP_INTEGRATION_ROUTES.stripeProbe,
    proposeMode: { kind: 'refuse', reason: 'secret' },
    handler: async (c, { ctx }) => {
      const parsed = shopIntegrationContracts.stripeProbe.input.safeParse(await readJson(c.req.raw));
      if (!parsed.success) return respond(err(validation('Invalid Stripe permission probe', parsed.error.flatten())));
      return respond(await probeStripePermissions(ctx, parsed.data, deps));
    },
  },
  {
    ...SHOP_INTEGRATION_ROUTES.storageConfigure,
    proposeMode: { kind: 'refuse', reason: 'secret' },
    handler: async (c, { ctx, tenant }) => {
      const parsed = shopIntegrationContracts.storageConfigure.input.safeParse(await readJson(c.req.raw));
      if (!parsed.success) return respond(err(validation('Invalid storage configuration payload', parsed.error.flatten())));
      return respond(await configureStorageConnection(ctx, parsed.data, { ...deps, corsOrigins: await storageCorsOrigins(tenant, deps) }));
    },
  },
  {
    ...SHOP_INTEGRATION_ROUTES.shipxSettings,
    handler: async (_c, { ctx }) => deps.shipxIntegration === undefined
      ? shipxUnavailable()
      : respond(await getShipxSettings(ctx, { shipxSettings: deps.shipxIntegration.shipxSettings, tenantSecrets: deps.tenantSecrets })),
  },
  {
    ...SHOP_INTEGRATION_ROUTES.shipxConfigure,
    proposeMode: { kind: 'refuse', reason: 'secret' },
    handler: async (c, { ctx }) => {
      if (deps.shipxIntegration === undefined) return shipxUnavailable();
      const parsed = shopIntegrationContracts.shipxConfigure.input.safeParse(await readJson(c.req.raw));
      if (!parsed.success) return respond(err(validation('Invalid InPost ShipX settings', parsed.error.flatten())));
      return respond(await configureShipx(ctx, parsed.data, {
        shipxSettings: deps.shipxIntegration.shipxSettings,
        tenantSecrets: deps.tenantSecrets,
        secretCrypto: deps.secretCrypto,
        ids: deps.ids,
        clock: deps.clock,
      }));
    },
  },
];
