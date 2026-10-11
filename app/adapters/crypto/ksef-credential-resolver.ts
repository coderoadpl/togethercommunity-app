import {
  err,
  integrationNotConfigured,
  nipSchema,
  ok,
  validation,
} from '#core/domain/index.js';
import type { KsefCredentialResolver, TenantSecretResolver } from '#core/server/index.js';

export const createKsefCredentialResolver = (
  secrets: TenantSecretResolver,
): KsefCredentialResolver => ({
  resolve: async (tenantId, mode = 'live') => {
    const [token, contextNip] = await Promise.all([
      secrets.resolve(tenantId, mode === 'test' ? 'ksef.test.token' : 'ksef.token'),
      secrets.resolve(tenantId, mode === 'test' ? 'ksef.test.contextNip' : 'ksef.contextNip'),
    ]);
    if (!token.ok || !contextNip.ok) {
      return err(integrationNotConfigured('Save the KSeF token and context NIP in Integrations → Invoicing'));
    }
    const parsedNip = nipSchema.safeParse(contextNip.value);
    if (!parsedNip.success) return err(validation('The KSeF context NIP is invalid'));
    return ok({ tenantId, credentialSlot: mode, token: token.value, contextNip: parsedNip.data });
  },
});
