import {
  err,
  NEVER_INHERIT_SECRET_KEYS,
  notFound,
  organizationSecretKeySchema,
  type AppError,
  type Result,
  type TenantSecretKey,
} from '#core/domain/index.js';
import type { EffectiveTenantConfigReader, SecretCrypto, TenantSecretResolver } from '#core/server/index.js';

const neverInherited: ReadonlySet<TenantSecretKey> = new Set(NEVER_INHERIT_SECRET_KEYS);

export const createEffectiveTenantSecretResolver = (
  workspaceSecrets: TenantSecretResolver,
  config: Pick<EffectiveTenantConfigReader, 'findInheritedSecret'>,
  crypto: SecretCrypto,
): TenantSecretResolver => ({
  resolve: async (tenantId, key): Promise<Result<string, AppError>> => {
    const organizationKey = organizationSecretKeySchema.safeParse(key);
    if (neverInherited.has(key) || !organizationKey.success) return workspaceSecrets.resolve(tenantId, key);
    const inherited = await config.findInheritedSecret(tenantId, organizationKey.data);
    if (inherited.source === 'workspace') return workspaceSecrets.resolve(tenantId, key);
    // The retained workspace row may belong to another account, so a switched group never falls back to it.
    if (inherited.value === null) return err(notFound(`No "${key}" secret is configured for this tenant's organization`));
    const { ciphertext, iv, authTag } = inherited.value;
    return crypto.decrypt({ ciphertext, iv, authTag });
  },
});
