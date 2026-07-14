import {
  err,
  m2mEnrollInputSchema,
  ok,
  unauthorized,
  validation,
  type AppError,
  type M2mEnrollInput,
  type Result,
  type Tenant,
  type TenantApiKey,
} from '@core/domain/index.js';

import type { ApiKeyCrypto, TenantApiKeyRepository } from '../ports.js';
import { fulfillEnrollment, type FulfillEnrollmentDeps } from './fulfill-enrollment.js';

export interface ApiKeyAuthDeps {
  tenantApiKeys: TenantApiKeyRepository;
  apiKeyCrypto: ApiKeyCrypto;
}

export const authenticateApiKey = async (
  tenantId: string,
  presentedSecret: string,
  deps: ApiKeyAuthDeps,
): Promise<Result<TenantApiKey, AppError>> => {
  const secret = presentedSecret.trim();
  if (!secret) return err(unauthorized('Missing API key'));
  const found = await deps.tenantApiKeys.findActiveByHash(tenantId, deps.apiKeyCrypto.hash(secret));
  if (!found) return err(unauthorized('Invalid API key'));
  return ok(found);
};

export type M2mEnrollDeps = FulfillEnrollmentDeps;

export interface M2mEnrollResult {
  memberId: string;
  grantId: string;
  renewed: boolean;
  magicLink: { email: string; url: string; token: string } | null;
}

export const m2mEnroll = async (
  tenant: Pick<Tenant, 'id' | 'name'>,
  input: M2mEnrollInput,
  deps: M2mEnrollDeps,
): Promise<Result<M2mEnrollResult, AppError>> => {
  const parsed = m2mEnrollInputSchema.safeParse(input);
  if (!parsed.success) return err(validation('Invalid enrollment payload', parsed.error.flatten()));

  return fulfillEnrollment(
    tenant,
    {
      email: parsed.data.email,
      productId: parsed.data.productId,
      expiresAt: parsed.data.expiresAt ?? null,
      language: parsed.data.language ?? 'pl',
      source: 'manual',
      sendEmail: parsed.data.doNotSendEmail !== true,
    },
    deps,
  );
};
