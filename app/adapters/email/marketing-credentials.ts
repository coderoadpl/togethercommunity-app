import { appError, ok, type AppError, type Result } from '#core/domain/index.js';
import type { MarketingSesCredentialResolver, SesMarketingCredentials, TenantSecretResolver } from '#core/server/index.js';

export const createMarketingSesCredentialResolver = (
  resolver: TenantSecretResolver,
): MarketingSesCredentialResolver => ({
  resolve: async (tenantId): Promise<Result<SesMarketingCredentials, AppError>> => {
    const accessKeyId = await resolver.resolve(tenantId, 'ses.accessKeyId');
    if (!accessKeyId.ok) return { ok: false, error: appError('ses_not_configured', 'Tenant SES access key is not configured') };
    const secretAccessKey = await resolver.resolve(tenantId, 'ses.secretAccessKey');
    if (!secretAccessKey.ok) return { ok: false, error: appError('ses_not_configured', 'Tenant SES secret key is not configured') };
    const region = await resolver.resolve(tenantId, 'ses.region');
    if (!region.ok) return { ok: false, error: appError('ses_not_configured', 'Tenant SES region is not configured') };
    return ok({ accessKeyId: accessKeyId.value, secretAccessKey: secretAccessKey.value, region: region.value });
  },
});
