import { stripeModeFromKey, type StripeMode } from '#core/domain/index.js';
import type { PaymentSourceReader, SecretCrypto } from '#core/server/index.js';

import type { Db } from './client.js';
import { createEffectiveTenantConfigReader } from './organizations.js';

const STRIPE_KEY_SLOT = { live: 'stripe.restrictedKey', test: 'stripe.testRestrictedKey' } as const;

export const createPaymentSourceReader = (db: Db, crypto: Pick<SecretCrypto, 'decrypt'>): PaymentSourceReader => {
  const inherited = createEffectiveTenantConfigReader(db);
  const keyModeOf = (stored: Parameters<SecretCrypto['decrypt']>[0]): StripeMode | null => {
    const decrypted = crypto.decrypt(stored);
    return decrypted.ok ? stripeModeFromKey(decrypted.value) : null;
  };
  return {
    read: async (tenantId, mode) => {
      const key = await inherited.findInheritedSecret(tenantId, STRIPE_KEY_SLOT[mode]);
      if (key.source === 'workspace') return { source: 'workspace' };
      return {
        source: 'organization',
        keyPresent: key.value !== null,
        // No route registers an organization webhook endpoint yet, so an inherited mode is never ready.
        webhookReady: false,
        keyMode: key.value === null ? null : keyModeOf(key.value),
      };
    },
  };
};
