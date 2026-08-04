import {
  err,
  internal,
  notFound,
  storageConfigurationSchema,
  type AppError,
  type Result,
  type TenantSecretKey,
} from '#core/domain/index.js';
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
    if (key !== 's3.accessKeyId' && key !== 's3.secretAccessKey') {
      const stored = await secrets.findByKey(tenantId, key);
      if (stored) {
        return crypto.decrypt({ ciphertext: stored.ciphertext, iv: stored.iv, authTag: stored.authTag });
      }
      return err(notFound(`No "${key}" secret is configured for this tenant`));
    }

    const configuration = await secrets.findByKey(tenantId, 's3.configuration');
    if (!configuration) {
      const stored = await secrets.findByKey(tenantId, key);
      return stored
        ? crypto.decrypt({ ciphertext: stored.ciphertext, iv: stored.iv, authTag: stored.authTag })
        : err(notFound(`No "${key}" secret is configured for this tenant`));
    }
    const decrypted = crypto.decrypt({
      ciphertext: configuration.ciphertext,
      iv: configuration.iv,
      authTag: configuration.authTag,
    });
    if (!decrypted.ok) return decrypted;
    let decoded: unknown;
    try {
      decoded = JSON.parse(decrypted.value);
    } catch {
      return err(internal('Stored S3 configuration is invalid'));
    }
    const parsed = storageConfigurationSchema.safeParse(decoded);
    if (!parsed.success) return err(internal('Stored S3 configuration is invalid'));
    const valueByKey: Record<Extract<TenantSecretKey, 's3.accessKeyId' | 's3.secretAccessKey'>, string> = {
      's3.accessKeyId': parsed.data.accessKeyId,
      's3.secretAccessKey': parsed.data.secretAccessKey,
    };
    return { ok: true, value: valueByKey[key] };
  },
});
