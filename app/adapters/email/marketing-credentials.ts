import { appError, err, ok, type AppError, type Result, type TenantSecretKey } from '#core/domain/index.js';
import type { MarketingSesCredentialResolver, SesMarketingCredentials, TenantSecretResolver } from '#core/server/index.js';

const sesSecret = async (
  resolver: TenantSecretResolver,
  tenantId: string,
  key: TenantSecretKey,
  missing: string,
): Promise<Result<string, AppError>> => {
  const resolved = await resolver.resolve(tenantId, key);
  if (resolved.ok || resolved.error.code !== 'not_found') return resolved;
  return err(appError('ses_not_configured', missing));
};

export const createMarketingSesCredentialResolver = (
  resolver: TenantSecretResolver,
): MarketingSesCredentialResolver => ({
  resolve: async (tenantId): Promise<Result<SesMarketingCredentials, AppError>> => {
    const accessKeyId = await sesSecret(resolver, tenantId, 'ses.accessKeyId', 'Tenant SES access key is not configured');
    if (!accessKeyId.ok) return accessKeyId;
    const secretAccessKey = await sesSecret(resolver, tenantId, 'ses.secretAccessKey', 'Tenant SES secret key is not configured');
    if (!secretAccessKey.ok) return secretAccessKey;
    const region = await sesSecret(resolver, tenantId, 'ses.region', 'Tenant SES region is not configured');
    if (!region.ok) return region;
    return ok({ accessKeyId: accessKeyId.value, secretAccessKey: secretAccessKey.value, region: region.value });
  },
});
