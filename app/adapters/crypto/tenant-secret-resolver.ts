import { err, notFound, type AppError, type Result } from '#core/domain/index.js';
import type { SecretCrypto, TenantSecretRepository, TenantSecretResolver } from '#core/server/index.js';

/**
 * Reads a tenant's encrypted secret and decrypts it on demand — the seam a
 * payment adapter uses to obtain per-tenant credentials at call time, so keys
 * are only ever in plaintext transiently inside the server process.
 */
export const createTenantSecretResolver = (
  secrets: TenantSecretRepository,
  crypto: SecretCrypto,
): TenantSecretResolver => ({
  resolve: async (tenantId, key): Promise<Result<string, AppError>> => {
    const stored = await secrets.findByKey(tenantId, key);
    if (!stored) return err(notFound(`No "${key}" secret is configured for this tenant`));
    return crypto.decrypt({ ciphertext: stored.ciphertext, iv: stored.iv, authTag: stored.authTag });
  },
});
