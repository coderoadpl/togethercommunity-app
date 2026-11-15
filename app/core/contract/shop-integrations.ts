import { z } from 'zod';

import {
  shopIntegrationSecretDeleteInputSchema,
  shopIntegrationSecretInputSchema,
  shopIntegrationSecretKeySchema,
  tenantSecretMaskedSchema,
  type ShopManagementScope,
} from '#core/domain/index.js';

import {
  storageConfigureInputSchema,
  storageConfigureOutputSchema,
  stripeConfigureInputSchema,
  stripeConfigureOutputSchema,
  stripeProbePermissionsInputSchema,
  stripeProbePermissionsOutputSchema,
  tenantSecretsListOutputSchema,
} from './routes.js';
import { shipxContracts } from './shipx.js';
import { strictInput } from './strict-input.js';

const READ = 'shop:integrations:read' satisfies ShopManagementScope;
const WRITE = 'shop:integrations:write' satisfies ShopManagementScope;

export const SHOP_INTEGRATION_ROUTES = {
  listSecrets: { method: 'GET', path: '/api/m2m/shop/integrations/secrets', scope: READ },
  setSecret: { method: 'POST', path: '/api/m2m/shop/integrations/secrets', scope: WRITE },
  deleteSecret: { method: 'DELETE', path: '/api/m2m/shop/integrations/secrets/:key', scope: WRITE },
  stripeConfigure: { method: 'POST', path: '/api/m2m/shop/integrations/stripe/configure', scope: WRITE },
  stripeProbe: { method: 'POST', path: '/api/m2m/shop/integrations/stripe/probe', scope: WRITE },
  storageConfigure: { method: 'POST', path: '/api/m2m/shop/integrations/storage/configure', scope: WRITE },
  shipxSettings: { method: 'GET', path: '/api/m2m/shop/integrations/shipx', scope: READ },
  shipxConfigure: { method: 'POST', path: '/api/m2m/shop/integrations/shipx/configure', scope: WRITE },
} as const;

export const shopIntegrationContracts = {
  listSecrets: { output: tenantSecretsListOutputSchema },
  setSecret: { input: strictInput(shopIntegrationSecretInputSchema), output: z.object({ secret: tenantSecretMaskedSchema }) },
  deleteSecret: { input: strictInput(shopIntegrationSecretDeleteInputSchema), output: z.object({ key: shopIntegrationSecretKeySchema }) },
  stripeConfigure: { input: strictInput(stripeConfigureInputSchema), output: stripeConfigureOutputSchema },
  stripeProbe: { input: strictInput(stripeProbePermissionsInputSchema), output: stripeProbePermissionsOutputSchema },
  storageConfigure: { input: strictInput(storageConfigureInputSchema), output: storageConfigureOutputSchema },
  shipxSettings: { output: shipxContracts.shipxSettings.output },
  shipxConfigure: { ...shipxContracts.shipxConfigure, input: strictInput(shipxContracts.shipxConfigure.input) },
} as const;
