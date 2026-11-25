import type { StripeMode } from '#core/domain/index.js';
import {
  createWorkspacePaymentConfigReader,
  STRIPE_KEY_SLOT,
  stripeKeyModeOf,
  type EffectivePaymentConfigReader,
  type SecretCrypto,
} from '#core/server/index.js';

import type { Db } from './client.js';
import { createEffectiveTenantConfigReader } from './organizations.js';
import { createTenantSecretRepository } from './repositories.js';

// No organization webhook endpoint can be registered yet, so no organization can verify events for an inheriting workspace.
const organizationEndpointRegistered = async (_tenantId: string, _mode: StripeMode): Promise<boolean> => false;

export const createEffectivePaymentConfigReader = (
  db: Db,
  crypto: Pick<SecretCrypto, 'decrypt'>,
): EffectivePaymentConfigReader => {
  const inherited = createEffectiveTenantConfigReader(db);
  const workspace = createWorkspacePaymentConfigReader(createTenantSecretRepository(db), crypto);
  return {
    read: async (tenantId, mode) => {
      const key = await inherited.findInheritedSecret(tenantId, STRIPE_KEY_SLOT[mode]);
      if (key.source === 'workspace') return workspace.read(tenantId, mode);
      return {
        source: 'organization',
        keyPresent: key.value !== null,
        webhookReady: await organizationEndpointRegistered(tenantId, mode),
        keyMode: key.value === null ? null : stripeKeyModeOf(key.value, crypto),
      };
    },
  };
};
